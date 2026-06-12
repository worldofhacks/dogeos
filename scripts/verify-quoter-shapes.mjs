// verify-quoter-shapes.mjs — one-time live cross-check of quoter return shapes
// and the assumed V2 swap fee against the deployed DogeOS testnet contracts.
//
// Why this exists (2026-06-11 repo audit, trading-correctness #2 and #4):
//   • The live Algebra decoder reads a >=6-word QuoterV2-style return (amount
//     at word 0, gas at word 4, fee at word 5) while the repo's own "verified"
//     BARKSWAP_ALGEBRA_QUOTER_ABI declares only 2 outputs. Both cannot describe
//     the same deployed contract, and upstream Algebra QuoterV2 returns
//     (amountOut, amountIn, sqrtPriceX96After, ticksCrossed, gasEstimate, fee)
//     for BOTH directions — which would make the exact-output decode of word 0
//     read amountOut instead of amountIn.
//   • Every V2 quote assumes a hard-coded 30 bps fee that was never checked
//     against the venue's own getAmountsOut.
//
// Run: node scripts/verify-quoter-shapes.mjs
// Exits non-zero if any live result contradicts what the aggregator decodes.
import { createJsonRpcClient } from "../packages/dogeos-rpc/src/index.mjs";
import { listSources } from "../packages/aggregator/src/sources/registry.mjs";
import { DOGEOS_CHAIN } from "../packages/config/src/chains.mjs";

const ONE = 10n ** 18n; // all official DogeOS testnet tokens use 18 decimals

const SELECTORS = {
  getReserves: "0x0902f1ac",
  getAmountsOut: "0xd06ca61f",
  v3QuoteExactInputSingle: "0xc6a5026a",
  algebraQuoteExactInputSingle: "0xe94764c4",
  algebraQuoteExactOutputSingle: "0x62086e24",
};

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return String(address).toLowerCase().slice(2).padStart(64, "0");
}

function words(result) {
  const hex = String(result ?? "0x").slice(2);
  const out = [];
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  return out;
}

function fmt(units) {
  return `${units} (${Number(units) / 1e18})`;
}

const failures = [];
function check(label, condition, detail) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

const client = createJsonRpcClient({ rpcUrl: DOGEOS_CHAIN.rpcUrls[0] });
const sources = listSources();
const bySourceId = Object.fromEntries(sources.map((source) => [source.sourceId, source]));

