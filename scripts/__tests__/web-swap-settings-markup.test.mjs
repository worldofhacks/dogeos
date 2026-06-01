import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexHtmlUrl = new URL("../../apps/web/src/index.html", import.meta.url);

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

test("swap settings keeps trade knobs inside the popup, not the home form", async () => {
  const html = await readFile(indexHtmlUrl, "utf8");
  const swapForm = sliceBetween(html, '<form id="swap-form"', "</form>");
  const settingsPanel = sliceBetween(html, 'id="swap-settings-panel"', '<div id="sdk-wallet-root"');
  const settingsButton = sliceBetween(html, 'id="swap-settings-toggle"', "</button>");

  assert.equal(swapForm.includes('id="slippage-knob"'), false);
  assert.equal(swapForm.includes('id="gas-knob"'), false);
  assert.match(settingsPanel, /id="slippage-knob"/);
  assert.match(settingsPanel, /id="gas-knob"/);
  assert.match(settingsButton, /aria-controls="swap-settings-panel"/);
  assert.match(settingsButton, /id="swap-settings-summary"/);
});
