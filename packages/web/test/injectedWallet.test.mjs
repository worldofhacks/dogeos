import assert from "node:assert/strict";
import test from "node:test";

import {
  connectInjectedProviderToDogeOS,
  createInjectedWalletBridge,
  detectInjectedProvider,
  isUnknownChainError,
  switchInjectedProviderToDogeOS,
} from "../../../apps/web/src/injected-wallet.js";

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

function createEip6963Window(details = []) {
  const listeners = new Map();

  return {
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    addEventListener(eventName, handler) {
      const handlers = listeners.get(eventName) ?? [];
      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    removeEventListener(eventName, handler) {
      const handlers = listeners.get(eventName) ?? [];
      listeners.set(eventName, handlers.filter((entry) => entry !== handler));
    },
    dispatchEvent(event) {
      if (event.type === "eip6963:requestProvider") {
        for (const detail of details) {
          for (const handler of listeners.get("eip6963:announceProvider") ?? []) {
            handler({ type: "eip6963:announceProvider", detail });
          }
        }
      }
      return true;
    },
  };
}

test("detectInjectedProvider returns true synchronously for window.ethereum", async () => {
  const provider = createProvider();
  assert.equal(await detectInjectedProvider({ ethereum: provider }, { timeoutMs: 50 }), true);
});

test("detectInjectedProvider returns true when a wallet announces over EIP-6963", async () => {
  const mydoge = createProvider({ chainId: "0x5fdaf3" });
  const globalObject = createEip6963Window([
    { info: { uuid: "mydoge-link", name: "MyDoge Link", rdns: "com.mydoge.link" }, provider: mydoge },
  ]);
  assert.equal(await detectInjectedProvider(globalObject, { timeoutMs: 200 }), true);
});

test("detectInjectedProvider returns false when no injected wallet is present (SDK fallback)", async () => {
  const globalObject = createEip6963Window([]); // nothing announces
  assert.equal(await detectInjectedProvider(globalObject, { timeoutMs: 50 }), false);
});

test("detectInjectedProvider returns false for a bare global with no provider APIs", async () => {
  assert.equal(await detectInjectedProvider({}, { timeoutMs: 50 }), false);
});

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

test("injected wallet bridge discovers MetaMask through EIP-6963 announcements", async () => {
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  const globalObject = createEip6963Window([
    {
      info: {
        uuid: "metamask",
        name: "MetaMask",
        rdns: "io.metamask",
      },
      provider: metamask,
    },
  ]);
  const bridge = createInjectedWalletBridge({ globalObject });

  const address = await bridge.openModal({ walletPreference: "metamask" });

  assert.equal(address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(bridge.getProvider(), metamask);
  assert.deepEqual(
    metamask.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
});

test("injected wallet bridge discovers MyDoge Link through EIP-6963 announcements", async () => {
  const mydoge = createProvider({
    accounts: ["0xdddddddddddddddddddddddddddddddddddddddd"],
    chainId: "0x5fdaf3",
  });
  const states = [];
  const globalObject = createEip6963Window([
    {
      info: {
        uuid: "mydoge-link",
        name: "Doge Link Wallet",
        rdns: "com.mydoge.link",
      },
      provider: mydoge,
    },
  ]);
  const bridge = createInjectedWalletBridge({
    globalObject,
    missingClientIdMessage: "SDK client id missing.",
    publishWalletState: (state) => states.push(state),
  });

  const address = await bridge.openModal({ walletPreference: "mydoge" });

  assert.equal(address, "0xdddddddddddddddddddddddddddddddddddddddd");
  assert.equal(bridge.getProvider(), mydoge);
  assert.equal(states.at(-1).walletLabel, "MyDoge Link");
  assert.equal(states.at(-1).walletPreference, "mydoge");
});

test("injected wallet bridge uses MyDoge EIP-6963 metadata when the provider is also window.ethereum", async () => {
  const mydoge = createProvider({
    accounts: ["0xdddddddddddddddddddddddddddddddddddddddd"],
    chainId: "0x5fdaf3",
  });
  const globalObject = {
    ...createEip6963Window([
      {
        info: {
          uuid: "mydoge-link",
          name: "MyDoge Link",
          rdns: "com.mydoge.link",
        },
        provider: mydoge,
      },
    ]),
    ethereum: mydoge,
  };
  const bridge = createInjectedWalletBridge({ globalObject });

  const address = await bridge.openModal({ walletPreference: "mydoge" });

  assert.equal(address, "0xdddddddddddddddddddddddddddddddddddddddd");
  assert.equal(bridge.getProvider(), mydoge);
});

test("injected wallet bridge initialization does not auto-select a default provider when multiple wallets are installed", async () => {
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
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: { providers: [metamask, mydoge] } },
    publishWalletState: (state) => states.push(state),
  });

  bridge.initialize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(states.at(-1).hasProvider, true);
  assert.equal(states.at(-1).isConnected, false);
  assert.equal(states.at(-1).address, "");
  assert.equal(metamask.calls.length, 0);
  assert.equal(mydoge.calls.length, 0);
});

