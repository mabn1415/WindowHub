use crate::model::*;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use windows::{
    core::{BOOL, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
        Graphics::{Dwm::*, Gdi::*},
        System::Threading::*,
        UI::{HiDpi::*, WindowsAndMessaging::*},
    },
};
static KNOWN: Mutex<Option<HashMap<String, NativeWindow>>> = Mutex::new(None);
pub fn init(_: PathBuf) {}
pub fn shutdown() {}
fn rect(r: RECT) -> Rect {
    Rect {
        x: r.left as f64,
        y: r.top as f64,
        width: (r.right - r.left) as f64,
        height: (r.bottom - r.top) as f64,
    }
}
fn wide(v: &[u16]) -> String {
    String::from_utf16_lossy(&v[..v.iter().position(|c| *c == 0).unwrap_or(v.len())])
}
unsafe fn visible_rect(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    if DwmGetWindowAttribute(
        hwnd,
        DWMWA_EXTENDED_FRAME_BOUNDS,
        &mut r as *mut _ as _,
        std::mem::size_of::<RECT>() as u32,
    )
    .is_ok()
    {
        Some(r)
    } else {
        GetWindowRect(hwnd, &mut r).ok().map(|_| r)
    }
}
unsafe fn window_info(hwnd: HWND) -> Option<NativeWindow> {
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return None;
    }
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == std::process::id() {
        return None;
    }
    if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
        return None;
    }
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as _, 4);
    if cloaked != 0 {
        return None;
    }
    let mut title = vec![0u16; GetWindowTextLengthW(hwnd).max(0) as usize + 1];
    GetWindowTextW(hwnd, &mut title);
    let title = wide(&title);
    if title.trim().is_empty() {
        return None;
    }
    let r = visible_rect(hwnd)?;
    if r.right - r.left < 40 || r.bottom - r.top < 40 {
        return None;
    }
    let mut app_id = String::new();
    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        if QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
        .is_ok()
        {
            app_id = String::from_utf16_lossy(&buffer[..size as usize]).to_lowercase();
        }
        let _ = CloseHandle(handle);
    }
    // Higher integrity windows may not expose their process; do not use an unstable PID as a saved app identity.
    if app_id.is_empty() {
        return None;
    }
    let app_name = app_id
        .rsplit('\\')
        .next()
        .unwrap_or("Application")
        .trim_end_matches(".exe")
        .to_string();
    Some(NativeWindow {
        id: format!("{}", hwnd.0 as usize),
        pid,
        app_id,
        app_name,
        title,
        rect: rect(r),
        resizable: GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_THICKFRAME.0 != 0,
    })
}
unsafe extern "system" fn enum_windows(hwnd: HWND, data: LPARAM) -> BOOL {
    if let Some(w) = window_info(hwnd) {
        (*(data.0 as *mut Vec<NativeWindow>)).push(w);
    }
    BOOL(1)
}
unsafe extern "system" fn enum_monitors(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(m, &mut info as *mut _ as _).as_bool() {
        let device = wide(&info.szDevice);
        let mut display = DISPLAY_DEVICEW::default();
        display.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
        let has_display = EnumDisplayDevicesW(
            windows::core::PCWSTR(info.szDevice.as_ptr()),
            0,
            &mut display,
            EDD_GET_DEVICE_INTERFACE_NAME,
        )
        .as_bool();
        let id = if has_display && !wide(&display.DeviceID).is_empty() {
            wide(&display.DeviceID)
        } else {
            device.clone()
        };
        let name = if has_display {
            wide(&display.DeviceString)
        } else {
            device
        };
        let (mut x, mut y) = (96, 96);
        let _ = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut x, &mut y);
        (*(data.0 as *mut Vec<Monitor>)).push(Monitor {
            id,
            name,
            rect: rect(info.monitorInfo.rcWork),
            scale: x as f64 / 96.,
        });
    }
    BOOL(1)
}
pub fn snapshot() -> Result<Snapshot, String> {
    unsafe {
        let mut monitors = Vec::<Monitor>::new();
        let mut windows = Vec::<NativeWindow>::new();
        if !EnumDisplayMonitors(
            None,
            None,
            Some(enum_monitors),
            LPARAM(&mut monitors as *mut _ as isize),
        )
        .as_bool()
        {
            return Err("ディスプレイを取得できません".into());
        }
        EnumWindows(Some(enum_windows), LPARAM(&mut windows as *mut _ as isize))
            .map_err(|e| e.to_string())?;
        // EnumWindows is front-to-back. Reverse so overlap order follows normal bottom-to-top stacking.
        windows.reverse();
        *KNOWN.lock().map_err(|e| e.to_string())? =
            Some(windows.iter().map(|w| (w.id.clone(), w.clone())).collect());
        Ok(Snapshot {
            monitors,
            windows,
            trusted: true,
            platform: "windows".into(),
        })
    }
}
pub fn permission() -> Result<bool, String> {
    Ok(true)
}
pub fn apply(moves: &[Move]) -> Result<Vec<MoveResult>, String> {
    Ok(moves
        .iter()
        .map(|m| unsafe {
            let operation = (|| -> Result<Rect, String> {
                let hwnd = HWND(m.id.parse::<usize>().map_err(|e| e.to_string())? as *mut _);
                let actual = window_info(hwnd).ok_or("ウィンドウが閉じられたか、操作できません")?;
                if actual.pid != m.pid || actual.app_id != m.app_id {
                    return Err("ウィンドウが変わりました。再取得してください".into());
                }
                if IsZoomed(hwnd).as_bool() {
                    let _ = ShowWindowAsync(hwnd, SW_RESTORE);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                let mut outer = RECT::default();
                GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
                let visible = visible_rect(hwnd).ok_or("位置を取得できません")?;
                let l = visible.left - outer.left;
                let t = visible.top - outer.top;
                let r = outer.right - visible.right;
                let b = outer.bottom - visible.bottom;
                SetWindowPos(
                    hwnd,
                    Some(HWND_TOP),
                    m.rect.x.round() as i32 - l,
                    m.rect.y.round() as i32 - t,
                    m.rect.width.round() as i32 + l + r,
                    m.rect.height.round() as i32 + t + b,
                    SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                )
                .map_err(|e| e.to_string())?;
                std::thread::sleep(std::time::Duration::from_millis(120));
                Ok(rect(
                    visible_rect(hwnd).ok_or("反映後の位置を取得できません")?,
                ))
            })();
            match operation {
                Ok(actual) => {
                    let exact = (actual.x - m.rect.x).abs() < 6.
                        && (actual.y - m.rect.y).abs() < 6.
                        && (actual.width - m.rect.width).abs() < 6.
                        && (actual.height - m.rect.height).abs() < 6.;
                    MoveResult {
                        id: m.id.clone(),
                        ok: exact,
                        message: if exact {
                            "反映しました"
                        } else {
                            "アプリの最小サイズ等により指定位置・サイズと異なります"
                        }
                        .into(),
                        actual: Some(actual),
                    }
                }
                Err(e) => MoveResult {
                    id: m.id.clone(),
                    ok: false,
                    message: e,
                    actual: None,
                },
            }
        })
        .collect())
}

pub fn context() -> Result<NativeContext, String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let window = window_info(hwnd);
        let snapshot = snapshot()?;
        let monitor = window
            .as_ref()
            .and_then(|w| {
                snapshot.monitors.iter().max_by(|a, b| {
                    fn overlap(a: &Rect, b: &Rect) -> f64 {
                        ((a.x + a.width).min(b.x + b.width) - a.x.max(b.x)).max(0.)
                            * ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)).max(0.)
                    }
                    overlap(&w.rect, &a.rect).total_cmp(&overlap(&w.rect, &b.rect))
                })
            })
            .cloned();
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        Ok(NativeContext {
            window,
            monitor,
            app_pid: if pid == std::process::id() {
                None
            } else {
                Some(pid)
            },
        })
    }
}
pub fn activate(window: &NativeWindow) -> Result<bool, String> {
    unsafe {
        let hwnd = HWND(window.id.parse::<usize>().map_err(|e| e.to_string())? as *mut _);
        let actual = window_info(hwnd).ok_or("対象が閉じられました")?;
        if actual.pid != window.pid || actual.app_id != window.app_id {
            return Err("対象が変わりました".into());
        }
        Ok(SetForegroundWindow(hwnd).as_bool())
    }
}
pub fn hub_frontmost() -> Result<bool, String> {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
        Ok(pid == std::process::id())
    }
}
pub fn activate_pid(pid: u32) -> Result<bool, String> {
    let snapshot = snapshot()?;
    match snapshot.windows.iter().find(|w| w.pid == pid) {
        Some(w) => activate(w),
        None => Ok(false),
    }
}
pub fn special(window: &Move, mode: &str) -> Result<MoveResult, String> {
    unsafe {
        if mode == "fullscreen" {
            return Ok(MoveResult{id:window.id.clone(),ok:false,message:"Windowsのネイティブ全画面はアプリごとの操作が必要です。最大化を使用してください".into(),actual:None});
        }
        let hwnd = HWND(window.id.parse::<usize>().map_err(|e| e.to_string())? as *mut _);
        let actual = window_info(hwnd).ok_or("対象が閉じられました")?;
        if actual.pid != window.pid || actual.app_id != window.app_id {
            return Err("対象が変わりました".into());
        }
        let _ = ShowWindowAsync(hwnd, SW_MAXIMIZE);
        std::thread::sleep(std::time::Duration::from_millis(160));
        let ok = IsZoomed(hwnd).as_bool();
        Ok(MoveResult {
            id: window.id.clone(),
            ok,
            message: if ok {
                "最大化しました"
            } else {
                "最大化を確認できませんでした"
            }
            .into(),
            actual: visible_rect(hwnd).map(rect),
        })
    }
}

pub fn hub_monitor(mode: &str) -> Result<Option<Monitor>, String> {
    unsafe {
        let mut point = POINT::default();
        if mode != "primary" {
            GetCursorPos(&mut point).map_err(|e| e.to_string())?;
        }
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTOPRIMARY);
        let mut ms = Vec::<Monitor>::new();
        let _ = enum_monitors(
            monitor,
            HDC::default(),
            std::ptr::null_mut(),
            LPARAM(&mut ms as *mut _ as isize),
        );
        Ok(ms.into_iter().next())
    }
}
