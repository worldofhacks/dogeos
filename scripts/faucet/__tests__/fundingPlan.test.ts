import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  OFFICIAL_DOGEOS_FAUCET_URL,
  buildFundingPlan,
  formatFundingMarkdown,
  hoursUntilEligible,
  lastClaimedAtByAddressFromState,
  markAddressClaimed,
  normalizeFundingAddresses,
  parseTargetDoge
} = require("../lib/fundingPlan.cjs");

const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SECONDARY = "0x0000000000000000000000000000000000000001";

describe("DogeOS faucet funding plan", () => {
  test("normalizes configured project wallet addresses without accepting invalid input", () => {
    expect(normalizeFundingAddresses(`${DEPLOYER}, ${SECONDARY}`)).toEqual([DEPLOYER, SECONDARY]);
    expect(() => normalizeFundingAddresses(`${DEPLOYER}, not-an-address`)).toThrow(/valid EVM address/u);
  });

  test("derives whole-hour eligibility from the official twenty-four hour faucet cadence", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");

    expect(hoursUntilEligible(undefined, now)).toBe(0);
    expect(hoursUntilEligible("2026-05-27T11:59:00.000Z", now)).toBe(0);
    expect(hoursUntilEligible("2026-05-28T00:00:00.000Z", now)).toBe(12);
  });

  test("builds a conservative funding plan with balance deficits and claim windows", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const plan = buildFundingPlan({
      addresses: [DEPLOYER, SECONDARY],
      balancesWeiByAddress: {
        [DEPLOYER]: 2_000_000_000_000_000_000n,
        [SECONDARY]: 0n
      },
      lastClaimedAtByAddress: {
        [DEPLOYER]: "2026-05-28T06:15:00.000Z",
        [SECONDARY]: "2026-05-27T06:15:00.000Z"
      },
      now,
      targetDoge: "5"
    });

    expect(plan.faucetUrl).toBe(OFFICIAL_DOGEOS_FAUCET_URL);
    expect(plan.summary.totalDeficitDoge).toBe("8.0");
    expect(plan.summary.fundingRecommendedWallets).toBe(1);
    expect(plan.wallets).toMatchObject([
      {
        address: DEPLOYER,
        balanceDoge: "2.0",
        eligibleNow: false,
        fundingRecommended: false,
        hoursUntilEligible: 19,
        targetDoge: "5.0"
      },
      {
        address: SECONDARY,
        balanceDoge: "0.0",
        eligibleNow: true,
        fundingRecommended: true,
        hoursUntilEligible: 0,
        targetDoge: "5.0"
      }
    ]);
  });

  test("can treat the configured amount as a top-up above the live wallet balance", () => {
    const now = new Date("2026-05-28T12:00:00.000Z");
    const plan = buildFundingPlan({
      addresses: [DEPLOYER],
      balancesWeiByAddress: {
        [DEPLOYER]: 42_068_782_673_100_144_711n
      },
      lastClaimedAtByAddress: {},
      now,
      targetDoge: "40",
      targetMode: "top-up"
    });

    expect(plan.targetMode).toBe("top-up");
    expect(plan.targetInputDoge).toBe("40.0");
    expect(plan.summary.totalDeficitDoge).toBe("40.0");
    expect(plan.summary.fundingRecommendedWallets).toBe(1);
    expect(plan.wallets[0]).toMatchObject({
      balanceDoge: "42.068782673100144711",
      deficitDoge: "40.0",
      fundingRecommended: true,
      targetDoge: "82.068782673100144711",
      targetInputDoge: "40.0",
      targetMode: "top-up"
    });
  });

  test("refuses an interval shorter than the official faucet cadence", () => {
    expect(() =>
      buildFundingPlan({
        addresses: [DEPLOYER],
        balancesWeiByAddress: { [DEPLOYER]: 0n },
        lastClaimedAtByAddress: {},
        minimumIntervalHours: 12,
        now: new Date("2026-05-28T12:00:00.000Z"),
        targetDoge: "5"
      })
    ).toThrow(/minimum interval cannot be below 24 hours/u);
  });

  test("formats evidence without leaking private-key-like environment values", () => {
    const plan = buildFundingPlan({
      addresses: [DEPLOYER],
      balancesWeiByAddress: { [DEPLOYER]: 0n },
      lastClaimedAtByAddress: {},
      now: new Date("2026-05-28T12:00:00.000Z"),
      targetDoge: "5"
    });

    const markdown = formatFundingMarkdown(plan, {
      DEPLOYER_PRIVATE_KEY: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    });

    expect(markdown).toContain(OFFICIAL_DOGEOS_FAUCET_URL);
    expect(markdown).toContain("Manual claim required");
    expect(markdown).not.toContain("0123456789abcdef");
  });

  test("parses positive target DOGE amounts for LP seed planning", () => {
    expect(parseTargetDoge("12.5")).toBe("12.5");
    expect(() => parseTargetDoge("0")).toThrow(/greater than zero/u);
    expect(() => parseTargetDoge("abc")).toThrow(/valid DOGE amount/u);
  });

  test("records manual claim timestamps by normalized wallet address", () => {
    const state = markAddressClaimed(
      { claims: {} },
      DEPLOYER.toLowerCase(),
      new Date("2026-05-28T12:00:00.000Z")
    );

    expect(state.claims[DEPLOYER]).toEqual({
      lastClaimedAt: "2026-05-28T12:00:00.000Z",
      source: "manual-faucet-claim"
    });
    expect(lastClaimedAtByAddressFromState(state)).toEqual({
      [DEPLOYER]: "2026-05-28T12:00:00.000Z"
    });
  });
});
