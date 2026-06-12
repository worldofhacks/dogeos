// permit2Approval.mjs — approval planning for DogeSwapRouter split swaps.
//
// The router pulls input EXCLUSIVELY through canonical Permit2
// AllowanceTransfer (it is never approved directly), so a split swap needs up
// to TWO one-time prerequisite transactions:
//   1. ERC20.approve(Permit2, amount)                        (token -> Permit2)
//   2. Permit2.approve(token, router, uint160 amount, uint48 expiration)
// Signature-based PERMIT2_PERMIT is deliberately not used: the app's wallet
// bridges have no verified eth_signTypedData_v4 path (see useWallet.js NOTE).
//
// The plan keeps the repo's exact-amount approval discipline and returns a
// `transactions` array; `transaction` mirrors the first pending step for
// backward compatibility with single-step consumers.

import { PERMIT2_ADDRESS } from "./dogeSwapRouterCalldata.mjs";
import {
  buildErc20ApproveCalldata,
  encodeErc20AllowanceCall,
} from "./erc20Approval.mjs";

export const PERMIT2_ALLOWANCE_SELECTOR = "0x927da105"; // allowance(address,address,address)
export const PERMIT2_APPROVE_SELECTOR = "0x87517c45"; // approve(address,address,uint160,uint48)

const UINT48_MAX = (1n << 48n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const DEFAULT_PERMIT2_EXPIRATION_SECONDS = 30n * 24n * 60n * 60n; // 30 days

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function encodeAddress(value, fieldName) {
  return normalizeAddress(value, fieldName).slice(2).padStart(64, "0");
}

function encodeUint(value, fieldName) {
  const bigint = BigInt(value);
  if (bigint < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return bigint.toString(16).padStart(64, "0");
}

function decodeWord(result, wordIndex, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  const wordStart = 2 + wordIndex * 64;
  const word = normalized.slice(wordStart, wordStart + 64);
  if (!/^0x[0-9a-f]*$/.test(normalized) || word.length !== 64) {
    throw new Error(`${fieldName} must contain ABI-encoded words.`);
  }
  return BigInt(`0x${word}`);
}

export function encodePermit2AllowanceCall({ owner, token, spender }) {
  return `${PERMIT2_ALLOWANCE_SELECTOR}${encodeAddress(owner, "owner")}${encodeAddress(token, "token")}${encodeAddress(spender, "spender")}`;
}

export function buildPermit2ApproveCalldata({ token, spender, amount, expiration }) {
  const normalizedAmount = BigInt(amount);
  const normalizedExpiration = BigInt(expiration);
  if (normalizedAmount <= 0n || normalizedAmount > UINT160_MAX) {
    throw new Error("Permit2 approval amount must fit uint160 and be greater than zero.");
  }
  if (normalizedExpiration <= 0n || normalizedExpiration > UINT48_MAX) {
    throw new Error("Permit2 approval expiration must fit uint48 and be greater than zero.");
  }
  return `${PERMIT2_APPROVE_SELECTOR}${encodeAddress(token, "token")}${encodeAddress(spender, "spender")}${encodeUint(normalizedAmount, "amount")}${encodeUint(normalizedExpiration, "expiration")}`;
}

export function createPermit2ApprovalPlanner({
  client,
  permit2 = PERMIT2_ADDRESS,
  blockTag = "latest",
  nowSeconds = () => Math.floor(Date.now() / 1_000),
  expirationSeconds = DEFAULT_PERMIT2_EXPIRATION_SECONDS,
} = {}) {
  if (!client?.call) {
    throw new Error("Permit2 approval planning requires an RPC call client.");
  }

  return async function planPermit2Approval({ token, owner, spender, amount }) {
    const normalizedAmount = BigInt(amount);
    if (normalizedAmount <= 0n) {
      throw new Error("amount must be greater than zero.");
    }
    const tokenAddress = normalizeAddress(token, "token");
    const routerAddress = normalizeAddress(spender, "spender");
    const permit2Address = normalizeAddress(permit2, "permit2");

    const [erc20AllowanceResult, permit2AllowanceResult] = await Promise.all([
      client.call(
        { to: tokenAddress, data: encodeErc20AllowanceCall({ owner, spender: permit2Address }) },
        blockTag,
      ),
      client.call(
        { to: permit2Address, data: encodePermit2AllowanceCall({ owner, token: tokenAddress, spender: routerAddress }) },
        blockTag,
      ),
    ]);

    const erc20Allowance = decodeWord(erc20AllowanceResult, 0, "ERC-20 allowance result");
    const permit2Amount = decodeWord(permit2AllowanceResult, 0, "Permit2 allowance result");
    const permit2Expiration = decodeWord(permit2AllowanceResult, 1, "Permit2 allowance result");

    const now = BigInt(nowSeconds());
    const transactions = [];

    if (erc20Allowance < normalizedAmount) {
      transactions.push({
        step: "erc20-approve-permit2",
        to: tokenAddress,
        data: buildErc20ApproveCalldata({ spender: permit2Address, amount: normalizedAmount }),
        value: 0n,
      });
    }

    if (permit2Amount < normalizedAmount || permit2Expiration <= now) {
      transactions.push({
        step: "permit2-approve-router",
        to: permit2Address,
        data: buildPermit2ApproveCalldata({
          token: tokenAddress,
          spender: routerAddress,
          amount: normalizedAmount,
          expiration: now + BigInt(expirationSeconds),
        }),
        value: 0n,
      });
    }

    return {
      approvalRequired: transactions.length > 0,
      allowance: erc20Allowance,
      permit2: {
        address: permit2Address,
        amount: permit2Amount,
        expiration: permit2Expiration,
      },
      ...(transactions.length > 0
        ? { transactions, transaction: transactions[0] }
        : {}),
    };
  };
}
