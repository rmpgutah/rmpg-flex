#!/bin/bash
set -euo pipefail

SCHEME="RMPGFlexConnect"
PROJECT="project.yml"
ARCHIVE_PATH="./build/RMPGFlexConnect.xcarchive"
EXPORT_PATH="./build/export"
IPA_PATH="$EXPORT_PATH/RMPGFlexConnect.ipa"
OTA_BASE="https://rmpgutah.us/ios/ota"
TEAM_ID="${APPLE_TEAM_ID:-}"
BUNDLE_ID="com.rmpg.flex.connect"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OTA]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

mkdir -p build

if [ -z "$TEAM_ID" ]; then
    warn "APPLE_TEAM_ID not set — will use automatic signing"
fi

if [ ! -f "$PROJECT" ]; then
    warn "project.yml not found — running xcodegen generate"
    if ! command -v xcodegen &>/dev/null; then
        err "xcodegen not found. Install: brew install xcodegen"
    fi
    xcodegen generate
fi

log "Archiving $SCHEME..."
xcodebuild archive \
    -scheme "$SCHEME" \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    -configuration Release \
    -allowProvisioningUpdates \
    ${TEAM_ID:+-developmentTeam "$TEAM_ID"} \
    CODE_SIGN_STYLE=Automatic \
    | xcpretty || true

if [ ! -d "$ARCHIVE_PATH" ]; then
    err "Archive failed — no .xcarchive produced"
fi

log "Exporting IPA..."
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_PATH" \
    -exportOptionsPlist <(cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>enterprise</string>
    <key>teamID</key>
    <string>${TEAM_ID}</string>
    <key>compileBitcode</key>
    <false/>
    <key>uploadSymbols</key>
    <true/>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST
) | xcpretty || true

if [ ! -f "$IPA_PATH" ]; then
    err "Export failed — no .ipa produced"
fi

log "IPA exported: $IPA_PATH"
IPA_SIZE=$(du -h "$IPA_PATH" | cut -f1)
log "IPA size: $IPA_SIZE"

if command -v xcrun &>/dev/null; then
    log "Verifying IPA signature..."
    xcrun codesign -d --verbose=4 "$IPA_PATH" 2>/dev/null | head -3 || warn "Could not verify signature"
fi

log ""
log "Wireless OTA install URL:"
log "  itms-services://?action=download-manifest&url=$OTA_BASE/manifest.plist"
log ""
log "To deploy, upload these files to your web server:"
log "  1. $IPA_PATH → $OTA_BASE/RMPGFlexConnect.ipa"
log "  2. OTA/manifest.plist → $OTA_BASE/manifest.plist (update __IPA_URL__)"
log "  3. OTA/index.html → $OTA_BASE/index.html"
log ""
log "Test the install page: https://rmpgutah.us/ios/ota/"
