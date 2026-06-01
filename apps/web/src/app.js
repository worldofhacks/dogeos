const DOGEOS_CHAIN_ID = 6_281_971;
const BLOCKSCOUT_BASE_URL = "https://blockscout.testnet.dogeos.com";
const DOGEOS_FAUCET_URL = "https://faucet.testnet.dogeos.com";
const QUOTE_DEBOUNCE_MS = 250;
const QUOTE_POLL_MS = 10_000;
const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";
const LOAD_SDK_WALLET_EVENT = "dogeos:load-sdk-wallet";
const CHART_LIBRARY_PATH = "/advanced_charting_library/charting_library/";
const CHART_LIBRARY_SCRIPT = `${CHART_LIBRARY_PATH}charting_library.standalone.js`;
const CHART_DEFAULT_RESOLUTION = "1";
const CHART_PRICE_SCALE = 100_000_000;
const MAX_CHART_BARS = 240;
const MOBILE_CHART_QUERY = "(max-width: 760px)";
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

const state = {
  tokens: [],
  sources: [],
  venues: [],
  verification: null,
  quote: null,
  quoteMode: "exactInput",
  currentView: "swap",
  tokenPickerSide: null,
  tokenFilter: "",
  chartVisible: true,
  chartPopoutVisible: false,
  swapSettingsVisible: false,
  activity: [],
  lastQuoteStartedAtMs: 0,
  walletAddress: "",
  walletChainId: "",
  walletChainType: "",
  walletProviderReady: false,
  walletConnecting: false,
  walletError: "",
  walletSource: "",
  walletConnectRequested: false,
  walletBalances: {},
  walletBalanceErrors: {},
};

const elements = {
  form: document.querySelector("#swap-form"),
  sellAmount: document.querySelector("#sell-amount"),
  sellToken: document.querySelector("#sell-token"),
  buyToken: document.querySelector("#buy-token"),
  buyAmount: document.querySelector("#buy-amount"),
  slippageBps: document.querySelector("#slippage-bps"),
  recipient: document.querySelector("#recipient"),
  routeRows: document.querySelector("#route-rows"),
  routeSummary: document.querySelector("#route-summary"),
  quoteStatus: document.querySelector("#quote-status"),
  quoteButton: document.querySelector("#quote-button"),
  swapButton: document.querySelector("#swap-button"),
  connectWallet: document.querySelector("#connect-wallet"),
  refreshData: document.querySelector("#refresh-data"),
  sellTokenChip: document.querySelector("#sell-token-chip"),
  buyTokenChip: document.querySelector("#buy-token-chip"),
  sellBalance: document.querySelector("#sell-balance"),
  buyBalance: document.querySelector("#buy-balance"),
  sellAmountMax: document.querySelector("#sell-amount-max"),
  sellAmountHalf: document.querySelector("#sell-amount-half"),
  sellAmountQuarter: document.querySelector("#sell-amount-quarter"),
  slippageKnob: document.querySelector("#slippage-knob"),
  slippageValue: document.querySelector("#slippage-value"),
  gasKnob: document.querySelector("#gas-knob"),
  gasPriorityValue: document.querySelector("#gas-priority-value"),
  quoteRefreshRing: document.querySelector("#quote-refresh-ring"),
  flipTokens: document.querySelector("#flip-tokens"),
  swapSettingsToggle: document.querySelector("#swap-settings-toggle"),
  swapSettingsSummary: document.querySelector("#swap-settings-summary"),
  swapSettingsPanel: document.querySelector("#swap-settings-panel"),
  swapSettingsClose: document.querySelector("#swap-settings-close"),
  swapSettingsScrim: document.querySelector("#swap-settings-scrim"),
  chartToggle: document.querySelector("#chart-toggle"),
  chartPanel: document.querySelector("#chart-panel"),
  chartPopout: document.querySelector("#chart-popout"),
  chartPopoutPanel: document.querySelector("#chart-popout-panel"),
  chartPopoutClose: document.querySelector("#chart-popout-close"),
  chartPopoutScrim: document.querySelector("#chart-popout-scrim"),
  marketVisual: document.querySelector("#market-visual"),
  chartPopoutVisual: document.querySelector("#chart-popout-visual"),
  bestSourceLabel: document.querySelector("#best-source-label"),
  quoteLatencyLabel: document.querySelector("#quote-latency-label"),
  sourceIssuesLabel: document.querySelector("#source-issues-label"),
  quoteTelemetryDetail: document.querySelector("#quote-telemetry-detail"),
  sourceIssueDetail: document.querySelector("#source-issue-detail"),
  tokenPicker: document.querySelector("#token-picker"),
  tokenPickerScrim: document.querySelector("#token-picker-scrim"),
  tokenPickerClose: document.querySelector("#token-picker-close"),
  tokenPickerSearch: document.querySelector("#token-picker-search"),
  tokenPickerList: document.querySelector("#token-picker-list"),
  tokenSearch: document.querySelector("#token-search"),
  tokenListView: document.querySelector("#token-list-view"),
  activityList: document.querySelector("#activity-list"),
  sourceList: document.querySelector("#source-list"),
  sourceCount: document.querySelector("#source-count"),
  verificationSummary: document.querySelector("#verification-summary"),
  timeline: document.querySelector("#timeline"),
  views: {
    swap: document.querySelector("#view-swap"),
    tokens: document.querySelector("#view-tokens"),
    activity: document.querySelector("#view-activity"),
    settings: document.querySelector("#view-settings"),
  },
  nav: {
    swap: document.querySelector("#nav-swap"),
    tokens: document.querySelector("#nav-tokens"),
    activity: document.querySelector("#nav-activity"),
    settings: document.querySelector("#nav-settings"),
  },
  bottomNav: {
    swap: document.querySelector("#bottom-nav-swap"),
    tokens: document.querySelector("#bottom-nav-tokens"),
    activity: document.querySelector("#bottom-nav-activity"),
    settings: document.querySelector("#bottom-nav-settings"),
  },
};

elements.sellAmount.value = "1";
elements.slippageBps.value = "50";

let quoteRefreshTimer = null;
let quotePollTimer = null;
let quoteRequestSeq = 0;
let activeQuoteController = null;
let sdkWalletReadyPromise = null;
let tradingViewLibraryPromise = null;
let walletBalanceRequestSeq = 0;

const chartWidgets = new Map();
const chartWidgetSymbols = new Map();
const chartPendingContainers = new Set();
const chartBarsBySymbol = new Map();
const chartSubscribers = new Map();

function tokenByAddress(address) {
  const normalized = String(address ?? "").toLowerCase();
  return state.tokens.find((token) => token.address.toLowerCase() === normalized);
}

function tokenBySymbol(symbol) {
  return state.tokens.find((token) => token.symbol === symbol);
}

function selectedTokens() {
  return {
    sellToken: tokenByAddress(elements.sellToken.value),
    buyToken: tokenByAddress(elements.buyToken.value),
  };
}

function selectedPairLabel() {
  const { sellToken, buyToken } = selectedTokens();
  if (!sellToken || !buyToken) return "selected pair";
  return `${sellToken.symbol}/${buyToken.symbol}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceById(sourceId) {
  return state.sources.find((source) => source.sourceId === sourceId);
}

function venueBySourceId(sourceId) {
  return state.venues.find((venue) => venue.sourceId === sourceId);
}

function sdkWallet() {
  return window.dogeosAggregatorWallet ?? null;
}

function loadSdkWallet() {
  const wallet = sdkWallet();
  if (wallet?.openModal) return Promise.resolve(wallet);

  sdkWalletReadyPromise ??= new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(SDK_WALLET_READY_EVENT, handleReady);
      sdkWalletReadyPromise = null;
      reject(new Error("DogeOS SDK wallet did not load."));
    }, 10_000);

    function handleReady() {
      window.clearTimeout(timeout);
      window.removeEventListener(SDK_WALLET_READY_EVENT, handleReady);
      const readyWallet = sdkWallet();
      if (readyWallet?.openModal) {
        resolve(readyWallet);
      } else {
        sdkWalletReadyPromise = null;
        reject(new Error("DogeOS SDK wallet is unavailable."));
      }
    }

    window.addEventListener(SDK_WALLET_READY_EVENT, handleReady);
    window.dispatchEvent(new Event(LOAD_SDK_WALLET_EVENT));
  });

  return sdkWalletReadyPromise;
}

function preloadSdkWallet() {
  if (sdkWallet()?.openModal || sdkWalletReadyPromise) return;
  window.dispatchEvent(new Event(LOAD_SDK_WALLET_EVENT));
}

function restorePersistedWalletSession() {
  preloadSdkWallet();
}

function shortAddress(address) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function compactAddress(address) {
  if (!address) return "-";
  if (address === "native") return "native";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function tokenGlyph(token) {
  const glyphs = {
    DOGE: "Ð",
    WDOGE: "Ð",
    USDC: "$",
    USDT: "$",
    USD1: "$",
    WETH: "Ξ",
    LBTC: "₿",
  };
  return glyphs[token?.symbol] ?? token?.symbol?.slice(0, 1) ?? "?";
}

function tokenColor(token) {
  const colors = {
    DOGE: "#c2a633",
    WDOGE: "#e0b84a",
    USDC: "#2775ca",
    USDT: "#26a17b",
    USD1: "#b5891d",
    WETH: "#627eea",
    LBTC: "#f7931a",
  };
  return colors[token?.symbol] ?? "#56544b";
}

function tokenIconHtml(token) {
  return `<span class="token-icon" style="--token-color:${tokenColor(token)}">${escapeHtml(tokenGlyph(token))}</span>`;
}

function tokenSearchText(token) {
  return `${token.symbol} ${token.name ?? ""} ${token.address}`.toLowerCase();
}

function filteredTokens(query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return state.tokens;
  return state.tokens.filter((token) => tokenSearchText(token).includes(normalized));
}

function parseChainId(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "string" && /^eip155:\d+$/i.test(value)) {
    return BigInt(value.split(":")[1]);
  }

  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function chainIdMatchesDogeos(value) {
  return parseChainId(value) === BigInt(DOGEOS_CHAIN_ID);
}

function chartUsesSheet() {
  return Boolean(window.matchMedia?.(MOBILE_CHART_QUERY)?.matches);
}

function normalizeHexAddress(value, fieldName = "address") {
  const address = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return address;
}

function encodeAddressWord(value, fieldName = "address") {
  return normalizeHexAddress(value, fieldName).slice(2).padStart(64, "0");
}

function encodeErc20BalanceOf(owner) {
  return `${ERC20_BALANCE_OF_SELECTOR}${encodeAddressWord(owner, "owner")}`;
}

function decodeUint256Result(value, fieldName = "result") {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a uint256 ABI result.`);
  }
  return BigInt(normalized).toString();
}

