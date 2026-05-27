#!/usr/bin/env node
const { validateLiveEvidence, writeLiveEvidenceReport } = require("./lib/liveEvidence.cjs");

const report = validateLiveEvidence({ cwd: process.cwd() });
const paths = writeLiveEvidenceReport(report, { cwd: process.cwd() });

console.log(`security live evidence: ${report.ok ? "pass" : "fail"}`);
console.log(`json: ${paths.jsonPath}`);
console.log(`markdown: ${paths.markdownPath}`);

if (!report.ok) {
  for (const check of report.checks.filter((item) => !item.ok)) {
    console.error(`failed: ${check.label}`);
  }
  process.exitCode = 1;
}
