# Repository Guidelines

## Project Structure & Module Organization

OnCue is a Tauri 2 desktop application. The React 19 and TypeScript frontend lives in `src/`: page-level views are in `src/pages/`, shared integrations and utilities in `src/lib/`, Zustand state in `src/stores/`, and translations in `src/i18n/`. Native commands, audio capture, and SQLite setup live in `src-tauri/src/`; Tauri capabilities, icons, and packaging configuration stay under `src-tauri/`. Use `scripts/` for focused verification utilities and `docs/` for design references. Treat `dist/`, `node_modules/`, and `src-tauri/target/` as generated output.

## Build, Test, and Development Commands

- `npm ci` installs the exact versions in `package-lock.json`.
- `npm run tauri dev` starts the full desktop app; `npm run dev` starts only Vite on port 1420.
- `npm run tauri:mac-audio` enables native macOS ScreenCaptureKit audio and requires full Xcode.
- `npm run build` type-checks the frontend and creates `dist/`.
- `npm run lint` is the intended ESLint entry point, but currently needs an `eslint.config.*` file before it can pass.
- `npm run verify:copilot` exercises the checked-in Copilot verification harness.
- `cargo test --manifest-path src-tauri/Cargo.toml` compiles and runs Rust tests.

## Coding Style & Naming Conventions

Follow the existing style: two-space indentation in TypeScript/TSX and four spaces in Rust. Use `PascalCase` for React components and pages, `camelCase` for TypeScript functions and variables, and `snake_case` for Rust modules and functions. Keep strict TypeScript types intact and avoid unused values. Run `npm run build`, and apply `cargo fmt --manifest-path src-tauri/Cargo.toml` to Rust you touch; the repository currently has unrelated rustfmt drift.

## Testing Guidelines

No unit-test framework or coverage threshold is currently configured. Add the smallest focused regression check for changed non-trivial logic. Extend `scripts/verify-copilot.mjs` for Copilot flows; place Rust unit tests beside their module in a `#[cfg(test)]` block. Always run the build, relevant verification script, and Rust tests.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, sentence-case subjects, for example `Fix macOS system audio dependency issues`. Keep each commit scoped to one change. Pull requests should explain user-visible behavior, list verification commands, link the relevant issue, and include screenshots for UI changes. Call out platform-specific audio, permission, signing, or packaging effects.

## Security & Configuration

Copy `.env.example` for local configuration, but never commit API keys, signing credentials, or generated certificates. Keep platform permissions synchronized with `src-tauri/capabilities/`, `Info.plist`, and `entitlements.plist`.
