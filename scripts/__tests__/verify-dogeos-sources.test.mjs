import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBlockscoutAbiUrl,
  buildBlockscoutAddressUrl,
  buildBlockscoutSmartContractUrl,
  classifyVerification,
  defaultVerificationTargets,
  decodeAddressResult,
  summarizeReadCheck,
  summarizeTokenDecimalCheck,
  summarizeVerificationReport,
  selectorPresent,
  TOKEN_DECIMALS_SELECTOR,
} from "../verify-dogeos-sources.mjs";

test("selectorPresent detects a selector inside router bytecode", () => {
  const bytecode = "0x608060405260043610806304e45aaf1461029157";

  assert.equal(selectorPresent(bytecode, "0x04e45aaf"), true);
});

test("selectorPresent rejects malformed or absent selectors", () => {
  assert.equal(selectorPresent("0x6080", "0x04e45aaf"), false);
  assert.equal(selectorPresent("0x6080", "04e45aaf"), false);
  assert.equal(selectorPresent("0x6080", "0x1234"), false);
});

test("classifyVerification keeps unverified routers below active status", () => {
  const result = classifyVerification({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: {
      is_contract: true,
      is_verified: false,
      hash: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    },
    expectedSelectors: ["0x04e45aaf"],
    abiProvenance: "blockscout",
  });

  assert.equal(result.hasBytecode, true);
  assert.equal(result.selectorMatches.length, 1);
  assert.equal(result.status, "readOnly");
  assert.match(result.reason, /not verified/i);
});

test("classifyVerification requires bytecode before a source can be read", () => {
  const result = classifyVerification({
    role: "router",
    bytecode: "0x",
    blockscout: {
      is_contract: false,
      is_verified: false,
      hash: "0x0000000000000000000000000000000000000000",
    },
    expectedSelectors: ["0x04e45aaf"],
    abiProvenance: "blockscout",
  });

  assert.equal(result.hasBytecode, false);
  assert.equal(result.status, "watchlist");
  assert.match(result.reason, /no bytecode/i);
});

test("classifyVerification allows active routers only with bytecode, ABI provenance, verification, and selector matches", () => {
  const result = classifyVerification({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: {
      is_contract: true,
      is_verified: true,
      hash: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    },
    blockscoutContract: {
      hasAbi: true,
      name: "SwapRouter",
      compilerVersion: "v0.8.30",
    },
    expectedSelectors: ["0x04e45aaf"],
    abiProvenance: "blockscout",
  });

  assert.equal(result.status, "active");
  assert.equal(result.isBlockscoutAbiAvailable, true);
});

test("classifyVerification keeps verified routers below active when relationship reads mismatch", () => {
  const result = classifyVerification({
    role: "router",
    bytecode: "0x608060405260043610806304e45aaf1461029157",
    blockscout: {
      is_contract: true,
      is_verified: true,
      hash: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    },
    blockscoutContract: {
      hasAbi: true,
    },
    expectedSelectors: ["0x04e45aaf"],
    abiProvenance: "blockscout",
    readChecks: [
      {
        label: "factory()",
        expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        actualAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
        matches: false,
      },
    ],
  });

  assert.equal(result.status, "simulationOnly");
  assert.equal(result.readCheckMatches.length, 0);
  assert.match(result.reason, /relationship/i);
});

test("summarizeReadCheck decodes ABI address reads and compares expected addresses", () => {
  const check = summarizeReadCheck(
    {
      label: "factory()",
      selector: "0xc45a0155",
      expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
    },
    "0x0000000000000000000000007d175e06570cafa1cfdf060850b84e0ca23eff0b",
  );

  assert.equal(decodeAddressResult(check.rawResult), "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b");
  assert.deepEqual(check, {
    label: "factory()",
    selector: "0xc45a0155",
    expectedAddress: "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b",
    actualAddress: "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b",
    rawResult: "0x0000000000000000000000007d175e06570cafa1cfdf060850b84e0ca23eff0b",
    matches: true,
  });
});

test("summarizeTokenDecimalCheck decodes ERC-20 decimals reads", () => {
  const check = summarizeTokenDecimalCheck(
    {
      symbol: "USDC",
      address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
      decimals: 18,
    },
    "0x0000000000000000000000000000000000000000000000000000000000000012",
  );

  assert.equal(TOKEN_DECIMALS_SELECTOR, "0x313ce567");
  assert.deepEqual(check, {
    symbol: "USDC",
    address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    selector: "0x313ce567",
    expectedDecimals: 18,
    actualDecimals: 18,
    rawResult: "0x0000000000000000000000000000000000000000000000000000000000000012",
    hasBytecode: true,
    matches: true,
  });
});

