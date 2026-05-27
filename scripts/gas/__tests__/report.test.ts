import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { buildMarkdownGasReport, estimateCostWei } = require("../lib/report.cjs");

describe("router gas report helpers", () => {
  test("estimates wei cost from gas units and gas price", () => {
    expect(estimateCostWei("21000", "1000000000")).toBe("21000000000000");
  });

  test("renders a markdown report with deployment and function gas rows", () => {
    const report = buildMarkdownGasReport({
      generatedAt: "2026-05-23T00:00:00.000Z",
      compiler: "0.8.30",
      evmVersion: "prague",
      referenceGasPriceWei: "1000000000",
      rows: [
        {
          category: "deployment",
          action: "DogeOSSwapRouter.constructor",
          gasUsed: "100",
          estimatedCostWei: "100000000000",
          notes: "local deployment"
        },
        {
          category: "swap",
          action: "exactInput ERC20 -> ERC20",
          gasUsed: "200",
          estimatedCostWei: "200000000000",
          notes: "mock adapter"
        }
      ]
    });

    expect(report).toContain("Solidity `0.8.30`, EVM `prague`");
    expect(report).toContain("| deployment | `DogeOSSwapRouter.constructor` | `100` | `100000000000` | local deployment |");
    expect(report).toContain("No transaction was broadcast");
  });
});
