export const OFFICIAL_DOGEOS_TOKENS = [
  {
    symbol: "WDOGE",
    name: "Wrapped Doge",
    address: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "LBTC",
    name: "Lombard Staked BTC",
    address: "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    address: "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "USD1",
    name: "World Liberty Financial USD",
    address: "0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
  {
    symbol: "USDT",
    name: "Tether",
    address: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
    decimals: 18,
    provenance: "dogeos-faucet-rpc-validated",
  },
];

export function getOfficialToken(symbol) {
  return OFFICIAL_DOGEOS_TOKENS.find((token) => token.symbol === symbol);
}
