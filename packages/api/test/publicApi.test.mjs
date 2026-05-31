import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../src/index.mjs";

test("public API package exports handler and Node runtime boundaries", () => {
  assert.equal(typeof api.createAggregatorApiHandler, "function");
  assert.equal(typeof api.createLiveAggregatorApiHandler, "function");
  assert.equal(typeof api.createNodeRequestListener, "function");
  assert.equal(typeof api.startAggregatorApiServer, "function");
});
