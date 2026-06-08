import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(import.meta.dirname, "..");

const IGNORED_PATH_PARTS = new Set([
  ".git",
  ".tmp",
  ".worktrees",
  "coverage",
  "dist",
  "node_modules",
]);

const VENDORED_PREFIXES = [
  "apps/web/src/public/advanced_charting_library/",
  "apps/web/dist/advanced_charting_library/",
];

function normalizePath(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isIgnoredRepositoryScopePath(path) {
  const normalized = normalizePath(path);
  if (!normalized) return true;
  if (VENDORED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  return normalized.split("/").some((part) => IGNORED_PATH_PARTS.has(part));
}

function fileViolationKind(path) {
  const normalized = normalizePath(path);
  const basename = normalized.split("/").at(-1) ?? "";

  if (/\.(sol|s\.sol)$/i.test(normalized) || normalized.startsWith("contracts/")) {
    return "evm-contract-file";
  }

  if (/^(foundry\.toml|hardhat\.config\.[cm]?js|hardhat\.config\.ts)$/i.test(basename)) {
    return "evm-tooling-config";
  }

  if (
    /(^|\/)(deploy|deployment|broadcast)[^/]*\.(mjs|js|ts|cjs)$/i.test(normalized) ||
    /(^|\/)scripts\/.*deploy.*\.(mjs|js|ts|cjs)$/i.test(normalized)
  ) {
    return "dex-deployment-file";
  }

  return null;
}

function scriptLooksOwnedDex(name, command) {
  const text = `${name} ${command}`.toLowerCase();
  if (!/(deploy|broadcast|forge script|hardhat run)/.test(text)) return false;
  return /(dex|amm|v2|v3|factory|router|pool|liquidity|owned)/.test(text);
}

function contentLooksOwnedAmm(body) {
  return /(\bcreatePool\s*\(|\bmintPosition\s*\(|NonfungiblePositionManager|UniswapV[23]Factory|DeployOwned|deployOwned|pool\s*seeding)/.test(
    body,
  );
}

function fileContentsFor(path, fileContents) {
  if (!fileContents?.has?.(path)) return "";
  return String(fileContents.get(path) ?? "");
}

export function findRepositoryScopeViolations({
  files = [],
  fileContents = new Map(),
  packageScripts = {},
} = {}) {
  const violations = [];

  for (const file of files.map(normalizePath)) {
    if (isIgnoredRepositoryScopePath(file)) continue;

    const kind = fileViolationKind(file);
    if (kind) {
      violations.push({
        kind,
        path: file,
        reason: "Owned EVM contract, tooling, or deployment surface is outside the external-venue aggregator scope.",
      });
      continue;
    }

    const body = fileContentsFor(file, fileContents);
    if (body && contentLooksOwnedAmm(body)) {
      violations.push({
        kind: "owned-amm-content",
        path: file,
        reason: "File content includes owned AMM creation or liquidity-management behavior.",
      });
    }
  }

  for (const [script, command] of Object.entries(packageScripts ?? {})) {
    if (!scriptLooksOwnedDex(script, command)) continue;
    violations.push({
      kind: "owned-dex-script",
      script,
      command,
      reason: "Package script appears to deploy or broadcast an owned DEX surface.",
    });
  }

  return {
    violations,
    summary: {
      violationCount: violations.length,
      hasBlockingMismatch: violations.length > 0,
    },
  };
}

async function listRepoFiles(dir = repoRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const relativePath = normalizePath(relative(repoRoot, absolute));
    if (isIgnoredRepositoryScopePath(relativePath)) continue;

    if (entry.isDirectory()) {
      files.push(...await listRepoFiles(absolute));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

async function readPackageScripts() {
  try {
    const packageJson = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
    return packageJson.scripts ?? {};
  } catch {
    return {};
  }
}

async function readContents(files) {
  const contents = new Map();
  await Promise.all(
    files
      .filter((file) => /\.(mjs|js|cjs|ts|tsx|jsx|json)$/i.test(file))
      .map(async (file) => {
        try {
          contents.set(file, await readFile(join(repoRoot, file), "utf8"));
        } catch {
          // A race with generated files should not make the scope scan unusable.
        }
      }),
  );
  return contents;
}

async function main() {
  const files = await listRepoFiles();
  const report = findRepositoryScopeViolations({
    files,
    fileContents: await readContents(files),
    packageScripts: await readPackageScripts(),
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.summary.hasBlockingMismatch) {
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
