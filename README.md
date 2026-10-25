# SlimManager – the modern task manager for gamers

**A good-looking, fully customizable task manager for Windows & Mac – with Game Boost and live stats on your phone or tablet.**
Free · no ads · no account · no cloud · scan a QR code and your phone becomes a second screen.

⬇️ **[Download SlimManager](https://slimbitapps.github.io/SlimManager/)** · by [SlimBit Apps](https://slimbitapps.github.io/)

## Why SlimManager?

- **Your dashboard, your style** – drag & drop widgets (gauges, graphs, bars, big numbers, top processes, clock, network, drives, CPU cores, PC info, battery, custom text). Pick size, color and title for each.
- **6 skins** – Neon, Glass, Clean, Retro (looks like Windows back in the day), Terminal, Sunset. Backgrounds (Aurora, Space, Synthwave, Waves, Carbon) or **your own image**, accent color, corner radius, fonts, animated RGB border.
- **On your phone or tablet** – scan the QR code (or type the address + 6-digit PIN). No app install. Your phone gets its own layout; a tablet makes a perfect second screen.
- **Control from your phone** – end tasks, change priority, start Game Boost, toggle the overlay.
- **Game Boost** – one click (or Ctrl+Shift+B, or automatically when a game starts): game gets priority, background apps step back, apps from your list are closed. Everything is reset afterwards – with a summary.
- **Clean up** – close background programs you don't need in one go. System processes are protected.
- **Mini overlay** – a small always-on-top stats bar (Ctrl+Shift+O) over games in borderless mode.
- **Alerts** when your PC gets too hot or memory runs full · share layouts as a file · English & German · light/dark · simple & pro mode.

## Install

- **Windows 10/11:** download `SlimManager-Setup.exe` and double-click it. No admin rights? Use `SlimManager-Windows-portable.zip`.
- **Mac (macOS 12+):** open `SlimManager-Mac.dmg` (Intel: `SlimManager-Mac-Intel.dmg`) and drag SlimManager into Applications.

---

# SlimManager (Deutsch)

Der moderne Task-Manager für Gamer – für Windows und Mac. Komplett anpassbar, mit Game Boost und Live-Werten aufs Handy.

**Alles bleibt lokal.** Keine Datensammlung, kein Konto, kein Internet nötig.

## Installieren

**Am einfachsten über die [Download-Seite](https://slimbitapps.github.io/SlimManager/)** – sie erkennt dein System.

- **Windows:** `SlimManager-Setup.exe` doppelklicken. Beim ersten Start fragt die Firewall → **„Zugriff zulassen“** (nur nötig für die Handy-Anzeige).
- **Mac:** `SlimManager-Mac.dmg` öffnen, Symbol auf „Programme“ ziehen.

## So funktioniert's

Beim ersten Start: **Sprache**, **hell/dunkel**, **Skin**, **Bedienung** (Einfach/Profi), kurze Tour.

| Bereich | Was du dort machst |
|---|---|
| **Dashboard** | Live-Werte. „Anpassen“: Widgets hinzufügen, ziehen, Größe/Farbe/Darstellung wählen. „Aussehen“: Skin, Hintergrund, eigenes Bild |
| **Prozesse** | Apps statt hunderter Prozesse, sortieren, suchen, beenden, Priorität ändern, „Aufräumen“ |
| **Game Boost** | Spiel wählen → Boost. Automatisch beim Spielstart, Tastenkürzel, Liste „Beim Boost schließen“ |
| **Handy & Tablet** | QR-Code scannen oder Adresse + PIN eintippen. Eigenes Handy-Layout, Rechte (nur ansehen / steuern) |

## Ehrlich gesagt

- **Temperaturen** geben Windows und macOS oft nur mit Admin-Rechten oder Zusatz-Treibern frei. NVIDIA-Karten liefern sie trotzdem.
  Fehlt ein Wert, tauscht das Standard-Layout die Kachel automatisch gegen einen vorhandenen Wert.
- **Game Boost am Mac:** Ohne Admin-Rechte darf eine App andere nur bremsen, nicht hochstufen. SlimManager nutzt dafür den
  Hintergrund-Modus von macOS (`taskpolicy`), der sich danach sauber wieder aufheben lässt.
- **FPS** gibt es noch nicht (siehe Plan, Version 2).

## Sicherheit

- QR-Code mit **Einmal-Code** im `#`-Teil der Adresse (wird nie übers WLAN gesendet) – oder **6-stellige PIN**, die nach jedem Fehlversuch wechselt.
- Daraus leiten Handy und PC einen **Geräte-Schlüssel** ab (nie übertragen). **Jeder Befehl ist signiert und nummeriert** (HMAC-SHA256).
- Weitere Geräte müssen **am PC zugelassen** werden. „Handy darf steuern“ lässt sich ausschalten (nur ansehen).
- Nur Geräte aus dem **lokalen Netz**, nur IP-Adressen als Host (Schutz vor DNS-Rebinding), Sperre nach 5 Fehlversuchen.
- **Systemprozesse sind geschützt** – weder am PC noch vom Handy beendbar oder bremsbar.

---

## Stand der Entwicklung

**Version 1.0** – Dashboard mit 10 Widget-Arten und 4 Darstellungen, Drag & Drop, 6 Skins, Hintergründe + eigenes Bild,
Layouts teilen, Prozesse (gruppiert/einzeln, Symbole, beenden, Priorität, Aufräumen), Game Boost (manuell/automatisch/Tastenkürzel,
Schließ-Liste, eigene Spiele, Zusammenfassung), Handy/Tablet (QR + PIN, eigenes Layout, Steuern, Zustimmung), Mini-Anzeige,
Warnungen, Taskleisten-Symbol, Deutsch/Englisch, hell/dunkel, Einfach/Profi.

**Als Nächstes:** siehe [docs/PLAN.md](docs/PLAN.md).

---

## Für Entwickler

Technik: Electron (Fenster, Server, Prozesse), React + TypeScript (PC-Fenster **und** Handy-Seite – gleiche Widgets), Vite,
[systeminformation](https://github.com/sebhildebrandt/systeminformation) für die Messwerte.

```bash
npm install
npm start            # App bauen und starten
npm test             # Logik- und Sicherheitstests
npm run test:e2e     # echte App automatisch durchklicken (inkl. Handy-Fenster, Screenshots)
npm run icons        # Logo und Symbole neu erzeugen
bash scripts/test-build.sh   # Testversion: Mac-DMG + Windows-ZIP
```

Aufbau:
- `electron/core/` – Logik ohne Oberfläche: Messwerte (`monitor.cjs`), Prozesse & Prioritäten (`procs.cjs`), Game Boost (`boost.cjs`),
  Server (`server.cjs`), Kopplung (`auth.cjs`), Netzwerk, Einstellungen, Layout-Prüfung (`layout.cjs`)
- `electron/main.cjs` – Fenster, Mini-Anzeige, Taskleiste, Tastenkürzel, Verbindung zur Oberfläche
- `src/shared/` – Widgets, Dashboard, Skins (`dashboard.css`) – von PC-Fenster und Handy gemeinsam genutzt
- `src/components/` – PC-Fenster (React), Texte in `src/locales/`
- `src/remote/` – Handy-Seite · `src/overlay/` – Mini-Anzeige
- `test/` – automatische Tests · `brand/` – Logo · `website/` – Download-Seite

Installer werden per GitHub Actions gebaut (`.github/workflows/build.yml`) – nur bei Code-Änderungen.
