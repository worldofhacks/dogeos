export type Address = `0x${string}`;

export interface ContractReader {
  read<T = unknown>(address: Address, abi: readonly string[], method: string, args?: readonly unknown[]): Promise<T>;
}

export interface V2PairState {
  pair: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: bigint;
}

export interface ClammPoolState {
  pool: Address;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}
