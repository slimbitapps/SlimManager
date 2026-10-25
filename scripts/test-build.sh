#!/bin/bash
# Baut eine Testversion für Mac (DMG, startet sofort ohne Gatekeeper-Warnung, weil lokal gebaut)
# und Windows (portable ZIP) – ohne GitHub. Ergebnis in test-build/, Finder öffnet den Ordner.
#   bash scripts/test-build.sh
set -e
[ -f ~/SlimBit-Tools/env.sh ] && . ~/SlimBit-Tools/env.sh
cd "$(dirname "$0")/.."
APP=$(node -p "require('./package.json').productName")
ARCH=$(uname -m); [ "$ARCH" = arm64 ] && A=--arm64 || A=--x64
npm ci --no-audit --no-fund >/dev/null
npm run typecheck >/dev/null
npm test >/dev/null
npx vite build >/dev/null
rm -rf release test-build && mkdir test-build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg $A -c.mac.identity=null --publish never >/dev/null
npx electron-builder --win zip --x64 --publish never >/dev/null
mv release/*.dmg "test-build/$APP-Mac-Test.dmg"
mv release/*portable.zip "test-build/$APP-Windows-Test.zip"
rm -rf release
echo "Testversion fertig:"; ls -lh test-build | awk 'NR>1 {print "  " $9, $5}'
[ -z "$NO_OPEN" ] && open test-build || true