test("injected wallet bridge connects through the requested browser wallet provider", async () => {
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  metamask.isMetaMask = true;
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isRainbow = true;
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: { providers: [metamask, rainbow] } },
    publishWalletState: (state) => states.push(state),
  });

  const address = await bridge.openModal({ walletPreference: "rainbow" });

  assert.equal(address, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(bridge.getProvider(), rainbow);
  assert.deepEqual(
    rainbow.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(metamask.calls.length, 0);
  assert.equal(states.at(-1).walletLabel, "Rainbow Wallet");
});

test("injected wallet bridge does not treat Rainbow compatibility flags as MetaMask", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isMetaMask = true;
  rainbow.isRainbow = true;
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  metamask.isMetaMask = true;
  const bridge = createInjectedWalletBridge({
    globalObject: { ethereum: { providers: [rainbow, metamask] } },
  });

  const address = await bridge.openModal({ walletPreference: "metamask" });

  assert.equal(address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(bridge.getProvider(), metamask);
  assert.deepEqual(
    metamask.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(rainbow.calls.length, 0);
});

test("injected wallet bridge rejects Rainbow announcements that mimic MetaMask metadata", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isMetaMask = true;
  rainbow.isRainbow = true;
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  metamask.isMetaMask = true;
  const globalObject = createEip6963Window([
    {
      info: {
        uuid: "rainbow-compatible",
        name: "Rainbow Wallet",
        rdns: "io.metamask",
      },
      provider: rainbow,
    },
    {
      info: {
        uuid: "metamask",
        name: "MetaMask",
        rdns: "io.metamask",
      },
      provider: metamask,
    },
  ]);
  const bridge = createInjectedWalletBridge({ globalObject });

  const address = await bridge.openModal({ walletPreference: "metamask" });

  assert.equal(address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(bridge.getProvider(), metamask);
  assert.deepEqual(
    metamask.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(rainbow.calls.length, 0);
});

test("injected wallet bridge prefers announced MetaMask over Rainbow window.ethereum compatibility flags", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isMetaMask = true;
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x5fdaf3",
  });
  metamask.isMetaMask = true;
  const globalObject = {
    ...createEip6963Window([
      {
        info: {
          uuid: "metamask",
          name: "MetaMask",
          rdns: "io.metamask",
        },
        provider: metamask,
      },
    ]),
    ethereum: rainbow,
  };
  const bridge = createInjectedWalletBridge({ globalObject });

  const address = await bridge.openModal({ walletPreference: "metamask" });

  assert.equal(address, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(bridge.getProvider(), metamask);
  assert.deepEqual(
    metamask.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
  assert.equal(rainbow.calls.length, 0);
});

test("injected wallet bridge does not use a Rainbow-only announcement for MetaMask", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isMetaMask = true;
  const globalObject = {
    ...createEip6963Window([
      {
        info: {
          uuid: "rainbow",
          name: "Rainbow Wallet",
          rdns: "me.rainbow",
        },
        provider: rainbow,
      },
    ]),
    ethereum: rainbow,
  };
  const bridge = createInjectedWalletBridge({ globalObject });

  await assert.rejects(() => bridge.openModal({ walletPreference: "metamask" }), /MetaMask provider is not available/);
  assert.equal(bridge.getProvider(), null);
  assert.equal(rainbow.calls.length, 0);
});

test("injected wallet bridge uses Rainbow EIP-6963 metadata when the provider is also window.ethereum", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isMetaMask = true;
  const globalObject = {
    ...createEip6963Window([
      {
        info: {
          uuid: "rainbow",
          name: "Rainbow Wallet",
          rdns: "me.rainbow",
        },
        provider: rainbow,
      },
    ]),
    ethereum: rainbow,
  };
  const bridge = createInjectedWalletBridge({ globalObject });

  const address = await bridge.openModal({ walletPreference: "rainbow" });

  assert.equal(address, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(bridge.getProvider(), rainbow);
  assert.deepEqual(
    rainbow.calls.map((call) => call.method),
    ["eth_requestAccounts", "eth_chainId"],
  );
});

