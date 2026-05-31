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

test("repository exposes no owned DEX contract, factory, or deployment surfaces", async () => {
  const files = await listRepoFiles();
  const disallowedFiles = files
    .map((file) => relative(repoRoot, file))
    .filter((file) =>
      /\.(sol|s\.sol)$/i.test(file) ||
      /(^|\/)(hardhat\.config|foundry\.toml|deploy[^/]*|contracts\/)/i.test(file),
    );

  assert.deepEqual(disallowedFiles, []);
});

test("current architecture docs describe direct venue execution instead of a future owned router path", async () => {
  const docs = await Promise.all(
    [
      "docs/dogeos-dex-aggregator-architecture.md",
      "docs/dex-aggregator-competitive-analysis.md",
      "docs/superpowers/specs/2026-05-30-dogeos-v2-v3-aggregator-design.md",
    ].map(async (file) => [file, await readFile(join(repoRoot, file), "utf8")]),
  );

  for (const [file, body] of docs) {
    assert.doesNotMatch(body, /aggregator (execution )?router,? if (deployed|required|needed)/i, file);
    assert.doesNotMatch(body, /narrow aggregator router/i, file);
    assert.doesNotMatch(body, /repository currently contains documentation, validation reports, screenshots, and empty script directories/i, file);
    assert.doesNotMatch(body, /does not contain frontend source, backend source, smart contracts, package manifests/i, file);
    assert.match(body, /directly through (the )?selected verified venue router/i, file);
  }
});

test("repository docs do not preserve owned-router or allowlist execution language", async () => {
  const docs = (await listRepoFiles())
    .map((file) => relative(repoRoot, file))
    .filter((file) => file.startsWith("docs/") && file.endsWith(".md"));

  for (const file of docs) {
    const body = await readFile(join(repoRoot, file), "utf8");
    assert.doesNotMatch(body, /\baggregator router\b/i, file);
    assert.doesNotMatch(body, /\ballowlisted?\b/i, file);
  }
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

test("repository docs describe provenance validation without recurring execution gates", async () => {
  const docs = (await listRepoFiles())
    .map((file) => relative(repoRoot, file))
    .filter((file) => file.startsWith("docs/") && file.endsWith(".md"));

  for (const file of docs) {
    const body = await readFile(join(repoRoot, file), "utf8");
    assert.doesNotMatch(body, /guarded by/i, file);
    assert.doesNotMatch(body, /execution gates?/i, file);
    assert.doesNotMatch(body, /before execution is enabled/i, file);
    assert.doesNotMatch(body, /\|\s*Execution readiness\s*\|\s*[^|\n]*blocked/i, file);
  }
});
