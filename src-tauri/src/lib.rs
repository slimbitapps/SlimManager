//! SlimManager – die Tauri-Hülle.
//! Sie ist bewusst klein: Sie startet den Kern (core/main.cjs bzw. das fertige Kern-Programm), zeigt das Fenster,
//! und kümmert sich um alles, was nur das Betriebssystem kann: Taskleisten-Symbol, Tastenkürzel, Mitteilungen,
//! Mini-Anzeige, Autostart, Datei speichern. Alle Logik (Messwerte, Boost, Handy) steckt im Kern.
//!
//! Kern → Hülle: JSON-Zeilen auf stdout ({"t":"ready"|"tray"|"overlay"|"hotkeys"|"notify"|"show"|"autostart", …})
//! Hülle → Kern: JSON-Zeilen auf stdin ({"t":"hotkey"|"tray"|"quit", …})

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// Gemeinsamer Zustand: Verbindung zum Kern und ein paar Einstellungen, die die Hülle braucht
#[derive(Default)]
struct Core {
    stdin: Option<ChildStdin>,
    child: Option<Child>,
    port: u16,
    token: String,
    close_to_tray: bool,
    quitting: bool,
    start_hidden: bool,
}
type Shared = Arc<Mutex<Core>>;

/// Einträge im Taskleisten-Menü (Texte kommen vom Kern, in der gewählten Sprache)
struct TrayItems {
    open: MenuItem<Wry>,
    boost: MenuItem<Wry>,
    overlay: CheckMenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[derive(Serialize, Clone)]
struct CoreInfo {
    port: u16,
    token: String,
}

/// Die Oberfläche fragt, wo der Kern erreichbar ist (Port + geheimer Token)
#[tauri::command]
fn core_info(state: tauri::State<Shared>) -> Option<CoreInfo> {
    let s = state.lock().unwrap();
    if s.port == 0 {
        None
    } else {
        Some(CoreInfo { port: s.port, token: s.token.clone() })
    }
}

/// Text in eine Datei speichern (Layout teilen) – mit dem normalen "Speichern unter"-Fenster
#[tauri::command]
async fn save_text(app: AppHandle, name: String, contents: String) -> bool {
    let picked = app.dialog().file().set_file_name(&name).add_filter("JSON", &["json"]).blocking_save_file();
    match picked.and_then(|p| p.into_path().ok()) {
        Some(path) => std::fs::write(path, contents).is_ok(),
        None => false,
    }
}

#[tauri::command]
fn relaunch(app: AppHandle) {
    app.restart();
}

/// Eine Nachricht an den Kern schicken
fn to_core(app: &AppHandle, msg: Value) {
    let state = app.state::<Shared>();
    let mut s = state.lock().unwrap();
    if let Some(stdin) = s.stdin.as_mut() {
        let _ = writeln!(stdin, "{}", msg);
        let _ = stdin.flush();
    }
}

/// Hauptfenster zeigen (oder neu öffnen, wenn es geschlossen war – das spart im Hintergrund Arbeitsspeicher)
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("SlimManager")
        .inner_size(1280.0, 820.0)
        .min_inner_size(940.0, 620.0)
        .center();
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    match builder.build() {
        Ok(w) => {
            let handle = app.clone();
            w.on_window_event(move |e| {
                if let WindowEvent::Destroyed = e {
                    // Ohne "Im Hintergrund weiterlaufen" (und nicht am Mac): Fenster zu = SlimManager beenden
                    let tray = handle.state::<Shared>().lock().unwrap().close_to_tray;
                    if !tray && !cfg!(target_os = "macos") {
                        quit_all(&handle);
                    }
                }
            });
        }
        Err(e) => eprintln!("Fenster: {e}"),
    }
}

