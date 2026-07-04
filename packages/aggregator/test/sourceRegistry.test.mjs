import assert from "node:assert/strict";
import test from "node:test";

import {
  getExecutableSources,
  getSource,
  listVenueContracts,
  listVerificationTargets,
  listSources,
} from "../src/sources/registry.mjs";

test("source registry exposes external venues plus the first-party split router", () => {
  const sources = listSources();
  const sourceIds = sources.map((source) => source.sourceId).sort();

  assert.deepEqual(sourceIds, [
    "barkswap-algebra",
    "dogebox",
    "dogeswap-split",
    "muchfi-v2",
    "muchfi-v3",
    "suchswap",
  ]);

  // Every quote-source venue is external; the only internal source is the
  // first-party DogeSwapRouter aggregator (disabled until its address is set).
  assert.deepEqual(
    sources.filter((source) => source.ownership !== "external").map((source) => source.sourceId),
    ["dogeswap-split"],
  );
  const split = sources.find((source) => source.sourceId === "dogeswap-split");
  assert.equal(split.ownership, "internal");
  assert.equal(split.status, "disabled"); // no DOGESWAP_ROUTER_ADDRESS in test env
});

test("source registry marks verified live quote venues executable", () => {
  assert.deepEqual(
    getExecutableSources().map((source) => source.sourceId).sort(),
    ["barkswap-algebra", "muchfi-v2", "muchfi-v3"],
  );
  assert.equal(getSource("muchfi-v2").status, "active");
  assert.equal(getSource("muchfi-v2").verification.execution, true);
  assert.equal(getSource("muchfi-v3").status, "active");
  assert.equal(getSource("muchfi-v3").verification.execution, true);
  assert.equal(getSource("barkswap-algebra").status, "active");
  assert.equal(getSource("barkswap-algebra").verification.execution, true);
  assert.equal(getSource("suchswap").status, "watchlist");
  assert.equal(getSource("dogebox").status, "watchlist");
});

test("routed sources expose committed adapter ABI fragments instead of hiding selector-only evidence", () => {
  assert.equal(getSource("muchfi-v2").abiProvenance, "adapter-fragment");
  assert.equal(getSource("muchfi-v3").abiProvenance, "adapter-fragment");
  assert.equal(getSource("barkswap-algebra").abiProvenance, "adapter-fragment");
  assert.equal(getSource("suchswap").abiProvenance, "none");
  assert.equal(getSource("dogebox").abiProvenance, "none");
});

test("source registry preserves protocol families needed for modular routing", () => {
  assert.equal(getSource("muchfi-v2").protocolType, "v2");
  assert.equal(getSource("muchfi-v3").protocolType, "v3");
  assert.equal(getSource("barkswap-algebra").protocolType, "algebra");
});

test("source registry exposes verification targets for routers, factories, and position managers", () => {
  const targets = listVerificationTargets();
  const targetKeys = targets.map((target) => `${target.sourceId}:${target.role}:${target.address}`).sort();

  for (const key of [
    "barkswap-algebra:factory:0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
    "barkswap-algebra:pool:0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
    "barkswap-algebra:pool:0x5DC3eB0e452f464e134F854EAeDf9431B93Da624",
    "barkswap-algebra:positionManager:0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07",
    "barkswap-algebra:quoter:0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D",
    "barkswap-algebra:router:0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
    "muchfi-v2:factory:0x7864071B532894216e3C045a74814EafEB92ae20",
    "muchfi-v2:pool:0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
    "muchfi-v2:router:0xC653e745FC613a03D156DACB924AE8e9148B18dc",
    "muchfi-v3:factory:0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
    "muchfi-v3:pool:0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
    "muchfi-v3:quoter:0x5DE1Ea595653419f295511DEb781b98387a77cc2",
    "muchfi-v3:router:0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    "suchswap:factory:0x924163a558915Bf685eD21809A8B8b372A79Ed37",
  ]) {
    assert.equal(targetKeys.includes(key), true, key);
  }

  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router").expectedSelectors,
    ["0x04e45aaf", "0x5023b4df", "0x5ae401dc"],
  );
  assert.equal(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router")
      .abiProvenance,
    "adapter-fragment",
  );
  assert.equal(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router")
      .abiArtifact.target.address,
    "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
  );
  assert.match(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router")
      .abiArtifact.artifactHash,
    /^0x[0-9a-f]{64}$/,
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v3" && target.role === "router")
      .expectedAbiFunctions,
    [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "multicall(uint256,bytes[])",
    ],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v2" && target.role === "router").expectedSelectors,
    ["0x38ed1739", "0xd06ca61f", "0x8803dbee"],
  );
  assert.equal(
    targets.find((target) => target.sourceId === "muchfi-v2" && target.role === "router")
      .abiArtifact.target.address,
    "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v2" && target.role === "router")
      .expectedAbiFunctions,
    [
      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      "getAmountsOut(uint256,address[])",
      "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
    ],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "router")
      .expectedSelectors,
    ["0x1679c792", "0x1764babc"],
  );
  assert.equal(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "router")
      .abiArtifact.target.address,
    "0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "router")
      .expectedAbiFunctions,
    [
      "exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))",
      "exactOutputSingle((address,address,address,address,uint256,uint256,uint256,uint160))",
    ],
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
  assert.deepEqual(
    targets.find((target) => target.sourceId === "muchfi-v2" && target.role === "router")
      .expectedReadChecks,
    [
      {
        label: "factory()",
        selector: "0xc45a0155",
        expectedAddress: "0x7864071B532894216e3C045a74814EafEB92ae20",
      },
      {
        label: "WETH()",
        selector: "0xad5c4648",
        expectedAddress: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      },
    ],
  );
  assert.deepEqual(
    targets.find((target) => target.sourceId === "barkswap-algebra" && target.role === "router")
      .expectedReadChecks,
    [
      {
        label: "factory()",
        selector: "0xc45a0155",
        expectedAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
      },
      {
        label: "poolDeployer()",
        selector: "0x3119049a",
        expectedAddress: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
      },
    ],
  );
});