function walletBalanceKey(tokenAddress) {
  return normalizeHexAddress(tokenAddress, "token");
}

function errorMessage(error, fallback = "Request failed.") {
  if (typeof error === "string") return error;
  return error?.shortMessage ?? error?.message ?? fallback;
}

function isUnsupportedChainMessage(message) {
  return (
    /chain id not supported/i.test(message) ||
    /chain not (configured|supported|added)/i.test(message) ||
    /unsupported chain/i.test(message) ||
    /unrecognized chain/i.test(message) ||
    /unknown chain/i.test(message)
  );
}

function walletConnectErrorMessage(error) {
  const message = errorMessage(error, "Wallet connection failed.");
  if (!isUnsupportedChainMessage(message)) return message;
  return "Add DogeOS Chikyu Testnet with RPC https://rpc.testnet.dogeos.com and chain ID 6281971, then connect again.";
}

function decimalToUnits(value, decimals) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) {
    throw new Error("Amount must be a positive decimal.");
  }

  const [whole, fraction = ""] = raw.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");

  if (units <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return units.toString();
}

function unitsToDecimal(value, decimals, precision = 6) {
  if (value === undefined || value === null || value === "") return "-";
  const units = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = units % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, precision);
  const trimmedFraction = fractionText.replace(/0+$/, "");

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

function formatDogeWei(value) {
  if (value === undefined || value === null) return "-";
  return unitsToDecimal(value, 18, 15);
}

function bigintFromQuantity(value, fieldName = "quantity") {
  try {
    return BigInt(value ?? 0);
  } catch {
    throw new Error(`${fieldName} must be a numeric quantity.`);
  }
}

function hexQuantity(value) {
  const quantity = bigintFromQuantity(value);
  if (quantity < 0n) throw new Error("Hex quantity cannot be negative.");
  return `0x${quantity.toString(16)}`;
}

function bufferedGasLimit(value, bufferBps = 12_000n) {
  const gas = bigintFromQuantity(value, "gas");
  return (gas * bufferBps + 9_999n) / 10_000n;
}

function nativeDogeFundingMessage(requiredWei, availableWei) {
  return `Insufficient DOGE for DogeOS gas: need ${formatDogeWei(requiredWei)} DOGE, wallet has ${formatDogeWei(availableWei)} DOGE. Faucet: ${DOGEOS_FAUCET_URL}`;
}

function transactionErrorMessage(error) {
  const message = errorMessage(error, "Transaction could not be built.");
  const nativeMatch = message.match(/Insufficient native DOGE balance:\s*required\s*(\d+),\s*available\s*(\d+)/i);
  if (nativeMatch) {
    return nativeDogeFundingMessage(nativeMatch[1], nativeMatch[2]);
  }

  if (/Insufficient DOGE for DogeOS gas/i.test(message)) {
    return message;
  }

  if (/insufficient funds|testnet doge|native doge balance|not enough.*doge/i.test(message)) {
    return `Insufficient DOGE for DogeOS gas. Use the official DogeOS testnet faucet: ${DOGEOS_FAUCET_URL}`;
  }

  return message.replace(/https?:\/\/\S*faucet\S*/gi, DOGEOS_FAUCET_URL);
}

function formatLatencyMs(value) {
  if (value === undefined || value === null) return "";
  const latencyMs = Number(value);
  if (!Number.isFinite(latencyMs)) return "";
  return `${Math.round(latencyMs)}ms`;
}

function formatTelemetryLatency(value) {
  return formatLatencyMs(value) || "-";
}

function formatTelemetryCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? String(Math.max(0, Math.trunc(count))) : "-";
}

function quoteTelemetryDetail(quote) {
  if (!quote?.telemetry) return "verify - / providers - / fees - / score - / routes -";

  const verify = formatTelemetryLatency(quote.telemetry?.preQuoteVerificationMs);
  const providers = formatTelemetryLatency(quote.telemetry?.candidateProviderMs);
  const fees = formatTelemetryLatency(quote.telemetry?.feeResolutionMs);
  const score = formatTelemetryLatency(quote.telemetry?.routeScoringMs);
  const candidateCount = formatTelemetryCount(quote.telemetry?.candidateCount);
  const executableCount = formatTelemetryCount(quote.telemetry?.executableCandidateCount);
  const rejectedCount = formatTelemetryCount(quote.telemetry?.rejectedCandidateCount);
  const sourceIssueCount = Number(quote.telemetry?.sourceErrorCount ?? 0);
  const sourceIssueText =
    Number.isFinite(sourceIssueCount) && sourceIssueCount > 0
      ? ` / ${Math.trunc(sourceIssueCount)} ${sourceIssueCount === 1 ? "issue" : "issues"}`
      : "";

  return `verify ${verify} / providers ${providers} / fees ${fees} / score ${score} / routes ${executableCount}/${candidateCount} live, ${rejectedCount} rejected${sourceIssueText}`;
}

function quoteSourceIssueDetail(quote) {
  const sourceErrors = quote?.telemetry?.sourceErrors;
  if (!Array.isArray(sourceErrors) || sourceErrors.length === 0) return "";

  const visibleErrors = sourceErrors.slice(0, 2).map((entry) => {
    const type = entry?.type || "source-issue";
    const id = entry?.providerId || entry?.sourceId || entry?.protocolType || "unknown-source";
    const protocol = entry?.protocolType && entry?.protocolType !== id ? `/${entry.protocolType}` : "";
    const message = entry?.message || "Live quote source returned no diagnostic message.";
    return `${type} / ${id}${protocol}: ${message}`;
  });

  const overflowCount = sourceErrors.length - visibleErrors.length;
  return overflowCount > 0
    ? `${visibleErrors.join(" | ")} | +${overflowCount} more`
    : visibleErrors.join(" | ");
}

function quoteLatencySuffix(quote) {
  const latency = formatLatencyMs(quote.telemetry?.quoteLatencyMs);
  return latency ? ` / ${latency}` : "";
}

function quoteSourceIssueSuffix(quote) {
  if (!quote) return "";

  const sourceErrorCount = Number(quote.telemetry?.sourceErrorCount ?? 0);
  if (!Number.isFinite(sourceErrorCount) || sourceErrorCount <= 0) return "";

  return ` / ${sourceErrorCount} source ${sourceErrorCount === 1 ? "issue" : "issues"}`;
}

function quoteStatusSuffix(quote) {
  return `${quoteLatencySuffix(quote)}${quoteSourceIssueSuffix(quote)}`;
}

function normalizedPairKey(left, right) {
  const first = String(left ?? "").toUpperCase();
  const second = String(right ?? "").toUpperCase();
  if (!first || !second) return "";
  return `${first}/${second}`;
}

function supportedPairLabels() {
  const labels = [];
  const seen = new Set();

  for (const source of state.sources) {
    if (source.status !== "active") continue;
    for (const pair of source.supportedPairs ?? []) {
      const label = String(pair ?? "").trim().toUpperCase();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
  }

  return labels;
}

function sourceSupportsSelectedPair() {
  const { sellToken, buyToken } = selectedTokens();
  if (!sellToken || !buyToken) return false;

  const direct = normalizedPairKey(sellToken.symbol, buyToken.symbol);
  const inverse = normalizedPairKey(buyToken.symbol, sellToken.symbol);
  return supportedPairLabels().some((pair) => pair === direct || pair === inverse);
}

function quoteHasOneHopPreview(quote = state.quote) {
  const rows = routeRowsFromQuote(quote);
  return rows.some((route) => route.routeType === "oneHop" || route.reason === "one-hop-execution-preview");
}

function routeAvailabilityMessage(quote = state.quote) {
  const pair = selectedPairLabel();
  const supportedPairs = supportedPairLabels();
  const supportedText = supportedPairs.length ? supportedPairs.join(", ") : "no verified live pools";

  if (quote?.status === "read-only" && quoteHasOneHopPreview(quote)) {
    return `Read-only WDOGE bridge preview for ${pair}; execution stays direct-only until multi-leg swap execution is enabled.`;
  }

  if (!sourceSupportsSelectedPair()) {
    return `No verified pool for ${pair}. Verified live pools currently cover ${supportedText}.`;
  }

  return `No executable route returned for ${pair}${quoteSourceIssueSuffix(quote)}.`;
}

function formatTokenAmount(value, token, precision = 6) {
  return token ? unitsToDecimal(value, token.decimals, precision) : String(value ?? "-");
}

function mergeExecutionQuote(baseQuote, nextQuote) {
  if (!nextQuote) return baseQuote;
  return {
    ...baseQuote,
    ...nextQuote,
    recipient: nextQuote.recipient ?? baseQuote.recipient,
    deadline: nextQuote.deadline ?? baseQuote.deadline,
    slippageBps: nextQuote.slippageBps ?? baseQuote.slippageBps,
  };
}

function swapActivityTitle(quote) {
  const sellToken = tokenByAddress(quote.sellToken);
  const buyToken = tokenByAddress(quote.buyToken);
  return `${formatTokenAmount(quote.amountIn, sellToken, 4)} ${sellToken?.symbol ?? "sell"} -> ${formatTokenAmount(quote.amountOut, buyToken, 4)} ${buyToken?.symbol ?? "buy"}`;
}

function swapIntentLabel(quote) {
  const sellToken = tokenByAddress(quote.sellToken);
  const buyToken = tokenByAddress(quote.buyToken);
  const output = quote.quoteMode === "exactOutput" ? quote.amountOut : quote.minAmountOut ?? quote.amountOut;
  const outputLabel = quote.quoteMode === "exactOutput" ? "" : "at least ";
  return `${formatTokenAmount(quote.amountIn, sellToken, 4)} ${sellToken?.symbol ?? "sell"} for ${outputLabel}${formatTokenAmount(output, buyToken, 4)} ${buyToken?.symbol ?? "buy"}`;
}

function formatBlockNumber(value) {
  if (!value) return "";
  try {
    return BigInt(value).toString();
  } catch {
    return String(value);
  }
}

function formatReceiptBlockNumber(receipt) {
  return formatBlockNumber(receipt?.blockNumber);
}

function blockscoutAddressUrl(address) {
  if (!address) return null;
  return `${BLOCKSCOUT_BASE_URL}/address/${address}`;
}

function blockscoutTxUrl(txHash) {
  if (!txHash) return null;
  return `${BLOCKSCOUT_BASE_URL}/tx/${txHash}`;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  }

  return body;
}

