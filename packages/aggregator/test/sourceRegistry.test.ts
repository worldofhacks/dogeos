import { describe, expect, it } from "vitest";
import { getExecutableSources, getQuoteSources, getSource, SOURCES } from "../src/sources/registry";

describe("source registry", () => {
  it("registers V1 sources with execution disabled unless provenance is confirmed", () => {
    expect(getSource("owned-pancake-v3").status).toBe("disabled");
    expect(getSource("muchfi-v3").protocolType).toBe("v3");
    expect(getSource("muchfi-v2").protocolType).toBe("v2");
    expect(getSource("barkswap-algebra").protocolType).toBe("algebra");
    expect(getSource("barkswap-algebra").status).toBe("readOnly");
    expect(getSource("suchswap").status).toBe("watchlist");
    expect(getSource("dogebox").status).toBe("watchlist");
  });

  it("never returns readOnly, disabled, or watchlist sources for execution", () => {
    expect(getExecutableSources()).toEqual([]);
    expect(getQuoteSources().map((source) => source.sourceId)).toEqual(["muchfi-v3", "muchfi-v2", "barkswap-algebra"]);
    expect(SOURCES.every((source) => source.sourceId.length > 0)).toBe(true);
  });
});
