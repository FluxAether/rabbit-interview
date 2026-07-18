# StealthPath (即答侠) — Desktop Interview Copilot

Full-featured cross-platform desktop app built with **Tauri 2 + React 19**.

Replicates and enhances all core features of 即答侠:
- Real-time Stealth Copilot (system audio + AI suggestions in floating window)
- AI Mock Interviews
- Intelligent Resume Optimizer
- Interview History + Replay

## Design Fidelity
**All UI strictly follows the design references** located at:
`the local design mock directory` (6 reference images)

## Getting Started

```bash
npm install
npm run tauri dev
```

Build for production:
```bash
npm run tauri build
```

## Current Progress (aligned with project plan)
- ✅ Phase 0: Project bootstrap + modern React + Tailwind + design system
- ✅ Dashboard, Settings, History, Mock Interview, Resume Optimizer, Stealth preview
- 🚧 Phase 1 in progress: Audio capture + real floating window + Deepgram integration

See the full phased plan in the session plan file for complete scope and milestones.

## Tech Stack
Tauri 2 (Rust) • React 19 + TS • Tailwind • Framer Motion • Lucide • SQLite (planned) • Deepgram (STT) + Groq / OpenAI / Claude / Google Gemini (LLM)

## Audio Capture (Important for Interviews)

The Stealth Copilot can capture **both your voice and the interviewer's voice** (system audio) for real-time transcription and suggestions.

### Recommended on macOS (no BlackHole needed!)
- In the **隐形助手 / Stealth Copilot** panel, enable **"Use system audio (macOS native — captures interviewer)"**.
- This uses Apple's **ScreenCaptureKit** (via native `SCContentSharingPicker` support).
- You will be prompted once for **Screen Recording** permission (this also enables system audio capture).
- Optional: click "Open native picker" to precisely select a meeting window (Zoom / Teams / etc.) instead of the whole screen.
- "Also capture microphone" is recommended.

This completely removes the need to install BlackHole or create Aggregate Devices for most users.

**Note on building**: Native ScreenCaptureKit support pulls in Swift-based dependencies (`apple-metal` etc.). You need a full Xcode installation for successful linking on macOS (see Packaging section below).

### Fallback / Other platforms
- Microphone-only mode still uses `cpal` (select device in the UI).
- On older macOS or Windows, you may still need virtual audio routing tools for system audio.

See Settings > Audio Capture for more details.

## License
Proprietary (internal project)

## Packaging & Signing (Phase 4)

### macOS (with native audio capture)
1. Make sure you have **full Xcode** (not just Command Line Tools) installed and selected:
   ```bash
   xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
   The `screencapturekit` crate (and its `apple-metal` dependency) uses Swift bridges, which require a proper Xcode installation.

2. `npm run build:mac` (or `npm run tauri build`)

3. If you see Swift compatibility linker errors during build, update Xcode / Command Line Tools and try again.

4. For notarization:
   - Create App Store Connect API key or use `xcrun notarytool store-credentials`
   - `xcrun notarytool submit --keychain-profile "AC_PASSWORD" --wait ./target/release/bundle/macos/StealthPath.app.tar.gz`
5. Staple: `xcrun stapler staple ./target/.../StealthPath.app`

Entitlements are in `src-tauri/entitlements.plist` (microphone + network + file access + screen capture via Info.plist descriptions).

### Windows
- `npm run build:win`
- For signing use EV certificate or Azure Trusted Signing.
- Configure in `tauri.conf.json` under `bundle.windows` or via env `TAURI_SIGNING_PRIVATE_KEY`.

### General
- Update `tauri.conf.json` identifier, version, and updater pubkey before release.
- Use GitHub Releases + Tauri updater for auto-updates.
- Test on clean machines.

### Automated Releases (Recommended)

1. Tag a version: `git tag v1.0.0 && git push origin v1.0.0`
2. GitHub Actions will build for macOS + Windows and create a release with all assets.
3. Workflow file: `.github/workflows/release.yml`

**Required GitHub Secrets** (for signed builds):
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD` (macOS)
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater + Windows)

See the workflow for details.

See `src-tauri/tauri.conf.json` and the full development plan for details.
