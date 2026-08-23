fn main() {
    compile_apple_stt();
    tauri_build::build();
}

fn compile_apple_stt() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" {
        return;
    }

    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("native/apple-stt/AppleSttBridge.swift");
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let output = out_dir.join("libAppleSttBridge.a");

    println!("cargo:rerun-if-changed={}", source.display());

    let status = std::process::Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            "-emit-library",
            "-static",
            "-O",
            "-target",
            swift_target(),
            "-framework",
            "Speech",
            "-framework",
            "AVFoundation",
            "-framework",
            "Foundation",
            "-o",
        ])
        .arg(&output)
        .arg(&source)
        .status()
        .expect("failed to invoke swiftc for Apple STT");
    if !status.success() {
        panic!("swiftc failed while compiling Apple STT bridge");
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=AppleSttBridge");
    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=swiftCore");
    println!("cargo:rustc-link-lib=swift_Concurrency");
    if let Ok(sdk) = std::process::Command::new("xcrun").args(["--show-sdk-path"]).output() {
        if sdk.status.success() {
            let sdk_path = String::from_utf8_lossy(&sdk.stdout).trim().to_string();
            println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk_path);
        }
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

fn swift_target() -> &'static str {
    match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default().as_str() {
        "x86_64" => "x86_64-apple-macosx13.0",
        _ => "arm64-apple-macosx13.0",
    }
}
