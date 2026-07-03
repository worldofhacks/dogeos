import {
  APPROVAL_HASH,
  DOGEOS_CHAIN_ID_HEX,
  SWAP_HASH,
  WALLET_ADDRESS,
} from "./mock-data.mjs";

function uint256Hex(value) {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

export async function installMockWallet(page, options = {}) {
  const address = options.address ?? WALLET_ADDRESS;
  const chainId = options.chainId ?? DOGEOS_CHAIN_ID_HEX;
  const tokenBalance = options.tokenBalance ?? 1_000_000n * 10n ** 18n;
  const nativeBalance = options.nativeBalance ?? 100n * 10n ** 18n;

  await page.addInitScript(
    ({ address, chainId, tokenBalanceHex, nativeBalanceHex, approvalHash, swapHash }) => {
      let connected = false;
      let currentChainId = chainId;
      let sendCount = 0;

      function publish(detail = {}) {
        window.dispatchEvent(
          new CustomEvent("dogeos:sdk-wallet-updated", {
            detail: {
              address: connected ? address : "",
              chainId: connected ? currentChainId : "",
              walletLabel: connected ? "Mock Wallet" : "",
              walletSource: "injected",
              isConnecting: false,
              error: "",
              ...detail,
            },
          }),
        );
      }

      const provider = {
        async request({ method, params = [] }) {
          if (method === "eth_chainId") return currentChainId;
          if (method === "eth_accounts") return connected ? [address] : [];
          if (method === "eth_requestAccounts") {
            connected = true;
            publish();
            return [address];
          }
          if (method === "eth_getBalance") return nativeBalanceHex;
          if (method === "eth_call") return tokenBalanceHex;
          if (method === "eth_gasPrice") return "0x3b9aca00";
          if (method === "eth_signTypedData_v4") return `0x${"11".repeat(65)}`;
          if (method === "eth_sendTransaction") {
            sendCount += 1;
            return sendCount === 1 ? approvalHash : swapHash;
          }
          if (method === "eth_getTransactionReceipt") {
            const hash = params[0];
            return {
              transactionHash: hash,
              status: "0x1",
              blockNumber: "0x1234",
              gasUsed: "0x5208",
            };
          }
          if (method === "wallet_switchEthereumChain") {
            currentChainId = chainId;
            publish();
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            currentChainId = chainId;
            publish();
            return null;
          }
          throw new Error(`unsupported mock wallet method: ${method}`);
        },
      };

      window.dogeosAggregatorWallet = {
        walletSource: "injected",
        openModal: async () => {
          connected = true;
          publish();
          return address;
        },
        disconnect: async () => {
          connected = false;
          publish();
        },
        isConnected: () => connected,
        getAddress: () => (connected ? address : ""),
        getChainId: () => (connected ? currentChainId : ""),
        getProvider: () => provider,
        switchToDogeOS: async () => {
          currentChainId = chainId;
          publish();
          return true;
        },
        listInjectedWallets: () => [
          { label: "Mock MyDoge", preference: "mydoge", rdns: "mock.mydoge" },
        ],
      };

      window.__dogeswapMockWallet = {
        connect() {
          connected = true;
          publish();
        },
        disconnect() {
          connected = false;
          publish();
        },
        setChain(nextChainId) {
          currentChainId = nextChainId;
          publish();
        },
      };
    },
    {
      address,
      chainId,
      tokenBalanceHex: uint256Hex(tokenBalance),
      nativeBalanceHex: `0x${BigInt(nativeBalance).toString(16)}`,
      approvalHash: APPROVAL_HASH,
      swapHash: SWAP_HASH,
    },
  );
}
