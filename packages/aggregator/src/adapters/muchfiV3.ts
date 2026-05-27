import type { Address, ClammPoolState, ContractReader } from "./types";

const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
] as const;

export async function readMuchFiV3Pool(reader: ContractReader, pool: Address): Promise<ClammPoolState> {
  const [token0, token1, fee, liquidity, slot0] = await Promise.all([
    reader.read<Address>(pool, V3_POOL_ABI, "token0"),
    reader.read<Address>(pool, V3_POOL_ABI, "token1"),
    reader.read<number>(pool, V3_POOL_ABI, "fee"),
    reader.read<bigint>(pool, V3_POOL_ABI, "liquidity"),
    reader.read<readonly [bigint, number]>(pool, V3_POOL_ABI, "slot0")
  ]);

  return {
    pool,
    token0,
    token1,
    fee: Number(fee),
    liquidity: BigInt(liquidity),
    sqrtPriceX96: BigInt(slot0[0]),
    tick: Number(slot0[1])
  };
}
