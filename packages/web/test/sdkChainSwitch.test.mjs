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

function createProvider({ chainId = "0x1" } = {}) {
  const calls = [];
  let chainKnown = false;
  const accounts = ["0x1111111111111111111111111111111111111111"];

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
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
      "eth_requestAccounts",
      "eth_chainId",
    ],
  );
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
