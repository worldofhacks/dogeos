import type { Address, ClammPoolState, ContractReader } from "./types";

const ALGEBRA_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint16)",
  "function liquidity() view returns (uint128)",
  "function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, bool unlocked)"
] as const;

export async function readBarkswapAlgebraPool(reader: ContractReader, pool: Address): Promise<ClammPoolState> {
  const [token0, token1, fee, liquidity, globalState] = await Promise.all([
    reader.read<Address>(pool, ALGEBRA_POOL_ABI, "token0"),
    reader.read<Address>(pool, ALGEBRA_POOL_ABI, "token1"),
    reader.read<number>(pool, ALGEBRA_POOL_ABI, "fee"),
    reader.read<bigint>(pool, ALGEBRA_POOL_ABI, "liquidity"),
    reader.read<readonly [bigint, number]>(pool, ALGEBRA_POOL_ABI, "globalState")
  ]);

  return {
    pool,
    token0,
    token1,
    fee: Number(fee),
    liquidity: BigInt(liquidity),
    sqrtPriceX96: BigInt(globalState[0]),
    tick: Number(globalState[1])
  };
}
