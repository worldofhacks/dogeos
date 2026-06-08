import assert from "node:assert/strict";
import test from "node:test";

import {
  findRepositoryScopeViolations,
  isIgnoredRepositoryScopePath,
} from "../verify-repository-scope.mjs";

test("findRepositoryScopeViolations flags owned DEX contract and deployment surfaces", () => {
  const report = findRepositoryScopeViolations({
    files: [
      "contracts/DogeosV3Factory.sol",
      "foundry.toml",
      "scripts/deploy-owned-v3.mjs",
      "packages/aggregator/src/swap/ownedV3Surface.mjs",
      "package.json",
    ],
    fileContents: new Map([
      [
        "packages/aggregator/src/swap/ownedV3Surface.mjs",
        "export function mintPosition(manager) { return manager.createPool(); }\n",
      ],
    ]),
    packageScripts: {
      "deploy:dex": "forge script scripts/DeployOwnedV3.s.sol --broadcast",
      "build:web": "vite build",
    },
  });

  assert.equal(report.summary.hasBlockingMismatch, true);
  assert.deepEqual(
    report.violations.map((violation) => `${violation.kind}:${violation.path ?? violation.script}`).sort(),
    [
      "dex-deployment-file:scripts/deploy-owned-v3.mjs",
      "evm-contract-file:contracts/DogeosV3Factory.sol",
      "evm-tooling-config:foundry.toml",
      "owned-amm-content:packages/aggregator/src/swap/ownedV3Surface.mjs",
      "owned-dex-script:deploy:dex",
    ],
  );
});

test("findRepositoryScopeViolations ignores docs and vendored charting library assets", () => {
  const report = findRepositoryScopeViolations({
    files: [
      "docs/dogeos-testnet-dex-map.md",
      "packages/aggregator/src/sources/registry.mjs",
      "apps/web/src/public/advanced_charting_library/charting_library/bundles/contract-expiration.js",
    ],
    fileContents: new Map([
      ["docs/dogeos-testnet-dex-map.md", "External DEX deployment notes and router discovery.\n"],
      ["packages/aggregator/src/sources/registry.mjs", "export const source = { router, factory };\n"],
      [
        "apps/web/src/public/advanced_charting_library/charting_library/bundles/contract-expiration.js",
        "Show contract expiration.\n",
      ],
    ]),
    packageScripts: {
      "discover:liquidity": "node scripts/discover-dogeos-liquidity.mjs",
      "verify:sources": "node scripts/verify-dogeos-sources.mjs",
    },
  });

  assert.equal(report.summary.hasBlockingMismatch, false);
  assert.deepEqual(report.violations, []);
});

test("isIgnoredRepositoryScopePath excludes generated, dependency, temporary, and vendor paths", () => {
  assert.equal(isIgnoredRepositoryScopePath("node_modules/hardhat/config.js"), true);
  assert.equal(isIgnoredRepositoryScopePath("apps/web/dist/assets/index.js"), true);
  assert.equal(isIgnoredRepositoryScopePath(".tmp/solidity-agent-kit/Example.sol"), true);
  assert.equal(isIgnoredRepositoryScopePath(".worktrees/old/contracts/Owned.sol"), true);
  assert.equal(
    isIgnoredRepositoryScopePath(
      "apps/web/src/public/advanced_charting_library/charting_library/bundles/contract.js",
    ),
    true,
  );
  assert.equal(isIgnoredRepositoryScopePath("packages/aggregator/src/sources/registry.mjs"), false);
});
