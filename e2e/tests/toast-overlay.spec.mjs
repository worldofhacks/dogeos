// toast-overlay.spec.mjs — regression coverage for issue #14: an active toast
// stack (fixed bottom-center, z-index 200, 4.2s per pill) must never intercept
// taps on UI beneath it — QA caught the nav being unclickable on
// android-landscape for the life of the stack, and it made the landscape
// swap-flow test flaky.
import { expect, test } from "@playwright/test";

import { bootDogeSwap } from "./helpers.mjs";

// Fire `count` toasts via the same window event showToast() uses, and wait for
// the first pill to render. Each pill self-dismisses after 4.2s, so assertions
// that need a live stack must run within that window (or re-fire). `tag` keeps
// messages unique across rounds — pills from a previous round may still be
// alive when the next one fires.
async function fireToastStack(page, count, tag) {
  await page.evaluate(({ n, t }) => {
    for (let i = 1; i <= n; i += 1) {
      window.dispatchEvent(
        new CustomEvent("dogeos:toast", {
          detail: { message: `e2e toast ${t} ${i}`, kind: "info" },
        }),
      );
    }
  }, { n: count, t: tag });
  await expect(page.getByText(`e2e toast ${tag} 1`)).toBeVisible();
}

test.describe("toast overlay", () => {
  test("toast pills are pointer-transparent (never swallow taps)", async ({ page }) => {
    await bootDogeSwap(page);
    await fireToastStack(page, 3, "hit");

    // For every visible pill, hit-test its center: elementFromPoint must
    // resolve to whatever sits BENEATH the pill, never the pill itself.
    const interceptingPills = await page.evaluate(() => {
      const pills = [...document.querySelectorAll("div.anim-rise")].filter((el) =>
        /^e2e toast hit \d+$/.test(el.textContent ?? ""),
      );
      return pills
        .filter((pill) => {
          const rect = pill.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && pill.contains(hit);
        })
        .map((pill) => pill.textContent);
    });
    expect(interceptingPills).toEqual([]);
  });

  test("nav items receive clicks while a toast stack is active", async ({ page }) => {
    await bootDogeSwap(page);

    // Re-fire a fresh stack before every nav tap so pills are alive during the
    // click, and give each click a budget well under one pill lifetime (4.2s):
    // before the fix an overlapped nav item stayed tap-dead for the whole
    // stack duration, so these clicks would time out.
    // Tags stay unrelated to view names so the post-click view assertion can
    // never be satisfied by a toast pill's own text.
    const rounds = [
      ["tokens", "alpha"],
      ["activity", "beta"],
      ["settings", "gamma"],
    ];
    for (const [name, tag] of rounds) {
      await fireToastStack(page, 4, tag);
      await page
        .getByRole("button", { name: new RegExp(name, "i") })
        .first()
        .click({ timeout: 3000 });
      await expect(page.getByText(new RegExp(name, "i")).first()).toBeVisible();
    }
  });

  test("toast stack sits fully above the mobile bottom tab bar", async ({ page }) => {
    await bootDogeSwap(page);

    // The fixed bottom tab bar only exists in the mobile shell (viewport width
    // <= 760): its items expose bare names ("swap"), the desktop nav's are
    // numbered ("01 swap"). Skip on shells without a bottom nav.
    const tabItems = page.getByRole("button", { name: /^(swap|tokens|activity|settings)$/ });
    test.skip((await tabItems.count()) === 0, "no bottom tab bar in this shell");

    await fireToastStack(page, 3, "geom");

    const navTops = await Promise.all(
      (await tabItems.all()).map(async (item) => (await item.boundingBox()).y),
    );
    const navTop = Math.min(...navTops);

    for (let i = 1; i <= 3; i += 1) {
      const pill = page.getByText(`e2e toast geom ${i}`);
      const box = await pill.boundingBox();
      expect(box, `pill ${i} should be on-screen`).not.toBeNull();
      expect(
        box.y + box.height,
        `pill ${i} bottom edge must clear the tab bar top (${navTop})`,
      ).toBeLessThanOrEqual(navTop);
    }
  });
});
