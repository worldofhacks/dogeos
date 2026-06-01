import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createVenueAbiArtifact } from "../packages/aggregator/src/abi/venueAbiArtifacts.mjs";

const OPTION_KEYS = new Map([
  ["--source-id", "sourceId"],
  ["--role", "role"],
  ["--address", "address"],
  ["--issuer", "issuer"],
  ["--source-uri", "sourceUri"],
  ["--selectors", "selectors"],
  ["--abi", "abiPath"],
  ["--signed-at", "signedAt"],
  ["--checked-at", "checkedAt"],
  ["--chain-id", "chainId"],
]);

function splitSelectors(value) {
  return String(value ?? "")
    .split(",")
    .map((selector) => selector.trim())
    .filter(Boolean);
}

export function parseArgs(args = []) {
  const options = {};

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const field = OPTION_KEYS.get(option);
    if (!field) {
      throw new Error(`Unknown option: ${option}`);
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${option}`);
    }

    if (field === "selectors") {
      options.selectors = splitSelectors(value);
    } else if (field === "chainId") {
      options.chainId = Number(value);
    } else {
      options[field] = value;
    }
  }

  return options;
}

export function parseAbiJson(rawJson) {
  const parsed = JSON.parse(rawJson);

  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.abi)) return parsed.abi;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (typeof parsed?.result === "string") {
    const result = JSON.parse(parsed.result);
    if (Array.isArray(result)) return result;
  }

  throw new Error("ABI file must contain a JSON ABI array, an abi array, or a Blockscout result array.");
}

export async function buildVenueAbiArtifactFromArgs(args = [], { readFileFn = readFile } = {}) {
  const options = parseArgs(args);
  const abiPath = options.abiPath;
  if (!abiPath) {
    throw new Error("--abi is required.");
  }

  const abi = parseAbiJson(await readFileFn(abiPath, "utf8"));
  return createVenueAbiArtifact({
    ...options,
    abi,
  });
}

export async function main(args = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const artifact = await buildVenueAbiArtifactFromArgs(args);
    stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isMainModule(metaUrl) {
  return resolve(process.argv[1] ?? "") === fileURLToPath(metaUrl);
}

if (isMainModule(import.meta.url)) {
  await main();
}
