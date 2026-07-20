#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
let passed = 0
let failed = 0

function check(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`)
    passed += 1
  } else {
    console.error(`✗ ${message}`)
    failed += 1
  }
}

function source(relativePath) {
  const absolutePath = path.join(root, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

function loadTypeScriptModule(relativePath, exports) {
  const input = source(relativePath)
  const output = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const script = output
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  return new Function(`${script}\nreturn { ${exports.join(', ')} }`)()
}

console.log('=== Stealth Copilot refactor verification ===')

const app = source('src/App.tsx')
const page = source('src/pages/StealthCopilot.tsx')
const panel = source('src/components/CopilotPanel.tsx')
const session = source('src/lib/copilotSession.ts')
const sessionState = source('src/lib/copilotSessionState.ts')
const rustWindow = source('src-tauri/src/copilot_window.rs')
const rustAudio = source('src-tauri/src/audio/mod.rs')
const cargo = source('src-tauri/Cargo.toml')

check(session.length > 0, 'single Copilot session host exists')
check(panel.length > 0 && app.includes('CopilotPanel') && page.includes('CopilotPanel'), 'main and floating views share CopilotPanel')
check(!app.includes('startDeepgramStream') && !page.includes('startDeepgramStream'), 'views do not own STT connections')
check(!app.includes("listen<number[]>('audio-chunk'") && !page.includes("listen<number[]>('audio-chunk'"), 'views do not own audio listeners')
check(session.includes('startDeepgramStream') && session.includes("listen<number[]>('audio-chunk'"), 'session host owns STT and audio events')
check(session.includes('copilot-session-command') && session.includes('copilot-session-snapshot'), 'session commands and snapshots cross webviews')

check(rustWindow.includes('.content_protected(protected)') && rustWindow.includes('set_content_protected(protected)'), 'window protection is applied on create and reuse')
check(rustWindow.includes('protection_requested') && rustWindow.includes('protection_applied'), 'native window returns truthful protection status')
check(rustWindow.includes('toggle_copilot_window'), 'native window has a real visibility toggle')

check(!cargo.includes('screencapturekit') && !cargo.includes('macos-system-audio'), 'ScreenCaptureKit dependency and feature are removed')
check(!rustAudio.includes('start_macos_capture') && !rustAudio.includes('stop_macos_capture'), 'platform-specific ScreenCaptureKit commands are removed')
check(source('src-tauri/src/audio/audiotee.rs').includes('--sample-rate') && source('src-tauri/src/audio/audiotee.rs').includes('16000'), 'AudioTee adapter is fixed to 16 kHz PCM')
check(source('src-tauri/Info.plist').includes('NSAudioCaptureUsageDescription') && !source('src-tauri/Info.plist').includes('NSScreenCaptureUsageDescription'), 'macOS declares audio capture rather than screen capture permission')

if (sessionState) {
  const { createInitialSnapshot, reduceCopilotSnapshot } = loadTypeScriptModule(
    'src/lib/copilotSessionState.ts',
    ['createInitialSnapshot', 'reduceCopilotSnapshot'],
  )
  const initial = createInitialSnapshot()
  const starting = reduceCopilotSnapshot(initial, { type: 'start', sessionId: 7 })
  const duplicateStart = reduceCopilotSnapshot(starting, { type: 'start', sessionId: 8 })
  const stopping = reduceCopilotSnapshot(starting, { type: 'stop' })
  const lateSuggestion = reduceCopilotSnapshot(stopping, {
    type: 'suggestion',
    sessionId: 7,
    suggestion: { id: 1, text: 'late', category: 'test' },
  })
  check(starting.phase === 'starting' && starting.sessionId === 7, 'idle session starts with an explicit id')
  check(duplicateStart === starting, 'duplicate start is idempotent')
  check(stopping.phase === 'stopping' && stopping.sessionId === null, 'stop invalidates the active session id immediately')
  check(lateSuggestion === stopping, 'late callbacks are ignored after stop')
}

check(!sessionState || sessionState.includes("revision: snapshot.revision + 1"), 'snapshots carry a monotonic revision')

console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
