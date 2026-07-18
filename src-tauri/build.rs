fn main() {
    tauri_build::build();

    // When the macos-system-audio feature is enabled we pull in screencapturekit,
    // which produces a static bridge that dynamically loads Swift runtime libraries
    // (in particular libswift_Concurrency.dylib for async support).
    //
    // The dependency's build.rs emits `cargo:rustc-link-arg=-Wl,-rpath,...` but these
    // do not always make it into the final executable's LC_RPATH entries.
    // We therefore emit them here from the top-level build.rs so the dev binary
    // (and eventual bundled app) can locate the Swift dylibs provided by Xcode.
    //
    // This only affects macOS + the optional feature. We read the Xcode path the same
    // way the screencapturekit crate does (respecting DEVELOPER_DIR).
    #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
    {
        // Always add the common /usr/lib/swift rpath (used by many Swift dylibs)
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

        // Try to discover the active Xcode toolchain Swift lib directories
        // (swift-5.5 and the newer swift layout) so that @rpath/libswift_Concurrency.dylib resolves.
        let xcode_path = std::env::var("DEVELOPER_DIR")
            .ok()
            .or_else(|| {
                std::process::Command::new("xcode-select")
                    .arg("-p")
                    .output()
                    .ok()
                    .and_then(|o| {
                        if o.status.success() {
                            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                        } else {
                            None
                        }
                    })
            });

        if let Some(xp) = xcode_path {
            let p1 = format!(
                "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx",
                xp.trim_end_matches('/')
            );
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", p1);

            let p2 = format!(
                "{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
                xp.trim_end_matches('/')
            );
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", p2);
        } else {
            println!(
                "cargo:warning=Could not determine Xcode path (DEVELOPER_DIR or xcode-select). \
                 Swift Concurrency dylib (libswift_Concurrency.dylib) may fail to load at runtime. \
                 Run with DEVELOPER_DIR set to a full Xcode installation."
            );
        }
    }
}
