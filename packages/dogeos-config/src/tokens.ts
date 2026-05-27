export interface TokenConfig {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  verifiedSource: "dogeos-faucet";
}

export const TOKENS = {
  WDOGE: {
    symbol: "WDOGE",
    name: "Wrapped Doge",
    address: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  },
  LBTC: {
    symbol: "LBTC",
    name: "Lombard Staked BTC",
    address: "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  },
  USD1: {
    symbol: "USD1",
    name: "World Liberty Financial USD",
    address: "0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  },
  USDT: {
    symbol: "USDT",
    name: "Tether",
    address: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
    decimals: 18,
    verifiedSource: "dogeos-faucet"
  }
} as const satisfies Record<string, TokenConfig>;

export const OFFICIAL_TOKENS = Object.values(TOKENS);
