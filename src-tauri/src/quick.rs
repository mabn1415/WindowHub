use crate::model::*;
pub fn actions() -> [&'static str; 5] {
    ["left", "right", "top", "bottom", "maximize"]
}
pub fn defaults() -> std::collections::BTreeMap<String, String> {
    [
        ("left", "Left"),
        ("right", "Right"),
        ("top", "Up"),
        ("bottom", "Down"),
        ("maximize", "Enter"),
    ]
    .into_iter()
    .map(|(a, key)| (a.into(), format!("Control+Alt+Super+{key}")))
    .collect()
}
pub fn current_monitor<'a>(w: &NativeWindow, ms: &'a [Monitor]) -> Option<&'a Monitor> {
    ms.iter().max_by(|a, b| {
        fn overlap(w: &Rect, m: &Rect) -> f64 {
            ((w.x + w.width).min(m.x + m.width) - w.x.max(m.x)).max(0.)
                * ((w.y + w.height).min(m.y + m.height) - w.y.max(m.y)).max(0.)
        }
        overlap(&w.rect, &a.rect).total_cmp(&overlap(&w.rect, &b.rect))
    })
}
pub fn target(action: &str, w: &NativeWindow, ms: &[Monitor]) -> Result<(String, Rect), String> {
    let current = current_monitor(w, ms).ok_or("モニターが見つかりません")?;
    let mut monitor = current;
    let rect = match action {
        "left" => Rect {
            x: 0.,
            y: 0.,
            width: 0.5,
            height: 1.,
        },
        "right" => Rect {
            x: 0.5,
            y: 0.,
            width: 0.5,
            height: 1.,
        },
        "top" => Rect {
            x: 0.,
            y: 0.,
            width: 1.,
            height: 0.5,
        },
        "bottom" => Rect {
            x: 0.,
            y: 0.5,
            width: 1.,
            height: 0.5,
        },
        "maximize" => Rect {
            x: 0.,
            y: 0.,
            width: 1.,
            height: 1.,
        },
        _ => return Err("未対応の直接配置です".into()),
    };
    if ["left", "right"].contains(&action)
        && ms.len() > 1
        && near(&absolute(&rect, current), &w.rect)
    {
        let mut ordered: Vec<_> = ms.iter().collect();
        ordered.sort_by(|a, b| {
            (a.rect.x + a.rect.width / 2.)
                .total_cmp(&(b.rect.x + b.rect.width / 2.))
                .then(a.rect.y.total_cmp(&b.rect.y))
                .then(a.id.cmp(&b.id))
        });
        let i = ordered.iter().position(|m| m.id == current.id).unwrap();
        monitor = ordered[(i + if action == "right" {
            1
        } else {
            ordered.len() - 1
        }) % ordered.len()];
    }
    Ok((monitor.id.clone(), rect))
}
fn near(a: &Rect, b: &Rect) -> bool {
    (a.x - b.x).abs() < 6.
        && (a.y - b.y).abs() < 6.
        && (a.width - b.width).abs() < 6.
        && (a.height - b.height).abs() < 6.
}
#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (NativeWindow, Vec<Monitor>) {
        let ms = vec![
            Monitor {
                id: "left".into(),
                name: "Left".into(),
                scale: 1.,
                rect: Rect {
                    x: -1200.,
                    y: 0.,
                    width: 1200.,
                    height: 900.,
                },
            },
            Monitor {
                id: "main".into(),
                name: "Main".into(),
                scale: 2.,
                rect: Rect {
                    x: 0.,
                    y: 0.,
                    width: 1500.,
                    height: 900.,
                },
            },
        ];
        let w = NativeWindow {
            id: "w".into(),
            pid: 1,
            app_id: "app".into(),
            app_name: "App".into(),
            title: "".into(),
            resizable: true,
            rect: Rect {
                x: 200.,
                y: 100.,
                width: 700.,
                height: 500.,
            },
        };
        (w, ms)
    }
    #[test]
    fn current_position_drives_monitor_movement_without_history() {
        let (mut w, ms) = setup();
        let (id, left) = target("left", &w, &ms).unwrap();
        assert_eq!(id, "main");
        w.rect = absolute(&left, &ms[1]);
        assert_eq!(target("left", &w, &ms).unwrap().0, "left");
        assert_eq!(target("right", &w, &ms).unwrap().0, "main");
        let right = target("right", &w, &ms).unwrap().1;
        w.rect = absolute(&right, &ms[1]);
        assert_eq!(target("right", &w, &ms).unwrap().0, "left");
        w.rect.x += 4.;
        assert_eq!(target("right", &w, &ms).unwrap().0, "left");
        w.rect.x += 20.;
        assert_eq!(target("right", &w, &ms).unwrap().0, "main");
        assert_eq!(target("right", &w, &ms[1..]).unwrap().0, "main");
    }
    #[test]
    fn vertical_halves_and_maximize_are_distinct() {
        let (w, ms) = setup();
        assert_eq!(target("top", &w, &ms).unwrap().1.height, 0.5);
        assert_eq!(target("bottom", &w, &ms).unwrap().1.y, 0.5);
        assert_eq!(target("maximize", &w, &ms).unwrap().1.height, 1.);
    }
}

