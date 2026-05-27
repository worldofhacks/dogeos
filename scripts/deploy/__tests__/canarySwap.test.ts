import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  calculateMinAmountOut,
  parseBoundedInteger,
  evidenceFilenames,
  parseBoundedBps,
  validatePositiveAmount
} = require("../lib/canarySwap.cjs");

describe("canary swap helpers", () => {
  test("calculates minimum output from slippage bps without rounding above the quote", () => {
    expect(calculateMinAmountOut(1000n, 100)).toBe(990n);
    expect(calculateMinAmountOut(101n, 50)).toBe(101n);
    expect(calculateMinAmountOut(0n, 100)).toBe(0n);
  });

  test("bounds canary slippage to conservative basis points", () => {
    expect(parseBoundedBps("200", "DOGEOS_CANARY_SLIPPAGE_BPS", 1000)).toBe(200);
    expect(() => parseBoundedBps("-1", "DOGEOS_CANARY_SLIPPAGE_BPS", 1000)).toThrow(/DOGEOS_CANARY_SLIPPAGE_BPS/);
    expect(() => parseBoundedBps("1001", "DOGEOS_CANARY_SLIPPAGE_BPS", 1000)).toThrow(/DOGEOS_CANARY_SLIPPAGE_BPS/);
  });

  test("bounds deadline seconds to an operational window", () => {
    expect(parseBoundedInteger("600", "DOGEOS_CANARY_DEADLINE_SECONDS", 60, 3600)).toBe(600);
    expect(() => parseBoundedInteger("59", "DOGEOS_CANARY_DEADLINE_SECONDS", 60, 3600)).toThrow(
      /DOGEOS_CANARY_DEADLINE_SECONDS/
    );
    expect(() => parseBoundedInteger("3601", "DOGEOS_CANARY_DEADLINE_SECONDS", 60, 3600)).toThrow(
      /DOGEOS_CANARY_DEADLINE_SECONDS/
    );
  });

  test("rejects zero dust swap amounts", () => {
    expect(validatePositiveAmount(1n, "amountIn")).toBe(1n);
    expect(() => validatePositiveAmount(0n, "amountIn")).toThrow(/amountIn/);
  });

  test("builds stable evidence filenames from an ISO timestamp", () => {
    expect(evidenceFilenames("2026-05-27T10:11:12.345Z")).toEqual({
      jsonFilename: "canary-v2-swap-2026-05-27T101112345Z.json",
      latestJsonFilename: "canary-v2-swap-latest.json",
      markdownFilename: "canary-v2-swap-2026-05-27.md"
    });
  });
});
