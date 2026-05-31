import { fileURLToPath } from "node:url";

import { verifyDefaultSources } from "../packages/aggregator/src/verification/verificationSnapshot.mjs";

export {
  BLOCKSCOUT_BASE_URL,
  DOGEOS_CHAIN_ID_HEX,
  DOGEOS_RPC_URL,
  TOKEN_DECIMALS_SELECTOR,
  buildBlockscoutAbiUrl,
  buildBlockscoutAddressUrl,
  buildBlockscoutSmartContractUrl,
  buildExecutionEvidence,
  classifyVerification,
  createVerificationSnapshotProvider,
  decodeAddressResult,
  defaultVerificationTargets,
  selectorPresent,
  summarizeBlockscoutAbi,
  summarizeBlockscoutContract,
  summarizeReadCheck,
  summarizeTokenDecimalCheck,
  summarizeVerificationReport,
  verifyDefaultSources,
  verifySource,
} from "../packages/aggregator/src/verification/verificationSnapshot.mjs";

async function main() {
  const report = await verifyDefaultSources();
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
