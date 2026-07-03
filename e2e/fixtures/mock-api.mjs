import {
  DOGEOS_CHAIN_ID,
  SOURCES,
  TOKENS,
  WALLET_ADDRESS,
  approvalBody,
  quoteBody,
  swapBody,
} from "./mock-data.mjs";

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

export async function installMockApi(page, options = {}) {
  const state = {
    quoteMode: options.quoteMode ?? "success",
    swapMode: options.swapMode ?? "success",
    activityMode: options.activityMode ?? "empty",
  };

  await page.route("**/tokens", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: TOKENS }),
  );
  await page.route("**/sources", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: SOURCES }),
  );
  await page.route("**/chain-status", (route) =>
    fulfillJson(route, {
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
    }),
  );
  await page.route("**/venues", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: [] }),
  );
  await page.route("**/intelligence", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: [] }),
  );
  await page.route("**/verification", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: { status: "mocked" } }),
  );
  await page.route("**/trending-tokens", (route) =>
    fulfillJson(route, { chainId: DOGEOS_CHAIN_ID, data: [] }),
  );
  await page.route("**/activity**", (route) =>
    fulfillJson(route, {
      chainId: DOGEOS_CHAIN_ID,
      address: WALLET_ADDRESS,
      source: "blockscout",
      blockscoutUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/mock/transactions",
      data: state.activityMode === "empty" ? [] : [{ hash: "0x123", status: "ok" }],
      nextPageParams: null,
    }),
  );
  await page.route("**/quote", async (route) => {
    if (state.quoteMode === "error") {
      await fulfillJson(
        route,
        { error: { code: "quote-unavailable", message: "Upstream dependency is unavailable." } },
        503,
      );
      return;
    }
    const body = route.request().postDataJSON();
    await fulfillJson(route, quoteBody({ amountIn: body.amountIn }));
  });
  await page.route("**/approval", async (route) => {
    const body = route.request().postDataJSON();
    await fulfillJson(route, approvalBody(body));
  });
  await page.route("**/swap", async (route) => {
    if (state.swapMode === "slippage") {
      await fulfillJson(
        route,
        { error: { code: "swap-not-buildable", message: "Price moved past your slippage tolerance." } },
        422,
      );
      return;
    }
    const body = route.request().postDataJSON();
    await fulfillJson(route, swapBody(body));
  });

  return {
    setQuoteMode(mode) {
      state.quoteMode = mode;
    },
    setSwapMode(mode) {
      state.swapMode = mode;
    },
  };
}
