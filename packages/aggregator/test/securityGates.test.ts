import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getExecutableSources, getSource } from "../src/sources/registry";

const ROOT = path.resolve(__dirname, "../../..");
const DEPLOYMENTS_DIR = path.join(ROOT, "deployments", "dogeos-chikyu");
const DOCS_DIR = path.join(ROOT, "docs", "dexv3");
const DOGEOS_CHAIN_ID = 6281971;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/u;

function readJson<T = any>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function latestOnchainValidationPath(): string {
  const candidates = fs
    .readdirSync(DOCS_DIR)
    .filter((name) => /^onchain-validation-\d{4}-\d{2}-\d{2}\.json$/u.test(name))
    .sort();
  expect(candidates.length).toBeGreaterThan(0);
  return path.join(DOCS_DIR, candidates[candidates.length - 1]);
}

describe("aggregator security gates", () => {
  it("allows execution only for sources backed by live router, adapter, allowlist, preflight, and canary evidence", () => {
    expect(getExecutableSources().map((source) => source.sourceId)).toEqual(["muchfi-v2"]);

    const router = readJson(path.join(DEPLOYMENTS_DIR, "router-latest.json"));
    const adapter = readJson(path.join(DEPLOYMENTS_DIR, "adapter-latest.json"));
    const allowlist = readJson(path.join(DEPLOYMENTS_DIR, "adapter-allowlist-preflight-latest.json"));
    const route = readJson(path.join(DEPLOYMENTS_DIR, "route-v2-preflight-latest.json"));
    const canary = readJson(path.join(DEPLOYMENTS_DIR, "canary-v2-swap-latest.json"));

    expect(router.chainId).toBe(DOGEOS_CHAIN_ID);
    expect(adapter.chainId).toBe(DOGEOS_CHAIN_ID);
    expect(allowlist.chainId).toBe(DOGEOS_CHAIN_ID);
    expect(route.chainId).toBe(DOGEOS_CHAIN_ID);
    expect(canary.chainId).toBe(DOGEOS_CHAIN_ID);

    expect(router.status).toBe(1);
    expect(adapter.status).toBe(1);
    expect(allowlist.alreadyAllowed).toBe(true);
    expect(route.adapterAddress).toBe(adapter.adapterAddress);
    expect(canary.routerAddress).toBe(router.routerAddress);
    expect(canary.adapterAddress).toBe(adapter.adapterAddress);
    expect(canary.receipt.status).toBe(1);
    expect(canary.receipt.transactionHash).toMatch(TX_HASH);
    expect(BigInt(canary.actualAmountOut)).toBeGreaterThanOrEqual(BigInt(canary.minAmountOut));
    expect(BigInt(canary.receipt.gasUsed)).toBeLessThanOrEqual(BigInt(canary.estimatedGas));
    expect(Object.values(canary.postChecks).every((value) => value === true || value === false)).toBe(true);
    expect(canary.postChecks).toEqual({
      adapterAllowed: true,
      outputMetMinimum: true,
      routerAdapterAllowanceReset: true,
      routerPaused: false,
      routerUsdcDeltaZero: true,
      routerWdogeDeltaZero: true
    });
  });

  it("keeps quote-active CLAMM sources backed by on-chain pool evidence but blocked from execution", () => {
    const validation = readJson(latestOnchainValidationPath());
    const muchFiV3 = getSource("muchfi-v3");
    const barkswap = getSource("barkswap-algebra");

    expect(muchFiV3.quoteSupport).toBe("enabled");
    expect(muchFiV3.executionSupport).toBe("disabled");
    expect(barkswap.quoteSupport).toBe("enabled");
    expect(barkswap.executionSupport).toBe("disabled");

    expect(validation.contracts.muchFiV3Factory.bytecodePresent).toBe(true);
    expect(validation.contracts.muchFiV3UsdcWdoge500.bytecodePresent).toBe(true);
    expect(validation.contracts.muchFiV3UsdcWdoge2500.bytecodePresent).toBe(true);
    expect(validation.contracts.barkswapNewFactory.bytecodePresent).toBe(true);
    expect(validation.contracts.barkswapUsdcWdogeNew.bytecodePresent).toBe(true);
    expect(BigInt(validation.muchFiV3.usdcWdoge500.liquidity)).toBeGreaterThan(0n);
    expect(BigInt(validation.barkswap.usdcWdoge.liquidity)).toBeGreaterThan(0n);
    expect(validation.decision.externalExecution).toContain("muchfi-v2");
  });
});
