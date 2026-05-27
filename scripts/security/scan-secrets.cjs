const fs = require("node:fs");
const path = require("node:path");

const ROOTS = [".env.example", "docs", "contracts", "packages", "scripts", "hardhat.config.cjs", "package.json"];
const IGNORED_DIRS = new Set(["node_modules", "artifacts", "cache", "coverage", ".git"]);

const patterns = [
  new RegExp(["DEPLOYER_PRIVATE_KEY=", "0x[0-9a-fA-F]"].join("") + "{64}"),
  new RegExp(["PRIVATE_KEY=", "0x[0-9a-fA-F]"].join("") + "{16,}"),
  /\bMNEMONIC\b/u,
  /\bSEED\b/u,
  new RegExp(["4b61", "f309"].join(""))
];

function listFiles(target) {
  if (!fs.existsSync(target)) {
    return [];
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return [target];
  }

  const files = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }

  return files;
}

const findings = [];
for (const file of ROOTS.flatMap(listFiles)) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        findings.push(`${file}:${index + 1}: potential secret pattern`);
        break;
      }
    }
  });
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log("secret scan clean");
