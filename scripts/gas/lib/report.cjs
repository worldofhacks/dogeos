const fs = require("node:fs");
const path = require("node:path");

function estimateCostWei(gasUsed, gasPriceWei) {
  return (BigInt(gasUsed) * BigInt(gasPriceWei)).toString();
}

function buildMarkdownGasReport({ generatedAt, compiler, evmVersion, referenceGasPriceWei, rows }) {
  const body = rows
    .map(
      (row) =>
        `| ${row.category} | \`${row.action}\` | \`${row.gasUsed}\` | \`${row.estimatedCostWei}\` | ${row.notes} |`
    )
    .join("\n");

  return `# DogeOS Router Gas Profile

Generated: \`${generatedAt}\`

Solidity \`${compiler}\`, EVM \`${evmVersion}\`.

This is a local Hardhat gas profile for planned successful router operations. It is intended for pre-flight budgeting and regression tracking. No transaction was broadcast. Swap rows use mock tokens, a fixed-output mock adapter, and the production DogeOS V2 pair adapter against local V2-shaped pair mocks. Production source gas can still differ when the external pair bytecode differs.

Reference gas price: \`${referenceGasPriceWei}\` wei.

| Category | Action | Gas Used | Estimated Cost Wei | Notes |
| --- | --- | ---: | ---: | --- |
${body}
`;
}

function writeGasReport({ date, json, markdown }) {
  const dir = path.join(process.cwd(), "docs", "dexv3");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `router-gas-profile-${date}.json`);
  const mdPath = path.join(dir, `router-gas-profile-${date}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  fs.writeFileSync(mdPath, markdown);
  return { jsonPath, mdPath };
}

module.exports = {
  buildMarkdownGasReport,
  estimateCostWei,
  writeGasReport
};
