#!/bin/bash
# Richtet alle Werkzeuge für SlimBit-Apps EINMAL dauerhaft ein – ohne Admin-Rechte, nur im eigenen Benutzerordner.
#   bash scripts/setup-tools.sh            → ~/SlimBit-Tools (Node.js, ffmpeg, ffprobe, GitHub-CLI, Python-Pakete)
#   . ~/SlimBit-Tools/env.sh               → Werkzeuge im aktuellen Terminal benutzen
# Jeder Download wird mit der offiziellen Prüfsumme kontrolliert. Mehrfach ausführen ist ungefährlich.
set -e
T="$HOME/SlimBit-Tools"; mkdir -p "$T/bin"; cd "$T"
ARCH=$(uname -m); [ "$ARCH" = arm64 ] && NA=arm64 || NA=x64; [ "$ARCH" = arm64 ] && GA=arm64 || GA=amd64
NODE=v22.23.3; GH=2.102.0

if [ ! -x "$T/node/bin/node" ]; then
  F=node-$NODE-darwin-$NA.tar.gz
  curl -fsSLO "https://nodejs.org/dist/$NODE/$F"
  curl -fsSL "https://nodejs.org/dist/$NODE/SHASUMS256.txt" | grep " $F\$" | shasum -a 256 -c -
  tar xzf "$F" && rm "$F" && rm -rf node && mv "node-$NODE-darwin-$NA" node
fi
export PATH="$T/bin:$T/node/bin:$PATH"

if [ ! -x "$T/bin/gh" ]; then
  F=gh_${GH}_macOS_$GA.zip
  curl -fsSLO "https://github.com/cli/cli/releases/download/v$GH/$F"
  curl -fsSL "https://github.com/cli/cli/releases/download/v$GH/gh_${GH}_checksums.txt" | grep " $F\$" | shasum -a 256 -c -
  unzip -qo "$F" && cp "gh_${GH}_macOS_$GA/bin/gh" bin/gh && rm -rf "$F" "gh_${GH}_macOS_$GA"
fi

if [ ! -x "$T/bin/ffmpeg" ]; then
  mkdir -p media && (cd media && [ -f package.json ] || npm init -y >/dev/null) && (cd media && npm i --no-audit --no-fund ffmpeg-static@5 ffprobe-static@3 >/dev/null)
  ln -sf "$T/media/node_modules/ffmpeg-static/ffmpeg" bin/ffmpeg
  ln -sf "$T/media/node_modules/ffprobe-static/bin/darwin/$NA/ffprobe" bin/ffprobe
fi

python3 -m pip install --user -q numpy pillow 2>/dev/null || true
python3 -m pip install --user -q --only-binary :all: pocketsphinx 2>/dev/null || true

cat > "$T/env.sh" <<EOF
export PATH="$T/bin:$T/node/bin:\$PATH"
EOF
echo "Fertig: $(node -v) · $(ffmpeg -version | head -1 | cut -d' ' -f1-3) · $(gh --version | head -1)"
gh auth status >/dev/null 2>&1 && echo "GitHub: angemeldet" || echo "GitHub: noch nicht angemeldet → einmal ausführen:  ~/SlimBit-Tools/bin/gh auth login --web --git-protocol https"
