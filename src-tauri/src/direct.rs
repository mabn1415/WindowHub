use super::*;
use std::collections::{BTreeMap, HashSet};

fn parsed(value: &str) -> Result<Shortcut, String> {
    if !value.split('+').any(|s| {
        [
            "alt",
            "option",
            "control",
            "ctrl",
            "super",
            "command",
            "cmd",
            "cmdorctrl",
            "commandorcontrol",
        ]
        .contains(&s.to_lowercase().as_str())
    }) {
        return Err("Alt / Ctrl / Command のいずれかを含めてください".into());
    }
    value
        .parse()
        .map_err(|e| format!("ショートカットを確認してください: {e}"))
}
pub fn bindings(settings: &Settings) -> Result<BTreeMap<u32, (Shortcut, String)>, String> {
    let hub = parsed(&settings.shortcut)?;
    let mut result = BTreeMap::from([(hub.id(), (hub, "hub".into()))]);
    if settings.quick_enabled {
        for action in quick::actions() {
            let value = settings
                .quick_shortcuts
                .get(action)
                .ok_or("直接配置のキーが不足しています")?;
            let key = parsed(value)?;
            if result.insert(key.id(), (key, action.into())).is_some() {
                return Err("同じキーを複数の操作に登録できません".into());
            }
        }
    }
    Ok(result)
}
// Register additions first; a conflict or failed save leaves the old bindings intact.
pub fn replace(
    app: &tauri::AppHandle,
    state: &AppState,
    s: &mut Runtime,
    next: Settings,
) -> Result<Settings, String> {
    let wanted = bindings(&next)?;
    let mut added = vec![];
    for (id, (key, _)) in &wanted {
        if s.registered.contains(id) {
            continue;
        }
        if let Err(e) = app.global_shortcut().register(*key) {
            for key in added {
                let _ = app.global_shortcut().unregister(key);
            }
            return Err(format!(
                "キーを登録できません。別の組み合わせを選んでください: {e}"
            ));
        }
        added.push(*key);
    }
    if let Err(e) = store::save(&state.dir, &next) {
        for key in added {
            let _ = app.global_shortcut().unregister(key);
        }
        return Err(e);
    }
    for (id, (key, _)) in bindings(&s.settings)? {
        if s.registered.contains(&id) && !wanted.contains_key(&id) {
            let _ = app.global_shortcut().unregister(key);
        }
    }
    s.registered = wanted.keys().copied().collect();
    s.settings = next;
    s.shortcut_error = None;
    s.quick_error = None;
    Ok(s.settings.clone())
}
#[tauri::command]
pub async fn set_quick_shortcuts(
    enabled: bool,
    shortcuts: BTreeMap<String, String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Settings, String> {
    if shortcuts.len() != 5 || quick::actions().iter().any(|a| !shortcuts.contains_key(*a)) {
        return Err("5つの配置操作のキーを設定してください".into());
    }
    // Validate even when disabling, so an invalid set is never persisted.
    let mut s = lock(&state)?;
    let mut next = s.settings.clone();
    next.quick_shortcuts = shortcuts;
    next.quick_enabled = true;
    bindings(&next)?;
    next.quick_enabled = enabled;
    replace(&app, &state, &mut s, next)
}
fn trace(app: &tauri::AppHandle, stage: &str, key: u32) {
    static EVENTS: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if let Ok(mut events) = EVENTS.lock() {
        events.push(serde_json::json!({"at":now(),"stage":stage,"shortcut_id":key}));
        if events.len() > 32 {
            events.remove(0);
        }
        let _ = std::fs::write(
            state.dir.join("shortcut-diagnostics.json"),
            serde_json::to_vec(&*events).unwrap_or_default(),
        );
    }
}
pub fn dispatch(app: &tauri::AppHandle, key: &Shortcut, event: ShortcutState) {
    trace(
        app,
        if event == ShortcutState::Pressed {
            "pressed"
        } else {
            "released"
        },
        key.id(),
    );
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut held) = state.pressed.lock() else {
        return;
    };
    if event == ShortcutState::Released {
        held.remove(&key.id());
        return;
    }
    if !held.insert(key.id()) {
        return;
    }
    drop(held);
    let action = state.inner.lock().ok().and_then(|s| {
        bindings(&s.settings)
            .ok()
            .and_then(|b| b.get(&key.id()).map(|(_, a)| a.clone()))
    });
    match action.as_deref() {
        Some("hub") => {
            if let Some(w) = app.get_webview_window("main") {
                if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                    close_hub(app)
                } else {
                    show_hub(app)
                }
            }
        }
        Some(action) => {
            trace(app, "queued", key.id());
            let _ = state.direct_queue.send(action.into());
        }
        None => {}
    }
}
#[derive(serde::Serialize)]
pub struct HubMoved {
    pub result: MoveResult,
    pub monitor_id: String,
}
#[tauri::command]
pub async fn hub_move(action: String, app: tauri::AppHandle) -> Result<HubMoved, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = lock(&app.state::<AppState>())?
            .context
            .window
            .clone()
            .ok_or("対象アプリから起動キーでハブを開き直してください")?;
        move_target(&app, &action, target)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn perform(app: &tauri::AppHandle, action: &str) -> Result<(), String> {
    if !lock(&app.state::<AppState>())?.settings.quick_enabled {
        return Ok(());
    }
    // Home commands use the captured target; global keys use the current app.
    if platform::hub_frontmost()? {
        return Err("直接配置は対象アプリを開いているときに使ってください".into());
    }
    let context = platform::context()?;
    let target = context.window.ok_or("操作できるウィンドウがありません")?;
    move_target(app, action, target).map(|_| ())
}
fn move_target(
    app: &tauri::AppHandle,
    action: &str,
    target: NativeWindow,
) -> Result<HubMoved, String> {
    let snap = platform::snapshot()?;
    if !snap.trusted {
        return Err("アクセシビリティでWindowHubを許可してください".into());
    }
    let current = snap
        .windows
        .iter()
        .find(|w| w.id == target.id && w.pid == target.pid && w.app_id == target.app_id)
        .ok_or("対象が変わりました。もう一度キーを押してください")?;
    let state = app.state::<AppState>();
    let mut s = lock(&state)?;
    let (monitor_id, rect) = quick::target(action, current, &snap.monitors)?;
    let monitor = snap
        .monitors
        .iter()
        .find(|m| m.id == monitor_id)
        .ok_or("ディスプレイが外れました")?;
    let operation = to_move(current, absolute(&rect, monitor));
    let original = to_move(current, current.rect.clone());
    let result = platform::apply(&[operation.clone()])?
        .into_iter()
        .next()
        .ok_or("配置の結果を取得できません")?;
    s.undo = vec![original];
    if !result.ok {
        return Err(result.message);
    }
    let placement = Placement {
        window_id: current.id.clone(),
        monitor_id: monitor_id.clone(),
        rect,
        zone_id: None,
    };
    let _ = history_record(&mut s, &state.dir, &snap, &[placement], None, "quick");
    s.quick_error = None;
    s.last = Some(snap);
    Ok(HubMoved { result, monitor_id })
}
pub fn register_initial(
    app: &tauri::AppHandle,
    settings: &Settings,
) -> (HashSet<u32>, Option<String>) {
    let mut registered = HashSet::new();
    let mut errors = vec![];
    match bindings(settings) {
        Ok(all) => {
            for (id, (key, action)) in all {
                match app.global_shortcut().register(key) {
                    Ok(()) => {
                        registered.insert(id);
                    }
                    Err(e) => errors.push(format!("{action}: {e}")),
                }
            }
        }
        Err(e) => errors.push(e),
    }
    (
        registered,
        if errors.is_empty() {
            None
        } else {
            Some(format!(
                "登録できないショートカットがあります。設定から変更してください: {}",
                errors.join(" / ")
            ))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_keys_parse_and_are_distinct() {
        let b = bindings(&Settings::default()).unwrap();
        assert_eq!(b.len(), 6);
    }
    #[test]
    fn duplicate_aliases_and_unmodified_keys_are_rejected() {
        let mut settings = Settings::default();
        settings
            .quick_shortcuts
            .insert("left".into(), settings.shortcut.clone());
        assert!(bindings(&settings).is_err());
        settings
            .quick_shortcuts
            .insert("left".into(), "Left".into());
        assert!(bindings(&settings).is_err());
    }
}