#[cfg(all(test, target_os = "macos"))]
#[test]
#[ignore = "Only run with the dedicated WindowHub Test Target PID"]
fn native_direct_placement_smoke() {
    use crate::platform;
    let pid: u32 = std::env::var("WINDOWHUB_TEST_TARGET_PID")
        .expect("dedicated target PID required")
        .parse()
        .unwrap();
    platform::init(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    let first = platform::snapshot().unwrap();
    assert!(first.trusted, "test runner lacks Accessibility permission");
    let original = first
        .windows
        .iter()
        .find(|w| w.pid == pid && w.app_id == "local.windowhub.testtarget")
        .expect("only the dedicated test app is allowed")
        .clone();
    let mut checks = vec![];
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let sequence: Vec<_> = std::iter::once("left")
            .chain(std::iter::repeat_n("left", first.monitors.len()))
            .chain(["right", "right", "top", "bottom", "maximize"])
            .collect();
        for action in sequence {
            let snap = platform::snapshot().unwrap();
            let w = snap
                .windows
                .iter()
                .find(|w| {
                    w.id == original.id && w.pid == pid && w.app_id == "local.windowhub.testtarget"
                })
                .unwrap();
            let (id, r) = target(action, w, &snap.monitors).unwrap();
            let m = snap.monitors.iter().find(|m| m.id == id).unwrap();
            let operation = crate::to_move(w, absolute(&r, m));
            let got = platform::apply(&[operation.clone()]).unwrap().remove(0);
            assert!(got.ok, "{action} on {}: {}", m.name, got.message);
            let actual = got.actual.unwrap();
            checks.push(
                serde_json::json!({"action":action,"monitor":m.name,"rect":actual,"passed":true}),
            );
        }
        let primary = platform::hub_monitor("primary").unwrap().unwrap();
        assert_eq!(primary.id, first.monitors[0].id);
        assert!(platform::hub_monitor("mouse").unwrap().is_some());
    }));
    let restored = platform::apply(&[crate::to_move(&original, original.rect.clone())])
        .unwrap()
        .remove(0);
    assert!(restored.ok, "restore dedicated test window");
    std::fs::write(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../work/direct-native-smoke.json"),serde_json::to_vec_pretty(&serde_json::json!({"target":"dedicated test app only","monitor_count":first.monitors.len(),"checks":checks,"restored":restored.ok,"passed":result.is_ok(),"global_key_delivery":"tested separately"})).unwrap()).unwrap();
    platform::shutdown();
    if let Err(e) = result {
        std::panic::resume_unwind(e);
    }
}
