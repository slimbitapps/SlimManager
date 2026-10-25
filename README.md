# SlimManager – the modern task manager for gamers

**A good-looking, fully customizable task manager for Windows & Mac – with Game Boost and live stats on your phone or tablet.**
Free · no ads · no account · no cloud · scan a QR code and your phone becomes a second screen.

⬇️ **[Download SlimManager](https://slimbitapps.github.io/SlimManager/)** · by [SlimBit Apps](https://slimbitapps.github.io/)

## Why SlimManager?

- **Your dashboard, your style** – drag & drop widgets (gauges, graphs, bars, big numbers, top processes, clock, network, drives, CPU cores, PC info, battery, custom text). Pick size, color and title for each.
- **6 skins** – Neon, Glass, Clean, Retro (looks like Windows back in the day), Terminal, Sunset. Backgrounds (Aurora, Space, Synthwave, Waves, Carbon) or **your own image**, accent color, corner radius, fonts, animated RGB border.
- **On your phone or tablet** – scan the QR code (or type the address + 6-digit PIN). No app install. Your phone gets its own layout; a tablet makes a perfect second screen.
- **Control from your phone** – end tasks, change priority, start Game Boost, toggle the overlay.
- **Game Boost** – one click (or Ctrl+Shift+B, or automatically when a game starts): game gets priority, background ballast is frozen, CPU cores are kept free for the game, power plan "High performance", RAM freed, optional pause of Windows Update. A "never touch" list keeps headset software, Discord, music & OBS running. Everything is reset afterwards – even after a crash – with an honest before/after measurement.
- **Focus mode for work** – freeze background clutter, turbo off (cooler, quieter fans), pause Windows Update, close distracting apps.
- **Zero load while gaming** – SlimManager draws without the graphics card; smooth, animated values only while you look at it, power-saving automatically as soon as a game runs.
- **Clean up** – close background programs you don't need in one go. System processes are protected.
- **Tap any tile** for a detail view: big graph, min/average/peak and which apps use the most (CPU, RAM, GPU per app on Windows).
- **Edit the dashboard on your phone or iPad**, too. **Start with the computer**, **power-hog alerts**, live display of SlimManager's own usage.
- **Fullscreen** (F11) – perfect as a second-screen dashboard. **Mini overlay** – a small always-on-top stats bar (Ctrl+Shift+O).
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
| **Boost** | 🎮 Gaming: Spiel wählen → Boost (auch automatisch, Strg+Shift+B). 💼 Fokus: zum Arbeiten – leise, ohne Updates. Listen „Nie anfassen“, „Einfrieren“, „Schließen“ |
| **Handy & Tablet** | QR-Code scannen oder Adresse + PIN eintippen. Eigenes Handy-Layout, Rechte (nur ansehen / steuern) |

## Ehrlich gesagt

- **Temperaturen** geben Windows und macOS oft nur mit Admin-Rechten oder Zusatz-Treibern frei. NVIDIA-Karten liefern sie trotzdem.
  Fehlt ein Wert, tauscht das Standard-Layout die Kachel automatisch gegen einen vorhandenen Wert.
- **Boost am Mac:** Ohne Admin-Rechte darf eine App andere nur bremsen, nicht hochstufen, und keine Energiepläne ändern.
  SlimManager nutzt dafür den Hintergrund-Modus von macOS (`taskpolicy`) und friert per SIGSTOP ein – beides sauber umkehrbar.
- **Einfrieren** passiert automatisch nur bei bekanntem Ballast (Updater, Cloud-Sync, Absturz-Melder, Telemetrie). Anti-Cheat und
  Spiele-Launcher werden nie angefasst. Ein Wächter-Prozess taut alles auf, falls SlimManager abstürzt; Reste holt der nächste Start nach.
- **Leistung:** SlimManager zeichnet ohne Grafikkarte. Gemessen: ca. 0,5 % eines CPU-Kerns im Sparmodus, 2–5 % im flüssigen Modus (nur wenn man hinschaut).
- **FPS** gibt es noch nicht (siehe Plan, Version 2).

## Sicherheit

- QR-Code mit **Einmal-Code** im `#`-Teil der Adresse (wird nie übers WLAN gesendet) – oder **6-stellige PIN**, die nach jedem Fehlversuch wechselt.
- Daraus leiten Handy und PC einen **Geräte-Schlüssel** ab (nie übertragen). **Jeder Befehl ist signiert und nummeriert** (HMAC-SHA256).
- Weitere Geräte müssen **am PC zugelassen** werden. „Handy darf steuern“ lässt sich ausschalten (nur ansehen).
- Nur Geräte aus dem **lokalen Netz**, nur IP-Adressen als Host (Schutz vor DNS-Rebinding), Sperre nach 5 Fehlversuchen.
- **Systemprozesse sind geschützt** – weder am PC noch vom Handy beendbar oder bremsbar.

---

## Stand der Entwicklung

**Version 1.0** – Dashboard mit 10 Widget-Arten und 5 Darstellungen (Ring, Tacho mit Zeiger, Balken, Verlauf, Zahl), flüssige Werte
(1–4× pro Sekunde, Zähl-Effekt, Nachkommastellen), Vollbild, Boost 2.0 (Gaming + Fokus, Einfrieren, Kerne, Energieplan, Dienste, Ausnahmen), Drag & Drop, 6 Skins, Hintergründe + eigenes Bild,
Layouts teilen, Prozesse (gruppiert/einzeln, Symbole, beenden, Priorität, Aufräumen), Game Boost (manuell/automatisch/Tastenkürzel,
Schließ-Liste, eigene Spiele, Zusammenfassung), Handy/Tablet (QR + PIN, eigenes Layout, Steuern, Zustimmung), Mini-Anzeige,
Warnungen, Taskleisten-Symbol, Deutsch/Englisch, hell/dunkel, Einfach/Profi.

**Als Nächstes:** siehe [docs/PLAN.md](docs/PLAN.md).

---

## Für Entwickler

Technik: [Tauri 2](https://tauri.app) (schlanke Rust-Hülle: Fenster, Taskleiste, Tastenkürzel – nutzt das im System eingebaute WebView),
ein eigener Kern in Node.js (Messwerte, Prozesse, Boost, Handy-Server – als einzelne Programmdatei mitgeliefert),
React + TypeScript (PC-Fenster **und** Handy-Seite – gleiche Widgets), Vite.
Oberfläche und Kern sprechen über einen WebSocket nur auf `127.0.0.1` mit geheimem Token.

```bash
npm install
WITH_RUST=1 bash scripts/setup-tools.sh   # einmalig: Rust für Tauri (kostenlos, ohne Konto)
npm start            # App bauen und starten (Tauri-Entwicklermodus)
npm test             # Logik- und Sicherheitstests
npm run test:e2e     # echten Kern + Oberfläche automatisch durchklicken (inkl. Handy-Fenster, Screenshots)
npm run icons        # Logo und Symbole neu erzeugen
npm run dist         # fertige App bauen (Kern-Programm + Tauri-Installer)
bash scripts/test-build.sh   # Testversion: Mac-DMG (Windows baut GitHub Actions)
```

Aufbau:
- `core/lib/` – Logik ohne Oberfläche: Messwerte (`monitor.cjs`), Prozesse & Prioritäten (`procs.cjs`), Boost (`boost.cjs`),
  Systemeingriffe mit Rückweg (`tweaks.cjs`, Wächter `watchdog.cjs`),
  Server (`server.cjs`), Kopplung (`auth.cjs`), Netzwerk, Einstellungen, Layout-Prüfung (`layout.cjs`)
- `core/main.cjs` – der Kern: verbindet alles, RPC für die Oberfläche (`scripts/build-core.sh` macht daraus ein Programm)
- `src-tauri/` – Tauri-Hülle (Rust): Fenster, Mini-Anzeige, Taskleiste, Tastenkürzel, startet/beendet den Kern
- `src/api.ts` – Verbindung Oberfläche ↔ Kern
- `src/shared/` – Widgets, Dashboard, Skins (`dashboard.css`) – von PC-Fenster und Handy gemeinsam genutzt
- `src/components/` – PC-Fenster (React), Texte in `src/locales/`
- `src/remote/` – Handy-Seite · `src/overlay/` – Mini-Anzeige
- `test/` – automatische Tests (Electron dient dort nur als Test-Browser, nicht Teil der App) · `brand/` – Logo · `website/` – Download-Seite

Installer werden per GitHub Actions gebaut (`.github/workflows/build.yml`) – nur bei Code-Änderungen.
