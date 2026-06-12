import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMIT2_ALLOWANCE_SELECTOR,
  PERMIT2_APPROVE_SELECTOR,
  buildPermit2ApproveCalldata,
  createPermit2ApprovalPlanner,
  encodePermit2AllowanceCall,
} from "../src/swap/permit2Approval.mjs";
import { PERMIT2_ADDRESS } from "../src/swap/dogeSwapRouterCalldata.mjs";

const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const owner = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function permit2AllowanceResult(amount, expiration) {
  // packed return: amount (uint160 word), expiration (uint48 word), nonce word
  return `0x${word(amount)}${word(expiration)}${word(0n)}`;
}

test("buildPermit2ApproveCalldata encodes approve(token,spender,uint160,uint48)", () => {
  const calldata = buildPermit2ApproveCalldata({
    token: usdc,
    spender: router,
    amount: 1_000_000n,
    expiration: 1_780_000_300n,
  });
  assert.ok(calldata.startsWith(PERMIT2_APPROVE_SELECTOR));
  const words = calldata.slice(10).match(/.{64}/g);
  assert.equal(`0x${words[0].slice(24)}`, usdc.toLowerCase());
  assert.equal(`0x${words[1].slice(24)}`, router.toLowerCase());
  assert.equal(BigInt(`0x${words[2]}`), 1_000_000n);
  assert.equal(BigInt(`0x${words[3]}`), 1_780_000_300n);
});

test("encodePermit2AllowanceCall targets allowance(owner,token,spender)", () => {
  const calldata = encodePermit2AllowanceCall({ owner, token: usdc, spender: router });
  assert.ok(calldata.startsWith(PERMIT2_ALLOWANCE_SELECTOR));
});

test("planner requires BOTH approvals when nothing is approved yet", async () => {
  const client = {
    async call({ to }) {
      // ERC-20 allowance(owner, permit2) = 0; Permit2 allowance = 0/expired.
      return to.toLowerCase() === usdc.toLowerCase() ? `0x${word(0n)}` : permit2AllowanceResult(0n, 0n);
    },
  };
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.transactions.length, 2);
  assert.equal(plan.transactions[0].step, "erc20-approve-permit2");
  assert.equal(plan.transactions[0].to, usdc.toLowerCase());
  assert.equal(plan.transactions[1].step, "permit2-approve-router");
  assert.equal(plan.transactions[1].to, PERMIT2_ADDRESS.toLowerCase());
  // Back-compat single-tx mirror.
  assert.equal(plan.transaction, plan.transactions[0]);
});

test("planner skips the ERC-20 step when Permit2 already has token allowance", async () => {
  const client = {
    async call({ to }) {
      // ERC-20 allowance to Permit2 is already max; Permit2->router not yet set.
      return to.toLowerCase() === usdc.toLowerCase()
        ? `0x${word((1n << 256n) - 1n)}`
        : permit2AllowanceResult(0n, 0n);
    },
  };
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.transactions.length, 1);
  assert.equal(plan.transactions[0].step, "permit2-approve-router");
});

test("planner requires nothing when both allowances are sufficient and unexpired", async () => {
  const client = {
    async call({ to }) {
      return to.toLowerCase() === usdc.toLowerCase()
        ? `0x${word((1n << 256n) - 1n)}`
        : permit2AllowanceResult(5_000_000n, 9_999_999_999n);
    },
  };
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.transactions, undefined);
});

test("planner re-approves Permit2 when the existing allowance is expired", async () => {
  const client = {
    async call({ to }) {
      return to.toLowerCase() === usdc.toLowerCase()
        ? `0x${word((1n << 256n) - 1n)}`
        : permit2AllowanceResult(5_000_000n, 500n); // expiration < now
    },
  };
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.transactions.length, 1);
  assert.equal(plan.transactions[0].step, "permit2-approve-router");
});
