# Plan – SlimManager

## Name

**SlimManager** – passt zur Marke (Slim…) und sagt sofort, was es ist (Task-**Manager**). Eine Suche fand keine
Software mit diesem Namen (nur „SlimTimer“ und „SlimCleaner“, andere Bereiche). Vor der Veröffentlichung kurz im
DPMA-Register (`register.dpma.de`) nach „SlimManager“ für Software (Klasse 9) suchen.

## Was es schon gibt – und was SlimManager besser macht

| Tool | Stärke | Schwäche |
|---|---|---|
| Windows Task-Manager / Aktivitätsanzeige (Mac) | Immer da | Sieht „knochig“ aus, nicht anpassbar, kein Handy, kein Boost |
| Process Explorer, Process Lasso | Sehr mächtig | Für Profis, altmodisch, Lasso-Pro kostet Geld |
| MSI Afterburner + RivaTuner | FPS-Overlay | Kompliziert, nur Windows, altes Design |
| NZXT CAM, Razer Cortex | Gamer-Look, Boost | Konto nötig, Werbung/Hersteller-Bindung, schwer |
| Rainmeter | Sehr anpassbar | Nur Windows, Skins basteln ist mühsam, kein Prozess-Management |
| Zal, PC HW Monitor, Remote System Monitor | Werte aufs Handy | Eigene Handy-App nötig, oft nur Android, teils kostenpflichtig |
| Stats, iStat Menus (Mac) | Schöne Werte in der Menüleiste | Kein Prozess-Management, kein Handy, iStat kostet Geld |

**SlimManager:** alles in einem – schöner, komplett anpassbarer Task-Manager **+** Game Boost **+** Handy/Tablet als
Zweitbildschirm und Fernbedienung **ohne App-Download** (QR-Code oder Adresse + PIN). Windows **und** Mac, kostenlos,
kein Konto, keine Werbung, alles lokal.

## Version 1.0 (fertig)

- Live-Werte: CPU (gesamt + Kerne + Takt), RAM, Auslagerung, GPU (Windows alle Hersteller, NVIDIA mit Temperatur, Mac über ioreg),
  Grafikspeicher, Netzwerk, Festplatte, Laufwerke, Akku, Prozessanzahl, Laufzeit, Temperaturen (wo das System sie freigibt)
- Dashboard: 10 Widget-Arten, Darstellung Tacho/Balken/Verlauf/Zahl, 6 Größen, Farbe, Titel, Drag & Drop, fertige Layouts
  (Gamer, Klassisch, Minimal, Streamer, Handy), Layout als Datei teilen
- Aussehen: 6 Skins (Neon, Glas, Clean, Retro, Terminal, Sunset), 6 Hintergründe + eigenes Bild (abdunkeln, weichzeichnen),
  Akzentfarbe, Deckkraft, Ecken, Schrift, RGB-Rand, Animationen
- Prozesse: nach App gruppiert oder einzeln (Profi), Programm-Symbole, Filter (Apps/Spiele/Hintergrund/System), Suche, Sortieren,
  beenden (mit Rückfrage), Priorität, im Ordner zeigen, „Aufräumen“ (mehrere auf einmal), Systemprozesse geschützt
- Leistung: keine Grafikkarte, Spar-Automatik beim Zocken, Pause wenn unsichtbar, Messungen nur bei Bedarf (test/perf.cjs)
- Flüssige Anzeige: 1/2/4× pro Sekunde, Zähl-Effekt, Nachkommastellen, Tacho mit Zeiger, Leuchten, Spitzenwert; Vollbild (F11, Zweitmonitor)
- Boost 2.0: Gaming + Fokus, Ausnahmen („Nie anfassen“), Einfrieren (Ballast + eigene Liste), CPU-Kerne freihalten, Energieplan,
  RAM freigeben, Windows-Update & Co. pausieren (Admin), Wirkung vorher/nachher, absturzsicher (Wächter + undo.json)
- Detail-Ansicht beim Antippen einer Kachel (PC + Handy), GPU pro App (Windows) + Sortieren, Dashboard am Handy/iPad bearbeiten,
  eigener Verbrauch sichtbar, Autostart, Warnung bei Leistungsfressern, sparsamer Windows-Mess-Helfer (statt WMI)
- Game Boost: Spiel-Erkennung (Steam, Epic, Riot, GOG, EA, Ubisoft, Xbox, Battle.net, Minecraft, Roblox + eigene Liste),
  manuell / automatisch / Tastenkürzel, Spiel hochstufen, andere bremsen (Mac: Hintergrund-Modus), Schließ-Liste,
  sauberes Zurücksetzen, Zusammenfassung nach der Runde
- Handy & Tablet: QR-Code oder Adresse + PIN, eigenes Handy-Layout (im selben Editor), Prozesse & Boost steuern,
  Mini-Anzeige schalten, Vollbild, Bildschirm anlassen, Rechte „nur ansehen“, Zustimmung für weitere Geräte
- Mini-Anzeige (immer im Vordergrund), Warnungen (Temperatur/RAM), Taskleisten-Symbol, im Hintergrund weiterlaufen
- Deutsch/Englisch, hell/dunkel, Einfach/Profi, Einführung beim ersten Start

## Tauri-Ausgabe (Zweig "tauri")

- Hülle in Rust (src-tauri/), Kern als eigenständiges Programm (core/main.cjs → scripts/build-core.sh), Oberfläche unverändert
- Gemessen (Mac, fertige App): ca. 220 MB statt 480 MB, DMG 39 MB statt 107 MB, CPU im Vordergrund ca. 2–3 % eines Kerns
- Noch offen: Windows-Build (geht nur auf Windows bzw. GitHub Actions), Mini-Anzeige/Taskleiste/Tastenkürzel von Hand prüfen,
  danach Electron-Teile entfernen

## Noch auf echtem Windows zu prüfen (konnte am Mac nicht getestet werden)

- Einfrieren/Auftauen über den PowerShell-Helfer (NtSuspendProcess), CPU-Kerne, RAM freigeben
- Energieplan „Höchstleistung“ und „Turbo aus“ – und dass beides nach dem Boost wieder stimmt
- Admin-Helfer für Windows-Update & Co. (eine UAC-Abfrage, Dienste starten danach wieder)
- GPU-Auslastung (alle Hersteller) und NVIDIA-Temperatur, GPU pro App (Leistungsindikatoren / nvidia-smi pmon)
- Neuer Mess-Helfer (Prozessliste über .NET, netstat) – eigener Verbrauch sollte unter 1 % liegen

## Version 2 – Ideen (nach Wichtigkeit)

1. **FPS-Anzeige** über Intels PresentMon (Open Source, Windows) – im Dashboard, auf dem Handy und in der Mini-Anzeige.
2. **Autostart-Manager**: Programme, die mit Windows/macOS starten, ansehen und abschalten.
3. **Temperaturen ohne Admin** auf mehr PCs (z. B. LibreHardwareMonitor als optionaler Helfer unter Windows).
4. **Verlauf über Stunden** + „Was hat meinen PC gestern langsam gemacht?“.
5. **Profile**: „Zocken“, „Streamen“, „Arbeiten“ – jeweils mit eigenem Layout, Boost-Liste und Mini-Anzeige.
6. **Skin-Galerie** auf der Webseite: Layouts der Community herunterladen.
7. **Mehr Sprachen** (Französisch, Spanisch, Italienisch, Türkisch, Polnisch).
8. **Handy als Makro-Pad**: Knöpfe für Apps starten, Lautstärke, Discord stummschalten (wie ein Stream Deck).
9. **Netzwerk pro App** (wer frisst die Bandbreite beim Zocken?).
