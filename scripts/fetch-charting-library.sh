#!/usr/bin/env bash
#
# fetch-charting-library.sh — restore the vendored TradingView Advanced Charts
# library for a fresh checkout / CI.
#
# The library (~26MB, licensed) is intentionally NOT committed. It is gitignored
# at apps/web/src/public/advanced_charting_library/ and served at runtime from
# /advanced_charting_library/... (Vite serves apps/web/src/public as-is). This
# script clones the private mirror and copies only the runtime pieces the app
# needs: charting_library/ + datafeeds/ (no .git, no *.html demos).
#
# Usage:
#   ./scripts/fetch-charting-library.sh
#
# Override the source repo with CHARTING_LIBRARY_REPO if you mirror it elsewhere.
set -euo pipefail

REPO_URL="${CHARTING_LIBRARY_REPO:-https://github.com/worldofhacks/advanced_charting_library.git}"

# Resolve the repo root from this script's location so it works from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST="${REPO_ROOT}/apps/web/src/public/advanced_charting_library"

if [ -f "${DEST}/charting_library/charting_library.standalone.js" ]; then
  echo "charting library already present at ${DEST} — nothing to do."
  echo "(delete the directory and re-run to force a refresh.)"
  exit 0
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

echo "cloning ${REPO_URL} (shallow) ..."
git clone --depth 1 "${REPO_URL}" "${TMP_DIR}/advanced_charting_library"

SRC="${TMP_DIR}/advanced_charting_library"
if [ ! -d "${SRC}/charting_library" ] || [ ! -d "${SRC}/datafeeds" ]; then
  echo "error: clone is missing charting_library/ or datafeeds/." >&2
  exit 1
fi

echo "copying charting_library/ + datafeeds/ into ${DEST} ..."
mkdir -p "${DEST}"
rm -rf "${DEST}/charting_library" "${DEST}/datafeeds"
cp -R "${SRC}/charting_library" "${DEST}/charting_library"
cp -R "${SRC}/datafeeds" "${DEST}/datafeeds"

# Drop the demo HTML pages we never serve (keep charting_library/sameorigin.html,
# which the widget loads at runtime).
find "${DEST}" -maxdepth 1 -name "*.html" -delete 2>/dev/null || true

if [ ! -f "${DEST}/charting_library/charting_library.standalone.js" ]; then
  echo "error: standalone bundle missing after copy." >&2
  exit 1
fi

echo "done. vendored TradingView Advanced Charts at:"
echo "  ${DEST}"
