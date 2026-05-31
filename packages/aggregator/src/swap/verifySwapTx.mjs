import { resolveDataFinalityFeeWei } from "../fees/dataFinalityFee.mjs";

function assertHexAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
}

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex calldata.`);
  }
}

function normalizeGasBufferBps(value) {
  const normalized = BigInt(value);
  if (normalized < 10_000n) {
    throw new Error("gasBufferBps must be at least 10000.");
  }
  return normalized;
}

function bufferedGasLimit(estimatedGas, gasBufferBps) {
  return (estimatedGas * gasBufferBps + 9_999n) / 10_000n;
}

function transactionRequest({ transaction, sender }) {
  assertHexAddress(sender, "sender");
  assertHexAddress(transaction.to, "transaction.to");
  assertHexData(transaction.data, "transaction.data");

  const value = transaction.value ?? 0n;
  if (BigInt(value) < 0n) {
    throw new Error("transaction.value must be zero or greater.");
  }

  return {
    from: sender,
    to: transaction.to,
    data: transaction.data,
    value,
  };
}

export async function verifySwapTransaction({
  client,
  transaction,
  sender,
  gasBufferBps = 12_000n,
  blockTag = "latest",
  dataFinalityFeeWei,
} = {}) {
  const request = transactionRequest({ transaction, sender });

  if (!client?.call || !client?.estimateGas) {
    throw new Error("Swap verification requires RPC call and estimateGas methods.");
  }

  const buffer = normalizeGasBufferBps(gasBufferBps);

  await client.call(request, blockTag);
  const estimatedGas = await client.estimateGas(request);
  const exactDataFinalityFeeWei =
    dataFinalityFeeWei === undefined
      ? undefined
      : await resolveDataFinalityFeeWei(dataFinalityFeeWei, {
          transaction,
          request,
          sender,
          blockTag,
        });

  const verification = {
    status: "simulated",
    estimatedGas,
    gasLimit: bufferedGasLimit(estimatedGas, buffer),
    gasBufferBps: buffer,
    blockTag,
  };

  if (exactDataFinalityFeeWei !== undefined) {
    verification.dataFinalityFeeWei = exactDataFinalityFeeWei;
  }

  return verification;
}
