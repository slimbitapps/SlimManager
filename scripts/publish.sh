#!/bin/bash
# Veröffentlicht die App komplett auf GitHub – nach dem „Go“ des Nutzers:
#   1. Repository slimbitapps/<App> anlegen (falls nötig, öffentlich) und alles hochladen
#   2. GitHub Pages auf „GitHub Actions“ stellen und die Download-Seite bauen lassen
#   3. Startseite slimbitapps.github.io aktualisieren (Ordner als 1. Argument, optional)
#   4. Warten, bis Installer gebaut sind, und prüfen, dass alle 4 Dateien am Release hängen
#   bash scripts/publish.sh [PFAD-ZUR-STARTSEITE]
# Voraussetzung (einmalig): ~/SlimBit-Tools/bin/gh auth login --web --git-protocol https
set -e
[ -f ~/SlimBit-Tools/env.sh ] && . ~/SlimBit-Tools/env.sh
cd "$(dirname "$0")/.."
OWNER=slimbitapps
APP=$(node -p "require('./package.json').productName")
REPO=$OWNER/$APP
gh auth status >/dev/null 2>&1 || { echo "Nicht bei GitHub angemeldet. Einmal ausführen: gh auth login --web --git-protocol https"; exit 1; }
gh auth setup-git >/dev/null

# 1. Repository + Push
if gh repo view "$REPO" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$REPO.git"
else
  gh repo create "$REPO" --public --source . --remote origin --description "$(node -p "require('./package.json').description")"
fi
git push -u origin main

# 2. Pages (Quelle: GitHub Actions) + Download-Seite bauen
gh api -X POST "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || gh api -X PUT "repos/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh workflow run pages.yml -R "$REPO" >/dev/null 2>&1 || true
gh repo edit "$REPO" --homepage "https://$OWNER.github.io/$APP/" >/dev/null

# 3. Startseite
if [ -n "$1" ] && [ -d "$1/.git" ]; then (cd "$1" && git push) && echo "Startseite hochgeladen"; fi

# 4. Installer abwarten und prüfen
echo "Warte auf die Installer (ca. 15 Minuten) …"
sleep 20
RUN=$(gh run list -R "$REPO" -w "Installer bauen" -L 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN" -R "$REPO" --exit-status >/dev/null || { echo "Build fehlgeschlagen: https://github.com/$REPO/actions/runs/$RUN"; exit 1; }
V=$(node -p "require('./package.json').version")
gh release view "v$V" -R "$REPO" --json assets -q '.assets[].name' | sort
for f in "$APP-Setup.exe" "$APP-Mac.dmg" "$APP-Mac-Intel.dmg" "$APP-Windows-portable.zip"; do
  code=$(curl -sL -o /dev/null -r 0-0 -w "%{http_code}" "https://github.com/$REPO/releases/latest/download/$f")
  [ "$code" = 206 ] || [ "$code" = 200 ] || { echo "FEHLT: $f"; exit 1; }
done
code=$(curl -s -o /dev/null -w "%{http_code}" "https://$OWNER.github.io/$APP/")
echo "Download-Seite: https://$OWNER.github.io/$APP/ ($code)"
echo "Alles veröffentlicht ✓"
