import { expect } from "@playwright/test";

import { installMockApi } from "../fixtures/mock-api.mjs";
import { installMockWallet } from "../fixtures/mock-wallet.mjs";

export async function bootDogeSwap(page, options = {}) {
  await installMockWallet(page, options.wallet);
  const api = await installMockApi(page, options.api);
  await page.goto("/");
  await expect(page.getByText("DogeSwap").first()).toBeVisible();
  return { api };
}

export async function connectMockWallet(page) {
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await expect(page.getByRole("button", { name: /0x11.*1111/i }).first()).toBeVisible();
}

export async function enterSwapAmount(page, amount = "1") {
  await page.getByPlaceholder("0").fill(amount);
  await expect(page.getByText(/best price/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /review swap/i })).toBeEnabled();
}

export async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.ceil(doc.scrollWidth - doc.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

export async function visibleTapTargetFailures(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, [role='button']")];
    return buttons
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none") return false;
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.width < 36 || rect.height < 30;
      })
      .map((element) => ({
        text: element.textContent?.trim().slice(0, 40) ?? "",
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
      }));
  });
}
