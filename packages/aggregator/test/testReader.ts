import type { ContractReader } from "../src/adapters/types";

export function buildFakeReader(values: Record<string, unknown>): ContractReader {
  return {
    async read(address, _abi, method, args = []) {
      const key = `${address}:${method}:${args.join(",")}`;
      if (!(key in values)) {
        throw new Error(`missing fake read for ${key}`);
      }
      return values[key];
    }
  };
}
