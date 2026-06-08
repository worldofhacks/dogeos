import assert from "node:assert/strict";
import test from "node:test";

import {
  openDogeosSdkWalletModal,
  switchDogeosSdkAccountToChain,
} from "../../../apps/web/src/sdk-chain-switch.js";

const dogeosChain = {
  id: 6_281_971,
  name: "DogeOS Chikyu Testnet",
  rpcUrls: { default: { http: ["https://rpc.testnet.dogeos.com/"] } },
};

function createProvider({
  accounts = ["0x1111111111111111111111111111111111111111"],
  chainId = "0x1",
} = {}) {
  const calls = [];
  let chainKnown = false;

  return {
    calls,
    async request({ method, params }) {
      calls.push({ method, params });

      if (method === "eth_chainId") return chainKnown ? "0x5fdaf3" : chainId;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
      if (method === "wallet_switchEthereumChain") {
        if (!chainKnown) throw new Error("Chain Id not supported");
        chainId = params[0].chainId;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        chainKnown = true;
        chainId = params[0].chainId;
        return null;
      }

      throw new Error(`Unexpected method ${method}`);
    },
  };
}

test("SDK chain switch fails with an actionable DogeOS chain message when the SDK returns false", async () => {
  const account = {
    switchChain: async () => false,
  };

  await assert.rejects(
    () => switchDogeosSdkAccountToChain(account, dogeosChain),
    /DogeOS Chikyu Testnet \(6281971\) was not accepted/,
  );
});

test("SDK chain switch falls back to EIP-1193 add-chain flow for unsupported-chain SDK errors", async () => {
  const provider = createProvider();
  const account = {
    switchChain: async () => {
      throw new Error("Chain Id not supported");
    },
  };

  assert.equal(
    await switchDogeosSdkAccountToChain(account, dogeosChain, {
      globalObject: { ethereum: provider },
    }),
    true,
  );

  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ],
  );
  assert.equal(provider.calls[2].params[0].chainId, "0x5fdaf3");
});

test("SDK chain switch also falls back to EIP-1193 add-chain flow when the SDK returns false", async () => {
  const provider = createProvider();
  const account = {
    switchChain: async () => false,
  };

  assert.equal(
    await switchDogeosSdkAccountToChain(account, dogeosChain, {
      globalObject: { ethereum: provider },
    }),
    true,
  );

  assert.equal(
    provider.calls.some((call) => call.method === "wallet_addEthereumChain"),
    true,
  );
});

test("SDK wallet modal falls back to a direct injected DogeOS connection on unsupported-chain errors", async () => {
  const provider = createProvider();

  const result = await openDogeosSdkWalletModal({
    chainInfo: dogeosChain,
    globalObject: { ethereum: provider },
    openModal: async () => {
      throw new Error("Chain Id not supported");
    },
  });

  assert.equal(result.address, "0x1111111111111111111111111111111111111111");
  assert.equal(result.chainId, "0x5fdaf3");
  assert.equal(result.chainType, "evm");
  assert.equal(result.provider, provider);
  // SDK-first: the redundant pre-switch before openModal() was removed, so the
  // injected fallback now requests accounts first, then performs the add/switch.
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
      "eth_chainId",
    ],
  );
});

test("SDK wallet modal is the primary connect path — openModal() handles MyDoge, the injected provider is untouched", async () => {
  const mydoge = createProvider({
    accounts: ["0xdddddddddddddddddddddddddddddddddddddddd"],
    chainId: "0x5fdaf3",
  });
  mydoge.info = {
    name: "MyDoge Link",
    rdns: "com.mydoge.link",
  };
  let modalOpenCalls = 0;

  const result = await openDogeosSdkWalletModal({
    chainInfo: dogeosChain,
    globalObject: { ethereum: { providers: [mydoge] } },
    openModal: async () => {
      modalOpenCalls += 1;
      return "sdk-modal";
    },
  });

  // SDK-first: the Connect Kit modal lists MyDoge itself, so openModal() is the
  // chooser. No "try injected MyDoge first" shortcut: the injected provider is
  // never called and the SDK modal's own result is returned verbatim.
  assert.equal(result, "sdk-modal");
  assert.equal(modalOpenCalls, 1);
  assert.equal(mydoge.calls.length, 0);
});

test("SDK wallet modal uses the injected provider only when openModal is unavailable (no clientId)", async () => {
  const mydoge = createProvider({
    accounts: ["0xdddddddddddddddddddddddddddddddddddddddd"],
    chainId: "0x5fdaf3",
  });
  mydoge.info = {
    name: "MyDoge Link",
    rdns: "com.mydoge.link",
  };

  const result = await openDogeosSdkWalletModal({
    chainInfo: dogeosChain,
    globalObject: { ethereum: { providers: [mydoge] } },
    // openModal omitted → SDK not mounted → true injected fallback.
    walletPreference: "mydoge",
  });

  assert.equal(result.address, "0xdddddddddddddddddddddddddddddddddddddddd");
  assert.equal(result.provider, mydoge);
});

test("SDK wallet modal falls back to the requested MyDoge injected provider on unsupported-chain errors", async () => {
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  metamask.isMetaMask = true;
  const mydoge = createProvider({
    accounts: ["0xdddddddddddddddddddddddddddddddddddddddd"],
    chainId: "0x5fdaf3",
  });
  mydoge.info = {
    name: "MyDoge Link",
    rdns: "com.mydoge.link",
  };

  const result = await openDogeosSdkWalletModal({
    chainInfo: dogeosChain,
    globalObject: { ethereum: { providers: [metamask, mydoge] } },
    openModal: async () => {
      throw new Error("Chain Id not supported");
    },
    walletPreference: "mydoge",
  });

  assert.equal(result.address, "0xdddddddddddddddddddddddddddddddddddddddd");
  assert.equal(result.chainId, "0x5fdaf3");
  assert.equal(result.provider, mydoge);
  assert.deepEqual(
    mydoge.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(metamask.calls.length, 0);
});

test("SDK wallet modal maps unsupported-chain errors to an actionable DogeOS message when no injected fallback is available", async () => {
  await assert.rejects(
    () =>
      openDogeosSdkWalletModal({
        chainInfo: dogeosChain,
        globalObject: {},
        openModal: async () => {
          throw new Error("Chain Id not supported");
        },
      }),
    /DogeOS Chikyu Testnet \(6281971\) was not accepted/,
  );
});
