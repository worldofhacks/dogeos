const appUrl = typeof window === "undefined" ? "https://dogeos.local" : window.location.origin;
const runtimeConfig = typeof window === "undefined" ? {} : window.DOGEOS_AGGREGATOR_CONFIG ?? {};

export const DOGEOS_CHIKYU_TESTNET = {
  id: 6_281_971,
  name: "DogeOS Chikyū Testnet",
  nativeCurrency: { name: "DOGE", symbol: "DOGE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.dogeos.com/"] } },
  blockExplorers: {
    default: {
      name: "DogeOS Blockscout",
      url: "https://blockscout.testnet.dogeos.com",
    },
  },
  testnet: true,
};

export const DOGECOIN_MAINNET = {
  id: 1,
  name: "Dogecoin",
  nativeCurrency: { name: "DOGE", symbol: "DOGE", decimals: 8 },
  rpcUrls: { default: { http: [] } },
};

function chainIdNumber(chain) {
  const value = chain?.id;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^eip155:\d+$/.test(value)) {
    return Number(value.split(":")[1]);
  }
  return Number(value);
}

export function mergeDogeosChains(chains = {}) {
  const evmChains = Array.isArray(chains.evm) ? chains.evm : [];
  const hasDogeOS = evmChains.some((chain) => chainIdNumber(chain) === DOGEOS_CHIKYU_TESTNET.id);

  return {
    ...chains,
    evm: hasDogeOS ? evmChains : [DOGEOS_CHIKYU_TESTNET, ...evmChains],
  };
}

// The Connect Kit modal populates its wallet list (MyDoge, MetaMask, Rainbow,
// WalletConnect, ...) from `config.connectors`, which MUST come from the SDK's
// async `getConnectors()` helper — it cannot be hand-authored. Without it the
// modal renders empty, so we thread the resolved list into the live config.
export function mergeDogeosConnectors(connectors) {
  return Array.isArray(connectors) && connectors.length > 0 ? connectors : undefined;
}

export const dogeConfig = {
  clientId: runtimeConfig.dogeosClientId || import.meta.env.VITE_DOGEOS_CLIENT_ID || "",
  walletConnectProjectId:
    runtimeConfig.walletConnectProjectId || import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined,
  defaultConnectChain: "evm",
  chains: mergeDogeosChains({
    evm: [DOGEOS_CHIKYU_TESTNET],
    dogecoin: [DOGECOIN_MAINNET],
  }),
  // Populated at runtime from getConnectors() in DogeOSSdkWalletProvider; left
  // undefined here so the SDK falls back to its own bundled connectors until the
  // async list resolves.
  connectors: undefined,
  metadata: {
    name: "DogeOS Aggregator",
    description: "Fast DogeOS v2 and v3 DEX aggregator",
    url: appUrl,
    icons: [`${appUrl}/favicon.svg`],
  },
  login: {
    basicLogins: ["email", "externalWallets"],
    socialLogins: [{ type: "google" }, { type: "x" }],
  },
  theme: {
    defaultTheme: "light",
    themes: {
      light: {
        colors: {
          primary: {
            DEFAULT: "#0d9488",
            foreground: "#ffffff",
          },
          content1: "#ffffff",
        },
      },
    },
  },
};
