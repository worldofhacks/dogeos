import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveExecutableStatus,
  hasSelector,
} from "../src/verification/verifySource.mjs";

test("hasSelector detects function selectors in bytecode", () => {
  assert.equal(hasSelector("0x608060405260043610806304e45aaf1461029157", "0x04e45aaf"), true);
  assert.equal(hasSelector("0x608060405260043610806304e45aaf1461029157", "0x38ed1739"), false);
});

test("deriveExecutableStatus keeps unverified routers read-only", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: false },
    abiProvenance: "none",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "readOnly");
  assert.match(status.reason, /ABI provenance/i);
});

test("deriveExecutableStatus marks missing bytecode as watchlist", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x",
    blockscout: { isContract: false, isVerified: false },
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "watchlist");
  assert.match(status.reason, /bytecode/i);
});

test("deriveExecutableStatus requires selector matches for active routers", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806338ed17391461029157",
    blockscout: { isContract: true, isVerified: true },
    blockscoutContract: { hasAbi: true },
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "simulationOnly");
  assert.match(status.reason, /selector/i);
});

test("deriveExecutableStatus marks verified routers active after ABI and selector checks", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: true },
    blockscoutContract: { hasAbi: true },
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "active");
});

test("deriveExecutableStatus requires router relationship read checks for active status", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: true },
    blockscoutContract: { hasAbi: true },
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
    readChecks: [
      {
        label: "factory()",
        expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        actualAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
        matches: false,
      },
    ],
  });

  assert.equal(status.status, "simulationOnly");
  assert.deepEqual(status.readCheckMatches, []);
  assert.match(status.reason, /relationship/i);
});

test("deriveExecutableStatus keeps selector-only router evidence below executable status", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: true },
    blockscoutContract: { hasAbi: false },
    abiProvenance: "onchain-bytecode",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "readOnly");
  assert.match(status.reason, /selector-only/i);
});

test("deriveExecutableStatus marks adapter ABI fragments active only with matching selectors, functions, and reads", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: false },
    blockscoutContract: { hasAbi: false },
    abiProvenance: "adapter-fragment",
    abiArtifact: {
      status: "verified",
      matchesTarget: true,
      selectorMatches: ["0x04e45aaf"],
      abiFunctionMatches: [
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      ],
    },
    expectedSelectors: ["0x04e45aaf"],
    expectedAbiFunctions: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
    readChecks: [
      {
        label: "factory()",
        expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        actualAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        matches: true,
      },
    ],
  });

  assert.equal(status.status, "active");
  assert.equal(status.hasAdapterAbiArtifact, true);
  assert.equal(status.hasBlockscoutAbi, false);
  assert.deepEqual(status.abiArtifactSelectorMatches, ["0x04e45aaf"]);
  assert.deepEqual(status.abiArtifactFunctionMatches, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
});

test("deriveExecutableStatus keeps adapter ABI fragments below active when functions are incomplete", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: false },
    blockscoutContract: { hasAbi: false },
    abiProvenance: "adapter-fragment",
    abiArtifact: {
      status: "verified",
      matchesTarget: true,
      selectorMatches: ["0x04e45aaf"],
      abiFunctionMatches: [],
    },
    expectedSelectors: ["0x04e45aaf"],
    expectedAbiFunctions: [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    ],
  });

  assert.equal(status.status, "simulationOnly");
  assert.match(status.reason, /adapter ABI fragment/i);
});

test("deriveExecutableStatus requires a Blockscout ABI payload for Blockscout ABI provenance", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: true },
    blockscoutContract: { hasAbi: false },
    abiProvenance: "blockscout",
    expectedSelectors: ["0x04e45aaf"],
  });

  assert.equal(status.status, "readOnly");
  assert.match(status.reason, /Blockscout ABI/i);
});

test("deriveExecutableStatus allows venue ABI artifacts only when bytecode, target, selectors, and reads match", () => {
  const status = deriveExecutableStatus({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: { isContract: true, isVerified: false },
    blockscoutContract: { hasAbi: false },
    abiProvenance: "venue-artifact",
    abiArtifact: {
      status: "verified",
      matchesTarget: true,
      selectorMatches: ["0x04e45aaf"],
    },
    expectedSelectors: ["0x04e45aaf"],
    readChecks: [
      {
        label: "factory()",
        expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        actualAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        matches: true,
      },
    ],
  });

  assert.equal(status.status, "active");
  assert.equal(status.hasBlockscoutAbi, false);
  assert.equal(status.hasVenueAbiArtifact, true);
  assert.deepEqual(status.abiArtifactSelectorMatches, ["0x04e45aaf"]);
});

test("deriveExecutableStatus keeps venue ABI artifacts below active when artifact proof is incomplete", () => {
  for (const abiArtifact of [
    null,
    { status: "pending", matchesTarget: true, selectorMatches: ["0x04e45aaf"] },
    { status: "verified", matchesTarget: false, selectorMatches: ["0x04e45aaf"] },
    { status: "verified", matchesTarget: true, selectorMatches: ["0x38ed1739"] },
  ]) {
    const status = deriveExecutableStatus({
      role: "router",
      bytecode: "0x608060405260043610806304e45aaf1461029157",
      blockscout: { isContract: true, isVerified: false },
      blockscoutContract: { hasAbi: false },
      abiProvenance: "venue-artifact",
      abiArtifact,
      expectedSelectors: ["0x04e45aaf"],
    });

    assert.notEqual(status.status, "active");
    assert.match(status.reason, /venue ABI artifact/i);
  }
});
