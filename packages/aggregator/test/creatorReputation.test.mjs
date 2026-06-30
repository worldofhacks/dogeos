import assert from "node:assert/strict";
import test from "node:test";

import { createCreatorReputation } from "../src/discovery/creatorReputation.mjs";

test("deployer reputation flags + checks case-insensitively and notifies onChange once", () => {
  const changes = [];
  const rep = createCreatorReputation({ initial: ["0xAAA"], onChange: (l) => changes.push(l) });

  assert.equal(rep.isFlagged("0xaaa"), true, "seeded deployer flagged (case-insensitive)");
  assert.equal(rep.isFlagged("0xBBB"), false);
  assert.equal(rep.isFlagged(null), false);
  assert.equal(rep.isFlagged(undefined), false);

  rep.flag("0xBbB");
  assert.equal(rep.isFlagged("0xbbb"), true);
  assert.equal(rep.size, 2);
  assert.equal(changes.length, 1, "onChange fires for the new flag");

  rep.flag("0xbbb"); // duplicate -> no change
  assert.equal(changes.length, 1);
});
