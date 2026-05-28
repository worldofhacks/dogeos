const { formatEther, getAddress, isAddress, parseEther, ZeroAddress } = require("ethers");

const OFFICIAL_DOGEOS_FAUCET_URL = "https://faucet.testnet.dogeos.com/";
const OFFICIAL_MINIMUM_INTERVAL_HOURS = 24;

function normalizeFundingAddresses(value) {
  const rawAddresses = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const normalized = [];

  for (const rawAddress of rawAddresses) {
    const candidate = String(rawAddress || "").trim();
    if (!candidate) {
      continue;
    }
    if (!isAddress(candidate)) {
      throw new Error(`DOGEOS_FAUCET_ADDRESSES contains an invalid EVM address: ${candidate}`);
    }

    const address = getAddress(candidate);
    if (address === ZeroAddress) {
      throw new Error("DOGEOS_FAUCET_ADDRESSES cannot include the zero address");
    }
    if (!seen.has(address)) {
      seen.add(address);
      normalized.push(address);
    }
  }

  if (normalized.length === 0) {
    throw new Error("At least one project wallet address is required for the faucet funding plan");
  }

  return normalized;
}

function parseTargetDoge(value) {
  const rawValue = String(value || "").trim();
  let parsed;

  try {
    parsed = parseEther(rawValue);
  } catch {
    throw new Error("DOGEOS_FAUCET_TARGET_DOGE must be a valid DOGE amount");
  }

  if (parsed <= 0n) {
    throw new Error("DOGEOS_FAUCET_TARGET_DOGE must be greater than zero");
  }

  return formatEther(parsed);
}

function parseTargetDogeWei(value) {
  return parseEther(parseTargetDoge(value));
}

function assertMinimumInterval(minimumIntervalHours) {
  const interval = Number(minimumIntervalHours || OFFICIAL_MINIMUM_INTERVAL_HOURS);
  if (!Number.isFinite(interval) || interval < OFFICIAL_MINIMUM_INTERVAL_HOURS) {
    throw new Error("DOGEOS_FAUCET_MIN_INTERVAL_HOURS minimum interval cannot be below 24 hours");
  }

  return interval;
}

function parseDate(value, label) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }

  return date;
}

function hoursUntilEligible(lastClaimedAt, now = new Date(), minimumIntervalHours = OFFICIAL_MINIMUM_INTERVAL_HOURS) {
  const interval = assertMinimumInterval(minimumIntervalHours);
  const lastClaimedDate = parseDate(lastClaimedAt, "lastClaimedAt");
  if (!lastClaimedDate) {
    return 0;
  }

  const elapsedMs = now.getTime() - lastClaimedDate.getTime();
  const remainingMs = interval * 60 * 60 * 1000 - elapsedMs;
  return Math.max(Math.ceil(remainingMs / (60 * 60 * 1000)), 0);
}

function nextEligibleAt(lastClaimedAt, now, minimumIntervalHours) {
  const lastClaimedDate = parseDate(lastClaimedAt, "lastClaimedAt");
  if (!lastClaimedDate) {
    return now.toISOString();
  }

  return new Date(lastClaimedDate.getTime() + minimumIntervalHours * 60 * 60 * 1000).toISOString();
}

function normalizedValueMap(map, label, valueNormalizer = (value) => value) {
  const normalized = {};
  for (const [rawAddress, rawValue] of Object.entries(map || {})) {
    if (!isAddress(rawAddress)) {
      throw new Error(`${label} contains an invalid EVM address: ${rawAddress}`);
    }
    normalized[getAddress(rawAddress)] = valueNormalizer(rawValue);
  }

  return normalized;
}

function normalizeClaimState(state = {}) {
  const claims = {};
  for (const [rawAddress, claim] of Object.entries(state.claims || {})) {
    if (!isAddress(rawAddress)) {
      throw new Error(`claim state contains an invalid EVM address: ${rawAddress}`);
    }

    const normalizedAddress = getAddress(rawAddress);
    claims[normalizedAddress] = {
      lastClaimedAt: parseDate(claim.lastClaimedAt, "lastClaimedAt").toISOString(),
      source: claim.source || "manual-faucet-claim"
    };
  }

  return {
    ...state,
    claims
  };
}

function markAddressClaimed(state, address, now = new Date()) {
  const [normalizedAddress] = normalizeFundingAddresses([address]);
  const normalizedState = normalizeClaimState(state);

  return {
    ...normalizedState,
    claims: {
      ...normalizedState.claims,
      [normalizedAddress]: {
        lastClaimedAt: now.toISOString(),
        source: "manual-faucet-claim"
      }
    }
  };
}

function lastClaimedAtByAddressFromState(state) {
  const normalizedState = normalizeClaimState(state);
  return Object.fromEntries(
    Object.entries(normalizedState.claims).map(([address, claim]) => [address, claim.lastClaimedAt])
  );
}

