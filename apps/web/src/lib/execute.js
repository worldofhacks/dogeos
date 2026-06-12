// execute.js — framework-agnostic swap transaction lifecycle.
//
// Extracted from app.js (buildSwap / ensureTokenApproval / sendWalletTransaction
// / waitForTransactionReceipt / chain+account guards + the error-message mapping)
// so the React swap flow runs the EXACT same on-chain path the legacy DOM app
// used. No DOM, no React — pure async functions over the wallet bridge + API.
//
// The real flow on confirm:
//   1. bind the live best route to the connected wallet (recipient/deadline/slip).
//   2. /approval (ERC-20 sell token) → if approvalRequired, send + await receipt.
//   3. /swap → FRESH router calldata → send + await receipt.
//   4. friendly error mapping (insufficient DOGE → faucet; router reverts).
//
// The backend re-quotes inside /approval and /swap (refreshSwapQuoteBeforeBuild),
// so the swap tx always comes from a fresh quote even if the route is a little
// stale. We still validate chain id (6281971) + the connected account first.
import { postApproval, postSwap, DOGEOS_CHAIN_ID } from "./api.js";

export const DOGEOS_FAUCET_URL = "https://faucet.testnet.dogeos.com";

/* ---------- wallet bridge access (read-only; never mutated) ---------- */
function sdkWallet() {
  return (typeof window !== "undefined" && window.dogeosAggregatorWallet) || null;
}

/* ---------- chain id helpers (ported from app.js) ---------- */
export function parseChainId(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && /^eip155:\d+$/i.test(value)) {
    return BigInt(value.split(":")[1]);
  }
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

export function chainIdMatchesDogeos(value) {
  return parseChainId(value) === BigInt(DOGEOS_CHAIN_ID);
}

function addressesMatch(left, right) {
  return String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();
}

function shortAddress(value) {
  const text = String(value ?? "");
  if (text.length <= 12) return text;
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}

/* ---------- hex / wei helpers (ported from app.js) ---------- */
function bigintFromQuantity(value, fieldName = "quantity") {
  try {
    return BigInt(value ?? 0);
  } catch {
    throw new Error(`${fieldName} must be a numeric quantity.`);
  }
}

function hexQuantity(value) {
  const quantity = bigintFromQuantity(value);
  if (quantity < 0n) throw new Error("Hex quantity cannot be negative.");
  return `0x${quantity.toString(16)}`;
}

function formatDogeWei(value) {
  if (value === undefined || value === null) return "-";
  try {
    const units = BigInt(value);
    const base = 10n ** 18n;
    const whole = units / base;
    const fraction = (units % base).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return String(value);
  }
}

/* ---------- error-message mapping (ported from app.js) ---------- */
function rawMessage(error, fallback = "Request failed.") {
  if (typeof error === "string") return error;
  return error?.shortMessage ?? error?.message ?? fallback;
}

export function nativeDogeFundingMessage(requiredWei, availableWei) {
  return `Insufficient DOGE for DogeOS gas: need ${formatDogeWei(requiredWei)} DOGE, wallet has ${formatDogeWei(availableWei)} DOGE. Faucet: ${DOGEOS_FAUCET_URL}`;
}

