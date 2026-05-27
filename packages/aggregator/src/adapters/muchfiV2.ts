import type { Address, ContractReader, V2PairState } from "./types";

const V2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
] as const;

export async function readMuchFiV2Pair(reader: ContractReader, pair: Address): Promise<V2PairState> {
  const [token0, token1, reserves] = await Promise.all([
    reader.read<Address>(pair, V2_PAIR_ABI, "token0"),
    reader.read<Address>(pair, V2_PAIR_ABI, "token1"),
    reader.read<readonly [bigint, bigint, bigint]>(pair, V2_PAIR_ABI, "getReserves")
  ]);

  return {
    pair,
    token0,
    token1,
    reserve0: BigInt(reserves[0]),
    reserve1: BigInt(reserves[1]),
    blockTimestampLast: BigInt(reserves[2])
  };
}

export function estimateV2ExactIn({
  amountIn,
  reserveIn,
  reserveOut,
  feeNumerator = 997n,
  feeDenominator = 1000n
}: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  feeNumerator?: bigint;
  feeDenominator?: bigint;
}): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return 0n;
  }

  const amountInWithFee = amountIn * feeNumerator;
  return (amountInWithFee * reserveOut) / (reserveIn * feeDenominator + amountInWithFee);
}