/// Mini-Anzeige: durchsichtig, immer im Vordergrund, Klicks gehen hindurch
fn set_overlay(app: &AppHandle, on: bool, corner: &str) {
    let existing = app.get_webview_window("overlay");
    if !on {
        if let Some(w) = existing {
            let _ = w.close();
        }
        return;
    }
    if let Some(w) = existing {
        // Ecke geändert → Seite neu laden (sie positioniert sich selbst)
        let _ = w.eval(&format!("window.__setCorner && window.__setCorner('{}')", corner.replace('\'', "")));
        return;
    }
    let url = WebviewUrl::App(format!("overlay.html?corner={}", corner).into());
    let built = WebviewWindowBuilder::new(app, "overlay", url)
        .title("SlimManager Overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible_on_all_workspaces(true)
        .inner_size(240.0, 44.0)
        .build();
    if let Ok(w) = built {
        let _ = w.set_ignore_cursor_events(true);
    }
}

/// Tastenkürzel: Strg/⌘ + Shift + B (Boost) und + O (Mini-Anzeige)
fn shortcut(code: Code) -> Shortcut {
    let m = if cfg!(target_os = "macos") { Modifiers::SUPER } else { Modifiers::CONTROL };
    Shortcut::new(Some(m | Modifiers::SHIFT), code)
}
fn set_hotkeys(app: &AppHandle, boost: bool, overlay: bool) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if boost {
        let _ = gs.register(shortcut(Code::KeyB));
    }
    if overlay {
        let _ = gs.register(shortcut(Code::KeyO));
    }
}

/// Erst den Kern alles zurücksetzen lassen (auftauen, Energieplan …), dann beenden
fn quit_all(app: &AppHandle) {
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        if s.quitting {
            return;
        }
        s.quitting = true;
    }
    to_core(app, serde_json::json!({ "t": "quit" }));
    let handle = app.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        loop {
            let done = {
                let state = handle.state::<Shared>();
                let mut s = state.lock().unwrap();
                match s.child.as_mut() {
                    Some(c) => !matches!(c.try_wait(), Ok(None)),
                    None => true,
                }
            };
            if done || start.elapsed() > Duration::from_secs(7) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        handle.exit(0);
    });
}

/// Nachricht vom Kern verarbeiten (läuft im Haupt-Thread)
fn on_core(app: &AppHandle, msg: Value) {
    let t = msg["t"].as_str().unwrap_or("");
    match t {
        "ready" => {
            let hidden = {
                let state = app.state::<Shared>();
                let mut s = state.lock().unwrap();
                s.port = msg["port"].as_u64().unwrap_or(0) as u16;
                s.token = msg["token"].as_str().unwrap_or("").to_string();
                s.start_hidden
            };
            if !hidden {
                show_main(app);
            }
        }
        "tray" => {
            if let Some(items) = app.try_state::<TrayItems>() {
                let l = &msg["labels"];
                let _ = items.open.set_text(l["open"].as_str().unwrap_or("Open"));
                let _ = items.boost.set_text(l["boost"].as_str().unwrap_or("Boost"));
                let _ = items.overlay.set_text(l["overlay"].as_str().unwrap_or("Overlay"));
                let _ = items.quit.set_text(l["quit"].as_str().unwrap_or("Quit"));
                let _ = items.overlay.set_checked(msg["overlay"].as_bool().unwrap_or(false));
            }
            app.state::<Shared>().lock().unwrap().close_to_tray = msg["closeToTray"].as_bool().unwrap_or(false);
        }
        "overlay" => set_overlay(app, msg["on"].as_bool().unwrap_or(false), msg["corner"].as_str().unwrap_or("tr")),
        "hotkeys" => set_hotkeys(app, msg["boost"].as_bool().unwrap_or(false), msg["overlay"].as_bool().unwrap_or(false)),
        "notify" => {
            let _ = app
                .notification()
                .builder()
                .title(msg["title"].as_str().unwrap_or("SlimManager"))
                .body(msg["body"].as_str().unwrap_or(""))
                .show();
        }
        "show" => show_main(app),
        "autostart" => {
            let al = app.autolaunch();
            let _ = if msg["on"].as_bool().unwrap_or(false) { al.enable() } else { al.disable() };
        }
        _ => {}
    }
}

