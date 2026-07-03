#!/usr/bin/env node
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { launch as launchChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

import { createWebRequestListener } from "../../packages/web/src/server.mjs";
import {
  DOGEOS_CHAIN_ID,
  SOURCES,
  TOKENS,
  WALLET_ADDRESS,
  approvalBody,
  quoteBody,
  swapBody,
} from "../fixtures/mock-data.mjs";
import { installMockApi } from "../fixtures/mock-api.mjs";
import { installMockWallet } from "../fixtures/mock-wallet.mjs";

const PORT = Number(process.env.E2E_PERF_PORT ?? 8790);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const DATE = process.env.QA_DATE ?? new Date().toISOString().slice(0, 10);
const OUT_DIR = resolve("docs/qa");
const ARTIFACT_DIR = resolve("e2e/artifacts/perf");

async function directorySize(path) {
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

async function startLocalServer() {
  if (!BASE_URL.includes(`:${PORT}`)) return null;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  const listener = createWebRequestListener({
    staticRoot: resolve("apps/web/dist"),
    apiHandle: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/tokens") return json({ chainId: DOGEOS_CHAIN_ID, data: TOKENS });
      if (url.pathname === "/sources") return json({ chainId: DOGEOS_CHAIN_ID, data: SOURCES });
      if (url.pathname === "/chain-status") {
        return json({
          chainId: DOGEOS_CHAIN_ID,
          data: {
            live: true,
            chainId: DOGEOS_CHAIN_ID,
            expectedChainId: DOGEOS_CHAIN_ID,
            chainMatches: true,
            blockNumber: 6_000_000,
            blockscoutBaseUrl: "https://blockscout.testnet.dogeos.com",
            documentedMaxReorgDepth: 17,
          },
        });
      }
      if (url.pathname === "/venues") return json({ chainId: DOGEOS_CHAIN_ID, data: [] });
      if (url.pathname === "/intelligence") return json({ chainId: DOGEOS_CHAIN_ID, data: [] });
      if (url.pathname === "/verification") {
        return json({ chainId: DOGEOS_CHAIN_ID, data: { status: "mocked" } });
      }
      if (url.pathname === "/trending-tokens") {
        return json({ chainId: DOGEOS_CHAIN_ID, data: [] });
      }
      if (url.pathname === "/activity") {
        return json({
          chainId: DOGEOS_CHAIN_ID,
          address: WALLET_ADDRESS,
          source: "blockscout",
          blockscoutUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/mock/transactions",
          data: [],
          nextPageParams: null,
        });
      }
      if (url.pathname === "/quote") {
        const body = await request.json();
        return json(quoteBody({ amountIn: body.amountIn }));
      }
      if (url.pathname === "/approval") return json(approvalBody(await request.json()));
      if (url.pathname === "/swap") return json(swapBody(await request.json()));

      return json(
        { error: { code: "perf-api-unmocked", message: `No mock response for ${url.pathname}` } },
        404,
      );
    },
  });
  const server = createServer(listener);
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
  return server;
}

async function measurePlaywright() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await installMockWallet(page);
  await installMockApi(page);

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      timeToInteractiveMs: Math.round(nav.domInteractive),
      loadEventMs: Math.round(nav.loadEventEnd),
    };
  });

  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByPlaceholder("0").fill("1");
  const quoteStarted = Date.now();
  await page.getByText(/best price/i).waitFor();
  const quoteToRenderMs = Date.now() - quoteStarted;

  await browser.close();
  return { ...timing, quoteToRenderMs };
}

async function measureLighthouse() {
  const chrome = await launchChrome({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const result = await lighthouse(BASE_URL, {
      port: chrome.port,
      output: "json",
      onlyCategories: ["performance", "accessibility"],
      logLevel: "error",
    });
    return {
      performance: Math.round((result.lhr.categories.performance.score ?? 0) * 100),
      accessibility: Math.round((result.lhr.categories.accessibility.score ?? 0) * 100),
    };
  } finally {
    await chrome.kill();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const server = await startLocalServer();
  try {
    const bundleBytes = await directorySize(resolve("apps/web/dist"));
    const [playwrightMetrics, lighthouseMetrics] = await Promise.all([
      measurePlaywright(),
      measureLighthouse().catch((error) => ({ error: error.message })),
    ]);
    const metrics = {
      date: DATE,
      baseUrl: BASE_URL,
      bundleBytes,
      ...playwrightMetrics,
      lighthouse: lighthouseMetrics,
    };

    const jsonPath = resolve(ARTIFACT_DIR, `${DATE}.json`);
    await writeFile(jsonPath, `${JSON.stringify(metrics, null, 2)}\n`);

    const lighthousePerf =
      typeof lighthouseMetrics.performance === "number" ? lighthouseMetrics.performance : "n/a";
    const lighthouseA11y =
      typeof lighthouseMetrics.accessibility === "number" ? lighthouseMetrics.accessibility : "n/a";
    const report = `# QA ${DATE}

Target: ${BASE_URL}

## Performance

| Metric | Value |
| --- | ---: |
| Lighthouse performance | ${lighthousePerf} |
| Lighthouse accessibility | ${lighthouseA11y} |
| Quote to render | ${metrics.quoteToRenderMs} ms |
| Time to interactive | ${metrics.timeToInteractiveMs} ms |
| Load event | ${metrics.loadEventMs} ms |
| Bundle size | ${metrics.bundleBytes} bytes |

## Sweep

Run \`npm run e2e\` for the full desktop + mobile matrix. This perf report uses the same mocked wallet/API harness as the Playwright suite.

## Findings

- None filed by the perf harness.
`;
    await writeFile(resolve(OUT_DIR, `${DATE}.md`), report);
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await new Promise((resolveClose) => server?.close(resolveClose) ?? resolveClose());
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
