fn main() {
    #[cfg(target_os = "macos")]
    {
        use std::{fs, process::Command};
        println!("cargo:rerun-if-changed=native/WindowHubBridge.swift");
        fs::create_dir_all("binaries").unwrap();
        // Debug tests and release builds can run together. Each compiles in its
        // own Cargo directory, then atomically publishes a complete helper.
        let output =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("WindowHubBridge");
        let status = Command::new("swiftc")
            .args(["-O", "native/WindowHubBridge.swift", "-o"])
            .arg(&output)
            .args(["-framework", "Cocoa", "-framework", "ApplicationServices"])
            .status()
            .expect("Xcode Command Line Tools are required");
        assert!(status.success(), "macOS bridge compilation failed");
        let staged = format!("binaries/WindowHubBridge-{}", std::process::id());
        fs::copy(output, &staged).unwrap();
        fs::rename(staged, "binaries/WindowHubBridge").unwrap();
    }
    tauri_build::build()
}
