import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

const appRoot = resolve(import.meta.dirname, "../../../apps/web/src");
const repoRoot = resolve(import.meta.dirname, "../../..");
const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(eventName, handler) {
    const handlers = this.listeners.get(eventName) ?? [];
    handlers.push(handler);
    this.listeners.set(eventName, handlers);
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) ?? [];
    for (const handler of handlers) {
      handler({
        preventDefault() {},
        ...event,
      });
    }
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

async function drainMicrotasks(cycles = 8) {
  for (let i = 0; i < cycles; i += 1) {
    await Promise.resolve();
  }
}

function createStaticAppHarness({ venues = [], quoteHandler, verification } = {}) {
  const elementsBySelector = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const windowEvents = [];
  const fetchCalls = [];
  let timerId = 0;

  function elementForSelector(selector) {
    if (!elementsBySelector.has(selector)) {
      elementsBySelector.set(selector, new FakeElement(selector.slice(1)));
    }
    return elementsBySelector.get(selector);
  }

  const context = {
    AbortController,
    BigInt,
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    Date,
    Error,
    Number,
    Promise,
    RegExp,
    String,
    clearTimeout() {},
    console,
    document: {
      visibilityState: "visible",
      querySelector: elementForSelector,
      addEventListener(eventName, handler) {
        const handlers = documentListeners.get(eventName) ?? [];
        handlers.push(handler);
        documentListeners.set(eventName, handlers);
      },
    },
    fetch: async (path, options = {}) => {
      fetchCalls.push({ path, options });
      if (path === "/tokens") {
        return jsonResponse({
          data: [
            { symbol: "USDC", address: usdc, decimals: 18 },
            { symbol: "WDOGE", address: wdoge, decimals: 18 },
          ],
        });
      }
      if (path === "/sources") {
        return jsonResponse({
          data: [
            {
              sourceId: "muchfi-v2",
              displayName: "MuchFi V2",
              protocolType: "v2",
              status: "active",
              router: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
              supportedPairs: ["USDC/WDOGE"],
            },
          ],
        });
      }
      if (path === "/venues") return jsonResponse({ data: venues });
      if (path === "/verification") {
        return jsonResponse({
          data: verification ?? {
            tokens: [{ symbol: "USDC", matches: true }],
            sources: [],
            summary: {
              hasBlockingMismatch: false,
              relationshipMismatches: [],
              tokenDecimalMismatches: [],
              poolMismatches: [],
            },
          },
        });
      }
      if (path === "/quote") {
        if (quoteHandler) return quoteHandler({ path, options, fetchCalls });

        return jsonResponse({
          status: "ok",
          best: {
            sourceId: "muchfi-v2",
            protocolType: "v2",
            status: "active",
            quoteMode: "exactInput",
            sellToken: usdc,
            buyToken: wdoge,
            router: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
            poolAddress: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
            amountIn: "1000000000000000000",
            amountOut: "2000000000000000000",
            minAmountOut: "1990000000000000000",
            gasUnits: "125000",
            blockNumber: "5200000",
            feeEstimate: {
              totalFeeWei: "10",
              executionFeeWei: "7",
              dataFinalityFeeWei: "3",
            },
            priceImpactBps: "1",
          },
          alternatives: [],
          rejected: [],
          telemetry: {
            quoteLatencyMs: 18,
            preQuoteVerificationMs: 2,
            candidateProviderMs: 8,
            feeResolutionMs: 5,
            routeScoringMs: 3,
            candidateCount: 3,
            executableCandidateCount: 2,
            rejectedCandidateCount: 1,
            sourceErrorCount: 1,
            sourceErrors: [
              {
                type: "provider-error",
                providerId: "concentrated-liquidity",
                message: "Provider concentrated-liquidity timed out after 1000ms.",
              },
            ],
          },
        });
      }
      if (path === "/approval") return jsonResponse({ approvalRequired: false });
      if (path === "/swap") {
        return jsonResponse({
          transaction: {
            to: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
            data: "0x38ed1739",
            value: "0",
            gas: "150000",
          },
        });
      }

      return jsonResponse({ error: { message: `Unexpected path ${path}` } }, { ok: false, status: 404 });
    },
    setTimeout(callback) {
      timerId += 1;
      return timerId;
    },
    window: {
      DOGEOS_AGGREGATOR_CONFIG: {},
      addEventListener(eventName, handler) {
        const handlers = windowListeners.get(eventName) ?? [];
        handlers.push(handler);
        windowListeners.set(eventName, handlers);
      },
      clearTimeout() {},
      dispatchEvent(event) {
        windowEvents.push(event.type);
        const handlers = windowListeners.get(event.type) ?? [];
        for (const handler of handlers) handler(event);
      },
      removeEventListener(eventName, handler) {
        const handlers = windowListeners.get(eventName) ?? [];
        windowListeners.set(
          eventName,
          handlers.filter((candidate) => candidate !== handler),
        );
      },
      setTimeout() {
        timerId += 1;
        return timerId;
      },
    },
  };
  context.globalThis = context;
  context.window.window = context.window;

  return {
    context,
    element(id) {
      return elementForSelector(`#${id}`);
    },
    fetchCalls,
    windowEvents,
    windowDispatch(event) {
      context.window.dispatchEvent(event);
    },
  };
}

