use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Monitor {
    pub id: String,
    pub name: String,
    pub rect: Rect,
    pub scale: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeWindow {
    pub id: String,
    pub pid: u32,
    pub app_id: String,
    pub app_name: String,
    pub title: String,
    pub rect: Rect,
    pub resizable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub monitors: Vec<Monitor>,
    pub windows: Vec<NativeWindow>,
    pub trusted: bool,
    pub platform: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Placement {
    #[serde(default)]
    pub zone_id: Option<String>,
    pub window_id: String,
    pub monitor_id: String,
    pub rect: Rect,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Move {
    pub id: String,
    pub pid: u32,
    pub app_id: String,
    pub title: String,
    pub rect: Rect,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MoveResult {
    pub id: String,
    pub ok: bool,
    pub message: String,
    pub actual: Option<Rect>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    #[serde(default)]
    pub zone_id: Option<String>,
    pub app_id: String,
    pub title: String,
    pub ordinal: usize,
    pub monitor_id: String,
    pub rect: Rect,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layout {
    #[serde(default)]
    pub document: Option<LayoutDocument>,
    #[serde(default)]
    pub is_initial: bool,
    #[serde(default)]
    pub locked: bool,
    pub id: String,
    pub name: String,
    pub bindings: Vec<Binding>,
    pub uses: u32,
    pub last_used: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Theme {
    pub border: String,
    pub text: String,
    pub muted: String,
    pub selected: String,
    pub radius: u32,
    pub motion: f64,
    pub opacity: f64,
    pub background: String,
    pub accent: String,
    pub surface: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "hub_screen_default")]
    pub hub_screen: String,
    #[serde(default = "enabled")]
    pub quick_enabled: bool,
    #[serde(default = "crate::quick::defaults")]
    pub quick_shortcuts: BTreeMap<String, String>,
    #[serde(default = "enabled")]
    pub learning_enabled: bool,
    #[serde(default = "guide_default")]
    pub guide_mode: String,
    #[serde(default)]
    pub configurations: BTreeMap<String, Vec<Monitor>>,
    pub schema_version: u32,
    pub shortcut: String,
    pub theme: Theme,
    pub profiles: BTreeMap<String, Vec<Layout>>,
    pub guide_seen: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            hub_screen: hub_screen_default(),
            quick_enabled: true,
            quick_shortcuts: crate::quick::defaults(),
            learning_enabled: true,
            guide_mode: guide_default(),
            configurations: BTreeMap::new(),
            schema_version: 1,
            shortcut: "Control+Shift+Space".into(),
            theme: Theme::default(),
            profiles: BTreeMap::new(),
            guide_seen: false,
        }
    }
}
pub fn topology(monitors: &[Monitor]) -> String {
    let mut parts: Vec<_> = monitors
        .iter()
        .map(|m| {
            format!(
                "{}:{:.0},{:.0},{:.0},{:.0}@{:.2}",
                m.id, m.rect.x, m.rect.y, m.rect.width, m.rect.height, m.scale
            )
        })
        .collect();
    parts.sort();
    parts.join("|")
}
pub fn validate_rect(r: &Rect) -> Result<(), String> {
    if ![r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite())
        || r.x < 0.0
        || r.y < 0.0
        || r.width < 0.05 - 1e-8
        || r.height < 0.05 - 1e-8
        || r.x + r.width > 1.0001
        || r.y + r.height > 1.0001
    {
        return Err("配置はモニター内の5%以上の領域にしてください".into());
    }
    Ok(())
}
pub fn absolute(r: &Rect, monitor: &Monitor) -> Rect {
    Rect {
        x: (monitor.rect.x + r.x * monitor.rect.width).round(),
        y: (monitor.rect.y + r.y * monitor.rect.height).round(),
        width: (r.width * monitor.rect.width).round(),
        height: (r.height * monitor.rect.height).round(),
    }
}
pub fn bindings(placements: &[Placement], snapshot: &Snapshot) -> Result<Vec<Binding>, String> {
    let mut seen = std::collections::HashSet::new();
    placements
        .iter()
        .map(|p| {
            validate_rect(&p.rect)?;
            if !seen.insert(&p.window_id) {
                return Err("同じウィンドウを重複して配置できません".into());
            }
            let w = snapshot
                .windows
                .iter()
                .find(|w| w.id == p.window_id)
                .ok_or("ウィンドウを再取得してください")?;
            if !snapshot.monitors.iter().any(|m| m.id == p.monitor_id) {
                return Err("モニターが見つかりません".into());
            }
            let ordinal = snapshot
                .windows
                .iter()
                .filter(|other| other.app_id == w.app_id)
                .position(|other| other.id == w.id)
                .unwrap_or(0);
            Ok(Binding {
                zone_id: p.zone_id.clone(),
                app_id: w.app_id.clone(),
                title: w.title.clone(),
                ordinal,
                monitor_id: p.monitor_id.clone(),
                rect: p.rect.clone(),
            })
        })
        .collect()
}
// Match exact titles first, then app-local ordinal; never bind the same window twice.
pub fn resolve(layout: &Layout, snapshot: &Snapshot) -> (Vec<Placement>, Vec<String>) {
    let mut used = std::collections::HashSet::new();
    let mut result = Vec::new();
    let mut missing = Vec::new();
    for b in &layout.bindings {
        let candidates: Vec<_> = snapshot
            .windows
            .iter()
            .filter(|w| w.app_id == b.app_id)
            .collect();
        let w = candidates
            .iter()
            .find(|w| w.title == b.title && !used.contains(&w.id))
            .copied()
            .or_else(|| {
                candidates
                    .get(b.ordinal)
                    .filter(|w| !used.contains(&w.id))
                    .copied()
            })
            .or_else(|| candidates.iter().find(|w| !used.contains(&w.id)).copied());
        if let Some(w) = w.filter(|_| snapshot.monitors.iter().any(|m| m.id == b.monitor_id)) {
            used.insert(w.id.clone());
            result.push(Placement {
                zone_id: b.zone_id.clone(),
                window_id: w.id.clone(),
                monitor_id: b.monitor_id.clone(),
                rect: b.rect.clone(),
            });
        } else {
            missing.push(format!("{} / {}", b.app_id, b.title));
        }
    }
    (result, missing)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn monitor() -> Monitor {
        Monitor {
            id: "m".into(),
            name: "m".into(),
            rect: Rect {
                x: -1920.,
                y: 0.,
                width: 1920.,
                height: 1080.,
            },
            scale: 1.,
        }
    }
    #[test]
    fn negative_origin_and_ratio() {
        let r = absolute(
            &Rect {
                x: 0.5,
                y: 0.,
                width: 0.5,
                height: 1.,
            },
            &monitor(),
        );
        assert_eq!(r.x, -960.);
        assert_eq!(r.width, 960.);
    }
    #[test]
    fn rejects_offscreen_and_nan() {
        assert!(validate_rect(&Rect {
            x: 0.8,
            y: 0.,
            width: 0.5,
            height: 1.
        })
        .is_err());
        assert!(validate_rect(&Rect {
            x: f64::NAN,
            y: 0.,
            width: 0.5,
            height: 1.
        })
        .is_err());
    }
    #[test]
    fn topology_order_independent() {
        let a = monitor();
        let mut b = monitor();
        b.id = "b".into();
        assert_eq!(topology(&[a.clone(), b.clone()]), topology(&[b, a]));
    }
    #[test]
    fn restore_does_not_duplicate_windows() {
        let r = Rect {
            x: 0.,
            y: 0.,
            width: 0.5,
            height: 1.,
        };
        let s = Snapshot {
            monitors: vec![monitor()],
            trusted: true,
            platform: "test".into(),
            windows: vec![NativeWindow {
                id: "1".into(),
                pid: 1,
                app_id: "app".into(),
                app_name: "app".into(),
                title: "new title".into(),
                rect: r.clone(),
                resizable: true,
            }],
        };
        let b = Binding {
            zone_id: None,
            app_id: "app".into(),
            title: "old title".into(),
            ordinal: 0,
            monitor_id: "m".into(),
            rect: r,
        };
        let l = Layout {
            document: None,
            is_initial: false,
            locked: false,
            id: "l".into(),
            name: "l".into(),
            bindings: vec![b.clone(), b],
            uses: 0,
            last_used: 0,
        };
        let (p, missing) = resolve(&l, &s);
        assert_eq!(p.len(), 1);
        assert_eq!(missing.len(), 1);
    }
}

fn enabled() -> bool {
    true
}
fn guide_default() -> String {
    "compact".into()
}
impl Default for Theme {
    fn default() -> Self {
        Self {
            background: "#181B18".into(),
            surface: "#272C27".into(),
            border: "#465047".into(),
            text: "#EEEDE4".into(),
            muted: "#A9B1A7".into(),
            accent: "#A4B094".into(),
            selected: "#39473B".into(),
            radius: 8,
            motion: 1.0,
            opacity: 0.82,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ZoneNode {
    Zone {
        id: String,
    },
    Split {
        id: String,
        axis: String,
        ratio: f64,
        first: Box<ZoneNode>,
        second: Box<ZoneNode>,
    },
    Freeform {
        id: String,
        zones: Vec<Zone>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Zone {
    pub id: String,
    pub rect: Rect,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MonitorPlan {
    pub monitor_id: String,
    pub root: ZoneNode,
    pub locked: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LayoutDocument {
    pub version: u32,
    pub monitors: Vec<MonitorPlan>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NativeContext {
    pub window: Option<NativeWindow>,
    pub monitor: Option<Monitor>,
    pub app_pid: Option<u32>,
}

fn hub_screen_default() -> String {
    "mouse".into()
}
