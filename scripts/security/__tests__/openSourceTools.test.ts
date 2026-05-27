import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { OPEN_SOURCE_SECURITY_TOOLS, buildToolAvailabilityReport } = require("../lib/openSourceTools.cjs");

describe("open-source security tooling manifest", () => {
  test("tracks the minimal external security tools without adding package dependencies", () => {
    expect(OPEN_SOURCE_SECURITY_TOOLS.map((tool: { id: string }) => tool.id)).toEqual([
      "slither",
      "aderyn",
      "osv-scanner",
      "semgrep"
    ]);
    expect(OPEN_SOURCE_SECURITY_TOOLS.every((tool: { command: string; purpose: string }) => tool.command && tool.purpose)).toBe(true);
  });

  test("builds a non-strict availability report for local developer machines", () => {
    const report = buildToolAvailabilityReport({ cwd: process.cwd(), strict: false });

    expect(report.ok).toBe(true);
    expect(report.tools).toHaveLength(OPEN_SOURCE_SECURITY_TOOLS.length);
    expect(report.tools.every((tool: { installed: boolean }) => typeof tool.installed === "boolean")).toBe(true);
  });
});
