#!/usr/bin/env bash
# Render all automated teaser material. Real Sepolia transactions are sent.
# Needs: vhs, playwright chromium; env ALCHEMY_API_KEY, TCTC_ADMIN_PRIVATE_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${ALCHEMY_API_KEY:?set ALCHEMY_API_KEY}"
: "${TCTC_ADMIN_PRIVATE_KEY:?set TCTC_ADMIN_PRIVATE_KEY}"

mkdir -p video/out

echo "== 0/5 reset on-chain state (burn leftover certs)"
node video/reset-state.mjs

echo "== 1/5 scene 2: grant (VHS, real tx)"
vhs video/tapes/02-grant.tape

echo "== 2/5 scene 3: revoke / kill switch (VHS, real tx)"
vhs video/tapes/03-revoke.tape

echo "== 3/5 scene 5: agent denied (VHS)"
vhs video/tapes/05-denied.tape

echo "== 4/5 title cards (Playwright)"
node video/record-titles.mjs

echo "== 5/5 Etherscan scene (Playwright)"
node video/record-etherscan.mjs || echo "WARN: Etherscan scene missing; compose.sh will skip it"

echo "done. now run video/compose.sh"