// Map raw provider / router errors to friendly text. Covers native-DOGE funding
// (faucet link), the documented router reverts, and generic fallbacks.
export function transactionErrorMessage(error) {
  const message = rawMessage(error, "Transaction could not be built.");

  const nativeMatch = message.match(
    /Insufficient native DOGE balance:\s*required\s*(\d+),\s*available\s*(\d+)/i,
  );
  if (nativeMatch) {
    return nativeDogeFundingMessage(nativeMatch[1], nativeMatch[2]);
  }
  if (/Insufficient DOGE for DogeOS gas/i.test(message)) {
    return message;
  }
  if (/insufficient funds|testnet doge|native doge balance|not enough.*doge/i.test(message)) {
    return `Insufficient DOGE for DogeOS gas. Use the official DogeOS testnet faucet: ${DOGEOS_FAUCET_URL}`;
  }

  // Friendly router-revert translations (min-out / deadline / paused / permit /
  // balance). These mirror the common WowSwap-style router revert strings.
  if (/user (rejected|denied|cancel)/i.test(message)) {
    return "You cancelled the request in your wallet.";
  }
  if (/INSUFFICIENT_OUTPUT_AMOUNT|min.?out|slippage|price moved|too little received/i.test(message)) {
    return "Price moved past your slippage tolerance. Refresh the quote or raise slippage, then try again.";
  }
  if (/EXPIRED|deadline/i.test(message)) {
    return "The swap deadline passed before it was mined. Refresh the quote and try again.";
  }
  if (/paused|halted/i.test(message)) {
    return "This venue is paused right now. Pick another route or try again later.";
  }
  if (/permit|allowance|ERC20: transfer amount exceeds allowance/i.test(message)) {
    return "Token approval is missing or insufficient. Approve the token and try the swap again.";
  }
  if (/transfer amount exceeds balance|insufficient balance/i.test(message)) {
    return "Insufficient token balance for this swap.";
  }

  // Strip any backend faucet URL to the canonical one.
  return message.replace(/https?:\/\/\S*faucet\S*/gi, DOGEOS_FAUCET_URL);
}

/* ---------- chain + account guards (ported from app.js) ---------- */
// Resolve a provider that is on DogeOS Chikyū AND matches the connected account.
// Mirrors app.js's ensureWalletReadyForEvmTransaction.
export async function ensureWalletReadyForDogeos(
  sender,
  {
    providerMessage = "Switching wallet to DogeOS Chikyū",
    missingProviderMessage = "Connect an EVM wallet before sending a transaction.",
    onStatus,
  } = {},
) {
  const wallet = sdkWallet();
  let provider = wallet?.getProvider?.();
  if (!provider?.request) {
    throw new Error(missingProviderMessage);
  }

  const switchProviderToDogeOS = async () => {
    onStatus?.(providerMessage);
    const switched = await wallet.switchToDogeOS?.();
    if (switched === false) {
      throw new Error("Switch wallet to DogeOS Chikyū Testnet before sending a transaction.");
    }
    provider = wallet.getProvider?.() ?? provider;
  };

  if (!chainIdMatchesDogeos(wallet.getChainId?.())) {
    await switchProviderToDogeOS();
  }

  let providerChainId = await provider.request({ method: "eth_chainId" });
  if (!chainIdMatchesDogeos(providerChainId)) {
    await switchProviderToDogeOS();
    providerChainId = await provider.request({ method: "eth_chainId" });
  }
  if (!chainIdMatchesDogeos(providerChainId)) {
    throw new Error("Switch wallet to DogeOS Chikyū Testnet before sending a transaction.");
  }

  const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
  const providerAddress = Array.isArray(accounts) && accounts[0] ? String(accounts[0]) : "";
  if (providerAddress && sender && !addressesMatch(providerAddress, sender)) {
    throw new Error(
      `Connected wallet ${shortAddress(sender)} does not match active provider account ${shortAddress(
        providerAddress,
      )}. Disconnect and reconnect the intended wallet.`,
    );
  }

  return provider;
}

/* ---------- bounded wallet interaction ---------- */
// Some wallets (notably Rainbow on chains it doesn't support) leave a
// request promise pending FOREVER instead of rejecting — without a bound the
// pending modal spins until the tab dies. Every wallet prompt is therefore
// raced against a timeout and the flow's abort signal (the modal's cancel).
const WALLET_RESPONSE_TIMEOUT_MS = 120_000;

export const SWAP_CANCELLED_MESSAGE =
  "Swap cancelled. If you already confirmed in your wallet, that transaction may still complete on-chain.";

function awaitWalletResponse(promise, { signal, timeoutMs = WALLET_RESPONSE_TIMEOUT_MS, label = "The wallet" } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    };
    function onAbort() {
      cleanup();
      reject(new Error(SWAP_CANCELLED_MESSAGE));
    }
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not respond. Check your wallet extension and try again.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