function setStatus(message, isError = false) {
  elements.quoteStatus.textContent = message;
  elements.quoteStatus.classList.toggle("error-text", isError);
}

function switchView(view) {
  if (!elements.views[view]) return;
  state.currentView = view;

  for (const [key, viewElement] of Object.entries(elements.views)) {
    viewElement.hidden = key !== view;
    viewElement.classList.toggle("active", key === view);
  }

  for (const [key, navElement] of Object.entries(elements.nav)) {
    navElement.classList.toggle("active", key === view);
  }

  for (const [key, navElement] of Object.entries(elements.bottomNav)) {
    navElement.classList.toggle("active", key === view);
  }

  if (view !== "swap" && state.swapSettingsVisible) {
    toggleSwapSettings(false);
  }
}

function slippagePercent() {
  const bps = Number(elements.slippageBps.value || 0);
  return Number.isFinite(bps) ? bps / 100 : 0;
}

function setKnobTurn(element, value, min, max) {
  if (!element?.style?.setProperty) return;
  const numericValue = Number(value);
  const numericMin = Number(min);
  const numericMax = Number(max);
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericMin) || !Number.isFinite(numericMax)) {
    return;
  }

  const progress = Math.min(1, Math.max(0, (numericValue - numericMin) / (numericMax - numericMin || 1)));
  const degrees = -135 + progress * 270;
  element.style.setProperty("--knob-turn", `${degrees.toFixed(1)}deg`);
}

function renderTradeControls() {
  const percent = slippagePercent();
  const route = state.quote?.best ?? routeRowsFromQuote(state.quote)[0];
  const gasUnits = route?.gasUnits ? Number(route.gasUnits) : null;
  const slippageLabel = percent >= 49.995 ? "MAX" : `${percent.toFixed(percent >= 10 ? 0 : 2)}%`;
  const gasLabel = gasUnits ? `${route.gasUnits} gas` : "live gas";
  elements.slippageValue.textContent = slippageLabel;
  elements.gasPriorityValue.textContent = gasUnits ? `${route.gasUnits} gas` : "live";
  elements.swapSettingsSummary.textContent = `${slippageLabel} / ${gasLabel}`;
  setKnobTurn(elements.slippageKnob, elements.slippageBps.value, elements.slippageBps.min ?? 1, elements.slippageBps.max ?? 5000);
  setKnobTurn(elements.gasKnob, gasUnits ?? 120_000, 80_000, 320_000);
}

function selectedBalanceText(token) {
  if (!token) return "balance loading";

  if (!state.walletAddress) {
    return `${token.symbol} · ${compactAddress(token.address)}`;
  }

  const key = walletBalanceKey(token.address);
  if (Object.prototype.hasOwnProperty.call(state.walletBalances, key)) {
    return `Balance ${formatTokenAmount(state.walletBalances[key], token, 6)} ${token.symbol}`;
  }

  if (state.walletBalanceErrors[key]) {
    return `Balance unavailable for ${token.symbol}`;
  }

  return `Balance loading ${token.symbol}`;
}

function selectedSellBalance() {
  const sellToken = tokenByAddress(elements.sellToken.value);
  if (!sellToken || !state.walletAddress) return null;

  const key = walletBalanceKey(sellToken.address);
  if (!Object.prototype.hasOwnProperty.call(state.walletBalances, key)) return null;

  return {
    token: sellToken,
    units: BigInt(state.walletBalances[key]),
  };
}

function renderQuickAmountControls() {
  const sellBalance = selectedSellBalance();
  const hasSpendableBalance = Boolean(sellBalance && sellBalance.units > 0n);

  for (const button of [
    elements.sellAmountMax,
    elements.sellAmountHalf,
    elements.sellAmountQuarter,
  ]) {
    if (!button) continue;
    button.disabled = !hasSpendableBalance;
    button.setAttribute("aria-disabled", String(!hasSpendableBalance));
  }
}

function applySellBalancePercent(percent) {
  const sellBalance = selectedSellBalance();
  if (!sellBalance || sellBalance.units <= 0n) {
    setStatus("Connect wallet with a sell-token balance to use quick amounts", true);
    return;
  }

  const amount = (sellBalance.units * BigInt(percent)) / 100n;
  if (amount <= 0n) {
    setStatus("Sell-token balance is too small for that quick amount", true);
    return;
  }

  elements.sellAmount.value = unitsToDecimal(amount.toString(), sellBalance.token.decimals, sellBalance.token.decimals);
  scheduleExactInputQuoteRefresh();
}

function renderTokenChips() {
  const sellToken = tokenByAddress(elements.sellToken.value);
  const buyToken = tokenByAddress(elements.buyToken.value);

  elements.sellTokenChip.innerHTML = sellToken
    ? `${tokenIconHtml(sellToken)}<span>${escapeHtml(sellToken.symbol)}</span>`
    : "Sell token";
  elements.buyTokenChip.innerHTML = buyToken
    ? `${tokenIconHtml(buyToken)}<span>${escapeHtml(buyToken.symbol)}</span>`
    : "Buy token";
  elements.sellBalance.textContent = selectedBalanceText(sellToken);
  elements.buyBalance.textContent = selectedBalanceText(buyToken);
  renderQuickAmountControls();
}

function renderTokenOptions() {
  const options = state.tokens
    .map((token) => `<option value="${token.address}">${escapeHtml(token.symbol)}</option>`)
    .join("");
  elements.sellToken.innerHTML = options;
  elements.buyToken.innerHTML = options;

  const usdc = tokenBySymbol("USDC");
  const wdoge = tokenBySymbol("WDOGE");
  if (usdc) elements.sellToken.value = usdc.address;
  if (wdoge) elements.buyToken.value = wdoge.address;
  renderTokenChips();
  renderTradeControls();
}

