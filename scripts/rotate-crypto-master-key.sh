#!/usr/bin/env bash
# ============================================================
# RMPG Flex — Crypto master-key rotation helper
# ------------------------------------------------------------
# Re-wraps every crypto_identities secret half from the OLD
# RMPG_PQ_MASTER_KEY to the NEW one via POST /api/crypto/rotate-master-key.
#
# Prerequisites:
#   1. The NEW RMPG_PQ_MASTER_KEY is already set in the Worker secret
#      store:  `wrangler secret put RMPG_PQ_MASTER_KEY` (and deployed).
#   2. You have an admin JWT for the live API.
#   3. The crypto_identities table exists (migration 0206 applied, or
#      route boot-reconciled — either is fine).
#
# Usage:
#   scripts/rotate-crypto-master-key.sh <admin_jwt> <old_key_base64> [api_base]
#
#   admin_jwt       — a valid admin role JWT
#   old_key_base64  — the PREVIOUS RMPG_PQ_MASTER_KEY (base64, 32 bytes)
#   api_base        — optional; defaults to https://api.rmpgutah.us
#
# After a 200 response, the old key can be destroyed. If the rotation
# fails (wrong old key, D1 batch error), the table is left intact under
# the OLD key — destroy nothing until you see {"ok":true,...}.
#
# Exit codes:
#   0  rotation succeeded
#   1  bad args / missing deps
#   2  API returned non-200
# ============================================================
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <admin_jwt> <old_key_base64> [api_base]" >&2
  exit 1
fi

JWT="$1"
OLD_KEY="$2"
API_BASE="${3:-https://api.rmpgutah.us}"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required (brew install jq)" >&2
  exit 1
fi

PAYLOAD=$(jq -nc --arg old "$OLD_KEY" '{oldKey: $old}')

echo "→ Rotating crypto master key at ${API_BASE}/api/crypto/rotate-master-key ..."
RESP=$(curl -sS -w '\n%{http_code}' \
  -X POST "${API_BASE}/api/crypto/rotate-master-key" \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD") || { echo "curl failed" >&2; exit 2; }

HTTP_CODE=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "Rotation FAILED (HTTP ${HTTP_CODE}):" >&2
  echo "$BODY" >&2
  exit 2
fi

echo "$BODY" | jq .
echo "✓ Rotation complete. The old RMPG_PQ_MASTER_KEY can now be destroyed."