function toWei(value, label) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`${label} must be a bigint-compatible wei amount`);
  }
}

function buildFundingPlan({
  addresses,
  balancesWeiByAddress,
  lastClaimedAtByAddress = {},
  minimumIntervalHours = OFFICIAL_MINIMUM_INTERVAL_HOURS,
  now = new Date(),
  targetDoge
}) {
  const interval = assertMinimumInterval(minimumIntervalHours);
  const normalizedAddresses = normalizeFundingAddresses(addresses);
  const targetWei = parseTargetDogeWei(targetDoge);
  const balances = normalizedValueMap(balancesWeiByAddress, "balancesWeiByAddress", (value) =>
    toWei(value, "balance")
  );
  const lastClaims = normalizedValueMap(lastClaimedAtByAddress, "lastClaimedAtByAddress");

  let totalBalanceWei = 0n;
  let totalDeficitWei = 0n;

  const wallets = normalizedAddresses.map((address) => {
    const balanceWei = balances[address] || 0n;
    const deficitWei = balanceWei >= targetWei ? 0n : targetWei - balanceWei;
    const lastClaimedAt = lastClaims[address];
    const waitHours = hoursUntilEligible(lastClaimedAt, now, interval);
    const eligibleNow = waitHours === 0;
    const fundingRecommended = eligibleNow && deficitWei > 0n;

    totalBalanceWei += balanceWei;
    totalDeficitWei += deficitWei;

    return {
      address,
      balanceDoge: formatEther(balanceWei),
      balanceWei: balanceWei.toString(),
      deficitDoge: formatEther(deficitWei),
      deficitWei: deficitWei.toString(),
      eligibleNow,
      fundingRecommended,
      hoursUntilEligible: waitHours,
      lastClaimedAt: lastClaimedAt || null,
      nextEligibleAt: nextEligibleAt(lastClaimedAt, now, interval),
      targetDoge: formatEther(targetWei),
      targetWei: targetWei.toString()
    };
  });

  return {
    faucetUrl: OFFICIAL_DOGEOS_FAUCET_URL,
    generatedAt: now.toISOString(),
    minimumIntervalHours: interval,
    policy: {
      automatedClaiming: false,
      captchaBypass: false,
      note: "Manual faucet claim required; this planner records cadence, balances, and evidence only."
    },
    summary: {
      eligibleWallets: wallets.filter((wallet) => wallet.eligibleNow).length,
      fundingRecommendedWallets: wallets.filter((wallet) => wallet.fundingRecommended).length,
      totalBalanceDoge: formatEther(totalBalanceWei),
      totalBalanceWei: totalBalanceWei.toString(),
      totalDeficitDoge: formatEther(totalDeficitWei),
      totalDeficitWei: totalDeficitWei.toString(),
      walletCount: wallets.length
    },
    wallets
  };
}

function formatFundingMarkdown(plan) {
  const rows = plan.wallets
    .map((wallet) =>
      [
        wallet.address,
        wallet.balanceDoge,
        wallet.targetDoge,
        wallet.deficitDoge,
        wallet.eligibleNow ? "yes" : "no",
        wallet.fundingRecommended ? "yes" : "no",
        wallet.hoursUntilEligible.toString(),
        wallet.lastClaimedAt || "not recorded"
      ].join(" | ")
    )
    .join("\n");

  return `# DogeOS Chikyu Faucet Funding Plan

Generated: ${plan.generatedAt}

Official faucet: ${plan.faucetUrl}

Manual claim required. The DogeOS testnet faucet is protected by reCAPTCHA and the published cadence is one claim per 24 hours, so this script does not automate claims or attempt to bypass rate limits.

## Summary

- Wallets tracked: ${plan.summary.walletCount}
- Eligible now: ${plan.summary.eligibleWallets}
- Funding recommended: ${plan.summary.fundingRecommendedWallets}
- Total balance: ${plan.summary.totalBalanceDoge} DOGE
- Target deficit: ${plan.summary.totalDeficitDoge} DOGE
- Minimum claim interval: ${plan.minimumIntervalHours} hours

## Wallets

address | balance DOGE | target DOGE | deficit DOGE | eligible now | funding recommended | hours until eligible | last claim
--- | ---: | ---: | ---: | --- | --- | ---: | ---
${rows}

## Operator Steps

1. Open ${plan.faucetUrl}.
2. Use only eligible project wallets with a positive target deficit.
3. Complete the faucet claim manually.
4. After a successful claim, run \`pnpm faucet:plan -- --mark-claimed <address>\` so the next plan preserves the 24-hour cadence.
`;
}

module.exports = {
  OFFICIAL_DOGEOS_FAUCET_URL,
  OFFICIAL_MINIMUM_INTERVAL_HOURS,
  buildFundingPlan,
  formatFundingMarkdown,
  hoursUntilEligible,
  lastClaimedAtByAddressFromState,
  markAddressClaimed,
  normalizeFundingAddresses,
  parseTargetDoge
};
