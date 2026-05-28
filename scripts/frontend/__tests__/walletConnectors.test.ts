import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

type Provider = {
  info?: { name?: string; rdns?: string };
  isMetaMask?: boolean;
  isMyDoge?: boolean;
  request: () => Promise<unknown>;
};

function loadConnectors(windowLike: Record<string, unknown>) {
  const filename = resolve(process.cwd(), "apps/swap/wallet-connectors.js");
  const code = readFileSync(filename, "utf8");
  const context = vm.createContext({ window: windowLike, globalThis: windowLike });
  vm.runInContext(code, context, { filename });
  return windowLike.DogeOSWalletConnectors as {
    discoverInjectedProviders: (win?: Record<string, unknown>) => Array<{ provider: Provider; label: string }>;
    choosePreferredProvider: (providers: Array<{ provider: Provider; label: string }>) => { provider: Provider; label: string } | null;
    labelForProvider: (provider: Provider, fallback?: string) => string;
  };
}

function provider(name: string, flags: Partial<Provider> = {}): Provider {
  return {
    info: { name },
    request: async () => [],
    ...flags,
  };
}

describe("DogeOS wallet connector discovery", () => {
  test("discovers EIP-1193, EIP-6963, MyDoge, and DogeOS providers without duplicates", () => {
    const injected = provider("MetaMask", { isMetaMask: true });
    const myDoge = provider("MyDoge Wallet", { isMyDoge: true });
    const dogeos = provider("DogeOS Wallet", { info: { name: "DogeOS Wallet", rdns: "com.dogeos.wallet" } });

    const win = {
      ethereum: { providers: [injected, myDoge], request: async () => [] },
      mydoge: { ethereum: myDoge },
      dogeos: { ethereum: dogeos },
      __dogeosEip6963Providers: [{ info: dogeos.info, provider: dogeos }],
    };

    const connectors = loadConnectors(win);
    const discovered = connectors.discoverInjectedProviders(win);

    expect(discovered.map((entry) => entry.label)).toEqual([
      "DogeOS Wallet",
      "MyDoge Wallet",
      "MetaMask",
      "Injected wallet",
    ]);
    expect(new Set(discovered.map((entry) => entry.provider)).size).toBe(discovered.length);
  });

  test("prefers doge-native providers over generic injected wallets", () => {
    const metamask = provider("MetaMask", { isMetaMask: true });
    const myDoge = provider("MyDoge Wallet", { isMyDoge: true });
    const dogeos = provider("DogeOS Wallet", { info: { name: "DogeOS Wallet", rdns: "com.dogeos.wallet" } });
    const connectors = loadConnectors({});

    expect(connectors.choosePreferredProvider([
      { provider: metamask, label: "MetaMask" },
      { provider: myDoge, label: "MyDoge Wallet" },
    ])?.provider).toBe(myDoge);

    expect(connectors.choosePreferredProvider([
      { provider: metamask, label: "MetaMask" },
      { provider: dogeos, label: "DogeOS Wallet" },
      { provider: myDoge, label: "MyDoge Wallet" },
    ])?.provider).toBe(dogeos);
  });
});
