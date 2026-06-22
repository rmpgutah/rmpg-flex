#!/usr/bin/env bash
# Reinstall RMPG Flex Connect on the connected iPhone.
#
# STATUS: M0 stub. Not yet usable because:
#   1. RMPGFlexConnect.xcodeproj doesn't exist until M0/Task 6 lands.
#   2. xcodebuild deadlocks on the operator's Mac (see ios/README.md:77-87) —
#      once provisioning is set up, this will be rewritten to follow the
#      swiftc + manual-bundle + codesign pattern from ios/refresh-device.sh.
#
# For now, install via Xcode GUI: open RMPGFlexConnect.xcodeproj, plug in the
# iPhone, and press Cmd-R.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if [ ! -d "RMPGFlexConnect.xcodeproj" ]; then
    echo "RMPGFlexConnect.xcodeproj not found — run after M0/Task 6."
    exit 1
fi

echo "refresh-device.sh is an M0 stub. Use Xcode GUI Cmd-R to install."
echo ""
echo "Once provisioning is set up (post-M1), this will be rewritten to mirror"
echo "ios/refresh-device.sh — swiftc + manual bundle + codesign + devicectl install,"
echo "bypassing the xcodebuild deadlock documented in ios/README.md:77-87."
exit 2