function uniqueSelectedBalanceTokens() {
  const { sellToken, buyToken } = selectedTokens();
  const tokens = [];
  const seen = new Set();
  for (const token of [sellToken, buyToken]) {
    if (!token) continue;
    const key = walletBalanceKey(token.address);
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

function clearWalletBalances() {
  state.walletBalances = {};
  state.walletBalanceErrors = {};
}

async function readWalletTokenBalance(provider, owner, token) {
  const result = await provider.request({
    method: "eth_call",
    params: [
      {
        to: token.address,
        data: encodeErc20BalanceOf(owner),
      },
      "latest",
    ],
  });
  return decodeUint256Result(result, `${token.symbol} balance`);
}

async function refreshSelectedWalletBalances() {
  const wallet = sdkWallet();
  const provider = wallet?.getProvider?.();
  const owner = state.walletAddress;
  const tokens = uniqueSelectedBalanceTokens();

  if (!owner || !provider?.request || tokens.length === 0) {
    clearWalletBalances();
    renderTokenChips();
    return;
  }

  const requestSeq = ++walletBalanceRequestSeq;
  for (const token of tokens) {
    const key = walletBalanceKey(token.address);
    delete state.walletBalanceErrors[key];
    delete state.walletBalances[key];
  }
  renderTokenChips();

  const balances = await Promise.all(
    tokens.map(async (token) => {
      const key = walletBalanceKey(token.address);
      try {
        return { key, balance: await readWalletTokenBalance(provider, owner, token) };
      } catch (error) {
        return { key, error };
      }
    }),
  );

  if (requestSeq !== walletBalanceRequestSeq) return;

  for (const entry of balances) {
    if (entry.error) {
      state.walletBalanceErrors[entry.key] = errorMessage(entry.error, "Balance unavailable.");
    } else {
      state.walletBalances[entry.key] = entry.balance;
    }
  }
  renderTokenChips();
}

function renderTokenRow(token, { picker = false } = {}) {
  const address = compactAddress(token.address);
  const verified = token.verified === false ? "unverified" : "verified";
  const action = picker
    ? `<span class="status-pill active">select</span>`
    : `<span class="status-pill active">trade</span>`;

  return `
    <button class="token-row" type="button" data-token-address="${escapeHtml(token.address)}">
      ${tokenIconHtml(token)}
      <span>
        <strong>${escapeHtml(token.symbol)}</strong>
        <span class="token-meta">${escapeHtml(token.name ?? token.symbol)} / ${address} / ${verified}</span>
      </span>
      <svg class="sparkline" viewBox="0 0 70 24" aria-hidden="true">
        <polyline points="${sparklinePoints(token)}" fill="none" stroke="${token.symbol === "USDT" ? "#26a17b" : tokenColor(token)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
      ${action}
    </button>
  `;
}

function sparklinePoints(token) {
  const seed = Array.from(token.symbol ?? "DOGE").reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const points = [];
  for (let i = 0; i < 8; i += 1) {
    const x = Math.round((i / 7) * 70);
    const wave = Math.sin((seed + i * 31) / 18);
    const slope = token.symbol === "USDT" || token.symbol === "USDC" || token.symbol === "USD1" ? 0 : i * 0.9;
    const y = Math.round(15 - wave * 5 - slope);
    points.push(`${x},${Math.max(3, Math.min(21, y))}`);
  }
  return points.join(" ");
}

function renderTokenLists() {
  const listTokens = filteredTokens(elements.tokenSearch.value);
  elements.tokenListView.innerHTML = listTokens.length
    ? listTokens.map((token) => renderTokenRow(token)).join("")
    : `<div class="empty-state">No tokens match this filter</div>`;
  renderTokenPicker();
}

function openTokenPicker(side) {
  state.tokenPickerSide = side;
  elements.tokenPicker.hidden = false;
  elements.tokenPickerSearch.value = "";
  renderTokenPicker();
}

function closeTokenPicker() {
  state.tokenPickerSide = null;
  elements.tokenPicker.hidden = true;
}

function renderTokenPicker() {
  const tokens = filteredTokens(elements.tokenPickerSearch.value);
  elements.tokenPickerList.innerHTML = tokens.length
    ? tokens.map((token) => renderTokenRow(token, { picker: true })).join("")
    : `<div class="empty-state">No tokens match this search</div>`;
}

function chooseToken(address) {
  if (!state.tokenPickerSide) return;
  const token = tokenByAddress(address);
  if (!token) return;

  const otherSelect = state.tokenPickerSide === "sell" ? elements.buyToken : elements.sellToken;
  const targetSelect = state.tokenPickerSide === "sell" ? elements.sellToken : elements.buyToken;
  if (otherSelect.value.toLowerCase() === token.address.toLowerCase()) {
    otherSelect.value = targetSelect.value;
  }
  targetSelect.value = token.address;
  closeTokenPicker();
  renderTokenChips();
  refreshSelectedWalletBalances();
  scheduleQuoteRefresh();
}

function flipTokens() {
  const sellValue = elements.sellToken.value;
  elements.sellToken.value = elements.buyToken.value;
  elements.buyToken.value = sellValue;
  state.quoteMode = "exactInput";
  renderTokenChips();
  refreshSelectedWalletBalances();
  scheduleQuoteRefresh();
}

function verificationTargetsForSource(sourceId) {
  return state.verification?.sources?.filter((target) => target.sourceId === sourceId) ?? [];
}

function sourceVerificationLine(source) {
  const targets = verificationTargetsForSource(source.sourceId);
  if (state.verification?.error) return "Verification unavailable";
  if (targets.length === 0) {
    return state.verification ? "No contract targets" : "Verification snapshot loading";
  }

  const relationshipChecks = targets.flatMap((target) => target.readChecks ?? []);
  const relationshipMatches = relationshipChecks.filter((check) => check.matches).length;
  const relationshipText = relationshipChecks.length
    ? `${relationshipMatches}/${relationshipChecks.length} relationships`
    : "No relationship checks";
  const poolChecks = targets.filter((target) => target.poolStateCheck);
  const poolMatches = poolChecks.filter((target) => target.poolStateCheck?.matches === true).length;
  const poolText = poolChecks.length
    ? `${poolMatches}/${poolChecks.length} pool states`
    : "No pool state checks";
  const blockscoutAbiAvailable = targets.some(
    (target) => target.verification?.isBlockscoutAbiAvailable === true,
  );
  const abiText = blockscoutAbiAvailable ? "Blockscout ABI verified" : "Blockscout ABI pending";

  return `${abiText} / ${relationshipText} / ${poolText}`;
}

function venueContractSummary(source) {
  const venue = venueBySourceId(source.sourceId);
  if (!venue) return "Contract map loading";

  const contracts = venue.contracts ?? [];
  const router = contracts.find((contract) => contract.role === "router");
  const poolCount = contracts.filter((contract) => contract.role === "pool").length;
  const blockscoutAbiAvailable = contracts.some(
    (contract) => contract.verification?.isBlockscoutAbiAvailable === true,
  );
  const abiText = blockscoutAbiAvailable ? "Blockscout ABI verified" : "Blockscout ABI pending";
  const routerText = router ? `router ${shortAddress(router.address)}` : "router pending";

  return `${contracts.length} contracts / ${poolCount} pools / ${routerText} / ${abiText}`;
}

function renderVenueSummary(source) {
  const venue = venueBySourceId(source.sourceId);
  const router = venue?.contracts?.find((contract) => contract.role === "router");
  const routerHref = blockscoutAddressUrl(router?.address);
  const routerLink = routerHref
    ? ` <a class="explorer-link" href="${routerHref}" target="_blank" rel="noreferrer">router</a>`
    : "";

  return `<p class="verification-line">${venueContractSummary(source)}${routerLink}</p>`;
}

function contractAbiStatus(contract) {
  if (contract.verification?.isBlockscoutAbiAvailable === true) {
    return "Blockscout ABI verified";
  }

  const status = contract.blockscoutAbi?.status;
  const message = contract.blockscoutAbi?.message;
  if (message) {
    return status ? `Blockscout ABI ${status}: ${message}` : `Blockscout ABI pending: ${message}`;
  }

  return "Blockscout ABI pending";
}

function contractAbiProvenance(contract) {
  const provenance = contract.abiProvenance ?? "none";
  const hashMatches =
    contract.abiArtifact?.artifactHashMatches ??
    contract.executionEvidence?.abiProof?.artifactHashMatches;
  const hasArtifactHash = Boolean(
    contract.abiArtifact?.artifactHash ?? contract.executionEvidence?.abiProof?.artifactHash,
  );

  if (hashMatches === true) return `${provenance} / hash ok`;
  if (hashMatches === false) return `${provenance} / hash mismatch`;
  if (hasArtifactHash) return `${provenance} / hash pending`;
  return provenance;
}

function contractPoolProof(contract) {
  if (contract.role !== "pool") return "";

  const proof = contract.executionEvidence?.onchainProof;
  const pair = proof?.poolPair ?? "unmapped";
  const stateKind = proof?.poolStateKind ?? "state pending";
  const tokenStatus = proof?.poolTokenMatches === true ? "tokens ok" : "tokens mismatch";
  const stateStatus = proof?.poolStateVerified === true ? "state ok" : "state mismatch";
  const liquidityStatus = proof?.poolHasLiveLiquidity === true ? "live liquidity" : "liquidity pending";

  return `pool ${pair} / ${stateKind} / ${tokenStatus} / ${stateStatus} / ${liquidityStatus}`;
}

function renderVenueContractDetails(source) {
  const venue = venueBySourceId(source.sourceId);
  const contracts = venue?.contracts ?? [];
  if (contracts.length === 0) {
    return `<div class="contract-list empty">Contract map loading</div>`;
  }

  return `
    <div class="contract-list" aria-label="${escapeHtml(source.displayName)} contract provenance">
      ${contracts.map((contract) => {
        const href = blockscoutAddressUrl(contract.address) ?? contract.blockscoutUrl;
        const executable = contract.executionEvidence?.executable === true ? "execution-ready" : "read-check";
        return `
          <a class="contract-row" href="${href}" target="_blank" rel="noreferrer">
            <span class="contract-role">${escapeHtml(contract.role)}</span>
            <strong>${shortAddress(contract.address)}</strong>
            <span>${escapeHtml(contractAbiProvenance(contract))}</span>
            <span>${escapeHtml(contractAbiStatus(contract))}</span>
            <span class="pool-proof">${escapeHtml(contractPoolProof(contract))}</span>
            <span class="status-pill ${executable === "execution-ready" ? "active" : "blocked"}">${executable}</span>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function renderVerificationSummary() {
  if (!state.verification) {
    elements.verificationSummary.textContent = "Verification snapshot loading";
    elements.verificationSummary.classList.remove("error-text");
    return;
  }

  if (state.verification.error) {
    elements.verificationSummary.textContent = `Verification unavailable: ${state.verification.error}`;
    elements.verificationSummary.classList.add("error-text");
    return;
  }

  const summary = state.verification.summary ?? {};
  const tokenMatches = (state.verification.tokens ?? []).filter((token) => token.matches).length;
  const tokenTotal = state.verification.tokens?.length ?? 0;
  const relationshipMismatchCount = summary.relationshipMismatches?.length ?? 0;
  const tokenMismatchCount = summary.tokenDecimalMismatches?.length ?? 0;
  const poolMismatchCount = summary.poolMismatches?.length ?? 0;
  const status = summary.hasBlockingMismatch ? "Verification mismatch" : "Verification checks clear";

  elements.verificationSummary.textContent =
    `${status} / ${tokenMatches}/${tokenTotal} token decimals / ` +
    `${relationshipMismatchCount} relationship mismatches / ${tokenMismatchCount} token mismatches / ` +
    `${poolMismatchCount} pool ${poolMismatchCount === 1 ? "mismatch" : "mismatches"}`;
  elements.verificationSummary.classList.toggle("error-text", Boolean(summary.hasBlockingMismatch));
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function readinessItem({ status, title, detail }) {
  return `<li class="${status}"><span></span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div></li>`;
}

function renderReadiness() {
  if (!elements.timeline) return;

  if (!state.verification) {
    elements.timeline.innerHTML = [
      readinessItem({ status: "pending", title: "Chain", detail: "Verification snapshot loading" }),
      readinessItem({ status: "pending", title: "Quotes", detail: "Loading live venue registry" }),
      readinessItem({ status: "pending", title: "ABI", detail: "Blockscout ABI status loading" }),
      readinessItem({ status: "pending", title: "Execution", detail: "Execution evidence loading" }),
    ].join("");
    return;
  }

  if (state.verification.error) {
    elements.timeline.innerHTML = [
      readinessItem({ status: "blocked", title: "Chain", detail: state.verification.error }),
      readinessItem({ status: "pending", title: "Quotes", detail: "Live quote state preserved" }),
      readinessItem({ status: "pending", title: "ABI", detail: "Verification unavailable" }),
      readinessItem({ status: "pending", title: "Execution", detail: "Execution evidence unavailable" }),
    ].join("");
    return;
  }

  const targets = state.verification.sources ?? [];
  const activeVenueCount = state.sources.filter((source) => source.status === "active").length;
  const executableContractCount = targets.filter(
    (target) => target.executionEvidence?.executable === true,
  ).length;
  const hasBlockscoutAbi = targets.some(
    (target) => target.verification?.isBlockscoutAbiAvailable === true,
  );
  const abiMessage = targets.find((target) => target.blockscoutAbi?.message)?.blockscoutAbi?.message;
  const summary = state.verification.summary ?? {};
  const chainMatches = state.verification.chainMatches !== false;
  const hasBlockingMismatch = Boolean(summary.hasBlockingMismatch);
  const poolTargets = targets.filter(
    (target) => target.poolStateCheck || target.executionEvidence?.onchainProof?.poolPair,
  );
  const verifiedPoolCount = poolTargets.filter((target) => {
    const poolCheck = target.poolStateCheck;
    const poolProof = target.executionEvidence?.onchainProof;
    return poolCheck?.matches === true || poolProof?.poolStateVerified === true;
  }).length;
  const poolMismatchCount = summary.poolMismatches?.length ?? 0;

  elements.timeline.innerHTML = [
    readinessItem({
      status: chainMatches ? "done" : "blocked",
      title: "Chain",
      detail: chainMatches ? "RPC chain ID verified" : "RPC chain ID mismatch",
    }),
    readinessItem({
      status: activeVenueCount > 0 ? "done" : "pending",
      title: "Quotes",
      detail: activeVenueCount > 0
        ? `${pluralize(activeVenueCount, "active venue")} live`
        : "No active quote venues",
    }),
    readinessItem({
      status: poolMismatchCount > 0 ? "blocked" : verifiedPoolCount > 0 ? "done" : "pending",
      title: "Pool proof",
      detail: poolMismatchCount > 0
        ? `${pluralize(poolMismatchCount, "pool mismatch")}`
        : verifiedPoolCount > 0
          ? `${pluralize(verifiedPoolCount, "pool state check")} clear`
          : "Pool state proof loading",
    }),
    readinessItem({
      status: hasBlockscoutAbi ? "done" : "pending",
      title: "ABI",
      detail: hasBlockscoutAbi
        ? "Blockscout ABI verified"
        : `Blockscout ABI pending${abiMessage ? `: ${abiMessage}` : ""}`,
    }),
    readinessItem({
      status: executableContractCount > 0 && !hasBlockingMismatch ? "done" : "pending",
      title: "Execution",
      detail: executableContractCount > 0
        ? `${pluralize(executableContractCount, "executable contract")} with simulation evidence`
        : "No executable contract evidence",
    }),
  ].join("");
}

function renderSources() {
  elements.sourceCount.textContent = `${state.sources.length}`;
  elements.sourceList.innerHTML = state.sources
    .map((source) => {
      const statusClass = source.status === "active" ? "active" : "blocked";
      const pairText = source.supportedPairs?.length ? source.supportedPairs.join(", ") : "Discovery";

      return `
        <article class="source-card">
          <header>
            <strong>${source.displayName}</strong>
            <span class="status-pill ${statusClass}">${source.status}</span>
          </header>
          <p>${source.protocolType.toUpperCase()} / ${pairText}</p>
          ${renderVenueSummary(source)}
          ${renderVenueContractDetails(source)}
          <p class="verification-line">${sourceVerificationLine(source)}</p>
        </article>
      `;
    })
    .join("");
}

function routeRowsFromQuote(quote) {
  const rows = [];
  if (quote?.best) rows.push({ ...quote.best, reason: "best" });
  rows.push(...(quote?.alternatives ?? []).map((route) => ({ ...route, reason: "alternative" })));
  rows.push(...(quote?.rejected ?? []));
  return rows;
}

function routeStatusLabel(route) {
  if (route.reason === "not-active") return "inactive";
  if (route.reason === "best") return "best";
  if (route.reason) return route.reason;
  return route.status;
}

function selectedChartSymbol() {
  const { sellToken, buyToken } = selectedTokens();
  if (!sellToken || !buyToken) return "";
  return `${sellToken.symbol}/${buyToken.symbol}`;
}

function chartSymbolFromRoute(route) {
  const sellToken = tokenByAddress(route?.sellToken);
  const buyToken = tokenByAddress(route?.buyToken);
  if (!sellToken || !buyToken) return "";
  return `${sellToken.symbol}/${buyToken.symbol}`;
}

function chartContainerId(targetElement) {
  return targetElement?.id ? targetElement.id.replace(/^#/, "") : "";
}

function loadTradingViewLibrary() {
  if (window.TradingView?.widget) return Promise.resolve(window.TradingView);
  if (tradingViewLibraryPromise) return tradingViewLibraryPromise;

  tradingViewLibraryPromise = new Promise((resolve, reject) => {
    if (!document.createElement || !document.head?.appendChild) {
      reject(new Error("TradingView loader is unavailable."));
      return;
    }

    const script = document.createElement("script");
    script.src = CHART_LIBRARY_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.TradingView?.widget) {
        resolve(window.TradingView);
      } else {
        reject(new Error("TradingView charting library did not expose a widget."));
      }
    };
    script.onerror = () => reject(new Error("TradingView charting library failed to load."));
    document.head.appendChild(script);
  });

  return tradingViewLibraryPromise;
}

function chartSymbolInfo(symbol) {
  return {
    name: symbol,
    ticker: symbol,
    description: `${symbol} DogeOS live quote`,
    type: "crypto",
    session: "24x7",
    timezone: "Etc/UTC",
    exchange: "DogeOS",
    listed_exchange: "DogeOS",
    minmov: 1,
    pricescale: CHART_PRICE_SCALE,
    has_intraday: true,
    has_daily: true,
    supported_resolutions: ["1", "5", "15", "60", "1D"],
    volume_precision: 2,
    data_status: "streaming",
  };
}

function barsForSymbol(symbol) {
  return chartBarsBySymbol.get(symbol) ?? [];
}

function deferChartCallback(callback) {
  Promise.resolve().then(callback);
}

function createDogeosChartDatafeed() {
  return {
    onReady(callback) {
      deferChartCallback(() => callback({
        supports_search: false,
        supports_group_request: false,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        supported_resolutions: ["1", "5", "15", "60", "1D"],
      }));
    },
    resolveSymbol(symbolName, onResolve) {
      deferChartCallback(() => onResolve(chartSymbolInfo(symbolName)));
    },
    getBars(symbolInfo, _resolution, periodParams, onHistory) {
      const symbol = symbolInfo?.ticker ?? symbolInfo?.name ?? selectedChartSymbol();
      const fromMs = Number(periodParams?.from ?? 0) * 1000;
      const toMs = Number(periodParams?.to ?? Number.MAX_SAFE_INTEGER) * 1000;
      const bars = barsForSymbol(symbol).filter((bar) => bar.time >= fromMs && bar.time <= toMs);
      deferChartCallback(() => onHistory(bars, { noData: bars.length === 0 }));
    },
    subscribeBars(symbolInfo, _resolution, onRealtime, subscriberUID) {
      const symbol = symbolInfo?.ticker ?? symbolInfo?.name ?? selectedChartSymbol();
      chartSubscribers.set(subscriberUID, { symbol, onRealtime });
    },
    unsubscribeBars(subscriberUID) {
      chartSubscribers.delete(subscriberUID);
    },
  };
}

function tokenUnitsToNumber(value, decimals) {
  if (value === undefined || value === null) return 0;
  const units = BigInt(value);
  const base = 10n ** BigInt(decimals);
  return Number(units / base) + Number(units % base) / Number(base);
}

function chartPriceForRoute(route) {
  const sellToken = tokenByAddress(route?.sellToken);
  const buyToken = tokenByAddress(route?.buyToken);
  if (!sellToken || !buyToken) return null;

  const amountIn = tokenUnitsToNumber(route.amountIn, sellToken.decimals);
  const amountOut = tokenUnitsToNumber(route.amountOut, buyToken.decimals);
  if (!Number.isFinite(amountIn) || !Number.isFinite(amountOut) || amountIn <= 0 || amountOut <= 0) {
    return null;
  }

  return amountOut / amountIn;
}

function notifyChartSubscribers(symbol, bar) {
  for (const subscriber of chartSubscribers.values()) {
    if (subscriber.symbol === symbol) subscriber.onRealtime({ ...bar });
  }
}

function appendChartBar(symbol, price, { timestampMs = Date.now(), volume = 0 } = {}) {
  if (!symbol || !Number.isFinite(price) || price <= 0) return;

  const time = Math.floor(timestampMs / 60_000) * 60_000;
  const bars = [...barsForSymbol(symbol)];
  const previous = bars.at(-1);
  let bar;

  if (previous?.time === time) {
    bar = {
      ...previous,
      high: Math.max(previous.high, price),
      low: Math.min(previous.low, price),
      close: price,
      volume: previous.volume + volume,
    };
    bars[bars.length - 1] = bar;
  } else {
    bar = {
      time,
      open: previous?.close ?? price,
      high: Math.max(previous?.close ?? price, price),
      low: Math.min(previous?.close ?? price, price),
      close: price,
      volume,
    };
    bars.push(bar);
  }

  chartBarsBySymbol.set(symbol, bars.slice(-MAX_CHART_BARS));
  notifyChartSubscribers(symbol, bar);
}

function appendChartQuoteSample(quote = state.quote) {
  const route = routeRowsFromQuote(quote)[0];
  if (!route) return;

  const symbol = chartSymbolFromRoute(route);
  const price = chartPriceForRoute(route);
  if (!symbol || !price) return;

  const timestampMs = Number(route.quoteTimestampMs ?? Date.now());
  const volume = Number(route.gasUnits ?? 0);
  appendChartBar(symbol, price, { timestampMs, volume });

  const [base, quoteSymbol] = symbol.split("/");
  if (base && quoteSymbol) {
    appendChartBar(`${quoteSymbol}/${base}`, 1 / price, { timestampMs, volume });
  }
}

function setChartToggleLabel() {
  const label = chartUsesSheet()
    ? state.chartPopoutVisible ? "Hide chart" : "Chart"
    : state.chartVisible ? "Hide chart" : "Show chart";
  elements.chartToggle.textContent = label;
  elements.chartToggle.innerHTML = `<span aria-hidden="true"></span>${label}`;
}

function removeTradingViewChart(targetElement) {
  const container = chartContainerId(targetElement);
  const widget = chartWidgets.get(container);
  widget?.remove?.();
  chartWidgets.delete(container);
  chartWidgetSymbols.delete(container);
  chartPendingContainers.delete(container);
}

function updateTradingViewSymbol(targetElement, symbol) {
  const container = chartContainerId(targetElement);
  const widget = chartWidgets.get(container);
  if (!widget) return false;
  if (chartWidgetSymbols.get(container) === symbol) return true;

  if (typeof widget.setSymbol === "function") {
    widget.setSymbol(symbol, CHART_DEFAULT_RESOLUTION, () => {});
    chartWidgetSymbols.set(container, symbol);
    return true;
  }

  removeTradingViewChart(targetElement);
  return false;
}

function ensureTradingViewChart(targetElement = elements.marketVisual) {
  const container = chartContainerId(targetElement);
  const symbol = selectedChartSymbol();
  if (!container || !symbol) return;

  targetElement.classList.add("tradingview-chart");
  if (updateTradingViewSymbol(targetElement, symbol) || chartPendingContainers.has(container)) {
    return;
  }

  chartPendingContainers.add(container);
  targetElement.innerHTML = `<div class="tradingview-loading">TradingView · ${escapeHtml(symbol)}</div>`;

  loadTradingViewLibrary()
    .then((TradingView) => {
      chartPendingContainers.delete(container);
      if (chartWidgets.has(container)) {
        updateTradingViewSymbol(targetElement, symbol);
        return;
      }

      const options = {
        autosize: true,
        container,
        library_path: CHART_LIBRARY_PATH,
        symbol,
        interval: CHART_DEFAULT_RESOLUTION,
        timezone: "Etc/UTC",
        theme: "light",
        locale: "en",
        datafeed: createDogeosChartDatafeed(),
        disabled_features: [
          "header_symbol_search",
          "symbol_search_hot_key",
          "use_localstorage_for_settings",
        ],
        enabled_features: ["hide_left_toolbar_by_default"],
        loading_screen: {
          backgroundColor: "#f4f0df",
          foregroundColor: "#1b1a16",
        },
      };
      const Widget = TradingView.widget;
      const widget = Widget.prototype ? new Widget(options) : Widget(options);
      chartWidgets.set(container, widget);
      chartWidgetSymbols.set(container, symbol);
    })
    .catch((error) => {
      chartPendingContainers.delete(container);
      targetElement.classList.remove("tradingview-chart");
      targetElement.innerHTML = `
        <div class="empty-state">TradingView chart unavailable: ${escapeHtml(error.message)}</div>
      `;
    });
}

function routeExplorerLinks(route) {
  const source = sourceById(route.sourceId);
  const links = [];

  if (route.poolAddress) {
    links.push(["pool", blockscoutAddressUrl(route.poolAddress)]);
  }

  if (source?.router) {
    links.push(["router", blockscoutAddressUrl(source.router)]);
  }

  return links
    .filter(([, href]) => href)
    .map(([label, href]) => `<a class="explorer-link" href="${href}" target="_blank" rel="noreferrer">${label}</a>`)
    .join("");
}

function quoteExpiresInSeconds(quote = state.quote) {
  if (!quote?.expiresAtMs) return null;
  return Math.max(0, Math.ceil((Number(quote.expiresAtMs) - Date.now()) / 1000));
}

function updateQuoteRing({ loading = false } = {}) {
  if (loading) {
    elements.quoteRefreshRing.textContent = "scanning";
    elements.quoteRefreshRing.classList.add("loading");
    return;
  }

  elements.quoteRefreshRing.classList.remove("loading");
  const seconds = quoteExpiresInSeconds();
  if (seconds === null) {
    elements.quoteRefreshRing.textContent = "live";
    return;
  }
  elements.quoteRefreshRing.textContent = seconds > 0 ? `best · ${seconds}s` : "expired";
}

function renderMarketPanel() {
  const best = state.quote?.best;
  const source = best ? sourceById(best.sourceId) : null;
  const sourceIssueDetail = quoteSourceIssueDetail(state.quote);
  const sheetMode = chartUsesSheet();
  elements.bestSourceLabel.textContent = source?.displayName ?? "-";
  elements.quoteLatencyLabel.textContent = formatLatencyMs(state.quote?.telemetry?.quoteLatencyMs) || "-";
  elements.sourceIssuesLabel.textContent = String(state.quote?.telemetry?.sourceErrorCount ?? 0);
  elements.quoteTelemetryDetail.textContent = quoteTelemetryDetail(state.quote);
  elements.quoteTelemetryDetail.setAttribute("title", "Quote timing telemetry from the latest live route response");
  elements.sourceIssueDetail.textContent = sourceIssueDetail;
  elements.sourceIssueDetail.hidden = !sourceIssueDetail;
  elements.sourceIssueDetail.setAttribute(
    "title",
    sourceIssueDetail || "No source issues in the latest live route response",
  );
  const chartPanelHidden = sheetMode || !state.chartVisible;
  elements.chartPanel.hidden = chartPanelHidden;
  elements.chartPanel.setAttribute("aria-hidden", String(chartPanelHidden));
  const chartControlActive = sheetMode ? state.chartPopoutVisible : state.chartVisible;
  elements.chartToggle.setAttribute("aria-pressed", String(chartControlActive));
  elements.chartToggle.classList.toggle("active", chartControlActive);
  setChartToggleLabel();
  if (!sheetMode && state.chartVisible) {
    ensureTradingViewChart(elements.marketVisual);
  } else if (sheetMode) {
    removeTradingViewChart(elements.marketVisual);
  }
  if (state.chartPopoutVisible) ensureTradingViewChart(elements.chartPopoutVisual);
}

function toggleChartPopout(open = !state.chartPopoutVisible) {
  state.chartPopoutVisible = open;
  elements.chartPopoutPanel.hidden = !open;
  if (open) {
    ensureTradingViewChart(elements.chartPopoutVisual);
  } else {
    removeTradingViewChart(elements.chartPopoutVisual);
  }
  renderMarketPanel();
}

function toggleSwapSettings(open = !state.swapSettingsVisible) {
  state.swapSettingsVisible = Boolean(open);
  elements.swapSettingsPanel.hidden = !state.swapSettingsVisible;
  elements.swapSettingsPanel.setAttribute("aria-hidden", String(!state.swapSettingsVisible));
  elements.swapSettingsToggle.setAttribute("aria-expanded", String(state.swapSettingsVisible));
}

function renderActivity() {
  elements.activityList.innerHTML = state.activity.length
    ? state.activity.map((entry) => `
      <article class="activity-row">
        <span>
          <strong>${escapeHtml(entry.title)}</strong>
          ${renderActivityDetail(entry)}
        </span>
        <span class="status-pill active">${escapeHtml(entry.status)}</span>
      </article>
    `).join("")
    : `<div class="activity-empty">Submitted swaps will appear here for this session.</div>`;
}

function renderActivityDetail(entry) {
  const txHref = blockscoutTxUrl(entry.txHash);
  const txLink = txHref
    ? ` <a class="explorer-link" href="${txHref}" target="_blank" rel="noreferrer" aria-label="Open transaction in Blockscout">tx</a>`
    : "";

  return `<span class="activity-meta">${escapeHtml(entry.detail)}${txLink}</span>`;
}

function recordActivity({ title, detail, status = "sent", txHash = "" }) {
  state.activity = [
    {
      title,
      detail,
      status,
      txHash,
      timestampMs: Date.now(),
    },
    ...state.activity,
  ].slice(0, 20);
  renderActivity();
}

function renderRoutes() {
  const rows = routeRowsFromQuote(state.quote);
  const sellToken = tokenByAddress(elements.sellToken.value);
  const buyToken = tokenByAddress(elements.buyToken.value);
  renderTradeControls();
  updateQuoteRing();
  renderMarketPanel();

  if (rows.length === 0) {
    elements.routeRows.innerHTML = `<tr><td class="empty-state" colspan="7">No routes loaded</td></tr>`;
    elements.routeSummary.textContent = state.quote ? routeAvailabilityMessage(state.quote) : "No quote yet";
    if (state.quoteMode === "exactOutput") {
      elements.sellAmount.value = "";
    } else {
      elements.buyAmount.value = "";
    }
    elements.swapButton.disabled = true;
    renderMarketPanel();
    return;
  }

  elements.routeRows.innerHTML = rows
    .map((route) => {
      const source = sourceById(route.sourceId);
      const isExactOutput = route.quoteMode === "exactOutput";
      const amount = isExactOutput
        ? formatTokenAmount(route.amountIn, sellToken)
        : formatTokenAmount(route.amountOut, buyToken);
      const amountLabel = isExactOutput ? "Input" : "Output";
      const limit = isExactOutput
        ? formatTokenAmount(route.maxAmountIn ?? route.maximumInput, sellToken)
        : formatTokenAmount(route.minAmountOut ?? route.minimumOutput, buyToken);
      const limitLabel = isExactOutput ? "Max" : "Min";
      const status = routeStatusLabel(route);
      const blocked = route.status !== "active" || route.reason === "not-active";
      const statusClass = blocked ? "blocked" : "active";
      const fee = route.feeEstimate?.totalFeeWei ?? route.score?.totalFeeWei;
      const executionFee = route.feeEstimate?.executionFeeWei ?? route.score?.executionFeeWei;
      const dataFee = route.feeEstimate?.dataFinalityFeeWei ?? route.score?.dataFinalityFeeWei;
      const feeTitle = `execution ${formatDogeWei(executionFee)} DOGE, data/finality ${formatDogeWei(dataFee)} DOGE`;
      const feeDetail = `gas ${route.gasUnits ?? "-"} / data ${formatDogeWei(dataFee)}`;
      const impact = route.priceImpactBps === undefined ? "-" : `${route.priceImpactBps} bps`;
      const blockNumber = formatBlockNumber(route.blockNumber);

      return `
        <tr class="route-card-row">
          <td class="route-card-cell" colspan="7">
            <article class="route-card-row-content">
              <span class="source-cell">
                <strong>${source?.displayName ?? route.sourceId}</strong>
                <span>${route.protocolType ?? "-"}</span>
              </span>
              <span class="metric-cell"><span>${amountLabel}</span><strong>${amount}</strong></span>
              <span class="metric-cell"><span>${limitLabel}</span><strong>${limit}</strong></span>
              <span class="metric-cell fee-cell" title="${feeTitle}"><span>DOGE fee</span><strong>${formatDogeWei(fee)}</strong><small>${feeDetail}</small></span>
              <span class="metric-cell"><span>Impact</span><strong>${impact}</strong></span>
              <span class="metric-cell"><span>Quote block</span><strong>${blockNumber ? `block ${blockNumber}` : "-"}</strong></span>
              <span class="status-pill ${statusClass}">${status}</span>
              <span class="link-cell">${routeExplorerLinks(route) || "-"}</span>
            </article>
          </td>
        </tr>
      `;
    })
    .join("");

  if (state.quote?.best) {
    const isExactOutput = (state.quote.best.quoteMode ?? "exactInput") === "exactOutput";
    elements.routeSummary.textContent = `Executable route ready${quoteStatusSuffix(state.quote)}`;
    if (isExactOutput) {
      elements.sellAmount.value = sellToken
        ? unitsToDecimal(state.quote.best.amountIn, sellToken.decimals)
        : state.quote.best.amountIn;
      elements.buyAmount.value = buyToken
        ? unitsToDecimal(state.quote.best.amountOut, buyToken.decimals)
        : state.quote.best.amountOut;
    } else {
      elements.buyAmount.value = buyToken
        ? unitsToDecimal(state.quote.best.amountOut, buyToken.decimals)
        : state.quote.best.amountOut;
    }
    elements.swapButton.disabled = false;
  } else {
    elements.routeSummary.textContent = quoteHasOneHopPreview(state.quote)
      ? routeAvailabilityMessage(state.quote)
      : `Read-only quotes${quoteStatusSuffix(state.quote)}`;
    const first = rows[0];
    if (first?.quoteMode === "exactOutput") {
      elements.sellAmount.value = first && sellToken
        ? unitsToDecimal(first.amountIn, sellToken.decimals)
        : "";
      elements.buyAmount.value = first && buyToken
        ? unitsToDecimal(first.amountOut, buyToken.decimals)
        : elements.buyAmount.value;
    } else {
      elements.buyAmount.value = first && buyToken
        ? unitsToDecimal(first.amountOut, buyToken.decimals)
        : "";
    }
    elements.swapButton.disabled = true;
  }
}

async function loadRegistries() {
  const [tokensBody, sourcesBody] = await Promise.all([
    fetchJson("/tokens"),
    fetchJson("/sources"),
  ]);

  elements.sellAmount.value = "1";
  elements.buyAmount.value = "";
  elements.slippageBps.value = "50";
  state.quoteMode = "exactInput";
  state.tokens = tokensBody.data;
  state.sources = sourcesBody.data;
  renderTokenOptions();
  refreshSelectedWalletBalances();
  renderTokenLists();
  renderActivity();
  renderVerificationSummary();
  renderReadiness();
  renderSources();
  renderRoutes();
  renderMarketPanel();
  setStatus("Live DogeOS sources loaded");
  loadVenueMap();
  loadVerificationSnapshot();
}

async function loadVenueMap() {
  try {
    const venuesBody = await fetchJson("/venues");
    state.venues = venuesBody.data;
  } catch {
    state.venues = [];
  }

  renderSources();
}

async function loadVerificationSnapshot() {
  try {
    const verificationBody = await fetchJson("/verification");
    state.verification = verificationBody.data;
  } catch (error) {
    state.verification = {
      error: error.message,
      sources: [],
      tokens: [],
      summary: {
        hasBlockingMismatch: true,
      },
    };
  }

  renderVerificationSummary();
  renderReadiness();
  renderSources();
}

function quotePayload() {
  const sellToken = tokenByAddress(elements.sellToken.value);
  const buyToken = tokenByAddress(elements.buyToken.value);
  if (!sellToken) throw new Error("Sell token is not loaded.");
  if (!buyToken) throw new Error("Buy token is not loaded.");

  return {
    chainId: DOGEOS_CHAIN_ID,
    quoteMode: state.quoteMode,
    sellToken: elements.sellToken.value,
    buyToken: elements.buyToken.value,
    ...(state.quoteMode === "exactOutput"
      ? { amountOut: decimalToUnits(elements.buyAmount.value, buyToken.decimals) }
      : { amountIn: decimalToUnits(elements.sellAmount.value, sellToken.decimals) }),
    slippageBps: elements.slippageBps.value,
  };
}

function clearScheduledQuote() {
  if (!quoteRefreshTimer) return;
  clearTimeout(quoteRefreshTimer);
  quoteRefreshTimer = null;
}

function clearQuotePoll() {
  if (!quotePollTimer) return;
  clearTimeout(quotePollTimer);
  quotePollTimer = null;
}

function markQuoteStale(message = "Updating live quote") {
  state.quote = null;
  renderRoutes();
  setStatus(message);
  elements.routeSummary.textContent = message;
  elements.swapButton.disabled = true;
  updateQuoteRing({ loading: true });
}

function cancelActiveQuoteRequest() {
  if (!activeQuoteController) return;
  activeQuoteController.abort();
  activeQuoteController = null;
}

function scheduleQuoteRefresh({ invalidate = true } = {}) {
  clearScheduledQuote();
  clearQuotePoll();
  quoteRequestSeq += 1;
  cancelActiveQuoteRequest();
  if (invalidate) markQuoteStale();
  quoteRefreshTimer = setTimeout(() => {
    requestQuote({ live: true });
  }, QUOTE_DEBOUNCE_MS);
}

function scheduleExactInputQuoteRefresh() {
  state.quoteMode = "exactInput";
  scheduleQuoteRefresh();
}

function scheduleExactOutputQuoteRefresh() {
  state.quoteMode = "exactOutput";
  scheduleQuoteRefresh();
}

function scheduleNextLiveQuote() {
  clearQuotePoll();
  if (document.visibilityState === "hidden") return;

  quotePollTimer = setTimeout(() => {
    requestQuote({ live: true });
  }, QUOTE_POLL_MS);
}

async function requestQuote({ live = false } = {}) {
  clearScheduledQuote();
  clearQuotePoll();
  const requestSeq = ++quoteRequestSeq;
  cancelActiveQuoteRequest();
  const quoteController = new AbortController();
  activeQuoteController = quoteController;
  state.lastQuoteStartedAtMs = Date.now();
  elements.quoteButton.disabled = true;
  elements.swapButton.disabled = true;
  updateQuoteRing({ loading: true });
  setStatus(live ? "Updating live quote" : "Reading pools and quoters");
  let payload = null;

  try {
    payload = quotePayload();
    const quote = await fetchJson("/quote", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: quoteController.signal,
    });

    if (requestSeq !== quoteRequestSeq) return;

    state.quote = quote;
    appendChartQuoteSample(quote);
    renderRoutes();
    updateQuoteRing();

    if (quote.status === "ok") {
      setStatus(`Executable route ready${quoteSourceIssueSuffix(quote)}`);
    } else if (quote.status === "read-only") {
      setStatus(quoteHasOneHopPreview(quote)
        ? routeAvailabilityMessage(quote)
        : `Read-only quote previews returned${quoteSourceIssueSuffix(quote)}`);
    } else {
      setStatus(routeAvailabilityMessage(quote));
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    if (requestSeq !== quoteRequestSeq) return;
    state.quote = null;
    renderRoutes();
    updateQuoteRing();
    setStatus(error.message, true);
  } finally {
    if (activeQuoteController === quoteController) {
      activeQuoteController = null;
    }
    if (requestSeq === quoteRequestSeq) {
      elements.quoteButton.disabled = false;
      if (payload) scheduleNextLiveQuote();
    }
  }
}

async function connectWallet() {
  try {
    const wasConnected = Boolean(state.walletAddress);
    state.walletConnectRequested = true;
    const wallet = await loadSdkWallet();
    if (!wallet?.openModal) {
      throw new Error("DogeOS SDK wallet is still loading.");
    }

    if (wasConnected || state.walletAddress || wallet.isConnected?.()) {
      state.walletConnectRequested = false;
      setStatus("Wallet already connected");
      refreshSelectedWalletBalances();
      return;
    }

    setStatus("Opening wallet");
    await wallet.openModal();
  } catch (error) {
    setStatus(walletConnectErrorMessage(error), true);
  }
}

function handleSdkWalletUpdate(event) {
  const detail = event.detail ?? {};
  const previousAddress = state.walletAddress;
  const previousChainId = state.walletChainId;

  state.walletAddress = detail.address ?? "";
  state.walletChainId = detail.chainId ?? "";
  state.walletChainType = detail.chainType ?? "";
  state.walletProviderReady = Boolean(detail.hasProvider);
  state.walletConnecting = Boolean(detail.isConnecting);
  state.walletError = detail.error ?? "";
  state.walletSource = detail.walletSource ?? "";

  if (state.walletAddress && (!elements.recipient.value || elements.recipient.value === previousAddress)) {
    elements.recipient.value = state.walletAddress;
  }

  if (!state.walletAddress && elements.recipient.value === previousAddress) {
    elements.recipient.value = "";
  }

  if (state.walletConnecting) {
    elements.connectWallet.textContent = "Connecting";
  } else {
    elements.connectWallet.textContent = state.walletAddress ? shortAddress(state.walletAddress) : "Connect";
  }

  if (state.walletAddress && state.walletAddress !== previousAddress) {
    const walletSource = state.walletSource === "injected" ? "injected wallet" : "DogeOS SDK";
    setStatus(`Wallet connected through ${walletSource}`);
    state.walletConnectRequested = false;
  } else if (!state.walletAddress && !state.walletConnecting && state.walletError && state.walletConnectRequested) {
    setStatus(walletConnectErrorMessage(state.walletError), true);
  }

  if (!state.walletAddress) {
    clearWalletBalances();
    renderTokenChips();
    return;
  }

  if (state.walletAddress !== previousAddress || state.walletChainId !== previousChainId) {
    clearWalletBalances();
  }
  refreshSelectedWalletBalances();
}

async function buildSwap() {
  if (!state.quote?.best) return;

  try {
    elements.swapButton.disabled = true;
    if (!state.walletAddress) {
      throw new Error("Connect wallet before building a swap transaction.");
    }

    const recipient = elements.recipient.value || state.walletAddress;
    let quote = {
      ...state.quote.best,
      slippageBps: elements.slippageBps.value || "50",
      recipient,
      deadline: Math.floor(Date.now() / 1000) + 300,
    };

    quote = mergeExecutionQuote(quote, await ensureTokenApproval(quote));

    setStatus("Preparing verified swap transaction");
    const body = await fetchJson("/swap", {
      method: "POST",
      body: JSON.stringify({
        sender: state.walletAddress,
        quote,
      }),
    });

    setStatus("Awaiting swap signature");
    const executionQuote = mergeExecutionQuote(quote, body.quote);
    const txHash = await sendWalletTransaction(body.transaction);
    const title = swapActivityTitle(executionQuote);
    recordActivity({
      title,
      detail: `${sourceById(executionQuote.sourceId)?.displayName ?? executionQuote.sourceId} / ${shortAddress(txHash)}`,
      status: "submitted",
      txHash,
    });
    setStatus(`Swap submitted ${shortAddress(txHash)}`);
    const receipt = await waitForTransactionReceipt(txHash, { label: "Swap" });
    const blockNumber = formatReceiptBlockNumber(receipt);
    recordActivity({
      title,
      detail:
        `${sourceById(executionQuote.sourceId)?.displayName ?? executionQuote.sourceId} / ${shortAddress(txHash)}` +
        (blockNumber ? ` / block ${blockNumber}` : ""),
      status: "confirmed",
      txHash,
    });
    setStatus(`Swap confirmed and included ${shortAddress(txHash)}${blockNumber ? ` at block ${blockNumber}` : ""}`);
  } catch (error) {
    setStatus(transactionErrorMessage(error), true);
  } finally {
    elements.swapButton.disabled = !state.quote?.best;
  }
}

async function ensureTokenApproval(quote) {
  const approval = await fetchJson("/approval", {
    method: "POST",
    body: JSON.stringify({
      owner: state.walletAddress,
      quote,
    }),
  });

  const nextQuote = approval.quote ? mergeExecutionQuote(quote, approval.quote) : quote;

  if (!approval.approvalRequired) return nextQuote;

  setStatus(`Approving ${swapIntentLabel(nextQuote)}`);
  await preflightWalletGas(approval.transaction);
  const approvalHash = await sendWalletTransaction(approval.transaction);
  setStatus(`Approval submitted ${shortAddress(approvalHash)}`);
  await waitForTransactionReceipt(approvalHash, { label: "Approval" });
  setStatus("Approval confirmed");
  return nextQuote;
}

async function preflightWalletGas(transaction) {
  const wallet = sdkWallet();
  const provider = wallet?.getProvider?.();
  if (!provider?.request) {
    throw new Error("Connect an EVM wallet before estimating transaction gas.");
  }

  const request = {
    from: state.walletAddress,
    to: transaction.to,
    data: transaction.data,
    value: hexQuantity(transaction.value ?? 0),
  };
  const [estimatedGas, gasPrice, nativeBalance] = await Promise.all([
    provider.request({
      method: "eth_estimateGas",
      params: [request],
    }),
    provider.request({ method: "eth_gasPrice" }),
    provider.request({
      method: "eth_getBalance",
      params: [state.walletAddress, "latest"],
    }),
  ]);
  const gasLimit = transaction.gas === undefined
    ? bufferedGasLimit(estimatedGas)
    : bigintFromQuantity(transaction.gas, "transaction.gas");
  const requiredWei = gasLimit * bigintFromQuantity(gasPrice, "gasPrice") +
    bigintFromQuantity(transaction.value ?? 0, "transaction.value");
  const availableWei = bigintFromQuantity(nativeBalance, "nativeBalance");

  if (availableWei < requiredWei) {
    throw new Error(nativeDogeFundingMessage(requiredWei, availableWei));
  }

  return {
    gasLimit,
    gasPriceWei: bigintFromQuantity(gasPrice, "gasPrice"),
    nativeBalance: availableWei,
  };
}

async function sendWalletTransaction(transaction) {
  const wallet = sdkWallet();
  const provider = wallet?.getProvider?.();

  if (!provider?.request) {
    throw new Error("Connect an EVM wallet before sending a transaction.");
  }

  if (!chainIdMatchesDogeos(wallet.getChainId?.() ?? state.walletChainId)) {
    setStatus("Switching wallet to DogeOS Chikyu");
    const switched = await wallet.switchToDogeOS?.();
    if (switched === false) {
      throw new Error("Switch wallet to DogeOS Chikyu Testnet before sending a transaction.");
    }
  }

  const request = {
    from: state.walletAddress,
    to: transaction.to,
    data: transaction.data,
    value: hexQuantity(transaction.value ?? 0),
  };
  if (transaction.gas !== undefined) {
    request.gas = hexQuantity(transaction.gas);
  }

  try {
    return await provider.request({
      method: "eth_sendTransaction",
      params: [request],
    });
  } catch (error) {
    throw new Error(transactionErrorMessage(error));
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForTransactionReceipt(txHash, { timeoutMs = 120_000, pollMs = 3_000, label = "Transaction" } = {}) {
  const wallet = sdkWallet();
  const provider = wallet?.getProvider?.();
  if (!provider?.request) {
    throw new Error("Connect an EVM wallet before reading transaction receipts.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });

    if (receipt) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error(`${label} reverted ${shortAddress(txHash)}`);
      }
      return receipt;
    }

    await sleep(pollMs);
  }

  throw new Error(`${label} confirmation timed out ${shortAddress(txHash)}`);
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  requestQuote();
});
elements.connectWallet.addEventListener("pointerenter", preloadSdkWallet, { once: true });
elements.connectWallet.addEventListener("focus", preloadSdkWallet, { once: true });
elements.connectWallet.addEventListener("touchstart", preloadSdkWallet, { once: true, passive: true });
elements.connectWallet.addEventListener("click", connectWallet);
elements.refreshData.addEventListener("click", requestQuote);
elements.quoteRefreshRing.addEventListener("click", () => requestQuote({ live: true }));
elements.swapButton.addEventListener("click", buildSwap);
elements.sellTokenChip.addEventListener("click", () => openTokenPicker("sell"));
elements.buyTokenChip.addEventListener("click", () => openTokenPicker("buy"));
elements.tokenPickerClose.addEventListener("click", closeTokenPicker);
elements.tokenPickerScrim.addEventListener("click", closeTokenPicker);
elements.tokenPickerSearch.addEventListener("input", renderTokenPicker);
elements.tokenSearch.addEventListener("input", renderTokenLists);
elements.tokenPickerList.addEventListener("click", (event) => {
  const row = event.target?.closest?.("[data-token-address]");
  if (row) chooseToken(row.getAttribute("data-token-address"));
});
elements.tokenListView.addEventListener("click", (event) => {
  const row = event.target?.closest?.("[data-token-address]");
  if (!row) return;
  elements.sellToken.value = row.getAttribute("data-token-address");
  renderTokenChips();
  refreshSelectedWalletBalances();
  switchView("swap");
  scheduleQuoteRefresh();
});
elements.flipTokens.addEventListener("click", flipTokens);
elements.swapSettingsToggle.addEventListener("click", () => toggleSwapSettings());
elements.swapSettingsClose.addEventListener("click", () => toggleSwapSettings(false));
elements.swapSettingsScrim.addEventListener("click", () => toggleSwapSettings(false));
elements.chartToggle.addEventListener("click", () => {
  if (chartUsesSheet()) {
    toggleChartPopout(!state.chartPopoutVisible);
    return;
  }

  state.chartVisible = !state.chartVisible;
  renderMarketPanel();
});
elements.chartPopout.addEventListener("click", () => toggleChartPopout(true));
elements.chartPopoutClose.addEventListener("click", () => toggleChartPopout(false));
elements.chartPopoutScrim.addEventListener("click", () => toggleChartPopout(false));
for (const [view, navElement] of Object.entries(elements.nav)) {
  navElement.addEventListener("click", () => switchView(view));
}
for (const [view, navElement] of Object.entries(elements.bottomNav)) {
  navElement.addEventListener("click", () => switchView(view));
}
elements.sellAmount.addEventListener("input", scheduleExactInputQuoteRefresh);
elements.sellAmountMax.addEventListener("click", () => applySellBalancePercent(100));
elements.sellAmountHalf.addEventListener("click", () => applySellBalancePercent(50));
elements.sellAmountQuarter.addEventListener("click", () => applySellBalancePercent(25));
elements.buyAmount.addEventListener("input", scheduleExactOutputQuoteRefresh);
elements.sellToken.addEventListener("change", () => {
  renderTokenChips();
  refreshSelectedWalletBalances();
  scheduleQuoteRefresh();
});
elements.buyToken.addEventListener("change", () => {
  renderTokenChips();
  refreshSelectedWalletBalances();
  scheduleQuoteRefresh();
});
elements.slippageBps.addEventListener("input", () => {
  renderTradeControls();
  scheduleQuoteRefresh();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.swapSettingsVisible) {
    toggleSwapSettings(false);
  }
});
window.addEventListener(SDK_WALLET_EVENT, handleSdkWalletUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearQuotePoll();
  } else if (state.tokens.length > 0) {
    requestQuote({ live: true });
  }
});
const mobileChartMedia = window.matchMedia?.(MOBILE_CHART_QUERY);
mobileChartMedia?.addEventListener?.("change", renderMarketPanel);
mobileChartMedia?.addListener?.(renderMarketPanel);

toggleSwapSettings(false);

loadRegistries()
  .then(() => {
    requestQuote();
    restorePersistedWalletSession();
  })
  .catch((error) => setStatus(error.message, true));