// Map the gas-speed setting to a tip as a fraction of the LIVE base fee, and
// set both EIP-1559 fields so the transaction is always valid on a tiny-base-
// fee L2. Tier thresholds mirror useSettings.gasTier (eco < 1.5 <= normal <= 6
// < fast). On failure to read the base fee, leave gas to the wallet.
const GAS_TIP_FRACTION_BPS = { eco: 0n, normal: 5_000n, fast: 20_000n }; // 0% / 50% / 200% of base

export function gasSpeedTier(priorityFeeGwei) {
  const g = Number(priorityFeeGwei);
  if (!Number.isFinite(g) || g <= 0) return null;
  return g < 1.5 ? "eco" : g <= 6 ? "normal" : "fast";
}

export async function applyGasSpeed(request, provider, priorityFeeGwei) {
  const tier = gasSpeedTier(priorityFeeGwei);
  if (!tier) return request;
  let baseFeeWei = 0n;
  try {
    baseFeeWei = BigInt(await provider.request({ method: "eth_gasPrice" }));
  } catch {
    return request; // can't read base fee — let the wallet pick gas
  }
  if (baseFeeWei <= 0n) return request;
  const tip = (baseFeeWei * GAS_TIP_FRACTION_BPS[tier]) / 10_000n;
  // 2x base-fee headroom (standard) guarantees maxFeePerGas >= tip.
  request.maxFeePerGas = hexQuantity(baseFeeWei * 2n + tip);
  request.maxPriorityFeePerGas = hexQuantity(tip);
  return request;
}

/* ---------- send + receipt (ported from app.js) ---------- */
export async function sendWalletTransaction(transaction, sender, options = {}) {
  const provider = await ensureWalletReadyForDogeos(sender, options);

  const request = {
    from: sender,
    chainId: hexQuantity(transaction.chainId ?? DOGEOS_CHAIN_ID),
    to: transaction.to,
    data: transaction.data,
    value: hexQuantity(transaction.value ?? 0),
  };
  if (transaction.gas !== undefined) {
    request.gas = hexQuantity(transaction.gas);
  }
  // Gas-speed tip. DogeOS base fees are tiny (~0.015 gwei), so a fixed gwei
  // tip would dwarf the base fee and violate EIP-1559's invariant
  // `maxFeePerGas >= maxPriorityFeePerGas` (the wallet sets maxFeePerGas from
  // the base fee). So scale the tip to the LIVE base fee and always set a
  // valid maxFeePerGas = 2*baseFee + tip ourselves.
  await applyGasSpeed(request, provider, options.priorityFeeGwei);

  try {
    return await awaitWalletResponse(
      provider.request({
        method: "eth_sendTransaction",
        params: [request],
      }),
      { signal: options.signal, label: "The wallet" },
    );
  } catch (error) {
    throw new Error(transactionErrorMessage(error));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll eth_getTransactionReceipt until success / revert / timeout (ported 1:1).
export async function waitForTransactionReceipt(
  txHash,
  { timeoutMs = 120_000, pollMs = 3_000, label = "Transaction", signal } = {},
) {
  const provider = sdkWallet()?.getProvider?.();
  if (!provider?.request) {
    throw new Error("Connect an EVM wallet before reading transaction receipts.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Receipt watch cancelled.");
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error(`${label} reverted ${shortAddress(txHash)}`);
      }
      return receipt;
    }
    await sleep(pollMs);
  }
  throw new Error(`${label} confirmation timed out ${shortAddress(txHash)}`);
}

/* ---------- quote binding ---------- */
// Default tx deadline if the caller doesn't supply one (5 minutes).
const DEFAULT_DEADLINE_SECONDS = 300;

