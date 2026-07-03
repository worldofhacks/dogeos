import { expect, test } from "@playwright/test";

import { SWAP_HASH } from "../fixtures/mock-data.mjs";
import { bootDogeSwap, connectMockWallet, enterSwapAmount } from "./helpers.mjs";

test.describe("swap flow", () => {
  test("connects wallet, quotes, approves, swaps, and records activity", async ({ page }) => {
    await bootDogeSwap(page);
    await connectMockWallet(page);
    await enterSwapAmount(page, "1");

    await page.getByRole("button", { name: /review swap/i }).click();
    await expect(page.getByText(/confirm swap/i)).toBeVisible();
    await expect(page.getByText(/MuchFi V3/i).first()).toBeVisible();

    await page.getByRole("button", { name: /confirm swap/i }).click();
    await expect(page.getByText("success", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /done/i }).click();

    await page.getByRole("button", { name: /activity/i }).click();
    const localRow = page.getByRole("link", { name: /USDC → WDOGE/i });
    await expect(localRow).toBeVisible();
    await expect(localRow).toHaveAttribute("href", new RegExp(`${SWAP_HASH}$`));
  });

  test("surfaces quote outage as a retryable unavailable state", async ({ page }) => {
    await bootDogeSwap(page, { api: { quoteMode: "error" } });
    await connectMockWallet(page);
    await page.getByPlaceholder("0").fill("1");

    await expect(page.getByText(/quotes unavailable/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^quotes unavailable$/i })).toBeDisabled();
  });

  test("surfaces slippage rejection from swap build", async ({ page }) => {
    const { api } = await bootDogeSwap(page);
    await connectMockWallet(page);
    await enterSwapAmount(page, "1");
    api.setSwapMode("slippage");

    await page.getByRole("button", { name: /review swap/i }).click();
    await page.getByRole("button", { name: /confirm swap/i }).click();
    await expect(page.getByText(/price moved past your slippage tolerance/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  test("connect chip disconnects and returns to connect state", async ({ page }) => {
    await bootDogeSwap(page);
    await connectMockWallet(page);

    await page.getByRole("button", { name: /0x11.*1111/i }).first().click();
    await expect(page.getByRole("button", { name: /^connect$/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i })).toBeVisible();
  });

  test("insufficient balance disables review", async ({ page }) => {
    await bootDogeSwap(page, { wallet: { tokenBalance: 0n } });
    await connectMockWallet(page);
    await page.getByPlaceholder("0").fill("1");

    await expect(page.getByRole("button", { name: /insufficient balance/i })).toBeDisabled();
  });
});
