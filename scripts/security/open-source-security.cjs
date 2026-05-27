#!/usr/bin/env node
const {
  buildToolAvailabilityReport,
  writeToolAvailabilityReport
} = require("./lib/openSourceTools.cjs");

const strict = process.env.DOGEOS_SECURITY_STRICT_OPEN_SOURCE_TOOLS === "1";
const report = buildToolAvailabilityReport({ cwd: process.cwd(), strict });
const paths = writeToolAvailabilityReport(report, { cwd: process.cwd() });

console.log(`open-source security tooling: ${report.ok ? "pass" : "missing optional tools"}`);
console.log(`json: ${paths.jsonPath}`);
console.log(`markdown: ${paths.markdownPath}`);

for (const tool of report.tools) {
  console.log(`${tool.id}: ${tool.installed ? tool.path : "missing"} | ${tool.command}`);
}

if (!report.ok) {
  process.exitCode = 1;
}
