import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMIT2_ALLOWANCE_SELECTOR,
  PERMIT2_APPROVE_SELECTOR,
  buildPermit2ApproveCalldata,
  buildPermit2TypedData,
  createPermit2ApprovalPlanner,
  encodePermit2AllowanceCall,
} from "../src/swap/permit2Approval.mjs";
import { PERMIT2_ADDRESS } from "../src/swap/dogeSwapRouterCalldata.mjs";

const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const owner = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const MAX_UINT256 = (1n << 256n) - 1n;

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function permit2AllowanceResult(amount, expiration, nonce = 0n) {
  // packed return: amount (uint160 word), expiration (uint48 word), nonce word
  return `0x${word(amount)}${word(expiration)}${word(nonce)}`;
}

function plannerClient({ erc20Allowance, permit2Amount, permit2Expiration, permit2Nonce = 0n }) {
  return {
    async call({ to }) {
      return to.toLowerCase() === usdc.toLowerCase()
        ? `0x${word(erc20Allowance)}`
        : permit2AllowanceResult(permit2Amount, permit2Expiration, permit2Nonce);
    },
  };
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

test("buildPermit2TypedData produces the Permit2 EIP-712 payload (no version in domain)", () => {
  const typedData = buildPermit2TypedData({
    token: usdc,
    spender: router,
    amount: 1_000_000n,
    expiration: 1_790_000_000n,
    nonce: 7n,
    sigDeadline: 1_780_002_100n,
    chainId: 6_281_971,
  });

  assert.deepEqual(typedData.domain, {
    name: "Permit2",
    chainId: 6_281_971,
    verifyingContract: PERMIT2_ADDRESS.toLowerCase(),
  });
  assert.equal(typedData.primaryType, "PermitSingle");
  assert.equal(typedData.message.details.token, usdc.toLowerCase());
  assert.equal(typedData.message.details.amount, "1000000");
  assert.equal(typedData.message.details.nonce, "7");
  assert.equal(typedData.message.spender, router.toLowerCase());
  assert.equal(typedData.message.sigDeadline, "1780002100");
  // domain has exactly name/chainId/verifyingContract — Permit2 has no version
  assert.deepEqual(
    typedData.types.EIP712Domain.map((field) => field.name),
    ["name", "chainId", "verifyingContract"],
  );
});

test("planner: nothing approved yet -> ONE max approve tx + a permit signature request", async () => {
  const client = plannerClient({ erc20Allowance: 0n, permit2Amount: 0n, permit2Expiration: 0n, permit2Nonce: 3n });
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.transactions.length, 1); // the single on-chain approval
  assert.equal(plan.transactions[0].step, "erc20-approve-permit2");
  assert.equal(plan.transactions[0].to, usdc.toLowerCase());
  // Max approve to canonical Permit2 (spend authority stays in the exact,
  // expiring signed permit).
  assert.ok(plan.transactions[0].data.endsWith(MAX_UINT256.toString(16)));
  assert.equal(plan.transaction, plan.transactions[0]);

  assert.equal(plan.permit.required, true);
  assert.equal(plan.permit.typedData.message.details.nonce, "3");
  assert.equal(plan.permit.typedData.message.details.amount, "1000000");
  assert.equal(plan.permit.typedData.message.spender, router.toLowerCase());
  assert.equal(plan.permit.fallbackTransaction.to, PERMIT2_ADDRESS.toLowerCase());
  assert.ok(plan.permit.fallbackTransaction.data.startsWith(PERMIT2_APPROVE_SELECTOR));
});

test("planner: ERC20 already approved -> ZERO transactions, signature only", async () => {
  const client = plannerClient({ erc20Allowance: MAX_UINT256, permit2Amount: 0n, permit2Expiration: 0n });
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.transactions, undefined);
  assert.equal(plan.permit.required, true);
});

test("planner: live unexpired Permit2 allowance -> no tx and no signature", async () => {
  const client = plannerClient({
    erc20Allowance: MAX_UINT256,
    permit2Amount: 5_000_000n,
    permit2Expiration: 9_999_999_999n,
  });
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.permit.required, false);
  assert.equal(plan.permit.typedData, undefined);
});

test("planner: expired Permit2 allowance -> fresh permit required", async () => {
  const client = plannerClient({
    erc20Allowance: MAX_UINT256,
    permit2Amount: 5_000_000n,
    permit2Expiration: 500n, // < now
  });
  const plan = await createPermit2ApprovalPlanner({ client, nowSeconds: () => 1_000 })({
    token: usdc,
    owner,
    spender: router,
    amount: 1_000_000n,
  });

  assert.equal(plan.approvalRequired, false);
  assert.equal(plan.permit.required, true);
});
