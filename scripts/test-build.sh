#!/bin/bash
# Testversion der Tauri-Ausgabe bauen (Mac-DMG). Windows baut GitHub Actions (Tauri kann Windows nicht vom Mac aus bauen).
#   bash scripts/test-build.sh
set -e
[ -f ~/SlimBit-Tools/env.sh ] && . ~/SlimBit-Tools/env.sh
cd "$(dirname "$0")/.."
npm ci --no-audit --no-fund >/dev/null
npm run typecheck >/dev/null
npm test >/dev/null
bash scripts/build-core.sh >/dev/null
npx tauri build --bundles app,dmg >/dev/null
# Kern so testen, wie er in der fertigen App liegt (dort ist er neu signiert – ohne JIT-Erlaubnis würde er abstürzen)
node test/smoke.cjs src-tauri/target/release/bundle/macos/SlimManager.app/Contents/MacOS/slimmanager-core >/dev/null
rm -rf test-build && mkdir -p test-build # alte Testversionen weg, damit nichts verwechselt wird
cp src-tauri/target/release/bundle/dmg/*.dmg test-build/SlimManager-Mac-Test.dmg
echo "Testversion fertig:"; ls -lh test-build | awk 'NR>1 {print "  " $9, $5}'
[ -z "$NO_OPEN" ] && open test-build || true