// Bind the live best route to the connected wallet for execution. The backend
// re-quotes inside /approval + /swap, but we still send recipient/deadline/slip.
// `deadlineSeconds` comes from the user's trade-defaults setting (tx deadline).
export function bindExecutionQuote(bestRoute, sender, slippageBps, deadlineSeconds) {
  const ttl =
    Number.isFinite(deadlineSeconds) && deadlineSeconds > 0
      ? Math.floor(deadlineSeconds)
      : DEFAULT_DEADLINE_SECONDS;
  return {
    ...bestRoute,
    slippageBps: String(slippageBps ?? bestRoute.slippageBps ?? "50"),
    recipient: sender,
    sender,
    deadline: Math.floor(Date.now() / 1000) + ttl,
  };
}

function mergeExecutionQuote(baseQuote, nextQuote) {
  if (!nextQuote) return baseQuote;
  return {
    ...baseQuote,
    ...nextQuote,
    recipient: nextQuote.recipient ?? baseQuote.recipient,
    sender: nextQuote.sender ?? baseQuote.sender,
    deadline: nextQuote.deadline ?? baseQuote.deadline,
    slippageBps: nextQuote.slippageBps ?? baseQuote.slippageBps,
  };
}

// Is the sell token native DOGE? Native-in skips ERC-20 approval entirely.
export function isNativeSell(sellToken) {
  const sym = String(sellToken?.symbol ?? "").toUpperCase();
  const addr = String(sellToken?.address ?? "").toLowerCase();
  return (
    sym === "DOGE" ||
    addr === "" ||
    addr === "0x0000000000000000000000000000000000000000" ||
    addr === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  );
}

/* ---------- Permit2 in-swap authorization (split routes) ---------- */
// Preferred: sign the backend-provided EIP-712 PermitSingle (gasless) and let
// the router apply it inside the swap transaction. Fallback for wallets
// without eth_signTypedData_v4: send the on-chain Permit2.approve instead
// (the classic second approval). User rejection aborts — it is a consent step.
async function obtainPermit2Authorization({ permit, sender, sellToken, report, signal, priorityFeeGwei }) {
  const provider = await ensureWalletReadyForDogeos(sender, {
    missingProviderMessage: "Connect an EVM wallet before approving.",
  });

  try {
    report({ phase: "permit-sign", symbol: sellToken?.symbol });
    const signature = await awaitWalletResponse(
      provider.request({
        method: "eth_signTypedData_v4",
        params: [sender, JSON.stringify(permit.typedData)],
      }),
      { signal, label: "The wallet" },
    );
    const message = permit.typedData.message;
    return {
      permitSingle: {
        details: message.details,
        spender: message.spender,
        sigDeadline: message.sigDeadline,
      },
      signature,
    };
  } catch (error) {
    const message = String(error?.message ?? "");
    const unsupported =
      error?.code === -32601 || /not (supported|found|implemented)|does not exist|unsupported method/i.test(message);
    if (!unsupported) {
      // User rejected (or a real failure) — surface it, don't silently degrade.
      throw new Error(transactionErrorMessage(error));
    }
  }

  // Typed-data signing unavailable: classic on-chain Permit2 approval.
  if (permit.fallbackTransaction) {
    report({ phase: "approve-sign", symbol: sellToken?.symbol });
    const hash = await sendWalletTransaction(permit.fallbackTransaction, sender, {
      providerMessage: "Switching wallet to DogeOS Chikyū for approval",
      missingProviderMessage: "Connect an EVM wallet before approving.",
      signal,
      priorityFeeGwei,
    });
    report({ phase: "approve-pending", symbol: sellToken?.symbol, hash });
    await waitForTransactionReceipt(hash, { label: "Approval", signal });
    report({ phase: "approve-done", symbol: sellToken?.symbol, hash });
  }
  return null;
}

