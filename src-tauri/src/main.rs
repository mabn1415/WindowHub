#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod direct;
mod history;
mod quick;
use direct::{hub_move, set_quick_shortcuts};
mod model;
mod platform;
mod regions;
mod store;
use history::{History, Suggestion};
use model::*;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
struct Runtime {
    settings: Settings,
    last: Option<Snapshot>,
    undo: Vec<Move>,
    context: NativeContext,
    history: History,
    shortcut_error: Option<String>,
    history_error: Option<String>,
    quick_error: Option<String>,
    hub_monitor: Option<Monitor>,
    registered: std::collections::HashSet<u32>,
}
struct AppState {
    inner: Mutex<Runtime>,
    dir: PathBuf,
    direct_queue: std::sync::mpsc::Sender<String>,
    pressed: Mutex<std::collections::HashSet<u32>>,
}
static OPENING: AtomicBool = AtomicBool::new(false);
static HUB_SESSION: AtomicU64 = AtomicU64::new(0);
#[derive(serde::Serialize)]
struct Bootstrap {
    settings: Settings,
    snapshot: Snapshot,
    topology: String,
    context: NativeContext,
    suggestions: Vec<Suggestion>,
    compatible_profiles: Vec<ProfileInfo>,
    shortcut_error: Option<String>,
    history_error: Option<String>,
}
#[derive(serde::Serialize)]
struct ProfileInfo {
    key: String,
    names: Vec<String>,
}
#[derive(serde::Serialize)]
struct Restored {
    placements: Vec<Placement>,
    missing: Vec<String>,
    layout: Layout,
    snapshot: Snapshot,
    foreign: bool,
}
#[derive(serde::Serialize)]
struct Applied {
    results: Vec<MoveResult>,
    settings: Settings,
    warning: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn unique() -> String {
    format!(
        "layout-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}
fn lock(s: &AppState) -> Result<std::sync::MutexGuard<'_, Runtime>, String> {
    s.inner.lock().map_err(|e| e.to_string())
}
fn position(app: &tauri::AppHandle, view: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (context, needs_permission, guide_hidden) = {
        let s = lock(&state)?;
        (
            s.hub_monitor.clone(),
            s.last.as_ref().is_some_and(|snap| !snap.trusted),
            s.settings.guide_mode == "hidden",
        )
    };
    let (desired_w, desired_h): (f64, f64) = match view {
        "home" => (
            520f64,
            if needs_permission {
                if guide_hidden {
                    360.
                } else {
                    390.
                }
            } else if guide_hidden {
                270.
            } else {
                300.
            },
        ),
        "arrange" | "edit" => (840., 610.),
        "settings" => (760., 620.),
        "saved" => (660., 470.),
        "quick" => (680., 560.),
        _ => return Err("Unknown hub view".into()),
    };
    let w = app.get_webview_window("main").ok_or("Hub missing")?;
    let area = context
        .map(|m| {
            let factor = if cfg!(target_os = "macos") {
                m.scale
            } else {
                1.
            };
            (
                m.rect.x * factor,
                m.rect.y * factor,
                m.rect.width * factor,
                m.rect.height * factor,
                m.scale,
            )
        })
        .or_else(|| {
            app.primary_monitor().ok().flatten().map(|m| {
                let r = m.work_area();
                (
                    r.position.x as f64,
                    r.position.y as f64,
                    r.size.width as f64,
                    r.size.height as f64,
                    m.scale_factor(),
                )
            })
        });
    if let Some((x, y, width, height, scale)) = area {
        let ww = desired_w.min((width / scale - 24.).max(440.));
        let hh = desired_h.min((height / scale - 24.).max(220.));
        w.set_size(tauri::LogicalSize::new(ww, hh))
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        w.set_position(tauri::LogicalPosition::new(
            x / scale + (width / scale - ww) / 2.,
            y / scale + (height / scale - hh) / 2.,
        ))
        .map_err(|e| e.to_string())?;
        #[cfg(windows)]
        w.set_position(tauri::PhysicalPosition::new(
            (x + (width - ww * scale) / 2.).round() as i32,
            (y + (height - hh * scale) / 2.).round() as i32,
        ))
        .map_err(|e| e.to_string())?;
    } else {
        w.set_size(tauri::LogicalSize::new(desired_w, desired_h))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn show_hub(app: &tauri::AppHandle) {
    if OPENING.swap(true, Ordering::SeqCst) {
        return;
    }
    HUB_SESSION.fetch_add(1, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Relaunch the AX helper after a denied session: macOS can cache trust
        // in that process even after the user changes System Settings.
        let denied = app
            .state::<AppState>()
            .inner
            .lock()
            .ok()
            .and_then(|s| s.last.as_ref().map(|snap| !snap.trusted))
            .unwrap_or(false);
        if denied {
            platform::shutdown();
        }
        if let Ok(context) = platform::context() {
            // Development integration runs may target only our disposable test app.
            #[cfg(debug_assertions)]
            let context = std::env::var("WINDOWHUB_TEST_TARGET_PID")
                .ok()
                .and_then(|p| p.parse::<u32>().ok())
                .and_then(|pid| {
                    platform::snapshot().ok().and_then(|snap| {
                        snap.windows
                            .iter()
                            .find(|w| w.pid == pid && w.app_id == "local.windowhub.testtarget")
                            .map(|w| NativeContext {
                                window: Some(w.clone()),
                                monitor: quick::current_monitor(w, &snap.monitors).cloned(),
                                app_pid: Some(pid),
                            })
                    })
                })
                .unwrap_or(context);
            let mode = app
                .state::<AppState>()
                .inner
                .lock()
                .ok()
                .map(|s| s.settings.hub_screen.clone())
                .unwrap_or_else(|| "mouse".into());
            let monitor = if mode == "active" {
                context.monitor.clone()
            } else {
                platform::hub_monitor(&mode)
                    .ok()
                    .flatten()
                    .or_else(|| context.monitor.clone())
            };
            if let Ok(mut s) = app.state::<AppState>().inner.lock() {
                s.hub_monitor = monitor;
                if context.app_pid.is_some() {
                    s.context = context;
                }
            }
        }
        let handle = app.clone();
        let dispatched = app.run_on_main_thread(move || {
            let _ = position(&handle, "home");
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
                let _ = w.as_ref().set_focus();
                let _ = w.emit("hub-open", ());
            }
            OPENING.store(false, Ordering::SeqCst);
        });
        if dispatched.is_err() {
            OPENING.store(false, Ordering::SeqCst);
        }
    });
}
fn dismiss_hub(app: &tauri::AppHandle, restore_focus: bool) {
    HUB_SESSION.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        let _ = w.emit("hub-closed", ());
    }
    if !restore_focus {
        return;
    }
    let context = app
        .try_state::<AppState>()
        .and_then(|s| s.inner.lock().ok().map(|s| s.context.clone()));
    if let Some(context) = context {
        tauri::async_runtime::spawn_blocking(move || {
            if let Some(target) = context.window {
                let _ = platform::activate(&target);
            } else if let Some(pid) = context.app_pid {
                let _ = platform::activate_pid(pid);
            }
        });
    }
}
fn close_hub(app: &tauri::AppHandle) {
    dismiss_hub(app, true);
}
fn dismiss_after_blur(app: &tauri::AppHandle) {
    let app = app.clone();
    let session = HUB_SESSION.load(Ordering::SeqCst);
    tauri::async_runtime::spawn(async move {
        // Let native color panels and temporary focus transitions settle.
        tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(120))
        })
        .await
        .ok();
        if OPENING.load(Ordering::SeqCst) || session != HUB_SESSION.load(Ordering::SeqCst) {
            return;
        }
        if platform::hub_frontmost().unwrap_or(true) {
            return;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if session == HUB_SESSION.load(Ordering::SeqCst) {
                if let Some(w) = handle.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) && !w.is_focused().unwrap_or(false) {
                        // The user chose another app. Do not steal focus back.
                        dismiss_hub(&handle, false);
                    }
                }
            }
        });
    });
}
#[tauri::command]
async fn hide_hub(app: tauri::AppHandle) {
    close_hub(&app)
}
#[tauri::command]
async fn set_hub_view(view: String, app: tauri::AppHandle) -> Result<(), String> {
    position(&app, &view)
}
fn equivalent(a: &[Monitor], b: &[Monitor]) -> Option<std::collections::BTreeMap<String, String>> {
    if a.len() != b.len() {
        return None;
    }
    let norm = |ms: &[Monitor]| {
        let x = ms.iter().map(|m| m.rect.x).fold(f64::INFINITY, f64::min);
        let y = ms.iter().map(|m| m.rect.y).fold(f64::INFINITY, f64::min);
        ms.iter()
            .map(|m| {
                (
                    format!(
                        "{:.0},{:.0},{:.0},{:.0}@{:.2}",
                        m.rect.x - x,
                        m.rect.y - y,
                        m.rect.width,
                        m.rect.height,
                        m.scale
                    ),
                    m.id.clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    let a = norm(a);
    let b = norm(b);
    let mut result = std::collections::BTreeMap::new();
    for (key, id) in a {
        let choices: Vec<_> = b.iter().filter(|(k, _)| k == &key).collect();
        if choices.len() != 1 {
            return None;
        }
        result.insert(id, choices[0].1.clone());
    }
    Some(result)
}
#[tauri::command]
async fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap, String> {
    let snapshot = platform::snapshot()?;
    let mut s = lock(&state)?;
    let key = topology(&snapshot.monitors);
    let compatible_profiles = s
        .settings
        .configurations
        .iter()
        .filter(|(k, ms)| **k != key && equivalent(ms, &snapshot.monitors).is_some())
        .map(|(k, _)| ProfileInfo {
            key: k.clone(),
            names: s
                .settings
                .profiles
                .get(k)
                .map(|ls| ls.iter().map(|l| l.name.clone()).collect())
                .unwrap_or_default(),
        })
        .collect();
    let suggestions = if s.settings.learning_enabled {
        s.history.suggestions(&snapshot, now())
    } else {
        vec![]
    };
    s.last = Some(snapshot.clone());
    Ok(Bootstrap {
        settings: s.settings.clone(),
        snapshot,
        topology: key,
        context: s.context.clone(),
        suggestions,
        compatible_profiles,
        shortcut_error: s.quick_error.clone().or_else(|| s.shortcut_error.clone()),
        history_error: s.history_error.clone(),
    })
}
#[tauri::command]
async fn environment() -> Result<serde_json::Value, String> {
    let snap = platform::snapshot()?;
    Ok(
        serde_json::json!({"topology":topology(&snap.monitors),"window_count":snap.windows.len(),"trusted":snap.trusted}),
    )
}
#[tauri::command]
async fn request_permission() -> Result<bool, String> {
    platform::permission()
}
#[tauri::command]
async fn refresh_permissions() {
    platform::shutdown();
}
#[tauri::command]
async fn save_preferences(
    theme: Theme,
    guide_seen: bool,
    guide_mode: Option<String>,
    learning_enabled: Option<bool>,
    hub_screen: Option<String>,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    for color in [
        &theme.background,
        &theme.surface,
        &theme.accent,
        &theme.border,
        &theme.text,
        &theme.muted,
        &theme.selected,
    ] {
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err("色は #RRGGBB で入力してください".into());
        }
    }
    if theme.radius > 20
        || !theme.motion.is_finite()
        || theme.motion < 0.
        || theme.motion > 1.
        || !theme.opacity.is_finite()
        || !(0.55..=1.).contains(&theme.opacity)
    {
        return Err("外観設定の値が不正です".into());
    }
    let mut s = lock(&state)?;
    let mut next = s.settings.clone();
    if let Some(mode) = hub_screen {
        if !["mouse", "active", "primary"].contains(&mode.as_str()) {
            return Err("ハブの表示先が不正です".into());
        }
        next.hub_screen = mode;
    }
    next.theme = theme;
    next.guide_seen = guide_seen;
    if let Some(mode) = guide_mode {
        if !["full", "compact", "hidden"].contains(&mode.as_str()) {
            return Err("ガイド表示が不正です".into());
        }
        next.guide_mode = mode;
    }
    if let Some(enabled) = learning_enabled {
        next.learning_enabled = enabled;
    }
    store::save(&state.dir, &next)?;
    s.settings = next;
    Ok(s.settings.clone())
}
#[tauri::command]
async fn set_shortcut(
    shortcut: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    let mut s = lock(&state)?;
    let mut next = s.settings.clone();
    next.shortcut = shortcut;
    direct::replace(&app, &state, &mut s, next)
}
#[tauri::command]
async fn save_layout(
    name: String,
    placements: Vec<Placement>,
    layout_id: Option<String>,
    document: Option<LayoutDocument>,
    is_initial: Option<bool>,
    update_fixed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    if name.trim().is_empty() || name.chars().count() > 60 {
        return Err("レイアウト名は1〜60文字にしてください".into());
    }
    if placements.is_empty() && document.is_none() {
        return Err("領域またはウィンドウを設定してください".into());
    }
    let mut s = lock(&state)?;
    let snap = s.last.as_ref().ok_or("再取得してください")?;
    if let Some(d) = &document {
        regions::validate(d, snap, &placements)?;
    }
    let b = bindings(&placements, snap)?;
    let key = topology(&snap.monitors);
    let monitors = snap.monitors.clone();
    let mut next = s.settings.clone();
    let ls = next.profiles.entry(key.clone()).or_default();
    let initial = is_initial.unwrap_or(false);
    let id = layout_id.unwrap_or_else(unique);
    if let Some(old) = ls.iter().find(|l| l.id == id) {
        if old.locked && !update_fixed.unwrap_or(false) {
            return Err(
                "固定した初期レイアウトは「初期レイアウトを更新」で明示的に保存してください".into(),
            );
        }
    }
    if initial {
        for l in ls.iter_mut() {
            l.is_initial = false;
        }
    }
    if let Some(l) = ls.iter_mut().find(|l| l.id == id) {
        l.name = name.trim().into();
        l.bindings = b;
        l.document = document;
        l.is_initial = initial;
        l.locked = initial;
    } else {
        ls.push(Layout {
            id,
            name: name.trim().into(),
            bindings: b,
            document,
            is_initial: initial,
            locked: initial,
            uses: 0,
            last_used: 0,
        });
    }
    next.configurations.insert(key, monitors);
    store::save(&state.dir, &next)?;
    s.settings = next;
    Ok(s.settings.clone())
}
#[tauri::command]
async fn delete_layout(
    id: String,
    profile_key: Option<String>,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    let mut s = lock(&state)?;
    let key = profile_key
        .or_else(|| s.last.as_ref().map(|s| topology(&s.monitors)))
        .ok_or("再取得してください")?;
    let mut next = s.settings.clone();
    if let Some(ls) = next.profiles.get_mut(&key) {
        ls.retain(|l| l.id != id);
    }
    store::save(&state.dir, &next)?;
    s.settings = next;
    Ok(s.settings.clone())
}
#[tauri::command]
async fn restore_layout(
    id: String,
    profile_key: Option<String>,
    suggestion: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Restored, String> {
    let mut s = lock(&state)?;
    let snap = platform::snapshot()?;
    let current = topology(&snap.monitors);
    let key = profile_key.unwrap_or_else(|| current.clone());
    let foreign = key != current;
    let mut layout = if suggestion.unwrap_or(false) {
        if !s.settings.learning_enabled {
            return Err("履歴による提案は無効です".into());
        }
        s.history
            .suggestions(&snap, now())
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.layout)
    } else {
        s.settings
            .profiles
            .get(&key)
            .and_then(|ls| ls.iter().find(|l| l.id == id))
            .cloned()
    }
    .ok_or("保存したレイアウトが見つかりません")?;
    if foreign {
        let old = s
            .settings
            .configurations
            .get(&key)
            .ok_or("元の構成情報がありません")?;
        let mapping =
            equivalent(old, &snap.monitors).ok_or("構成が一致しないため読み込めません")?;
        for b in &mut layout.bindings {
            b.monitor_id = mapping
                .get(&b.monitor_id)
                .ok_or("モニターを対応付けできません")?
                .clone();
        }
        if let Some(doc) = &mut layout.document {
            for p in &mut doc.monitors {
                p.monitor_id = mapping
                    .get(&p.monitor_id)
                    .ok_or("領域を対応付けできません")?
                    .clone();
            }
        }
        layout.id = unique();
        layout.is_initial = false;
        layout.locked = false;
    }
    let (placements, missing) = resolve(&layout, &snap);
    if let Some(doc) = &layout.document {
        regions::validate(doc, &snap, &placements)?;
    }
    s.last = Some(snap.clone());
    Ok(Restored {
        placements,
        missing,
        layout,
        snapshot: snap,
        foreign,
    })
}
fn history_record(
    s: &mut Runtime,
    dir: &std::path::Path,
    snap: &Snapshot,
    ps: &[Placement],
    document: Option<LayoutDocument>,
    source: &str,
) -> Option<String> {
    if !s.settings.learning_enabled || s.history_error.is_some() {
        return s.history_error.clone();
    }
    let Ok(b) = bindings(ps, snap) else {
        return Some("履歴の配置情報を取得できません".into());
    };
    let mut next = s.history.clone();
    next.record(topology(&snap.monitors), b, document, now(), source.into());
    match next.save(dir) {
        Ok(()) => {
            s.history = next;
            None
        }
        Err(e) => Some(format!("配置は反映しましたが履歴を保存できません: {e}")),
    }
}
#[tauri::command]
async fn apply_layout(
    placements: Vec<Placement>,
    layout_id: Option<String>,
    document: Option<LayoutDocument>,
    state: State<'_, AppState>,
) -> Result<Applied, String> {
    let mut s = lock(&state)?;
    let snap = platform::snapshot()?;
    if !snap.trusted {
        return Err("アクセシビリティを許可して再取得してください".into());
    }
    let previous = s.last.as_ref().ok_or("再取得してください")?;
    if topology(&previous.monitors) != topology(&snap.monitors) {
        return Err("モニター構成が変わりました。再取得して確認してください".into());
    }
    if placements.is_empty() {
        return Err("ウィンドウを領域へ割り当ててください".into());
    }
    bindings(&placements, &snap)?;
    if let Some(doc) = &document {
        regions::validate(doc, &snap, &placements)?;
    }
    let mut moves = vec![];
    let mut undo = vec![];
    for p in &placements {
        let w = snap.windows.iter().find(|w| w.id == p.window_id).unwrap();
        if !previous
            .windows
            .iter()
            .any(|old| old.id == w.id && old.pid == w.pid && old.app_id == w.app_id)
        {
            return Err("ウィンドウが変わりました。再取得してください".into());
        }
        let monitor = snap.monitors.iter().find(|m| m.id == p.monitor_id).unwrap();
        moves.push(to_move(w, absolute(&p.rect, monitor)));
        undo.push(to_move(w, w.rect.clone()));
    }
    s.undo = undo;
    let results = platform::apply(&moves)?;
    let mut warning = None;
    if results.iter().all(|r| r.ok) {
        let key = topology(&snap.monitors);
        let mut next = s.settings.clone();
        if let Some(id) = layout_id {
            if let Some(l) = next
                .profiles
                .get_mut(&key)
                .and_then(|ls| ls.iter_mut().find(|l| l.id == id))
            {
                l.uses += 1;
                l.last_used = now();
            }
        }
        if let Err(e) = store::save(&state.dir, &next) {
            warning = Some(format!("使用回数を保存できません: {e}"));
        } else {
            s.settings = next;
        }
        let history_warning =
            history_record(&mut s, &state.dir, &snap, &placements, document, "apply");
        warning = warning.or(history_warning);
    }
    s.last = Some(snap);
    Ok(Applied {
        results,
        settings: s.settings.clone(),
        warning,
    })
}
fn to_move(w: &NativeWindow, rect: Rect) -> Move {
    Move {
        id: w.id.clone(),
        pid: w.pid,
        app_id: w.app_id.clone(),
        title: w.title.clone(),
        rect,
    }
}
#[tauri::command]
async fn quick_move(
    monitor_id: String,
    rect: Option<Rect>,
    mode: String,
    state: State<'_, AppState>,
) -> Result<MoveResult, String> {
    if !["move", "maximize", "fullscreen"].contains(&mode.as_str()) {
        return Err("未対応の操作です".into());
    }
    if cfg!(windows) && mode == "fullscreen" {
        return Err("Windowsではアプリ固有の全画面操作が必要です。最大化を使ってください".into());
    }
    let mut s = lock(&state)?;
    let target = s
        .context
        .window
        .clone()
        .ok_or("対象を取得できません。対象アプリから起動キーでハブを開き直してください")?;
    let snap = platform::snapshot()?;
    let current = snap
        .windows
        .iter()
        .find(|w| w.id == target.id && w.pid == target.pid && w.app_id == target.app_id)
        .ok_or("対象が変わりました。ハブを開き直してください")?;
    let m = snap
        .monitors
        .iter()
        .find(|m| m.id == monitor_id)
        .ok_or("モニターが外れました。再取得してください")?;
    let r = rect.unwrap_or(Rect {
        x: 0.,
        y: 0.,
        width: 1.,
        height: 1.,
    });
    validate_rect(&r)?;
    let operation = to_move(current, absolute(&r, m));
    let original = to_move(current, current.rect.clone());
    s.undo = vec![original.clone()];
    let mut result = platform::apply(&[operation.clone()])?.remove(0);
    if result.ok && mode != "move" {
        result = platform::special(&operation, &mode)?;
        if !result.ok && !result.message.contains("要求は送信") {
            let _ = platform::apply(&[original]);
        }
    }
    if result.ok {
        let p = Placement {
            window_id: target.id,
            monitor_id,
            rect: r,
            zone_id: None,
        };
        let _ = history_record(&mut s, &state.dir, &snap, &[p], None, "quick");
    }
    s.last = Some(snap);
    Ok(result)
}
#[tauri::command]
async fn record_current(
    window_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let mut s = lock(&state)?;
    if !s.settings.learning_enabled {
        return Err("履歴の記録を有効にしてください".into());
    }
    let snap = platform::snapshot()?;
    let mut ps = vec![];
    for w in snap.windows.iter().filter(|w| window_ids.contains(&w.id)) {
        if let Some(m) = snap.monitors.iter().find(|m| {
            w.rect.x >= m.rect.x - 1.
                && w.rect.y >= m.rect.y - 1.
                && w.rect.x + w.rect.width <= m.rect.x + m.rect.width + 1.
                && w.rect.y + w.rect.height <= m.rect.y + m.rect.height + 1.
        }) {
            let r = Rect {
                x: ((w.rect.x - m.rect.x) / m.rect.width).max(0.),
                y: ((w.rect.y - m.rect.y) / m.rect.height).max(0.),
                width: (w.rect.width / m.rect.width).min(1.),
                height: (w.rect.height / m.rect.height).min(1.),
            };
            if validate_rect(&r).is_ok() {
                ps.push(Placement {
                    window_id: w.id.clone(),
                    monitor_id: m.id.clone(),
                    rect: r,
                    zone_id: None,
                });
            }
        }
    }
    if ps.is_empty() {
        return Err("記録できる通常ウィンドウがありません".into());
    }
    if let Some(e) = history_record(&mut s, &state.dir, &snap, &ps, None, "manual_correction") {
        return Err(e);
    }
    Ok(ps.len())
}
#[tauri::command]
async fn history_info(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let s = lock(&state)?;
    Ok(
        serde_json::json!({"count":s.history.entries.len(),"last":s.history.entries.last().map(|e|e.used_at),"error":s.history_error}),
    )
}
#[tauri::command]
async fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    let mut s = lock(&state)?;
    let empty = History {
        version: 1,
        entries: vec![],
    };
    empty.save(&state.dir)?;
    s.history = empty;
    s.history_error = None;
    let backup = state.dir.join("history.json.bak");
    if backup.exists() {
        std::fs::remove_file(backup)
            .map_err(|e| format!("履歴はリセットしましたがバックアップを削除できません: {e}"))?;
    }
    Ok(())
}
#[tauri::command]
async fn undo_layout(state: State<'_, AppState>) -> Result<Vec<MoveResult>, String> {
    let mut s = lock(&state)?;
    if s.undo.is_empty() {
        return Err("戻せる配置がありません".into());
    }
    let r = platform::apply(&s.undo)?;
    if r.iter().all(|r| r.ok) {
        s.undo.clear();
    }
    Ok(r)
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_hub(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, key, event| direct::dispatch(app, key, event.state()))
                .build(),
        )
        .setup(|app| {
            platform::init(app.path().resource_dir()?);
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
                let ns = unsafe { &*(w.ns_window()? as *const NSWindow) };
                ns.setMovable(false);
                ns.setMovableByWindowBackground(false);
                ns.setCollectionBehavior(
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                        | NSWindowCollectionBehavior::Transient
                        | NSWindowCollectionBehavior::IgnoresCycle,
                );
                w.set_effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::HudWindow)
                        .state(tauri::window::EffectState::Active)
                        .radius(8.)
                        .build(),
                )?;
            }
            let dir = app.path().app_config_dir()?;
            let settings = store::load(&dir).map_err(std::io::Error::other)?;
            let (history, history_error) = match History::load(&dir) {
                Ok(h) => (h, None),
                Err(e) => (
                    History {
                        version: 1,
                        entries: vec![],
                    },
                    Some(e),
                ),
            };
            let (registered, shortcut_error) = direct::register_initial(app.handle(), &settings);
            let (direct_queue, direct_receiver) = std::sync::mpsc::channel::<String>();
            app.manage(AppState {
                dir,
                direct_queue,
                pressed: Mutex::new(std::collections::HashSet::new()),
                inner: Mutex::new(Runtime {
                    settings,
                    last: None,
                    undo: vec![],
                    context: NativeContext::default(),
                    history,
                    shortcut_error,
                    history_error,
                    quick_error: None,
                    hub_monitor: None,
                    registered,
                }),
            });
            let direct_app = app.handle().clone();
            std::thread::spawn(move || {
                for action in direct_receiver {
                    let outcome = direct::perform(&direct_app, &action);
                    if let Err(ref error) = outcome {
                        eprintln!("Quick Move: {error}");
                    }
                    if let Ok(mut s) = direct_app.state::<AppState>().inner.lock() {
                        s.quick_error = outcome.err();
                    }
                }
            });
            let show = MenuItem::with_id(app, "show", "WindowHubを開く", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("WindowHub")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_hub(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            show_hub(app.handle());
            Ok(())
        })
        .on_window_event(|w, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                close_hub(w.app_handle());
            }
            if let tauri::WindowEvent::Focused(false) = event {
                dismiss_after_blur(w.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            environment,
            set_hub_view,
            hide_hub,
            request_permission,
            refresh_permissions,
            save_preferences,
            set_shortcut,
            set_quick_shortcuts,
            save_layout,
            delete_layout,
            restore_layout,
            apply_layout,
            quick_move,
            hub_move,
            record_current,
            history_info,
            clear_history,
            undo_layout
        ])
        .build(tauri::generate_context!())
        .expect("WindowHub initialization failed")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                show_hub(app)
            }
            if let tauri::RunEvent::Exit = event {
                platform::shutdown();
            }
        });
}