test("injected wallet refresh keeps the selected provider object", async () => {
  const rainbow = createProvider({
    accounts: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    chainId: "0x5fdaf3",
  });
  rainbow.isRainbow = true;
  const metamask = createProvider({
    accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    chainId: "0x1",
  });
  metamask.isMetaMask = true;

  const result = await connectInjectedProviderToDogeOS(
    { ethereum: { providers: [rainbow, metamask] } },
    { provider: metamask, walletPreference: "metamask" },
  );

  assert.equal(result.provider, metamask);
  assert.equal(result.walletPreference, "metamask");
  assert.equal(result.walletLabel, "MetaMask");
  assert.deepEqual(
    metamask.calls.map((call) => call.method),
    [
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_chainId",
      "eth_chainId",
    ],
  );
  assert.equal(rainbow.calls.length, 0);
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

test("standalone injected wallet preflight treats unsupported-chain errors as add-chain flow", async () => {
  const provider = createProvider({ chainId: "0x1" });
  let chainKnown = false;
  provider.request = async ({ method, params }) => {
    provider.calls.push({ method, params });
    if (method === "eth_chainId") return chainKnown ? "0x5fdaf3" : "0x1";
    if (method === "wallet_switchEthereumChain") {
      if (!chainKnown) throw new Error("Chain Id not supported");
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      assert.equal(params[0].chainId, "0x5fdaf3");
      chainKnown = true;
      return null;
    }
    throw new Error(`Unexpected method ${method}`);
  };

  assert.equal(await switchInjectedProviderToDogeOS({ ethereum: provider }), true);
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
    ],
  );
});

test("unknown-chain detection accepts SDK string errors", () => {
  assert.equal(isUnknownChainError("Chain Id not supported"), true);
  assert.equal(isUnknownChainError("unsupported chain"), true);
});

test("standalone injected wallet preflight returns false instead of leaking unsupported-chain add errors", async () => {
  const provider = createProvider({ chainId: "0x1" });
  provider.request = async ({ method, params }) => {
    provider.calls.push({ method, params });
    if (method === "eth_chainId") return "0x1";
    if (method === "wallet_switchEthereumChain") throw new Error("Chain Id not supported");
    if (method === "wallet_addEthereumChain") throw new Error("Chain Id not supported");
    throw new Error(`Unexpected method ${method}`);
  };

  assert.equal(await switchInjectedProviderToDogeOS({ ethereum: provider }), false);
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
  );
});

test("standalone injected wallet preflight returns false instead of leaking unsupported-chain final switch errors", async () => {
  const provider = createProvider({ chainId: "0x1" });
  provider.request = async ({ method, params }) => {
    provider.calls.push({ method, params });
    if (method === "eth_chainId") return "0x1";
    if (method === "wallet_switchEthereumChain") throw new Error("Chain Id not supported");
    if (method === "wallet_addEthereumChain") {
      assert.equal(params[0].chainId, "0x5fdaf3");
      return null;
    }
    throw new Error(`Unexpected method ${method}`);
  };

  assert.equal(await switchInjectedProviderToDogeOS({ ethereum: provider }), false);
  assert.deepEqual(
    provider.calls.map((call) => call.method),
    [
      "eth_chainId",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "eth_chainId",
      "wallet_switchEthereumChain",
    ],
  );
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

test("injected wallet bridge explains MyDoge needs SDK config or an injected provider", async () => {
  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject: {},
    missingClientIdMessage: "SDK client id missing.",
    publishWalletState: (state) => states.push(state),
  });

  await assert.rejects(
    () => bridge.openModal({ walletPreference: "mydoge" }),
    /MyDoge Link needs a DogeOS SDK client ID or an injected MyDoge Link provider/,
  );
  assert.match(states.at(-1).error, /Set DOGEOS_CLIENT_ID or VITE_DOGEOS_CLIENT_ID/);
});

test("initialize() discovers EIP-6963 wallets so the chooser lists every brand once", () => {
  // Rainbow owns window.ethereum AND impersonates MetaMask there; the real
  // MetaMask only announces via EIP-6963. Before the persistent announce
  // listener, the chooser saw a single (Rainbow) wallet and forced it.
  const rainbowWindowProvider = createProvider();
  rainbowWindowProvider.isRainbow = true;
  rainbowWindowProvider.isMetaMask = true;
  const rainbowAnnounced = createProvider();
  rainbowAnnounced.isRainbow = true;
  const metamask = createProvider();
  metamask.isMetaMask = true;

  const globalObject = createEip6963Window([
    { info: { rdns: "me.rainbow", name: "Rainbow" }, provider: rainbowAnnounced },
    { info: { rdns: "io.metamask", name: "MetaMask" }, provider: metamask },
  ]);
  globalObject.ethereum = rainbowWindowProvider;

  const bridge = createInjectedWalletBridge({ globalObject });
  bridge.initialize();

  const wallets = bridge.listInjectedWallets();
  assert.deepEqual(wallets.map((wallet) => wallet.preference).sort(), ["metamask", "rainbow"]);
  assert.equal(wallets.find((wallet) => wallet.preference === "metamask").rdns, "io.metamask");
});