test("summarizeVerificationReport blocks chain, relationship, or token decimal mismatches", () => {
  const summary = summarizeVerificationReport({
    chainMatches: true,
    sources: [
      {
        sourceId: "muchfi-v3",
        role: "router",
        address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        readChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b",
            actualAddress: "0x099f459d81ce99ad3ece1ca2c77d9869883d2457",
            matches: false,
          },
        ],
      },
    ],
    tokens: [
      {
        symbol: "USDC",
        address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        expectedDecimals: 18,
        actualDecimals: 6,
        hasBytecode: true,
        matches: false,
      },
    ],
  });

  assert.equal(summary.hasBlockingMismatch, true);
  assert.equal(summary.relationshipMismatches.length, 1);
  assert.equal(summary.tokenDecimalMismatches.length, 1);
  assert.deepEqual(summary.relationshipMismatches[0], {
    sourceId: "muchfi-v3",
    role: "router",
    address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    label: "factory()",
    selector: "0xc45a0155",
    expectedAddress: "0x7d175e06570cafa1cfdf060850b84e0ca23eff0b",
    actualAddress: "0x099f459d81ce99ad3ece1ca2c77d9869883d2457",
    error: null,
  });
  assert.deepEqual(summary.tokenDecimalMismatches[0], {
    symbol: "USDC",
    address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
    expectedDecimals: 18,
    actualDecimals: 6,
    hasBytecode: true,
    error: null,
  });

  const chainSummary = summarizeVerificationReport({
    chainMatches: false,
    sources: [],
    tokens: [],
  });

  assert.equal(chainSummary.hasBlockingMismatch, true);
});

test("summarizeVerificationReport allows read-only sources with missing external ABI proof", () => {
  const summary = summarizeVerificationReport({
    chainMatches: true,
    sources: [
      {
        sourceId: "muchfi-v2",
        role: "router",
        address: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
        blockscoutContract: {
          hasAbi: false,
        },
        verification: {
          status: "readOnly",
          isBlockscoutAbiAvailable: false,
        },
        readChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x7864071b532894216e3c045a74814eafeb92ae20",
            actualAddress: "0x7864071b532894216e3c045a74814eafeb92ae20",
            matches: true,
          },
        ],
      },
    ],
    tokens: [
      {
        symbol: "USDC",
        address: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        expectedDecimals: 18,
        actualDecimals: 18,
        hasBytecode: true,
        matches: true,
      },
    ],
  });

  assert.equal(summary.hasBlockingMismatch, false);
  assert.deepEqual(summary.relationshipMismatches, []);
  assert.deepEqual(summary.tokenDecimalMismatches, []);
});

test("buildBlockscoutAddressUrl points at the DogeOS testnet explorer", () => {
  assert.equal(
    buildBlockscoutAddressUrl("0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB"),
    "https://blockscout.testnet.dogeos.com/api/v2/addresses/0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
  );
});

test("buildBlockscoutSmartContractUrl points at the DogeOS smart-contract metadata endpoint", () => {
  assert.equal(
    buildBlockscoutSmartContractUrl("0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB"),
    "https://blockscout.testnet.dogeos.com/api/v2/smart-contracts/0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
  );
});

test("buildBlockscoutAbiUrl points at the DogeOS direct ABI endpoint", () => {
  assert.equal(
    buildBlockscoutAbiUrl("0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB"),
    "https://blockscout.testnet.dogeos.com/api?module=contract&action=getabi&address=0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
  );
});

test("defaultVerificationTargets comes from the shared source registry", () => {
  const targets = defaultVerificationTargets();

  assert.equal(targets.length > 9, true);
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router").expectedSelectors,
    ["0x04e45aaf", "0x5023b4df"],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v2" && target.role === "router").expectedSelectors,
    ["0x38ed1739", "0xd06ca61f", "0x8803dbee"],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "router")
      .expectedSelectors,
    ["0x1679c792", "0x1764babc"],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "quoter")
      .expectedSelectors,
    ["0xe94764c4", "0x62086e24"],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "quoter")
      .expectedSelectors,
    ["0xc6a5026a", "0xbd21704a", "0xcdca1753"],
  );
});
