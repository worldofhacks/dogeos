export const ALLOWANCE_SELECTOR = "0xdd62ed3e";
export const APPROVE_SELECTOR = "0x095ea7b3";

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function assertHexAddress(value, fieldName) {
  const address = String(value ?? "");
  normalizeAddress(address, fieldName);
  return address;
}

function encodeAddress(value, fieldName) {
  return normalizeAddress(value, fieldName).slice(2).padStart(64, "0");
}

function positiveUint(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return normalized;
}

function nonNegativeUint(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return normalized;
}

function encodeUint(value, fieldName) {
  return nonNegativeUint(value, fieldName).toString(16).padStart(64, "0");
}

function decodeUint256Result(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a uint256 ABI result.`);
  }
  return BigInt(normalized);
}

export function encodeErc20AllowanceCall({ owner, spender }) {
  return `${ALLOWANCE_SELECTOR}${encodeAddress(owner, "owner")}${encodeAddress(spender, "spender")}`;
}

export function buildErc20ApproveCalldata({ spender, amount }) {
  return `${APPROVE_SELECTOR}${encodeAddress(spender, "spender")}${encodeUint(amount, "amount")}`;
}

export function buildErc20ApprovalPlan({ token, owner, spender, amount, allowance }) {
  const normalizedAmount = positiveUint(amount, "amount");
  const normalizedAllowance = nonNegativeUint(allowance, "allowance");
  const tokenAddress = assertHexAddress(token, "token");
  const spenderAddress = assertHexAddress(spender, "spender");
  assertHexAddress(owner, "owner");

  if (normalizedAllowance >= normalizedAmount) {
    return {
      approvalRequired: false,
      allowance: normalizedAllowance,
    };
  }

  return {
    approvalRequired: true,
    allowance: normalizedAllowance,
    transaction: {
      to: tokenAddress,
      data: buildErc20ApproveCalldata({
        spender: spenderAddress,
        amount: normalizedAmount,
      }),
      value: 0n,
    },
  };
}

export function createErc20ApprovalPlanner({ client, blockTag = "latest" } = {}) {
  if (!client?.call) {
    throw new Error("ERC-20 approval planning requires an RPC call client.");
  }

  return async function planErc20Approval({ token, owner, spender, amount }) {
    const allowanceResult = await client.call(
      {
        to: assertHexAddress(token, "token"),
        data: encodeErc20AllowanceCall({ owner, spender }),
      },
      blockTag,
    );
    const allowance = decodeUint256Result(allowanceResult, "allowance");

    return buildErc20ApprovalPlan({
      token,
      owner,
      spender,
      amount,
      allowance,
    });
  };
}
