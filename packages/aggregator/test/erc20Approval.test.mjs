import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVE_SELECTOR,
  ALLOWANCE_SELECTOR,
  buildErc20ApprovalPlan,
  buildErc20ApproveCalldata,
  createErc20ApprovalPlanner,
  encodeErc20AllowanceCall,
} from "../src/swap/erc20Approval.mjs";

const token = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const owner = "0x1111111111111111111111111111111111111111";
const spender = "0x2222222222222222222222222222222222222222";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function encodedAddress(address) {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

test("ERC-20 approval helpers encode allowance and approve calldata", () => {
  assert.equal(
    encodeErc20AllowanceCall({ owner, spender }),
    `${ALLOWANCE_SELECTOR}${encodedAddress(owner)}${encodedAddress(spender)}`,
  );
  assert.equal(
    buildErc20ApproveCalldata({ spender, amount: 1_000_000n }),
    `${APPROVE_SELECTOR}${encodedAddress(spender)}${word(1_000_000n)}`,
  );
});

test("buildErc20ApprovalPlan returns no transaction when allowance covers the swap input", () => {
  const plan = buildErc20ApprovalPlan({
    token,
    spender,
    owner,
    amount: 1_000_000n,
    allowance: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.allowance, 1_000_000n);
  assert.equal(plan.transaction, undefined);
});

test("buildErc20ApprovalPlan builds an exact approval transaction when allowance is short", () => {
  const plan = buildErc20ApprovalPlan({
    token,
    spender,
    owner,
    amount: 1_000_000n,
    allowance: 999_999n,
  });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.allowance, 999_999n);
  assert.deepEqual(plan.transaction, {
    to: token,
    data: `${APPROVE_SELECTOR}${encodedAddress(spender)}${word(1_000_000n)}`,
    value: 0n,
  });
});

test("createErc20ApprovalPlanner reads allowance through RPC before building approval tx", async () => {
  const calls = [];
  const planner = createErc20ApprovalPlanner({
    client: {
      async call(transaction, blockTag) {
        calls.push({ transaction, blockTag });
        return `0x${word(42n)}`;
      },
    },
  });

  const plan = await planner({ token, owner, spender, amount: 1_000_000n });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.allowance, 42n);
  assert.deepEqual(calls, [
    {
      transaction: {
        to: token,
        data: `${ALLOWANCE_SELECTOR}${encodedAddress(owner)}${encodedAddress(spender)}`,
      },
      blockTag: "latest",
    },
  ]);
});
