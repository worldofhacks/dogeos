#!/usr/bin/env bash
# pool-scan-cron.sh — runs the DogeOS deep pool scan on a schedule (systemd timer),
# diffs against the previous run, rotates the baseline, and surfaces NEW pools.
# Output + summaries land in $OUT; the human summary is echoed to journald.
set -uo pipefail

export PATH="/home/actlabs/.nvm/versions/node/v22.22.3/bin:$PATH"
REPO="/home/actlabs/dogeswap-prod"
OUT="${DOGEOS_POOL_SCAN_DIR:-/home/actlabs/dogeos-pool-scans}"
mkdir -p "$OUT"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

# Scan: INCREMENTAL via --cursor (scans only newly-confirmed blocks; the prior
# accumulated pool set rides on baseline.json's `pools[]`, treating the last
# reorg-depth blocks as unconfirmed). Diff vs the previous baseline, save this
# run as latest.json. Full JSON -> latest.json (via --save), human summary ->
# stderr -> the per-run summary file + journald.
node "$REPO/scripts/scan-dogeos-pools.mjs" \
  --summary \
  --cursor "$OUT/cursor.json" \
  --baseline "$OUT/baseline.json" \
  --save "$OUT/latest.json" \
  1>/dev/null 2>"$OUT/summary-$TS.txt"
SCAN_EXIT=$?

cat "$OUT/summary-$TS.txt"   # -> journald

# Persist a prominent alert when a NEW official-pair pool appeared since the last run.
if grep -q "★ NEW official-pair pool" "$OUT/summary-$TS.txt"; then
  {
    echo "=== NEW DogeOS official-pair pool detected at $TS ==="
    grep "★ NEW official-pair pool" "$OUT/summary-$TS.txt"
  } >> "$OUT/ALERTS.txt"
  echo "ALERT written to $OUT/ALERTS.txt"
fi

# Rotate the baseline so the next run diffs against this one.
[ -f "$OUT/latest.json" ] && cp "$OUT/latest.json" "$OUT/baseline.json"

# Keep the last 60 per-run summaries.
ls -1t "$OUT"/summary-*.txt 2>/dev/null | tail -n +61 | xargs -r rm -f

# scan exit 2 = "missing official-pair pools exist" (a known/standing state, not a failure);
# only surface a real failure (1) to systemd.
[ "${SCAN_EXIT:-0}" = "1" ] && exit 1
exit 0