/* ---------- the full lifecycle ---------- */
// Drives review→approval→swap→receipt. `report` receives lifecycle phase
// updates so the UI can render the right sub-step. Returns { txHash, receipt }.
//
// phases: 'approve-check' | 'approve-sign' | 'approve-pending' | 'approve-done'
//         | 'swap-build' | 'swap-sign' | 'swap-pending' | 'confirmed'
export async function executeSwap({
  bestRoute,
  sellToken,
  sender,
  slippageBps,
  deadlineSeconds,
  priorityFeeGwei,
  report = () => {},
  signal,
} = {}) {
  if (!bestRoute) throw new Error("No executable route to swap.");
  if (!sender) throw new Error("Connect a wallet before swapping.");

  // Bind the live quote to this wallet (recipient/deadline/slippage).
  let quote = bindExecutionQuote(bestRoute, sender, slippageBps, deadlineSeconds);

  // 1) Approval — only for ERC-20 sell tokens. Native DOGE-in skips it.
  if (!isNativeSell(sellToken)) {
    report({ phase: "approve-check" });
    const approval = await postApproval({ quote, sender });
    quote = approval.quote ? mergeExecutionQuote(quote, approval.quote) : quote;

    // Split routes pull through Permit2: at most ONE on-chain approval
    // (ERC20→Permit2, max, once per token ever) plus a gasless EIP-712
    // PermitSingle signature executed in-swap. Direct venue routes keep the
    // single classic exact-amount approve.
    const approvalTransactions =
      Array.isArray(approval.transactions) && approval.transactions.length > 0
        ? approval.transactions
        : approval.transaction
          ? [approval.transaction]
          : [];

    if (approval.approvalRequired && approvalTransactions.length > 0) {
      for (const approvalTransaction of approvalTransactions) {
        report({ phase: "approve-sign", symbol: sellToken?.symbol });
        const approvalHash = await sendWalletTransaction(approvalTransaction, sender, {
          providerMessage: "Switching wallet to DogeOS Chikyū for approval",
          missingProviderMessage: "Connect an EVM wallet before approving.",
          signal,
          priorityFeeGwei,
        });
        report({ phase: "approve-pending", symbol: sellToken?.symbol, hash: approvalHash });
        await waitForTransactionReceipt(approvalHash, { label: "Approval", signal });
        report({ phase: "approve-done", symbol: sellToken?.symbol, hash: approvalHash });
      }
    }

    if (approval.permit?.required) {
      const permitted = await obtainPermit2Authorization({
        permit: approval.permit,
        sender,
        sellToken,
        report,
        signal,
        priorityFeeGwei,
      });
      if (permitted) {
        quote = { ...quote, permit2Permit: permitted };
      }
    }
  }

  // 2) Swap — FRESH router calldata from /swap (backend re-quotes).
  if (signal?.aborted) throw new Error(SWAP_CANCELLED_MESSAGE);
  report({ phase: "swap-build" });
  const swap = await postSwap({ quote, sender });
  const transaction = swap.transaction;
  if (!transaction) throw new Error("Swap transaction could not be built.");
  const executionQuote = mergeExecutionQuote(quote, swap.quote);

  report({ phase: "swap-sign" });
  const txHash = await sendWalletTransaction(transaction, sender, { signal, priorityFeeGwei });
  report({ phase: "swap-pending", hash: txHash });

  // 3) Receipt — poll until included / reverted / timeout.
  const receipt = await waitForTransactionReceipt(txHash, { label: "Swap", signal });
  report({ phase: "confirmed", hash: txHash, receipt });

  return { txHash, receipt, quote: executionQuote };
}

/* ---------- activity log ---------- */
const HISTORY_KEY = "doge.history";
const HISTORY_CAP = 40;

// Append a confirmed swap to localStorage('doge.history'), newest-first, cap 40.
export function logSwapActivity(entry) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = [
      {
        paySym: entry.paySym,
        getSym: entry.getSym,
        payAmt: entry.payAmt,
        recv: entry.recv,
        venue: entry.venue,
        hash: entry.hash,
        status: "confirmed",
        ts: entry.ts ?? Date.now(),
      },
      ...(Array.isArray(list) ? list : []),
    ].slice(0, HISTORY_CAP);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    // Notify same-tab listeners (Activity view) — the `storage` event only
    // fires in OTHER tabs, so the active tab needs an explicit signal.
    window.dispatchEvent(new Event("doge:history-updated"));
  } catch {
    /* localStorage unavailable / quota — non-fatal */
  }
}