/// Kern starten: im Test/Entwickeln mit "node core/main.cjs", in der fertigen App das mitgelieferte Kern-Programm
fn spawn_core(app: &AppHandle) {
    // Gleicher Ordner wie bisher (Einstellungen bleiben erhalten); zum Testen über SM_USERDATA änderbar
    let data = std::env::var("SM_USERDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| app.path().data_dir().map(|d| d.join("SlimManager")).unwrap_or_default());
    let (program, args, dist) = if cfg!(debug_assertions) {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        ("node".to_string(), vec![root.join("core").join("main.cjs").to_string_lossy().to_string()], root.join("dist"))
    } else {
        let exe = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default();
        let name = if cfg!(windows) { "slimmanager-core.exe" } else { "slimmanager-core" };
        let res = app.path().resource_dir().map(|r| r.join("web")).unwrap_or_default();
        (exe.join(name).to_string_lossy().to_string(), vec![], res)
    };
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("SM_USERDATA", &data)
        .env("SM_DIST", &dist)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // kein Konsolenfenster
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Kern startet nicht: {e}");
            return;
        }
    };
    let stdout = child.stdout.take().unwrap();
    {
        let state = app.state::<Shared>();
        let mut s = state.lock().unwrap();
        s.stdin = child.stdin.take();
        s.child = Some(child);
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || on_core(&h, msg));
            }
        }
        // Kern beendet: wenn das nicht gewollt war, App ebenfalls beenden (nichts soll ohne Kern weiterlaufen)
        let quitting = handle.state::<Shared>().lock().unwrap().quitting;
        if !quitting {
            handle.exit(1);
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "SlimManager", true, None::<&str>)?;
    let boost = MenuItem::with_id(app, "boost", "Boost", true, None::<&str>)?;
    let overlay = CheckMenuItem::with_id(app, "overlay", "Overlay", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &PredefinedMenuItem::separator(app)?, &boost, &overlay, &PredefinedMenuItem::separator(app)?, &quit])?;
    let icon = app.default_window_icon().cloned();
    let mut tb = TrayIconBuilder::with_id("main")
        .tooltip("SlimManager")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "boost" => to_core(app, serde_json::json!({ "t": "tray", "k": "boost" })),
            "overlay" => to_core(app, serde_json::json!({ "t": "tray", "k": "overlay" })),
            "quit" => quit_all(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            // Windows: Linksklick öffnet das Fenster (rechts kommt das Menü)
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                if !cfg!(target_os = "macos") {
                    show_main(tray.app_handle());
                }
            }
        });
    if let Some(i) = icon {
        tb = tb.icon(i);
    }
    tb.build(app)?;
    app.manage(TrayItems { open, boost, overlay, quit });
    Ok(())
}

pub fn run() {
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    let shared: Shared = Arc::new(Mutex::new(Core { start_hidden, ..Default::default() }));
    let app = tauri::Builder::default()
        // Nur eine SlimManager-Instanz: ein zweiter Start holt nur das vorhandene Fenster nach vorne
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, sc, ev| {
                    if ev.state() == ShortcutState::Pressed {
                        let k = if sc.key == Code::KeyB { "boost" } else { "overlay" };
                        to_core(app, serde_json::json!({ "t": "hotkey", "k": k }));
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(shared)
        .invoke_handler(tauri::generate_handler![core_info, save_text, relaunch])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = build_tray(&handle) {
                eprintln!("Taskleiste: {e}");
            }
            spawn_core(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("SlimManager konnte nicht starten");

    app.run(|app, event| match event {
        // Letztes Fenster zu: mit "Im Hintergrund weiterlaufen" (oder am Mac) läuft SlimManager weiter
        RunEvent::ExitRequested { api, code: None, .. } => {
            let s = app.state::<Shared>();
            let keep = { let s = s.lock().unwrap(); !s.quitting && (s.close_to_tray || cfg!(target_os = "macos")) };
            if keep {
                api.prevent_exit();
            } else if !s.lock().unwrap().quitting {
                api.prevent_exit();
                quit_all(app);
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        _ => {}
    });
}
