import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS, getOfficialToken } from "../src/tokens.mjs";

test("DogeOS chain config includes chain id, RPC, explorer, native DOGE, and fee oracle", () => {
  assert.equal(DOGEOS_CHAIN.id, 6_281_971);
  assert.equal(DOGEOS_CHAIN.idHex, "0x5fdaf3");
  assert.equal(DOGEOS_CHAIN.nativeCurrency.symbol, "DOGE");
  assert.equal(DOGEOS_CHAIN.nativeCurrency.decimals, 18);
  assert.deepEqual(DOGEOS_CHAIN.rpcUrls, ["https://rpc.testnet.dogeos.com"]);
  assert.deepEqual(DOGEOS_CHAIN.wsRpcUrls, ["wss://ws.rpc.testnet.dogeos.com"]);
  assert.deepEqual(DOGEOS_CHAIN.fallbackRpcUrls, ["https://dogeos-testnet-public.unifra.io/"]);
  assert.equal(DOGEOS_CHAIN.blockscoutBaseUrl, "https://blockscout.testnet.dogeos.com");
  assert.equal(DOGEOS_CHAIN.l2scanBaseUrl, "https://dogeos-testnet.l2scan.co");
  assert.equal(DOGEOS_CHAIN.docsUrl, "https://docs.dogeos.com");
  assert.equal(DOGEOS_CHAIN.faucetUrl, "https://faucet.testnet.dogeos.com");
  assert.equal(DOGEOS_CHAIN.devPortalUrl, "https://portal.testnet.dogeos.com");
  assert.equal(DOGEOS_CHAIN.unifraConsoleUrl, "https://console.unifra.io/");
  assert.equal(DOGEOS_CHAIN.l1GasPriceOracle, "0x5300000000000000000000000000000000000002");
  assert.equal(DOGEOS_CHAIN.documentedMaxReorgDepth, 17);
});

test("official DogeOS token registry keeps all faucet tokens at provided addresses and on-chain 18 decimals", () => {
  assert.deepEqual(
    OFFICIAL_DOGEOS_TOKENS.map((token) => [token.symbol, token.address, token.decimals]),
    [
      ["WDOGE", "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE", 18],
      ["LBTC", "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E", 18],
      ["WETH", "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000", 18],
      ["USD1", "0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F", 18],
      ["USDC", "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925", 18],
      ["USDT", "0xC81800b77D91391Ef03d7868cB81204E753093a9", 18],
    ],
  );

  assert.equal(getOfficialToken("USDC").address, "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925");
  assert.equal(getOfficialToken("UNKNOWN"), undefined);
});
