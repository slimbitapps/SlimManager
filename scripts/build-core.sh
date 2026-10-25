#!/bin/bash
# Baut den SlimManager-Kern als EIN eigenständiges Programm (Node "Single Executable Application"):
# Kern + Node-Laufzeit in einer Datei → auf dem PC der Nutzer muss nichts installiert sein.
#   bash scripts/build-core.sh            → src-tauri/binaries/slimmanager-core-<plattform>
set -e
[ -f ~/SlimBit-Tools/env.sh ] && . ~/SlimBit-Tools/env.sh
cd "$(dirname "$0")/.."
TRIPLE=${TRIPLE:-$(rustc -vV | awk '/host:/ {print $2}')}
EXT=""; [[ $TRIPLE == *windows* ]] && EXT=".exe"
OUT="src-tauri/binaries/slimmanager-core-$TRIPLE$EXT"
mkdir -p build-core src-tauri/binaries

# 1. Alles in eine JavaScript-Datei packen (optionale Zusatz-Module, die es nicht gibt, bleiben draußen)
npx esbuild core/main.cjs --bundle --platform=node --target=node22 --format=cjs --outfile=build-core/core.cjs \
  --external:osx-temperature-sensor --external:bufferutil --external:utf-8-validate --log-level=warning

# 2. Daraus ein "Blob" machen und in eine Kopie der Node-Laufzeit einsetzen
cat > build-core/sea.json <<JSON
{ "main": "build-core/core.cjs", "output": "build-core/core.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false }
JSON
node --experimental-sea-config build-core/sea.json >/dev/null
rm -f "$OUT"
# Node-Laufzeit kopieren (über Node selbst – funktioniert auch mit Windows-Pfaden in Git-Bash)
node -e "require('fs').copyFileSync(process.execPath, process.argv[1])" "$OUT"
chmod u+w "$OUT"
if [ "$(uname)" = Darwin ]; then codesign --remove-signature "$OUT"; fi
MACHO=""; [ "$(uname)" = Darwin ] && MACHO="--macho-segment-name NODE_SEA"
npx postject "$OUT" NODE_SEA_BLOB build-core/core.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 $MACHO >/dev/null
if [ "$(uname)" = Darwin ]; then codesign --sign - "$OUT"; fi
echo "Kern fertig: $OUT ($(du -h "$OUT" | cut -f1))"