// ---------------------------------------------------------------------------
// Barkswap Algebra quoter shape (audit finding #2)
// ---------------------------------------------------------------------------
{
  const source = bySourceId["barkswap-algebra"];
  const pool = source.pools[0]; // WDOGE/USDC
  const [tokenA, tokenB] = [pool.token0, pool.token1];
  console.log(`\nBarkswap Algebra quoter ${source.quoter} (pool ${pool.pair})`);

  const exactInData =
    SELECTORS.algebraQuoteExactInputSingle +
    addressWord(tokenA) +
    addressWord(tokenB) +
    addressWord("0x0000000000000000000000000000000000000000") +
    word(ONE) +
    word(0n);
  const exactInRaw = await client.call({ to: source.quoter, data: exactInData }, "latest");
  const exactInWords = words(exactInRaw);
  console.log(`  exactInput raw return: ${exactInWords.length} words`);
  exactInWords.forEach((value, index) => console.log(`    word ${index}: ${value}`));

  check(
    "algebra exactInput returns >=6 words (QuoterV2-style, matches live decoder)",
    exactInWords.length >= 6,
    `${exactInWords.length} words`,
  );

  const quotedOut = exactInWords[0];
  if (exactInWords.length >= 6) {
    // Request the exact output the pool just quoted; QuoterV2-style returns
    // (amountOut, amountIn, ...) for BOTH directions, so word 0 should round
    // back to ~the requested amountOut and word 1 should be the input amount.
    const target = quotedOut / 2n;
    const exactOutData =
      SELECTORS.algebraQuoteExactOutputSingle +
      addressWord(tokenA) +
      addressWord(tokenB) +
      addressWord("0x0000000000000000000000000000000000000000") +
      word(target) +
      word(0n);
    const exactOutRaw = await client.call({ to: source.quoter, data: exactOutData }, "latest");
    const exactOutWords = words(exactOutRaw);
    console.log(`  exactOutput(amountOut=${fmt(target)}) raw return: ${exactOutWords.length} words`);
    exactOutWords.forEach((value, index) => console.log(`    word ${index}: ${value}`));

    const word0IsAmountOut = exactOutWords[0] === target;
    const word1LooksLikeInput =
      exactOutWords.length > 1 && exactOutWords[1] > 0n && exactOutWords[1] !== target;
    console.log(
      `  word0 === requested amountOut: ${word0IsAmountOut}; word1 plausible amountIn: ${word1LooksLikeInput}`,
    );
    check(
      "algebra exactOutput amountIn is at word 1 (word 0 echoes amountOut)",
      word0IsAmountOut && word1LooksLikeInput,
      `word0=${exactOutWords[0]} word1=${exactOutWords[1] ?? "<missing>"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// MuchFi V3 quoter shape (decoder reads amount at word 0, gas at word 3)
// ---------------------------------------------------------------------------
{
  const source = bySourceId["muchfi-v3"];
  if (source?.quoter) {
    const pool = source.pools[0];
    console.log(`\nMuchFi V3 quoter ${source.quoter} (pool ${pool.pair}, feeTier ${pool.feeTier})`);
    const data =
      SELECTORS.v3QuoteExactInputSingle +
      addressWord(pool.token0) +
      addressWord(pool.token1) +
      word(ONE) +
      word(pool.feeTier) +
      word(0n);
    const raw = await client.call({ to: source.quoter, data }, "latest");
    const v3Words = words(raw);
    console.log(`  exactInput raw return: ${v3Words.length} words`);
    v3Words.forEach((value, index) => console.log(`    word ${index}: ${value}`));
    check("v3 exactInput returns >=4 words (amount w0, gas w3)", v3Words.length >= 4, `${v3Words.length} words`);
  }
}

// ---------------------------------------------------------------------------
// MuchFi V2: validate the hard-coded 30 bps fee against getAmountsOut
// ---------------------------------------------------------------------------
{
  const source = bySourceId["muchfi-v2"];
  const pool = source.pools[0];
  console.log(`\nMuchFi V2 router ${source.router} (pool ${pool.pair})`);

  const reservesRaw = await client.call({ to: pool.address, data: SELECTORS.getReserves }, "latest");
  const [reserve0, reserve1] = words(reservesRaw);
  console.log(`  reserves: ${fmt(reserve0)} / ${fmt(reserve1)}`);

  const amountIn = ONE;
  const path = [pool.token0, pool.token1];
  const data =
    SELECTORS.getAmountsOut +
    word(amountIn) +
    word(64n) +
    word(2n) +
    addressWord(path[0]) +
    addressWord(path[1]);
  const raw = await client.call({ to: source.router, data }, "latest");
  const returned = words(raw);
  const routerAmountOut = returned[3]; // [offset, length, amounts[0], amounts[1]]
  console.log(`  router getAmountsOut(1e18): ${fmt(routerAmountOut)}`);

  let matchedFeeBps = null;
  for (const feeBps of [30n, 25n, 20n, 10n, 5n, 100n]) {
    const feeFactor = 10_000n - feeBps;
    const amountInWithFee = amountIn * feeFactor;
    const localOut = (amountInWithFee * reserve1) / (reserve0 * 10_000n + amountInWithFee);
    if (localOut === routerAmountOut) {
      matchedFeeBps = feeBps;
      break;
    }
  }
  const configuredFeeBps = source.feeBps ?? 30n;
  console.log(`  implied venue fee: ${matchedFeeBps === null ? "no candidate matched" : `${matchedFeeBps} bps`} (registry: ${configuredFeeBps} bps)`);
  check(
    "muchfi-v2 on-chain fee matches the registry feeBps the aggregator quotes with",
    matchedFeeBps === configuredFeeBps,
    `implied ${matchedFeeBps} bps vs configured ${configuredFeeBps} bps`,
  );
}

console.log("");
if (failures.length > 0) {
  console.error(`FAILED checks:\n - ${failures.join("\n - ")}`);
  process.exit(1);
}
console.log("All live quoter-shape and fee checks passed.");
