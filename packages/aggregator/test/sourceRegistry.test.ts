import { describe, expect, it } from "vitest";
import { getExecutableSources, getQuoteSources, getSource, SOURCES } from "../src/sources/registry";

describe("source registry", () => {
  it("registers V1 sources with MuchFi V3 and Barkswap quote-enabled", () => {
    expect(getSource("owned-pancake-v3").status).toBe("disabled");
    expect(getSource("muchfi-v3").protocolType).toBe("v3");
    expect(getSource("muchfi-v3").status).toBe("quoteActive");
    expect(getSource("muchfi-v3").quoteSupport).toBe("enabled");
    expect(getSource("muchfi-v3").executionSupport).toBe("disabled");
    expect(getSource("muchfi-v2").protocolType).toBe("v2");
    expect(getSource("muchfi-v2").status).toBe("active");
    expect(getSource("muchfi-v2").verified).toBe(true);
    expect(getSource("muchfi-v2").quoteSupport).toBe("enabled");
    expect(getSource("muchfi-v2").executionSupport).toBe("enabled");
    expect(getSource("barkswap-algebra").protocolType).toBe("algebra");
    expect(getSource("barkswap-algebra").status).toBe("quoteActive");
    expect(getSource("barkswap-algebra").quoteSupport).toBe("enabled");
    expect(getSource("barkswap-algebra").executionSupport).toBe("disabled");
    expect(getSource("suchswap").status).toBe("watchlist");
    expect(getSource("dogebox").status).toBe("watchlist");
  });

  it("returns only active verified sources for execution", () => {
    expect(getExecutableSources().map((source) => source.sourceId)).toEqual(["muchfi-v2"]);
    expect(getQuoteSources().map((source) => source.sourceId)).toEqual(["muchfi-v3", "muchfi-v2", "barkswap-algebra"]);
    expect(SOURCES.every((source) => source.sourceId.length > 0)).toBe(true);
  });
});
