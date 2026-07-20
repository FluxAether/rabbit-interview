# RabbitInterview (即答侠) — Desktop Interview Copilot

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

### Recommended on macOS

- macOS 14.2+ uses the bundled [AudioTee](https://github.com/makeusabrew/audiotee) sidecar to capture 16 kHz mono audio from the default system output.
- Microphone audio remains optional and is captured with `cpal`; when both sources are enabled they are mixed in the native layer.
- The integration is pinned to commit `56ac954369a09318e46b88a6eec33c2d2b0d32a3`. Each build records architecture-specific SHA-256 values in `src-tauri/target/audiotee-checksums.txt`; reviewed reference hashes and policy live in `src-tauri/binaries/audiotee.lock`.
- Run `npm run tauri:mac-audio` for development. `npm run build:mac` builds and bundles both sidecar architectures.
- The first system-audio capture requests macOS **System Audio Recording** permission. AudioTee does not use screen recording permission or capture screen contents.

See Packaging section below for more details.

### Fallback / Other platforms

- macOS 13.0–14.1 remains supported in microphone-only mode.
- Other platforms currently report their native capability and fall back to microphone-only mode. A Windows WASAPI loopback implementation remains a separate compatibility spike.

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
