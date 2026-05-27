export const L1_GAS_PRICE_ORACLE = "0x5300000000000000000000000000000000000002" as const;

export const DOGEOS_TESTNET = {
  id: 6281971,
  name: "DogeOS Chikyu Testnet",
  nativeCurrency: {
    name: "DogeOS DOGE",
    symbol: "DOGE",
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.dogeos.com"],
      webSocket: ["wss://ws.rpc.testnet.dogeos.com"]
    }
  },
  blockExplorers: {
    default: {
      name: "DogeOS Blockscout",
      url: "https://blockscout.testnet.dogeos.com"
    }
  },
  contracts: {
    l1GasPriceOracle: L1_GAS_PRICE_ORACLE
  }
} as const;
