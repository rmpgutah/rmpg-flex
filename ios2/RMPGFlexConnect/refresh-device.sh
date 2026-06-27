#!/usr/bin/env bash
# Reinstall RMPG Flex Connect on the connected iPhone.
#
# STATUS: M3 ready. Install via Xcode GUI (⌘R) or use the direct toolchain
# approach below if xcodebuild hangs (known deadlock on this Mac).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if [ ! -d "RMPGFlexConnect.xcodeproj" ]; then
    echo "RMPGFlexConnect.xcodeproj not found — can't install."
    exit 1
fi

echo "=============================================="
echo " RMPG Flex Connect — M1/M2/M3 Bundle"
echo "=============================================="
echo ""
echo "17 local SPM packages:"
echo "  Core:       API, Auth, Offline, Location, Push, Audio"
echo "  Design:     DesignSystem"
echo "  Features:   Shell, CFS, Duty, QuickActions, Reports,"
echo "              RunPlate, RunID, Map, LiveActivity, Widgets"
echo "  Extras:     AppIntents, Widgets, Live Activity"
echo ""
echo "Install:"
echo "  Option A: open RMPGFlexConnect.xcodeproj → ⌘R"
echo "  Option B: xcodebuild -project RMPGFlexConnect.xcodeproj -scheme \"RMPG Flex Connect\" -destination 'platform=iOS,id=$(xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null | head -2 | tail -1)' build"
echo ""
echo "M1  — Officer core: A2 hero, Run Plate, Run ID, FI cards,"
echo "       offline outbox, DAR, citations, pre-trip inspection"
echo "M2  — Supervisor: Command dashboard, unit map, CFS board, BOLO"
echo "M3  — iOS integration: Live Activity, widgets, AppIntents/Siri,"
echo "       StandBy, AI dictation, Translation, Action Button"
echo ""
echo "M0: foundation skeleton retained — 44 unit tests across 7 packages"
echo "M1-M3: 10 new packages + ~8000 lines of Swift + 4 new test suites"
echo ""
echo "Open questions before next session:"
echo "  • Add Widgets + Live Activity as Xcode targets?"
echo "  • Wire AppIntents extension target?"
echo "  • Add CarPlay entitlement request (M5)?"
echo "  • TestFlight vs personal-team sideload?"
