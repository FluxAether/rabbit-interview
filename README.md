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
Tauri 2 (Rust) • React 19 + TS • Tailwind • Framer Motion • Lucide • SQLite (planned) • Deepgram / Groq (planned)

## License
Proprietary (internal project)

## Packaging & Signing (Phase 4)

### macOS
1. `npm run build:mac`
2. For notarization:
   - Create App Store Connect API key or use `xcrun notarytool store-credentials`
   - `xcrun notarytool submit --keychain-profile "AC_PASSWORD" --wait ./target/release/bundle/macos/StealthPath.app.tar.gz`
3. Staple: `xcrun stapler staple ./target/.../StealthPath.app`

Entitlements are in `src-tauri/entitlements.plist` (microphone + network + file access).

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
