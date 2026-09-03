#!/bin/bash
# RMPG Flex — Set remaining Worker secrets
# Run this script and provide the values when prompted.
# These are integration secrets that need actual API key values.
#
# Usage: bash scripts/set-remaining-secrets.sh
# Or run individual lines manually.

set -e

ACCOUNT_ID="5caa95c5789f4fc4ed3934b2a2c29ed4"
WORKER="rmpg-flex-api"

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

echo "=== RMPG Flex Secret Setup ==="
echo "Worker: $WORKER"
echo "Account: $ACCOUNT_ID"
echo ""

# Helper function
set_secret() {
    local name="$1"
    local prompt="$2"
    echo -n "$prompt: "
    read -rs value
    echo ""
    if [ -n "$value" ]; then
        echo "$value" | wrangler secret put "$name" --name "$WORKER" 2>&1
        echo "  ✅ $name set"
    else
        echo "  ⏭️  $name skipped (empty)"
    fi
    echo ""
}

# --- Core Integration Secrets ---
echo "--- Core Integration Secrets ---"
echo ""

set_secret "ROBOFLOW_API_KEY" \
    "Roboflow API key (app.roboflow.com/settings/api)"

set_secret "MAPBOX_SECRET_TOKEN" \
    "Mapbox secret token (sk.ey... from account.mapbox.com/access-tokens/)"

set_secret "FLEETIO_API_KEY" \
    "Fleet.io API key (app.fleetio.com/settings/api_keys)"

set_secret "FLEETIO_ACCOUNT_TOKEN" \
    "Fleet.io Account Token (same page as API key)"

set_secret "FLEETIO_WEBHOOK_SECRET" \
    "Fleet.io webhook signing secret (optional, for inbound webhooks)"

set_secret "CARXE_API_KEY" \
    "CarsXE API key (carsxe.com)"

set_secret "LEGAL_DATA_HUNTER_API_KEY" \
    "Legal Data Hunter API key (legaldatahunter.com)"

set_secret "IPED_API_KEY" \
    "IPED API key (digital evidence)"

set_secret "FIRECRAWL_API_KEY" \
    "Firecrawl API key (firecrawl.dev)"

set_secret "RESEND_API_KEY" \
    "Resend API key (resend.com/api-keys)"

# --- Vehicle Enrichment ---
echo "--- Vehicle Enrichment APIs ---"
echo ""

set_secret "PLATE_TO_VIN_API_KEY" \
    "Plate-to-VIN API key (optional)"

set_secret "VIN_DECODER_API_KEY" \
    "VIN Decoder API key (optional)"

set_secret "PLATE_DECODER_API_KEY" \
    "Plate Decoder API key (optional)"

# --- GPS/Fleet Tracking ---
echo "--- GPS/Fleet Tracking ---"
echo ""

set_secret "TRACCAR_ENC_KEY" \
    "Traccar encryption key"

set_secret "CPG_ENC_KEY" \
    "ClearPathGPS encryption key"

# --- SSO/OIDC ---
echo "--- SSO/OIDC ---"
echo ""

set_secret "DIALER_OIDC_CLIENT_SECRET" \
    "Dialer OIDC client secret (paired with DIALER_OIDC_CLIENT_ID in wrangler.toml)"

# --- Other ---
echo "--- Other Secrets ---"
echo ""

set_secret "ALPR_EDGE_SECRET" \
    "ALPR edge detection secret"

set_secret "R2_SQL_TOKEN" \
    "R2 SQL token (analytics warehouse queries)"

set_secret "TURSO_AUTH_TOKEN" \
    "Turso auth token (turso.tech dashboard)"

set_secret "SERVE_INTAKE_LORA" \
    "Workers AI LoRA adapter (serve intake)"

# --- Optional ---
echo "--- Optional Secrets ---"
echo ""

set_secret "PDF_SIGNING_KEY" \
    "PDF signing key (optional, falls back to JWT_SECRET)"

set_secret "OPENCORPORATES_API_KEY" \
    "OpenCorporates API key (optional)"

set_secret "NUMVERIFY_API_KEY" \
    "NumVerify API key (optional)"

set_secret "GEMINI_API_KEY" \
    "Gemini API key (for deepsearch route)"

set_secret "BREACHDIRECTORY_API_KEY" \
    "BreachDirectory API key (for gosearch route, optional)"

echo ""
echo "=== Done! Verify with: ==="
echo "wrangler secret list --name rmpg-flex-api"
echo ""
echo "Then test: curl -sf https://api.rmpgutah.us/api/health"
