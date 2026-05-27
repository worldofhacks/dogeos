import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_MUCHFI_V2_FACTORY_ADDRESS,
  DEFAULT_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS,
  DEFAULT_USDC_ADDRESS,
  DEFAULT_WDOGE_ADDRESS,
  deriveAddress,
  normalizePrivateKey,
  parseDotEnv,
  redactSecret,
  resolveDeploymentConfig
} = require("../lib/env.cjs");

const HARDHAT_DEV_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARDHAT_DEV_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("deployment env helpers", () => {
  test("parses .env style assignments without exposing comments", () => {
    const parsed = parseDotEnv(`
      # local values
      export DOGEOS_RPC_URL="https://rpc.testnet.dogeos.com"
      DEPLOYER_ADDRESS=${HARDHAT_DEV_ADDRESS}
    `);

    expect(parsed.DOGEOS_RPC_URL).toBe("https://rpc.testnet.dogeos.com");
    expect(parsed.DEPLOYER_ADDRESS).toBe(HARDHAT_DEV_ADDRESS);
  });

  test("normalizes a private key without logging or mutating it", () => {
    expect(normalizePrivateKey(HARDHAT_DEV_PRIVATE_KEY)).toBe(HARDHAT_DEV_PRIVATE_KEY);
    expect(normalizePrivateKey(HARDHAT_DEV_PRIVATE_KEY.slice(2))).toBe(HARDHAT_DEV_PRIVATE_KEY);
  });

  test("rejects placeholder private keys", () => {
    expect(() => normalizePrivateKey("replace_with_local_testnet_key_never_commit_real_values")).toThrow(
      /DEPLOYER_PRIVATE_KEY/
    );
  });

  test("derives the deployer address from the configured private key", () => {
    expect(deriveAddress(HARDHAT_DEV_PRIVATE_KEY)).toBe(HARDHAT_DEV_ADDRESS);
  });

  test("redacts private-key-like values for diagnostics", () => {
    expect(redactSecret(HARDHAT_DEV_PRIVATE_KEY)).toBe("0xac09...ff80");
  });

  test("rejects a DEPLOYER_ADDRESS that does not match the private key", () => {
    expect(() =>
      resolveDeploymentConfig({
        env: {
          DEPLOYER_PRIVATE_KEY: HARDHAT_DEV_PRIVATE_KEY,
          DEPLOYER_ADDRESS: "0x0000000000000000000000000000000000000001"
        }
      })
    ).toThrow(/DEPLOYER_ADDRESS/);
  });

  test("uses DogeOS source defaults and treats deployment placeholders as unset", () => {
    const config = resolveDeploymentConfig({
      env: {
        DEPLOYER_PRIVATE_KEY: HARDHAT_DEV_PRIVATE_KEY,
        DEPLOYER_ADDRESS: HARDHAT_DEV_ADDRESS,
        DOGEOS_SWAP_ROUTER_ADDRESS: "replace_after_deployment",
        DOGEOS_V2_PAIR_ADAPTER_ADDRESS: "replace_after_adapter_deployment"
      }
    });

    expect(config.deployerAddress).toBe(HARDHAT_DEV_ADDRESS);
    expect(config.routerAddress).toBeUndefined();
    expect(config.adapterAddress).toBeUndefined();
    expect(config.wDogeAddress).toBe(DEFAULT_WDOGE_ADDRESS);
    expect(config.usdcAddress).toBe(DEFAULT_USDC_ADDRESS);
    expect(config.muchFiV2FactoryAddress).toBe(DEFAULT_MUCHFI_V2_FACTORY_ADDRESS);
    expect(config.muchFiV2UsdcWdogePairAddress).toBe(DEFAULT_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS);
  });
});
