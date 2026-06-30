// creatorReputation.mjs — guilt-by-association: a set of token-CREATOR
// (deployer) addresses that previously shipped a flagged token (one that failed
// the live round-trip probe — a honeypot / drained / dead pool). A token whose
// creator is in this set is dropped from the index, since scam creators reliably
// ship batches of sibling scams from one address. (Blockscout exposes the
// creator as `creator_address_hash`.)
//
// Pure in-memory set; persistence is injected via `onChange` (the server can
// write it to a JSON file). On a young testnet this catches little (most spam is
// already caught by the symbol regex), but it's the highest-ROI filter once a
// chain has real, repeat scam creators.

const lower = (value) => String(value ?? "").toLowerCase();

export function createCreatorReputation({ initial = [], onChange } = {}) {
  const flagged = new Set((initial ?? []).filter(Boolean).map(lower));
  return {
    isFlagged(deployer) {
      return deployer != null && flagged.has(lower(deployer));
    },
    flag(deployer) {
      if (!deployer) return;
      const key = lower(deployer);
      if (!flagged.has(key)) {
        flagged.add(key);
        onChange?.([...flagged]);
      }
    },
    list() {
      return [...flagged];
    },
    get size() {
      return flagged.size;
    },
  };
}
