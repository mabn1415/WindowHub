use crate::model::Settings;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
pub fn path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}
pub fn load(dir: &Path) -> Result<Settings, String> {
    let p = path(dir);
    if !p.exists() {
        return Ok(Settings::default());
    }
    let data = fs::read(&p).map_err(|e| e.to_string())?;
    let mut store: Settings = serde_json::from_slice(&data).map_err(|e| {
        format!(
            "設定を読み込めません。元のファイルは保持しています: {} ({e})",
            p.display()
        )
    })?;
    if store.schema_version != 1 {
        return Err("未対応の設定バージョンです。元のファイルは保持しています".into());
    }
    // Upgrade only known factory colors. Custom themes are kept byte-for-byte.
    let olive = store.theme.background == "#242820"
        && store.theme.surface == "#30362c"
        && store.theme.accent == "#b8c494";
    let clay = store.theme.background == "#2e2724"
        && store.theme.surface == "#3d322d"
        && store.theme.accent == "#dbb69b";
    if olive {
        store.theme = crate::model::Theme::default();
    }
    if clay {
        store.theme = crate::model::Theme {
            background: "#1D1B19".into(),
            surface: "#2C2925".into(),
            border: "#51483F".into(),
            text: "#F2ECE2".into(),
            muted: "#B6ACA0".into(),
            accent: "#C39C80".into(),
            selected: "#493C32".into(),
            ..crate::model::Theme::default()
        };
    }
    Ok(store)
}
pub fn save(dir: &Path, store: &Settings) -> Result<(), String> {
    atomic_save(dir, "settings.json", store)
}
pub fn atomic_save<T: serde::Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = dir.join(name);
    let tmp = dir.join(format!("{name}.tmp"));
    let mut f = File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    if target.exists() {
        fs::copy(&target, dir.join(format!("{name}.bak"))).map_err(|e| e.to_string())?;
    }
    fs::rename(tmp, target).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_factory_theme_upgrades_without_losing_custom_shortcut_or_profiles() {
        let dir = std::env::temp_dir().join(format!("windowhub-migrate-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let old = serde_json::json!({"schema_version":1,"shortcut":"Alt+Space","theme":{"background":"#242820","surface":"#30362c","accent":"#b8c494"},"guide_seen":true,"profiles":{"existing":[]}});
        fs::write(path(&dir), old.to_string()).unwrap();
        let upgraded = load(&dir).unwrap();
        assert_eq!(upgraded.theme.background, "#181B18");
        assert_eq!(upgraded.shortcut, "Alt+Space");
        assert!(upgraded.profiles.contains_key("existing"));
        // Loading alone never mutates a user's stored settings.
        assert_eq!(fs::read_to_string(path(&dir)).unwrap(), old.to_string());
        let mut custom = old;
        custom["theme"]["accent"] = "#123456".into();
        fs::write(path(&dir), custom.to_string()).unwrap();
        let preserved = load(&dir).unwrap();
        assert_eq!(preserved.theme.accent, "#123456");
        assert_eq!(preserved.theme.background, "#242820");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn roundtrip_and_corruption_preserved() {
        let dir = std::env::temp_dir().join(format!("windowhub-test-{}", std::process::id()));
        let mut s = Settings::default();
        s.shortcut = "Control+Shift+Space".into();
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir).unwrap().shortcut, s.shortcut);
        fs::write(path(&dir), b"broken").unwrap();
        assert!(load(&dir).is_err());
        assert_eq!(fs::read(path(&dir)).unwrap(), b"broken");
        fs::remove_dir_all(dir).unwrap();
    }
}
