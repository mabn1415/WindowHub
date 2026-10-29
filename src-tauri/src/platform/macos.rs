use crate::model::*;
use serde::{de::DeserializeOwned, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Mutex, OnceLock},
};
static PATH: OnceLock<PathBuf> = OnceLock::new();
static BRIDGE: Mutex<Option<Bridge>> = Mutex::new(None);
struct Bridge {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}
impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
pub fn init(resource: PathBuf) {
    let bundled = resource.join("WindowHubBridge");
    let _ = PATH.set(if bundled.exists() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/WindowHubBridge")
    });
}
fn call<T: DeserializeOwned>(action: &str, payload: impl Serialize) -> Result<T, String> {
    let mut lock = BRIDGE.lock().map_err(|e| e.to_string())?;
    if lock.is_none() {
        let mut child = Command::new(PATH.get().ok_or("native bridge not initialized")?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| e.to_string())?;
        *lock = Some(Bridge {
            input: child.stdin.take().unwrap(),
            output: BufReader::new(child.stdout.take().unwrap()),
            child,
        });
    }
    let b = lock.as_mut().unwrap();
    let request = serde_json::json!({"action":action,"payload":payload});
    if let Err(e) = writeln!(b.input, "{}", request).and_then(|_| b.input.flush()) {
        *lock = None;
        return Err(format!("macOS bridge: {e}"));
    }
    let mut line = String::new();
    match b.output.read_line(&mut line) {
        Ok(0) | Err(_) => {
            *lock = None;
            return Err("macOS bridgeが停止しました。再取得してください".into());
        }
        _ => {}
    }
    let value: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if value["ok"] != true {
        return Err(value["error"].as_str().unwrap_or("Native error").into());
    }
    serde_json::from_value(value["data"].clone()).map_err(|e| e.to_string())
}
pub fn snapshot() -> Result<Snapshot, String> {
    call("snapshot", ())
}
pub fn apply(moves: &[Move]) -> Result<Vec<MoveResult>, String> {
    call("apply", moves)
}
pub fn permission() -> Result<bool, String> {
    call("permission", ())
}
pub fn shutdown() {
    if let Ok(mut b) = BRIDGE.lock() {
        *b = None;
    }
}

pub fn context() -> Result<NativeContext, String> {
    call("context", ())
}
pub fn activate(window: &NativeWindow) -> Result<bool, String> {
    call("activate", window)
}
pub fn activate_pid(pid: u32) -> Result<bool, String> {
    call("activate", serde_json::json!({"pid":pid}))
}
pub fn hub_frontmost() -> Result<bool, String> {
    call("hubFrontmost", ())
}
pub fn special(window: &Move, mode: &str) -> Result<MoveResult, String> {
    if mode == "fullscreen" {
        call("fullscreen", window)
    } else {
        Ok(MoveResult {
            id: window.id.clone(),
            ok: true,
            message: "作業領域いっぱいに配置しました".into(),
            actual: Some(window.rect.clone()),
        })
    }
}

pub fn hub_monitor(mode: &str) -> Result<Option<Monitor>, String> {
    call("hubMonitor", mode)
}
