import assert from "node:assert/strict";
import test from "node:test";

import { createInjectedWalletBridge } from "../../../apps/web/src/injected-wallet.js";

function createProvider({ accounts = ["0x1111111111111111111111111111111111111111"], chainId = "0x1" } = {}) {
  const listeners = new Map();
  const calls = [];

  return {
    calls,
    on(event, listener) {
      listeners.set(event, listener);
    },
    removeListener(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    emit(event, payload) {
      listeners.get(event)?.(payload);
    },
    async request({ method, params }) {
      calls.push({ method, params });

      if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        chainId = params[0].chainId;
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        chainId = params[0].chainId;
        return null;
      }

      throw new Error(`Unexpected method ${method}`);
    },
  };
}

test("injected wallet bridge connects through the browser EIP-1193 provider", async () => {
  const provider = createProvider({ chainId: "0x5fdaf3" });
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: provider },
    missingClientIdMessage: "SDK client id missing.",
    publishWalletState: (state) => states.push(state),
  });

  const address = await bridge.openModal();

  assert.equal(address, "0x1111111111111111111111111111111111111111");
  assert.equal(bridge.getAddress(), address);
  assert.equal(bridge.getChainId(), "0x5fdaf3");
  assert.equal(bridge.getProvider(), provider);
  assert.equal(bridge.isConnected(), true);
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(states.at(-1).walletSource, "injected");
  assert.equal(states.at(-1).hasProvider, true);
  assert.equal(states.at(-1).isConnected, true);
});

test("injected wallet bridge switches to DogeOS testnet during connect", async () => {
  const provider = createProvider({ chainId: "0x1" });
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: provider },
    publishWalletState: (state) => states.push(state),
  });

  await bridge.openModal();

  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
    ],
  );
  assert.equal(provider.calls[2].params[0].chainId, "0x5fdaf3");
  assert.equal(bridge.getChainId(), "0x5fdaf3");
  assert.equal(states.at(-1).chainId, "0x5fdaf3");
  assert.equal(states.at(-1).isConnected, true);
});

test("injected wallet bridge adds DogeOS when the wallet does not know the chain", async () => {
  const provider = createProvider({ chainId: "0x1" });
  provider.request = async ({ method, params }) => {
    provider.calls.push({ method, params });
    if (method === "wallet_switchEthereumChain") throw { code: 4902 };
    if (method === "wallet_addEthereumChain") return null;
    if (method === "eth_chainId") return "0x5fdaf3";
    if (method === "eth_accounts" || method === "eth_requestAccounts") {
      return ["0x1111111111111111111111111111111111111111"];
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: provider },
    publishWalletState: (state) => states.push(state),
  });

  assert.equal(await bridge.switchToDogeOS(), true);

  const addChainCall = provider.calls.find((call) => call.method === "wallet_addEthereumChain");
  assert.equal(addChainCall.params[0].chainId, "0x5fdaf3");
  assert.equal(addChainCall.params[0].chainName, "DogeOS Chikyu Testnet");
  assert.deepEqual(addChainCall.params[0].rpcUrls, ["https://rpc.testnet.dogeos.com"]);
  assert.equal(states.at(-1).chainId, "0x5fdaf3");
});

test("injected wallet bridge reports an actionable error when no wallet provider is available", async () => {
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: {},
    missingClientIdMessage: "SDK client id missing.",
    publishWalletState: (state) => states.push(state),
  });

  await assert.rejects(() => bridge.openModal(), /No wallet provider is available/);
  assert.equal(states.at(-1).walletSource, "injected");
  assert.equal(states.at(-1).hasProvider, false);
  assert.match(states.at(-1).error, /Configure DOGEOS_CLIENT_ID/);
});
