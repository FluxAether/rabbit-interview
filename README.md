# RabbitInterview — Desktop Interview Copilot

Full-featured cross-platform desktop app built with **Tauri 2 + React 19**.

Replicates and enhances core interview copilot features:
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

Build or preview the independent marketing site:
```bash
npm run dev:marketing
npm run build:marketing
npm run preview:marketing
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

### Recommended on macOS

- macOS 14.2+ uses the bundled [AudioTee](https://github.com/makeusabrew/audiotee) sidecar to capture 16 kHz mono audio from the default system output.
- Microphone audio remains optional and is captured with `cpal`; when both sources are enabled they are mixed in the native layer.
- The integration is pinned to commit `56ac954369a09318e46b88a6eec33c2d2b0d32a3`. Each build records architecture-specific SHA-256 values in `src-tauri/target/audiotee-checksums.txt`; reviewed reference hashes and policy live in `src-tauri/binaries/audiotee.lock`.
- Run `npm run tauri:mac-audio` for development. `npm run build:mac` builds and bundles both sidecar architectures.
- The first system-audio capture requests macOS **System Audio Recording** permission. AudioTee does not use screen recording permission or capture screen contents.

See Packaging section below for more details.

### Windows

- Windows uses cpal's WASAPI host. Opening the default render endpoint as an input stream enables loopback capture of the system mix (shared mode).
- Microphone capture remains optional via cpal input devices; both sources mix in the native layer.
- Loopback follows the current default output device only for the active capture session. If the default device changes, restart capture. Exclusive-mode playback and DRM-protected content are not supported.

### Fallback / Other platforms

- macOS 13.0–14.1 remains supported in microphone-only mode.
- Unsupported platforms fall back to microphone-only mode.

See Settings > Audio Capture for more details.

## License
Proprietary (internal project)

## Packaging & Signing (Phase 4)

### macOS (with native audio capture)
1. Make sure a Swift 6.3.2 toolchain is installed and selected:
   ```bash
   xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
   `scripts/build-audiotee.sh` verifies the reviewed source commit and records the resulting architecture-specific checksum.

2. `npm run build:mac` (or `npm run tauri build`)

3. Attach `src-tauri/target/audiotee-checksums.txt` to the release audit. Swift embeds build-path details, so binary hashes are recorded per build rather than treated as cross-machine reproducible values.

4. For notarization:
   - Create App Store Connect API key or use `xcrun notarytool store-credentials`
   - `xcrun notarytool submit --keychain-profile "AC_PASSWORD" --wait ./target/release/bundle/macos/RabbitInterview.app.tar.gz`
5. Staple: `xcrun stapler staple ./target/.../RabbitInterview.app`

Entitlements are in `src-tauri/entitlements.plist`; `Info.plist` declares microphone and system-audio capture usage descriptions.

### Windows
- `npm run build:win`
- For signing use EV certificate or Azure Trusted Signing.
- Configure in `tauri.conf.json` under `bundle.windows` or via env `TAURI_SIGNING_PRIVATE_KEY`.

### General
- Update `tauri.conf.json` identifier, version, and updater pubkey before release.
- Use GitHub Releases + Tauri updater for auto-updates.
- The app fetches `plugins.updater.endpoints` → `.../releases/latest/download/latest.json`.
- That endpoint must be **publicly downloadable** (no GitHub auth). Private repos return 404 to the desktop app.
- Test on clean machines.

### Automated Releases (Recommended)

1. Optional: add `PUBLIC_DISTRIBUTION_TOKEN`, a fine-grained token with Contents read/write access only to `thomas92118/rabbit-interview-downloads`.
2. Tag a version: `git tag v0.7.0 && git push origin v0.7.0`.
3. GitHub Actions builds macOS and Windows in parallel, then always publishes installers, updater artifacts, `latest.json`, and `SHA256SUMS.txt` to this repository's Release. If the token is set, it also publishes those assets and the Pages site to the public repository.
4. `.github/workflows/marketing.yml` republishes `main/docs` only when the token is set and all four fixed public download assets exist.

Public distribution lives at `https://github.com/thomas92118/rabbit-interview-downloads`. The application source remains in this private repository.

**Required GitHub Secrets** (for signed builds):
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD` (macOS)
- `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater + Windows)
- `PUBLIC_DISTRIBUTION_TOKEN` (optional; skip public Release and Pages publishing when unset)

See the workflow for details.

See `src-tauri/tauri.conf.json` and the full development plan for details.
