import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalOverflow,
  bootDogeSwap,
  connectMockWallet,
  enterSwapAmount,
  visibleTapTargetFailures,
} from "./helpers.mjs";

test.describe("responsive UI sweep", () => {
  test("primary pages, token picker, review modal, and chart fit without horizontal overflow", async ({ page }) => {
    await bootDogeSwap(page);
    await connectMockWallet(page);
    await enterSwapAmount(page, "1");
    await assertNoHorizontalOverflow(page);

    await page.getByRole("button", { name: /USDC/i }).first().click();
    await expect(page.getByRole("dialog", { name: /select token/i }).or(page.getByText(/select token/i))).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "✕" }).click();

    await page.getByRole("button", { name: /review swap/i }).click();
    await expect(page.getByText(/confirm swap/i)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "✕" }).click();

    await page.getByRole("button", { name: /chart/i }).click();
    await expect(page.getByText(/WDOGE/i).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "✕" }).click();

    for (const name of ["tokens", "activity", "settings"]) {
      await page.getByRole("button", { name: new RegExp(name, "i") }).first().click();
      await expect(page.getByText(new RegExp(name, "i")).first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
  });

  test("visible controls have usable touch targets", async ({ page }, testInfo) => {
    await bootDogeSwap(page);
    await connectMockWallet(page);

    const failures = await visibleTapTargetFailures(page);
    expect(
      failures,
      `${testInfo.project.name} has undersized visible tap targets: ${JSON.stringify(failures)}`,
    ).toEqual([]);
  });
});
