import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const excludedDirs = new Set([".git", "node_modules", "dist", "coverage"]);

async function listRepoFiles(dir = repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      files.push(...await listRepoFiles(join(dir, entry.name)));
      continue;
    }

    files.push(join(dir, entry.name));
  }

  return files;
}

test("repository exposes no owned DEX/AMM/pool/factory surfaces (the audited DogeSwap router is allowed)", async () => {
  const files = (await listRepoFiles()).map((file) => relative(repoRoot, file));

  // The approved, audited, non-custodial DogeSwap swap router (and its vendored Foundry deps)
  // live under packages/contracts/. It owns NO pools/liquidity — it routes to EXTERNAL venues —
  // so its .sol / foundry.toml / deploy script are in scope (see docs/superpowers/specs).
  // EVM contract/tooling/deployment surfaces ANYWHERE ELSE remain out of scope.
  const isApprovedRouterPath = (file) => file.startsWith("packages/contracts/");
  const disallowedFiles = files.filter(
    (file) =>
      !isApprovedRouterPath(file) &&
      (/\.(sol|s\.sol)$/i.test(file) ||
        /(^|\/)(hardhat\.config|foundry\.toml|deploy[^/]*|contracts\/)/i.test(file)),
  );
  assert.deepEqual(disallowedFiles, []);

  // Owned AMM/DEX behavior (pool creation, liquidity provision) is forbidden EVERYWHERE,
  // including inside the router itself — it must only route through external venues.
  const ownedAmm = /\bcreatePool\s*\(|\bmintPosition\s*\(|\baddLiquidity\s*\(|\bdeployOwned\b/i;
  const firstPartySource = files.filter(
    (file) =>
      /^(packages|apps|scripts)\//.test(file) &&
      /\.(sol|mjs|js|cjs|ts|tsx|jsx)$/i.test(file) &&
      !file.includes("/lib/") &&
      !file.includes("/node_modules/") &&
      // The repository-scope guard files legitimately CONTAIN these patterns as detection
      // regexes/fixtures — they are the detector, not owned-AMM behavior.
      !/repository-scope|repositoryScope/.test(file),
  );
  const ownedAmmHits = [];
  for (const file of firstPartySource) {
    const body = await readFile(join(repoRoot, file), "utf8");
    if (ownedAmm.test(body)) ownedAmmHits.push(file);
  }
  assert.deepEqual(ownedAmmHits, []);
});

test("docs preserve the no-owned-DEX/pools/liquidity non-goal (an owned router is now in scope by design)", async () => {
  // The prior "no owned-router / no allowlist language" assertion was REMOVED: the program
  // deliberately added the audited DogeSwapRouter (a non-custodial router that owns no
  // pools/liquidity) — see docs/superpowers/specs/2026-06-06-*. The still-valid non-goal is
  // that we never own a DEX / pools / liquidity; assert that remains documented.
  const program = await readFile(
    join(repoRoot, "docs/superpowers/specs/2026-06-06-dogeos-premium-aggregator-v2-program.md"),
    "utf8",
  );
  assert.match(program, /no owned DEX/i, "program non-goals must forbid an owned DEX");
  assert.match(program, /pool factory|pool creation|liquidity management/i, "program non-goals must forbid owned pools/liquidity");
});

test("current DogeOS venue docs do not describe active sources as unconfirmed or blocked", async () => {
  const docs = [
    "docs/dogeos-testnet-dex-map.md",
    "docs/onchain-validation-2026-05-04.md",
  ];

  for (const file of docs) {
    const body = await readFile(join(repoRoot, file), "utf8");
    assert.doesNotMatch(body, /router\/quoter unconfirmed/i, file);
    assert.doesNotMatch(body, /execution remains blocked/i, file);
    assert.doesNotMatch(body, /not yet an executable route/i, file);
  }
});

