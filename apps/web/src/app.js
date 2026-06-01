const DOGEOS_CHAIN_ID = 6_281_971;
const BLOCKSCOUT_BASE_URL = "https://blockscout.testnet.dogeos.com";
const QUOTE_DEBOUNCE_MS = 250;
const QUOTE_POLL_MS = 10_000;
const SDK_WALLET_EVENT = "dogeos:sdk-wallet-updated";
const SDK_WALLET_READY_EVENT = "dogeos:sdk-wallet-ready";
const LOAD_SDK_WALLET_EVENT = "dogeos:load-sdk-wallet";

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
  activity: [],
  lastQuoteStartedAtMs: 0,
  walletAddress: "",
  walletChainId: "",
  walletChainType: "",
  walletProviderReady: false,
  walletConnecting: false,
  walletError: "",
  walletSource: "",
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
  slippageValue: document.querySelector("#slippage-value"),
  gasPriorityValue: document.querySelector("#gas-priority-value"),
  quoteRefreshRing: document.querySelector("#quote-refresh-ring"),
  flipTokens: document.querySelector("#flip-tokens"),
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

function tokenByAddress(address) {
  const normalized = String(address ?? "").toLowerCase();
  return state.tokens.find((token) => token.address.toLowerCase() === normalized);
}

function tokenBySymbol(symbol) {
  return state.tokens.find((token) => token.symbol === symbol);
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
  if (!value) return "-";
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

function formatTokenAmount(value, token, precision = 6) {
  return token ? unitsToDecimal(value, token.decimals, precision) : String(value ?? "-");
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
}

function slippagePercent() {
  const bps = Number(elements.slippageBps.value || 0);
  return Number.isFinite(bps) ? bps / 100 : 0;
}

function renderTradeControls() {
  const percent = slippagePercent();
  elements.slippageValue.textContent =
    percent >= 49.995 ? "MAX" : `${percent.toFixed(percent >= 10 ? 0 : 2)}%`;
  elements.gasPriorityValue.textContent = state.quote?.best?.gasUnits
    ? `${state.quote.best.gasUnits} gas`
    : "live";
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
  elements.sellBalance.textContent = sellToken
    ? `${sellToken.symbol} · ${compactAddress(sellToken.address)}`
    : "balance loading";
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
  scheduleQuoteRefresh();
}

function flipTokens() {
  const sellValue = elements.sellToken.value;
  elements.sellToken.value = elements.buyToken.value;
  elements.buyToken.value = sellValue;
  state.quoteMode = "exactInput";
  renderTokenChips();
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
  const blockscoutAbiAvailable = targets.some(
    (target) => target.verification?.isBlockscoutAbiAvailable === true,
  );
  const abiText = blockscoutAbiAvailable ? "Blockscout ABI verified" : "Blockscout ABI pending";

  return `${abiText} / ${relationshipText}`;
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
  const status = summary.hasBlockingMismatch ? "Verification mismatch" : "Verification checks clear";

  elements.verificationSummary.textContent =
    `${status} / ${tokenMatches}/${tokenTotal} token decimals / ` +
    `${relationshipMismatchCount} relationship mismatches / ${tokenMismatchCount} token mismatches`;
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

function routeBars(quote = state.quote) {
  const rows = routeRowsFromQuote(quote).filter((route) => route.amountOut || route.amountIn);
  if (rows.length === 0) return [];
  const values = rows.map((route) => {
    try {
      return Number(BigInt(route.amountOut ?? route.amountIn ?? 0n));
    } catch {
      return 0;
    }
  });
  const max = Math.max(...values, 1);
  return rows.slice(0, 6).map((route, index) => ({
    route,
    height: Math.max(8, Math.round((values[index] / max) * 100)),
  }));
}

function renderMarketVisual(targetElement = elements.marketVisual) {
  const bars = routeBars();
  const barCount = Math.max(1, bars.length);
  if (bars.length === 0) {
    targetElement.innerHTML = `
      <div class="empty-state">Route monitor waiting for a live quote</div>
    `;
    return;
  }

  targetElement.innerHTML = `
    <div class="market-bars" style="--bar-count:${barCount}">
      ${bars.map(({ route, height }, index) => {
        const source = sourceById(route.sourceId);
        const color = index === 0 ? "var(--te-gold)" : index === 1 ? "var(--te-accent)" : "var(--te-hair-strong)";
        return `
          <span class="market-bar">
            <i style="height:${height}%;--bar-color:${color}"></i>
            <span>${escapeHtml(source?.displayName ?? route.sourceId)}</span>
          </span>
        `;
      }).join("")}
    </div>
  `;
}

function renderMarketPanel() {
  const best = state.quote?.best;
  const source = best ? sourceById(best.sourceId) : null;
  elements.bestSourceLabel.textContent = source?.displayName ?? "-";
  elements.quoteLatencyLabel.textContent = formatLatencyMs(state.quote?.telemetry?.quoteLatencyMs) || "-";
  elements.sourceIssuesLabel.textContent = String(state.quote?.telemetry?.sourceErrorCount ?? 0);
  elements.quoteTelemetryDetail.textContent = quoteTelemetryDetail(state.quote);
  elements.quoteTelemetryDetail.setAttribute("title", "Quote timing telemetry from the latest live route response");
  elements.chartPanel.hidden = !state.chartVisible;
  elements.chartToggle.setAttribute("aria-pressed", String(state.chartVisible));
  elements.chartToggle.classList.toggle("active", state.chartVisible);
  renderMarketVisual(elements.marketVisual);
  if (state.chartPopoutVisible) renderMarketVisual(elements.chartPopoutVisual);
}

function toggleChartPopout(open = !state.chartPopoutVisible) {
  state.chartPopoutVisible = open;
  elements.chartPopoutPanel.hidden = !open;
  if (open) renderMarketVisual(elements.chartPopoutVisual);
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
    elements.routeSummary.textContent = "No quote yet";
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
    elements.routeSummary.textContent = `Read-only quotes${quoteStatusSuffix(state.quote)}`;
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
    renderRoutes();
    updateQuoteRing();

    if (quote.status === "ok") {
      setStatus(`Executable route ready${quoteSourceIssueSuffix(quote)}`);
    } else if (quote.status === "read-only") {
      setStatus(`Read-only quote previews returned${quoteSourceIssueSuffix(quote)}`);
    } else {
      setStatus(`No executable route returned${quoteSourceIssueSuffix(quote)}`);
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
    const wallet = await loadSdkWallet();
    if (!wallet?.openModal) {
      throw new Error("DogeOS SDK wallet is still loading.");
    }

    if (wallet.isConnected?.() || state.walletAddress) {
      await wallet.disconnect();
      state.walletAddress = "";
      state.walletProviderReady = false;
      elements.connectWallet.textContent = "Connect";
      setStatus("Wallet disconnected");
      return;
    }

    setStatus("Opening wallet");
    await wallet.openModal();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function handleSdkWalletUpdate(event) {
  const detail = event.detail ?? {};
  const previousAddress = state.walletAddress;

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
  }
}

async function buildSwap() {
  if (!state.quote?.best) return;

  try {
    elements.swapButton.disabled = true;
    if (!state.walletAddress) {
      throw new Error("Connect wallet before building a swap transaction.");
    }

    const recipient = elements.recipient.value || state.walletAddress;
    const quote = {
      ...state.quote.best,
      recipient,
      deadline: Math.floor(Date.now() / 1000) + 300,
    };

    await ensureTokenApproval(quote);

    setStatus("Preparing verified swap transaction");
    const body = await fetchJson("/swap", {
      method: "POST",
      body: JSON.stringify({
        sender: state.walletAddress,
        quote,
      }),
    });

    setStatus("Awaiting swap signature");
    const txHash = await sendWalletTransaction(body.transaction);
    const title = `${formatTokenAmount(quote.amountIn, tokenByAddress(quote.sellToken), 4)} ${tokenByAddress(quote.sellToken)?.symbol ?? "sell"} -> ${formatTokenAmount(quote.amountOut, tokenByAddress(quote.buyToken), 4)} ${tokenByAddress(quote.buyToken)?.symbol ?? "buy"}`;
    recordActivity({
      title,
      detail: `${sourceById(quote.sourceId)?.displayName ?? quote.sourceId} / ${shortAddress(txHash)}`,
      status: "submitted",
      txHash,
    });
    setStatus(`Swap submitted ${shortAddress(txHash)}`);
    const receipt = await waitForTransactionReceipt(txHash, { label: "Swap" });
    const blockNumber = formatReceiptBlockNumber(receipt);
    recordActivity({
      title,
      detail:
        `${sourceById(quote.sourceId)?.displayName ?? quote.sourceId} / ${shortAddress(txHash)}` +
        (blockNumber ? ` / block ${blockNumber}` : ""),
      status: "confirmed",
      txHash,
    });
    setStatus(`Swap confirmed and included ${shortAddress(txHash)}${blockNumber ? ` at block ${blockNumber}` : ""}`);
  } catch (error) {
    setStatus(error.message, true);
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

  if (!approval.approvalRequired) return;

  setStatus("Approving sell token");
  const approvalHash = await sendWalletTransaction(approval.transaction);
  setStatus(`Approval submitted ${shortAddress(approvalHash)}`);
  await waitForTransactionReceipt(approvalHash, { label: "Approval" });
  setStatus("Approval confirmed");
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
    value: `0x${BigInt(transaction.value ?? 0).toString(16)}`,
  };
  if (transaction.gas !== undefined) {
    request.gas = `0x${BigInt(transaction.gas).toString(16)}`;
  }

  return provider.request({
    method: "eth_sendTransaction",
    params: [request],
  });
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
  switchView("swap");
  scheduleQuoteRefresh();
});
elements.flipTokens.addEventListener("click", flipTokens);
elements.chartToggle.addEventListener("click", () => {
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
elements.buyAmount.addEventListener("input", scheduleExactOutputQuoteRefresh);
elements.sellToken.addEventListener("change", () => {
  renderTokenChips();
  scheduleQuoteRefresh();
});
elements.buyToken.addEventListener("change", () => {
  renderTokenChips();
  scheduleQuoteRefresh();
});
elements.slippageBps.addEventListener("input", () => {
  renderTradeControls();
  scheduleQuoteRefresh();
});
window.addEventListener(SDK_WALLET_EVENT, handleSdkWalletUpdate);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearQuotePoll();
  } else if (state.tokens.length > 0) {
    requestQuote({ live: true });
  }
});

loadRegistries()
  .then(requestQuote)
  .catch((error) => setStatus(error.message, true));