test("listInjectedWallets() offers only supported brands (no Compass/TronLink)", () => {
  const metamask = createProvider();
  metamask.isMetaMask = true;
  // Phantom's EVM provider impersonates MetaMask; it must list as Phantom.
  const phantom = createProvider();
  phantom.isPhantom = true;
  phantom.isMetaMask = true;
  const compass = createProvider();
  const tronlink = createProvider();

  const globalObject = createEip6963Window([
    { info: { rdns: "io.metamask", name: "MetaMask" }, provider: metamask },
    { info: { rdns: "app.phantom", name: "Phantom" }, provider: phantom },
    { info: { rdns: "io.leapwallet.CompassWallet", name: "Compass Wallet" }, provider: compass },
    { info: { rdns: "network.tron.link", name: "TronLink" }, provider: tronlink },
  ]);

  const bridge = createInjectedWalletBridge({ globalObject });
  bridge.initialize();

  const wallets = bridge.listInjectedWallets();
  assert.deepEqual(wallets.map((wallet) => wallet.preference).sort(), ["metamask", "phantom"]);
  assert.equal(wallets.find((wallet) => wallet.preference === "phantom").label, "Phantom");
});

test("a lone unsupported wallet is still offered and connects so users aren't dead-ended", async () => {
  const compass = createProvider({ accounts: ["0x4444444444444444444444444444444444444444"], chainId: "0x5fdaf3" });
  const globalObject = createEip6963Window([
    { info: { rdns: "io.leapwallet.CompassWallet", name: "Compass Wallet" }, provider: compass },
  ]);

  const bridge = createInjectedWalletBridge({ globalObject });
  bridge.initialize();

  const wallets = bridge.listInjectedWallets();
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].preference, "");
  assert.equal(wallets[0].label, "Compass Wallet");

  const address = await bridge.openModal({ walletPreference: wallets[0].preference });
  assert.equal(address, "0x4444444444444444444444444444444444444444");
});

test("multiple unsupported wallets with no supported brand list nothing", () => {
  const compass = createProvider();
  const tronlink = createProvider();
  const globalObject = createEip6963Window([
    { info: { rdns: "io.leapwallet.CompassWallet", name: "Compass Wallet" }, provider: compass },
    { info: { rdns: "network.tron.link", name: "TronLink" }, provider: tronlink },
  ]);

  const bridge = createInjectedWalletBridge({ globalObject });
  bridge.initialize();

  assert.deepEqual(bridge.listInjectedWallets(), []);
});

test("choosing Phantom connects the Phantom provider, not the MetaMask impersonation", async () => {
  const metamask = createProvider({ accounts: ["0x2222222222222222222222222222222222222222"], chainId: "0x5fdaf3" });
  metamask.isMetaMask = true;
  const phantom = createProvider({ accounts: ["0x3333333333333333333333333333333333333333"], chainId: "0x5fdaf3" });
  phantom.isPhantom = true;
  phantom.isMetaMask = true;

  const globalObject = createEip6963Window([
    { info: { rdns: "io.metamask", name: "MetaMask" }, provider: metamask },
    { info: { rdns: "app.phantom", name: "Phantom" }, provider: phantom },
  ]);

  const states = [];
  const bridge = createInjectedWalletBridge({
    globalObject,
    publishWalletState: (state) => states.push(state),
  });
  bridge.initialize();

  const address = await bridge.openModal({ walletPreference: "phantom" });
  assert.equal(address, "0x3333333333333333333333333333333333333333");
  assert.equal(states.at(-1).walletLabel, "Phantom");

  // And choosing MetaMask must not land on Phantom's impersonating provider.
  await bridge.disconnect();
  const metamaskAddress = await bridge.openModal({ walletPreference: "metamask" });
  assert.equal(metamaskAddress, "0x2222222222222222222222222222222222222222");
});

test("wallet choice persists to storage and clears on disconnect", async () => {
  const metamask = createProvider({ chainId: "0x5fdaf3" });
  metamask.isMetaMask = true;
  const store = new Map();
  const globalObject = createEip6963Window([
    { info: { rdns: "io.metamask", name: "MetaMask" }, provider: metamask },
  ]);
  globalObject.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };

  const bridge = createInjectedWalletBridge({ globalObject });
  bridge.initialize();
  await bridge.openModal({ walletPreference: "metamask" });
  assert.equal(store.get("doge.walletPreference"), "metamask");

  await bridge.disconnect();
  assert.equal(store.has("doge.walletPreference"), false);
});
