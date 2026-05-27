import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { validateLiveEvidence } = require("../lib/liveEvidence.cjs");

describe("live evidence security automation", () => {
  test("validates deployed router, adapter, allowlist, route preflight, and canary evidence", () => {
    const report = validateLiveEvidence({ cwd: process.cwd() });

    expect(report.ok).toBe(true);
    expect(report.summary.executableSources).toEqual(["muchfi-v2"]);
    expect(report.summary.quoteActiveSources).toEqual(["muchfi-v3", "barkswap-algebra"]);
    expect(report.checks.every((check: { ok: boolean }) => check.ok)).toBe(true);
    expect(report.artifacts.canary.receipt.transactionHash).toMatch(/^0x[0-9a-fA-F]{64}$/u);
  });
});