test("static web app exposes the primary aggregator workflow", async () => {
  const [html, js, css, main, sdkWallet, sdkWalletProvider, sdkChainSwitch, injectedWallet, sdkConfig, packageJson] =
    await Promise.all([
      readFile(resolve(appRoot, "index.html"), "utf8"),
      readFile(resolve(appRoot, "app.js"), "utf8"),
      readFile(resolve(appRoot, "styles.css"), "utf8"),
      readOptional(resolve(appRoot, "main.jsx")),
      readOptional(resolve(appRoot, "sdk-wallet.jsx")),
      readOptional(resolve(appRoot, "sdk-wallet-provider.jsx")),
      readOptional(resolve(appRoot, "sdk-chain-switch.js")),
      readOptional(resolve(appRoot, "injected-wallet.js")),
      readOptional(resolve(appRoot, "sdkConfig.js")),
      readFile(resolve(repoRoot, "package.json"), "utf8"),
    ]);
  const packageBody = JSON.parse(packageJson);

  assert.match(html, /id="swap-form"/);
  assert.match(html, /id="route-table"/);
  assert.match(html, /id="view-swap"/);
  assert.match(html, /id="view-tokens"/);
  assert.match(html, /id="view-activity"/);
  assert.match(html, /id="view-settings"/);
  assert.match(html, /data-view="swap"/);
  assert.match(html, /id="chart-panel"/);
  assert.match(html, /id="quote-telemetry-detail"/);
  assert.match(html, /id="source-issue-detail"/);
  assert.match(html, /id="token-picker"/);
  assert.match(html, /id="slippage-knob"/);
  assert.match(html, /id="quote-refresh-ring"/);
  assert.match(html, /id="quote-button" type="submit">Refresh<\/button>/);
  assert.doesNotMatch(html, /id="quote-button" type="submit">Quote<\/button>/);
  assert.match(html, /id="buy-amount" name="buyAmount" type="text"/);
  assert.match(html, /id="timeline"/);
  assert.match(html, /Active route simulation/);
  assert.doesNotMatch(html, /Execution disabled/);
  assert.match(html, /id="connect-wallet"/);
  assert.match(html, /id="verification-summary"/);
  assert.match(html, /id="sdk-wallet-root"/);
  assert.match(html, /src="\/runtime-config\.js"/);
  assert.match(html, /src="\/main\.jsx"/);

  assert.match(js, /fetchJson\("\/tokens"/);
  assert.match(js, /fetchJson\("\/sources"/);
  assert.match(js, /fetchJson\("\/venues"/);
  assert.match(js, /fetchJson\("\/verification"/);
  assert.match(js, /fetchJson\("\/quote"/);
  assert.match(js, /fetchJson\("\/approval"/);
  assert.match(js, /loadVenueMap/);
  assert.match(js, /renderVenueSummary/);
  assert.match(js, /venueContractSummary/);
  assert.match(js, /renderVerificationSummary/);
  assert.match(js, /sourceVerificationLine/);
  assert.match(js, /switchView/);
  assert.match(js, /openTokenPicker/);
  assert.match(js, /closeTokenPicker/);
  assert.match(js, /renderTokenPicker/);
  assert.match(js, /renderMarketPanel/);
  assert.match(js, /renderActivity/);
  assert.match(js, /flipTokens/);
  assert.match(js, /toggleChartPopout/);
  assert.match(js, /quoteExpiresInSeconds/);
  assert.match(js, /scheduleQuoteRefresh/);
  assert.match(js, /quoteMode/);
  assert.match(js, /exactOutput/);
  assert.match(js, /QUOTE_POLL_MS/);
  assert.match(js, /scheduleNextLiveQuote/);
  assert.match(js, /quotePollTimer/);
  assert.match(js, /quoteRequestSeq/);
  assert.match(js, /activeQuoteController/);
  assert.match(js, /quote\.telemetry\?\.quoteLatencyMs/);
  assert.match(js, /quote\.telemetry\?\.candidateProviderMs/);
  assert.match(js, /quote\.telemetry\?\.feeResolutionMs/);
  assert.match(js, /quote\.telemetry\?\.routeScoringMs/);
  assert.match(js, /quote\.telemetry\?\.candidateCount/);
  assert.match(js, /quote\.telemetry\?\.sourceErrorCount/);
  assert.match(js, /formatLatencyMs/);
  assert.match(js, /new AbortController\(\)/);
  assert.match(js, /activeQuoteController\.abort\(\)/);
  assert.match(js, /signal:\s*quoteController\.signal/);
  assert.match(js, /error\.name === "AbortError"/);
  assert.match(js, /sellAmount\.addEventListener\("input", scheduleExactInputQuoteRefresh\)/);
  assert.match(js, /buyAmount\.addEventListener\("input", scheduleExactOutputQuoteRefresh\)/);
  assert.match(js, /slippageBps\.addEventListener\("input"/);
  assert.match(js, /renderTradeControls\(\);\s*scheduleQuoteRefresh\(\);/);
  assert.match(js, /document\.addEventListener\("visibilitychange"/);
  assert.match(js, /sender: state\.walletAddress/);
  assert.match(js, /dogeosAggregatorWallet/);
  assert.match(js, /dogeos:load-sdk-wallet/);
  assert.match(js, /dogeos:sdk-wallet-ready/);
  assert.match(js, /dogeos:sdk-wallet-updated/);
  assert.doesNotMatch(js, /dogeos:quote-ready/);
  assert.match(js, /eth_sendTransaction/);
  assert.match(js, /eth_getTransactionReceipt/);
  assert.match(js, /approvalRequired/);
  assert.match(js, /Approval submitted/);
  assert.match(js, /Connect wallet before building a swap transaction/);
  assert.doesNotMatch(js, /state\.walletAddress \|\| ZERO_ADDRESS/);
  assert.doesNotMatch(js, /window\.ethereum\.request/);
  assert.doesNotMatch(js, /window\.dogeos\?\.wallet/);
  assert.match(js, /feeEstimate/);
  assert.match(js, /minAmountOut/);
  assert.match(js, /data\/finality/);
  assert.match(js, /blockscout\.testnet\.dogeos\.com/);
  assert.match(js, /Read-only quotes/);
  assert.doesNotMatch(js, /Exact-output execution is not enabled/);
  assert.doesNotMatch(js, /quote\.best\.quoteMode === "exactOutput"/);

  assert.match(main, /import "\.\/app\.js"/);
  assert.match(main, /import\("\.\/sdk-wallet\.jsx"\)/);
  assert.doesNotMatch(main, /import "\.\/sdk-wallet\.jsx"/);
  assert.doesNotMatch(main, /dogeos:quote-ready/);
  assert.doesNotMatch(main, /requestIdleCallback/);
  assert.doesNotMatch(main, /hasDogeosClientId/);
  assert.doesNotMatch(sdkWallet, /@dogeos\/dogeos-sdk/);
  assert.doesNotMatch(sdkWallet, /@dogeos\/dogeos-sdk\/style\.css/);
  assert.match(sdkWallet, /import\("\.\/sdk-wallet-provider\.jsx"\)/);
  assert.match(sdkWallet, /createInjectedWalletBridge/);
  assert.match(sdkWallet, /injected wallet fallback is enabled/);
  assert.match(sdkWallet, /dogeos:sdk-wallet-ready/);
  assert.match(injectedWallet, /export function createInjectedWalletBridge/);
  assert.match(injectedWallet, /globalObject\?\.ethereum/);
  assert.match(injectedWallet, /eth_requestAccounts/);
  assert.match(injectedWallet, /eth_accounts/);
  assert.match(injectedWallet, /eth_chainId/);
  assert.match(injectedWallet, /wallet_switchEthereumChain/);
  assert.match(injectedWallet, /wallet_addEthereumChain/);
  assert.match(injectedWallet, /walletSource:\s*"injected"/);
  assert.match(sdkWalletProvider, /@dogeos\/dogeos-sdk/);
  assert.match(sdkWalletProvider, /@dogeos\/dogeos-sdk\/style\.css/);
  assert.match(sdkWalletProvider, /switchDogeosSdkAccountToChain/);
  assert.match(sdkWalletProvider, /WalletConnectProvider/);
  assert.match(sdkWalletProvider, /getChains/);
  assert.match(sdkWalletProvider, /useState\(\(\) => dogeConfig\.chains\)/);
  assert.match(sdkWalletProvider, /chains:\s*chains \?\? dogeConfig\.chains/);
  assert.doesNotMatch(sdkWalletProvider, /useState\(undefined\)/);
  assert.doesNotMatch(sdkWalletProvider, /setChains\(undefined\)/);
  assert.match(sdkWalletProvider, /useWalletConnect/);
  assert.match(sdkWalletProvider, /useAccount/);
  assert.match(sdkWalletProvider, /switchInjectedProviderToDogeOS/);
  assert.match(sdkWalletProvider, /dogeosSdkSwitchFailureMessage/);
  assert.match(sdkWalletProvider, /mergeDogeosChains/);
  assert.match(sdkWalletProvider, /chainIdMatchesDogeos/);
  assert.match(sdkWalletProvider, /wallet\.isConnected/);
  assert.match(sdkWalletProvider, /currentProvider/);
  assert.match(sdkWalletProvider, /switchChain/);
  assert.match(sdkWalletProvider, /switchToDogeOS/);
  assert.match(sdkWalletProvider, /openDogeosWalletModal/);
  assert.match(sdkWalletProvider, /walletErrorMessage\(wallet\.error\)/);
  assert.doesNotMatch(sdkWalletProvider, /String\(wallet\.error\)/);
  assert.match(sdkWalletProvider, /walletSource:\s*"dogeos-sdk"/);
  assert.match(sdkChainSwitch, /isUnknownChainError/);
  assert.match(sdkChainSwitch, /switchInjectedProviderToDogeOS/);
  assert.match(sdkChainSwitch, /Chain Id not supported|was not accepted/);
  assert.match(sdkConfig, /VITE_DOGEOS_CLIENT_ID/);
  assert.match(sdkConfig, /DOGEOS_AGGREGATOR_CONFIG/);
  assert.match(sdkConfig, /dogeosClientId/);
  assert.match(sdkConfig, /DogeOS Chiky/);
  assert.match(sdkConfig, /defaultConnectChain:\s*"evm"/);
  assert.equal(packageBody.dependencies["@dogeos/dogeos-sdk"], "3.2.0");
  assert.equal(packageBody.dependencies.wagmi, "^2.19.5");
  assert.equal(packageBody.dependencies.react, "^18.3.1");
  assert.equal(packageBody.dependencies["react-dom"], "^18.3.1");
  assert.equal(packageBody.devDependencies.typescript, "^5.9.3");
  assert.equal(packageBody.devDependencies.vite, "^6.4.2");
  assert.equal(packageBody.overrides.axios, "1.16.1");
  assert.equal(packageBody.overrides["bn.js"], "5.2.3");
  assert.equal(packageBody.overrides.protobufjs, "7.6.2");
  assert.equal(packageBody.overrides.ws, "8.21.0");
  assert.equal(packageBody.scripts["build:web"], "vite build");
  assert.match(packageBody.scripts["start:web"], /--env-file-if-exists=\.env/);

  assert.match(css, /grid-template-columns/);
  assert.match(css, /device-shell/);
  assert.match(css, /bottom-nav/);
  assert.match(css, /quote-ring/);
  assert.match(css, /telemetry-detail/);
  assert.match(css, /source-issue-detail/);
  assert.match(css, /token-picker/);
  assert.match(css, /knob-control/);
  assert.match(css, /--te-accent:\s*#ff4d2e/);
  assert.match(css, /--te-gold:\s*#ffcf2e/);
  assert.match(css, /route-card-row-content/);
  assert.match(css, /explorer-link/);
  assert.match(css, /verification-summary/);
  assert.match(css, /verification-line/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(css, /table-layout:\s*fixed/);
  assert.doesNotMatch(css, /purple|violet|#7c3aed/i);
});

test("static web app renders detailed quote telemetry in the live route monitor", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness();

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);
  harness.element("swap-form").dispatchEvent({ type: "submit" });
  await drainMicrotasks(16);

  const detail = harness.element("quote-telemetry-detail").textContent;
  assert.match(detail, /verify 2ms/);
  assert.match(detail, /providers 8ms/);
  assert.match(detail, /fees 5ms/);
  assert.match(detail, /score 3ms/);
  assert.match(detail, /routes 2\/3 live/);
  assert.match(detail, /1 rejected/);
  assert.match(detail, /1 issue/);
});

test("static web app renders source issue details in the live route monitor", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness();

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);
  harness.element("swap-form").dispatchEvent({ type: "submit" });
  await drainMicrotasks(16);

  const detail = harness.element("source-issue-detail");
  assert.equal(detail.hidden, false);
  assert.match(detail.textContent, /provider-error/);
  assert.match(detail.textContent, /concentrated-liquidity/);
  assert.match(detail.textContent, /timed out after 1000ms/);
  assert.match(detail.getAttribute("title"), /concentrated-liquidity/);
});

test("static web app invalidates executable quotes immediately when either quote input changes", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");

  for (const inputId of ["sell-amount", "buy-amount"]) {
    const harness = createStaticAppHarness();

    vm.runInNewContext(appJs, harness.context);
    await drainMicrotasks();
    harness.element("swap-form").dispatchEvent({ type: "submit" });
    await drainMicrotasks();

    assert.equal(harness.element("swap-button").disabled, false);
    assert.match(harness.element("route-summary").textContent, /1 source issue/);
    assert.match(harness.element("route-rows").innerHTML, /block 5200000/);

    harness.windowDispatch(
      new harness.context.CustomEvent("dogeos:sdk-wallet-updated", {
        detail: {
          address: "0x1111111111111111111111111111111111111111",
          chainId: "0x5fdaf3",
          chainType: "evm",
          hasProvider: true,
          isConnected: true,
        },
      }),
    );

    harness.element(inputId).value = "1.1";
    harness.element(inputId).dispatchEvent({ type: "input" });

    assert.equal(harness.element("swap-button").disabled, true);
    assert.equal(harness.element("route-summary").textContent, "Updating live quote");

    harness.element("swap-button").dispatchEvent({ type: "click" });
    await drainMicrotasks();

    assert.equal(
      harness.fetchCalls.some((call) => call.path === "/approval" || call.path === "/swap"),
      false,
    );
  }
});

test("static web app ignores an in-flight quote response as soon as either quote input changes", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  let resolveFirstQuote;
  const harness = createStaticAppHarness({
    quoteHandler: () =>
      new Promise((resolve) => {
        resolveFirstQuote = resolve;
      }),
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  assert.equal(harness.fetchCalls.some((call) => call.path === "/quote"), true);

  harness.element("buy-amount").value = "1.1";
  harness.element("buy-amount").dispatchEvent({ type: "input" });

  assert.equal(harness.element("route-summary").textContent, "Updating live quote");
  assert.equal(harness.element("swap-button").disabled, true);

  resolveFirstQuote(
    jsonResponse({
      status: "ok",
      best: {
        sourceId: "muchfi-v2",
        protocolType: "v2",
        status: "active",
        quoteMode: "exactInput",
        sellToken: usdc,
        buyToken: wdoge,
        router: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
        amountIn: "1000000000000000000",
        amountOut: "2000000000000000000",
        minAmountOut: "1990000000000000000",
        gasUnits: "125000",
      },
      alternatives: [],
      rejected: [],
      telemetry: {
        quoteLatencyMs: 12,
        sourceErrorCount: 0,
      },
    }),
  );
  await drainMicrotasks(16);

  assert.equal(harness.element("buy-amount").value, "1.1");
  assert.equal(harness.element("route-summary").textContent, "Updating live quote");
  assert.equal(harness.element("swap-button").disabled, true);
});

test("static web app renders venue contract provenance details from the live venue map", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness({
    venues: [
      {
        sourceId: "muchfi-v2",
        contracts: [
          {
            role: "factory",
            address: "0x7864071B532894216e3C045a74814EafEB92ae20",
            abiProvenance: "none",
            blockscoutUrl: "https://blockscout.testnet.dogeos.com/address/0x7864071B532894216e3C045a74814EafEB92ae20",
            verification: {
              isBlockscoutAbiAvailable: false,
            },
          },
          {
            role: "router",
            address: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
            abiProvenance: "adapter-fragment",
            blockscoutUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/0xC653e745FC613a03D156DACB924AE8e9148B18dc",
            blockscoutAbiEndpointUrl: "https://blockscout.testnet.dogeos.com/api?module=contract&action=getabi&address=0xC653e745FC613a03D156DACB924AE8e9148B18dc",
            blockscoutAbi: {
              status: "0",
              message: "Contract source code not verified",
            },
            verification: {
              isBlockscoutAbiAvailable: false,
            },
            abiArtifact: {
              kind: "adapter-fragment",
              artifactHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              artifactHashMatches: true,
            },
            executionEvidence: {
              executable: true,
              abiProof: {
                artifactHashMatches: true,
              },
            },
          },
          {
            role: "pool",
            address: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
            abiProvenance: "onchain-bytecode",
            blockscoutUrl: "https://blockscout.testnet.dogeos.com/address/0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
            verification: {
              isBlockscoutAbiAvailable: false,
            },
            executionEvidence: {
              onchainProof: {
                poolPair: "WDOGE/USDC",
                poolStateVerified: true,
                poolTokenMatches: true,
                poolStateKind: "v2-reserves",
                poolHasLiveLiquidity: true,
              },
            },
          },
        ],
      },
    ],
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  const sourceList = harness.element("source-list").innerHTML;
  assert.match(sourceList, /contract-list/);
  assert.match(sourceList, /factory/);
  assert.match(sourceList, /router/);
  assert.match(sourceList, /pool/);
  assert.match(sourceList, /0xC653\.\.\.18dc/);
  assert.match(sourceList, /adapter-fragment/);
  assert.match(sourceList, /hash ok/);
  assert.match(sourceList, /pool WDOGE\/USDC/);
  assert.match(sourceList, /v2-reserves/);
  assert.match(sourceList, /tokens ok/);
  assert.match(sourceList, /live liquidity/);
  assert.match(sourceList, /execution-ready/);
  assert.match(sourceList, /Blockscout ABI pending/);
  assert.match(sourceList, /Contract source code not verified/);
  assert.match(sourceList, /href="https:\/\/blockscout\.testnet\.dogeos\.com\/address\/0xC653e745FC613a03D156DACB924AE8e9148B18dc"/);
  assert.doesNotMatch(sourceList, /href="https:\/\/blockscout\.testnet\.dogeos\.com\/api\/v2\/addresses\//);
});

test("static web app renders readiness from live verification state", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness({
    verification: {
      chainMatches: true,
      tokens: [{ symbol: "USDC", matches: true }],
      sources: [
        {
          sourceId: "muchfi-v2",
          role: "router",
          blockscoutAbi: {
            status: "0",
            message: "Contract source code not verified",
          },
          verification: {
            status: "active",
            isBlockscoutAbiAvailable: false,
          },
          executionEvidence: {
            executable: true,
          },
        },
      ],
      summary: {
        hasBlockingMismatch: false,
        relationshipMismatches: [],
        tokenDecimalMismatches: [],
        poolMismatches: [],
      },
    },
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  const timeline = harness.element("timeline").innerHTML;
  assert.match(timeline, /RPC chain ID verified/);
  assert.match(timeline, /1 active venue/);
  assert.match(timeline, /Blockscout ABI pending: Contract source code not verified/);
  assert.match(timeline, /1 executable contract/);
});

test("static web app renders pinned pool verification mismatches from live verification state", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness({
    verification: {
      chainMatches: true,
      tokens: [{ symbol: "USDC", matches: true }],
      sources: [
        {
          sourceId: "muchfi-v2",
          role: "pool",
          poolStateCheck: {
            pair: "WDOGE/USDC",
            matches: false,
            tokenMatches: false,
            stateKind: "v2-reserves",
            hasLiveLiquidity: true,
          },
          executionEvidence: {
            onchainProof: {
              poolPair: "WDOGE/USDC",
              poolStateVerified: false,
              poolTokenMatches: false,
              poolStateKind: "v2-reserves",
              poolHasLiveLiquidity: true,
            },
          },
        },
      ],
      summary: {
        hasBlockingMismatch: true,
        relationshipMismatches: [],
        tokenDecimalMismatches: [],
        poolMismatches: [
          {
            sourceId: "muchfi-v2",
            role: "pool",
            pair: "WDOGE/USDC",
          },
        ],
      },
    },
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  assert.match(harness.element("verification-summary").textContent, /1 pool mismatch/);
  assert.match(harness.element("timeline").innerHTML, /Pool proof/);
  assert.match(harness.element("timeline").innerHTML, /1 pool mismatch/);
});

test("static web app confirms submitted swaps from on-chain receipts", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness();
  const providerCalls = [];
  const swapHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  harness.context.window.dogeosAggregatorWallet = {
    getChainId: () => "0x5fdaf3",
    getProvider: () => ({
      request: async (request) => {
        providerCalls.push(request);
        if (request.method === "eth_sendTransaction") return swapHash;
        if (request.method === "eth_getTransactionReceipt") {
          return {
            status: "0x1",
            transactionHash: swapHash,
            blockNumber: "0x10",
          };
        }
        throw new Error(`Unexpected wallet method ${request.method}`);
      },
    }),
    switchToDogeOS: async () => true,
  };

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks();
  harness.element("swap-form").dispatchEvent({ type: "submit" });
  await drainMicrotasks();

  harness.windowDispatch(
    new harness.context.CustomEvent("dogeos:sdk-wallet-updated", {
      detail: {
        address: "0x1111111111111111111111111111111111111111",
        chainId: "0x5fdaf3",
        chainType: "evm",
        hasProvider: true,
        isConnected: true,
      },
    }),
  );

  harness.element("swap-button").dispatchEvent({ type: "click" });
  await drainMicrotasks(64);

  assert.deepEqual(
    providerCalls.map((call) => call.method),
    ["eth_sendTransaction", "eth_getTransactionReceipt"],
  );
  assert.match(harness.element("quote-status").textContent, /Swap confirmed/);
  assert.match(harness.element("activity-list").innerHTML, /confirmed/);
  assert.match(
    harness.element("activity-list").innerHTML,
    /href="https:\/\/blockscout\.testnet\.dogeos\.com\/tx\/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/,
  );
});

test("static web app treats eip155 DogeOS chain ids as already switched", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness();
  const providerCalls = [];
  let switchCalls = 0;

  harness.context.window.dogeosAggregatorWallet = {
    getChainId: () => "eip155:6281971",
    getProvider: () => ({
      request: async (request) => {
        providerCalls.push(request);
        if (request.method === "eth_sendTransaction") {
          return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        }
        if (request.method === "eth_getTransactionReceipt") {
          return {
            status: "0x1",
            transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            blockNumber: "0x11",
          };
        }
        throw new Error(`Unexpected wallet method ${request.method}`);
      },
    }),
    switchToDogeOS: async () => {
      switchCalls += 1;
      return true;
    },
  };

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks();
  harness.element("swap-form").dispatchEvent({ type: "submit" });
  await drainMicrotasks();

  harness.windowDispatch(
    new harness.context.CustomEvent("dogeos:sdk-wallet-updated", {
      detail: {
        address: "0x1111111111111111111111111111111111111111",
        chainId: "eip155:6281971",
        chainType: "evm",
        hasProvider: true,
        isConnected: true,
      },
    }),
  );

  harness.element("swap-button").dispatchEvent({ type: "click" });
  await drainMicrotasks(64);

  assert.equal(switchCalls, 0);
  assert.deepEqual(
    providerCalls.map((call) => call.method),
    ["eth_sendTransaction", "eth_getTransactionReceipt"],
  );
});

test("static web app loads the DogeOS wallet chunk only on connect intent", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness();

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  assert.equal(harness.windowEvents.includes("dogeos:quote-ready"), false);
  assert.equal(harness.windowEvents.includes("dogeos:load-sdk-wallet"), false);

  harness.element("connect-wallet").dispatchEvent({ type: "pointerenter" });

  assert.equal(harness.windowEvents.includes("dogeos:load-sdk-wallet"), true);
});
