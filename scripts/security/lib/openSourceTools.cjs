const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const OPEN_SOURCE_SECURITY_TOOLS = [
  {
    id: "slither",
    executable: "slither",
    purpose: "Static Solidity analysis for access control, reentrancy, unchecked transfers, shadowing, and known EVM footguns.",
    command: "slither . --exclude-dependencies --filter-paths 'node_modules|artifacts|cache|coverage'"
  },
  {
    id: "aderyn",
    executable: "aderyn",
    purpose: "Independent Solidity static analyzer to cross-check Slither-style findings with a separate ruleset.",
    command: "aderyn ."
  },
  {
    id: "osv-scanner",
    executable: "osv-scanner",
    purpose: "Open Source Vulnerabilities dependency audit for lockfiles and reachable package metadata.",
    command: "osv-scanner scan source -r ."
  },
  {
    id: "semgrep",
    executable: "semgrep",
    purpose: "Pattern-based source scan for JavaScript/TypeScript script hazards, secrets, and unsafe shell/process usage.",
    command: "semgrep scan --config p/security-audit --config p/secrets ."
  }
];

function isInstalled(executable) {
  const result = spawnSync("which", [executable], { encoding: "utf8" });
  if (result.status !== 0) {
    return { installed: false, path: null };
  }
  return { installed: true, path: result.stdout.trim() };
}

function buildToolAvailabilityReport({ cwd = process.cwd(), strict = false } = {}) {
  const tools = OPEN_SOURCE_SECURITY_TOOLS.map((tool) => {
    const availability = isInstalled(tool.executable);
    return {
      ...tool,
      installed: availability.installed,
      path: availability.path
    };
  });

  return {
    ok: strict ? tools.every((tool) => tool.installed) : true,
    strict,
    checkedAt: new Date().toISOString(),
    cwd,
    tools,
    nextAction: tools.every((tool) => tool.installed)
      ? "Run the listed commands before broadening execution adapters."
      : "Install missing tools locally, or rerun with DOGEOS_SECURITY_STRICT_OPEN_SOURCE_TOOLS=1 once the audit workstation is provisioned."
  };
}

function docsDir(cwd) {
  return path.join(cwd, "docs", "dexv3");
}

function markdownReport(report) {
  const rows = report.tools
    .map((tool) => `| ${tool.id} | ${tool.installed ? "Installed" : "Missing"} | ${tool.path || ""} | \`${tool.command}\` |`)
    .join("\n");

  return `# DogeOS Open-Source Security Tooling ${report.checkedAt.slice(0, 10)}

Generated: \`${report.checkedAt}\`

This is a zero-dependency local tooling gate. It does not add scanners to \`package.json\`; it records whether the audit workstation has the external open-source tools needed for deeper checks.

| Tool | Status | Path | Command |
| --- | --- | --- | --- |
${rows}

Next action: ${report.nextAction}
`;
}

function writeToolAvailabilityReport(report, { cwd = process.cwd() } = {}) {
  const dir = docsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const date = report.checkedAt.slice(0, 10);
  const jsonPath = path.join(dir, `open-source-security-tools-${date}.json`);
  const markdownPath = path.join(dir, `open-source-security-tools-${date}.md`);
  const latestJsonPath = path.join(dir, "open-source-security-tools-latest.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdownReport(report));
  return { jsonPath, latestJsonPath, markdownPath };
}

module.exports = {
  OPEN_SOURCE_SECURITY_TOOLS,
  buildToolAvailabilityReport,
  writeToolAvailabilityReport
};
