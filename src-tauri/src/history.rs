use crate::{model::*, store};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub topology: String,
    pub bindings: Vec<Binding>,
    pub document: Option<LayoutDocument>,
    pub used_at: u64,
    pub source: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct History {
    pub version: u32,
    pub entries: Vec<HistoryEntry>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Suggestion {
    pub id: String,
    pub name: String,
    pub samples: usize,
    pub score: f64,
    pub layout: Layout,
}
impl History {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let path = dir.join("history.json");
        if !path.exists() {
            return Ok(Self {
                version: 1,
                entries: vec![],
            });
        }
        let history: Self =
            serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("履歴を読み込めません。元ファイルは保持しています: {e}"))?;
        if history.version != 1 {
            return Err("未対応の履歴バージョンです".into());
        }
        Ok(history)
    }
    pub fn save(&self, dir: &Path) -> Result<(), String> {
        store::atomic_save(dir, "history.json", self)
    }
    pub fn record(
        &mut self,
        key: String,
        mut bindings: Vec<Binding>,
        document: Option<LayoutDocument>,
        used_at: u64,
        source: String,
    ) {
        // History never contains titles, document contents or text typed in other apps.
        for b in &mut bindings {
            b.title.clear();
        }
        self.entries.push(HistoryEntry {
            id: format!(
                "history-{}-{}",
                used_at,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ),
            topology: key,
            bindings,
            document,
            used_at,
            source,
        });
        if self.entries.len() > 200 {
            self.entries.drain(..self.entries.len() - 200);
        }
    }
    pub fn suggestions(&self, snapshot: &Snapshot, now: u64) -> Vec<Suggestion> {
        let key = topology(&snapshot.monitors);
        let open: HashSet<_> = snapshot.windows.iter().map(|w| w.app_id.as_str()).collect();
        let mut groups: BTreeMap<String, Vec<&HistoryEntry>> = BTreeMap::new();
        for entry in self.entries.iter().filter(|e| e.topology == key) {
            let mut parts: Vec<_> = entry
                .bindings
                .iter()
                .map(|b| {
                    format!(
                        "{}:{}:{}:{:.2},{:.2},{:.2},{:.2}",
                        b.app_id,
                        b.ordinal,
                        b.monitor_id,
                        b.rect.x,
                        b.rect.y,
                        b.rect.width,
                        b.rect.height
                    )
                })
                .collect();
            parts.sort();
            groups.entry(parts.join("|")).or_default().push(entry);
        }
        let mut result: Vec<_> = groups
            .values()
            .filter_map(|events| {
                if events.len() < 2 {
                    return None;
                }
                let latest = events.iter().max_by_key(|e| e.used_at)?;
                let compatible = latest
                    .bindings
                    .iter()
                    .filter(|b| open.contains(b.app_id.as_str()))
                    .count();
                if compatible == 0 {
                    return None;
                }
                let score = events
                    .iter()
                    .map(|e| 2.0f64.powf(-(now.saturating_sub(e.used_at) as f64) / 1_209_600.))
                    .sum::<f64>()
                    * compatible as f64
                    / latest.bindings.len().max(1) as f64;
                let layout = Layout {
                    id: latest.id.clone(),
                    name: "履歴からの候補".into(),
                    bindings: latest.bindings.clone(),
                    uses: events.len() as u32,
                    last_used: latest.used_at,
                    document: latest.document.clone(),
                    is_initial: false,
                    locked: false,
                };
                Some(Suggestion {
                    id: latest.id.clone(),
                    name: format!("{}ウィンドウの配置", latest.bindings.len()),
                    samples: events.len(),
                    score,
                    layout,
                })
            })
            .collect();
        result.sort_by(|a, b| b.score.total_cmp(&a.score));
        result.truncate(5);
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn proposals_require_repeated_matching_topology_and_prefer_recent_open_apps() {
        let rect = Rect {
            x: 0.,
            y: 0.,
            width: 1.,
            height: 1.,
        };
        let snapshot = Snapshot {
            monitors: vec![Monitor {
                id: "m".into(),
                name: "M".into(),
                rect: Rect {
                    x: 0.,
                    y: 0.,
                    width: 1200.,
                    height: 900.,
                },
                scale: 1.,
            }],
            windows: vec![NativeWindow {
                id: "w".into(),
                pid: 1,
                app_id: "app".into(),
                app_name: "App".into(),
                title: "".into(),
                rect: rect.clone(),
                resizable: true,
            }],
            trusted: true,
            platform: "test".into(),
        };
        let mut h = History {
            version: 1,
            entries: vec![],
        };
        let mut b = Binding {
            app_id: "app".into(),
            title: "private".into(),
            ordinal: 0,
            monitor_id: "m".into(),
            rect: rect.clone(),
            zone_id: None,
        };
        let key = topology(&snapshot.monitors);
        let now = 2_000_000;
        h.record(key.clone(), vec![b.clone()], None, now, "apply".into());
        assert!(h.suggestions(&snapshot, now).is_empty());
        h.record(key.clone(), vec![b.clone()], None, now, "apply".into());
        b.rect.width = 0.5;
        for _ in 0..3 {
            h.record(
                key.clone(),
                vec![b.clone()],
                None,
                now - 1_209_600,
                "apply".into(),
            );
        }
        // A different physical monitor configuration is excluded even at higher frequency.
        for _ in 0..10 {
            h.record(
                "other topology".into(),
                vec![b.clone()],
                None,
                now,
                "apply".into(),
            );
        }
        let candidates = h.suggestions(&snapshot, now);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].samples, 2);
        assert_eq!(candidates[0].layout.bindings[0].rect.width, 1.);
        assert!(!candidates[0].layout.locked);
        let mut empty = snapshot;
        empty.windows.clear();
        assert!(h.suggestions(&empty, now).is_empty());
    }
    #[test]
    fn history_strips_private_titles_and_bounds_size() {
        let mut h = History {
            version: 1,
            entries: vec![],
        };
        let b = Binding {
            app_id: "app".into(),
            title: "private document".into(),
            ordinal: 0,
            monitor_id: "m".into(),
            rect: Rect {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            zone_id: None,
        };
        for i in 0..205 {
            h.record("m".into(), vec![b.clone()], None, i, "manual".into());
        }
        assert_eq!(h.entries.len(), 200);
        assert!(h.entries.iter().all(|e| e.bindings[0].title.is_empty()));
    }
}
