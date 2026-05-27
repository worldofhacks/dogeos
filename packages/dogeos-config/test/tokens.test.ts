import { describe, expect, it } from "vitest";
import { DOGEOS_TESTNET, L1_GAS_PRICE_ORACLE } from "../src/chains";
import { OFFICIAL_TOKENS, TOKENS } from "../src/tokens";

describe("DogeOS config", () => {
  it("defines Chikyu testnet as a first-class chain", () => {
    expect(DOGEOS_TESTNET.id).toBe(6281971);
    expect(DOGEOS_TESTNET.nativeCurrency.symbol).toBe("DOGE");
    expect(DOGEOS_TESTNET.rpcUrls.default.http[0]).toBe("https://rpc.testnet.dogeos.com");
    expect(DOGEOS_TESTNET.blockExplorers.default.url).toBe("https://blockscout.testnet.dogeos.com");
    expect(L1_GAS_PRICE_ORACLE).toBe("0x5300000000000000000000000000000000000002");
  });

  it("keeps official faucet tokens at DogeOS testnet addresses and 18 decimals", () => {
    expect(TOKENS.WDOGE.address).toBe("0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE");
    expect(TOKENS.USDC.address).toBe("0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925");
    expect(TOKENS.USDT.address).toBe("0xC81800b77D91391Ef03d7868cB81204E753093a9");
    expect(TOKENS.WDOGE.decimals).toBe(18);
    expect(TOKENS.USDC.decimals).toBe(18);
    expect(TOKENS.USDT.decimals).toBe(18);
    expect(OFFICIAL_TOKENS).toHaveLength(6);
  });
});