test("source registry records real main-pair pools for live DogeOS quote reads", () => {
  assert.deepEqual(
    getSource("muchfi-v3").pools.map((pool) => `${pool.pair}:${pool.feeTier}:${pool.address}`).sort(),
    [
      "WDOGE/USDC:2500:0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
      "WDOGE/USDC:500:0x4F1c638952a23DB25a13167B83810201c4BC7299",
      "WDOGE/USDT:500:0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F",
    ],
  );
  assert.deepEqual(
    getSource("barkswap-algebra").pools.map((pool) => `${pool.pair}:${pool.address}`).sort(),
    [
      "WDOGE/USDC:0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
      "WDOGE/USDT:0x5DC3eB0e452f464e134F854EAeDf9431B93Da624",
    ],
  );
  assert.deepEqual(
    getSource("suchswap").pools.map((pool) => `${pool.pair}:${pool.feeTier}:${pool.address}`).sort(),
    [
      "WDOGE/USDC:10000:0xC940Fe1F7396517Cd67fC501597e3fF3C97E5850",
      "WDOGE/USDC:3000:0x1289ED890E1F58376045FdA9430100bFAD69A44b",
    ],
  );
});

test("source registry exposes a venue contract map with executable live venues", () => {
  const venues = listVenueContracts();
  const muchFiV3 = venues.find((venue) => venue.sourceId === "muchfi-v3");
  const barkswap = venues.find((venue) => venue.sourceId === "barkswap-algebra");

  assert.equal(venues.every((venue) => venue.ownership === "external"), true);
  assert.equal(muchFiV3.status, "active");
  assert.deepEqual(muchFiV3.supportedPairs, ["WDOGE/USDC", "WDOGE/USDT"]);
  assert.deepEqual(muchFiV3.execution, {
    enabled: true,
    reason: "Router selectors and relationship reads are verified on-chain; swaps execute after live simulation.",
  });
  assert.deepEqual(
    muchFiV3.contracts.map((contract) => `${contract.role}:${contract.address}`).sort(),
    [
      "factory:0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
      "pool:0x4F1c638952a23DB25a13167B83810201c4BC7299",
      "pool:0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F",
      "pool:0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
      "poolDeployer:0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348",
      "positionManager:0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5",
      "quoter:0x5DE1Ea595653419f295511DEb781b98387a77cc2",
      "router:0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    ],
  );
  assert.deepEqual(
    muchFiV3.contracts.find((contract) => contract.role === "router").expectedSelectors,
    ["0x04e45aaf", "0x5023b4df", "0x5ae401dc"],
  );
  assert.deepEqual(
    muchFiV3.contracts.find((contract) => contract.role === "router").expectedAbiFunctions,
    [
      "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))",
      "multicall(uint256,bytes[])",
    ],
  );
  assert.deepEqual(
    barkswap.contracts.find((contract) => contract.role === "router").expectedReadChecks,
    [
      {
        label: "factory()",
        selector: "0xc45a0155",
        expectedAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
      },
      {
        label: "poolDeployer()",
        selector: "0x3119049a",
        expectedAddress: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
      },
    ],
  );

  muchFiV3.contracts[0].address = "0x0000000000000000000000000000000000000000";
  assert.equal(
    listVenueContracts()
      .find((venue) => venue.sourceId === "muchfi-v3")
      .contracts.some((contract) => contract.address === "0x0000000000000000000000000000000000000000"),
    false,
  );
});
