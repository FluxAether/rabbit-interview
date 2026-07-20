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

function loadTypeScriptModule(relativePath, exports, dependencies = {}) {
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
  return new Function(...Object.keys(dependencies), `${script}\nreturn { ${exports.join(', ')} }`)(...Object.values(dependencies))
}

console.log('=== Stealth Copilot refactor verification ===')

const app = source('src/App.tsx')
const page = source('src/pages/StealthCopilot.tsx')
const panel = source('src/components/CopilotPanel.tsx')
const session = source('src/lib/copilotSession.ts')
const sessionState = source('src/lib/copilotSessionState.ts')
const db = source('src/lib/db.ts')
const rustWindow = source('src-tauri/src/copilot_window.rs')
const rustAudio = source('src-tauri/src/audio/mod.rs')
const cargo = source('src-tauri/Cargo.toml')

check(session.length > 0, 'single Copilot session host exists')
check(panel.length > 0 && app.includes('CopilotPanel') && page.includes('CopilotPanel'), 'main and floating views share CopilotPanel')
check(!app.includes('startDeepgramStream') && !page.includes('startDeepgramStream'), 'views do not own STT connections')
check(!app.includes("listen<number[]>('audio-chunk'") && !page.includes("listen<number[]>('audio-chunk'"), 'views do not own audio listeners')
check(session.includes('startDeepgramStream') && session.includes("listen<number[]>('audio-chunk'"), 'session host owns STT and audio events')
check(rustAudio.includes('"audio-source-chunk"') && session.includes("listen<AudioSourceChunk>('audio-source-chunk'"), 'system and microphone audio retain their source through transcription')
check(sessionState.includes("'system-stt' | 'microphone-stt' | 'follow-up' | 'llm'"), 'chat messages retain their exact source')
check(db.includes('CREATE TABLE IF NOT EXISTS copilot_messages') && db.includes('upsertCopilotMessage'), 'chat messages have a SQLite upsert store')
check(session.includes('upsertCopilotMessage'), 'the Copilot session persists displayed messages')
check(session.includes('copilot-session-command') && session.includes('copilot-session-snapshot'), 'session commands and snapshots cross webviews')
check(session.includes('await host.dispatch(command)'), 'main-window commands are handled directly by the active session host')

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
  const listening = reduceCopilotSnapshot(starting, { type: 'started', sessionId: 7, mode: 'system+microphone' })
  const duplicateStart = reduceCopilotSnapshot(starting, { type: 'start', sessionId: 8 })
  const stopping = reduceCopilotSnapshot(starting, { type: 'stop' })
  const lateSuggestion = reduceCopilotSnapshot(stopping, {
    type: 'suggestion',
    sessionId: 7,
    suggestion: { id: 1, text: 'late', category: 'test' },
  })
  const interviewerMessage = reduceCopilotSnapshot(starting, {
    type: 'message',
    sessionId: 7,
    message: { id: 1, role: 'interviewer', source: 'system-stt', text: 'Tell me about yourself.' },
  })
  const myMessage = reduceCopilotSnapshot(interviewerMessage, {
    type: 'message',
    sessionId: 7,
    message: { id: 2, role: 'me', source: 'microphone-stt', text: 'I build desktop applications.' },
  })
  const followUpMessage = reduceCopilotSnapshot(myMessage, {
    type: 'message',
    sessionId: 7,
    message: { id: 3, role: 'me', source: 'follow-up', text: 'Can you make that more concise?' },
  })
  const assistantMessage = reduceCopilotSnapshot(followUpMessage, {
    type: 'replace-suggestions',
    sessionId: 7,
    suggestions: [{ id: 4, text: 'Lead with a concise example.', category: 'test' }],
  })
  check(starting.phase === 'starting' && starting.sessionId === 7, 'idle session starts with an explicit id')
  check(listening.phase === 'listening' && listening.audioMode === 'system+microphone', 'native audio mode is reflected in the shared snapshot')
  check(duplicateStart === starting, 'duplicate start is idempotent')
  check(stopping.phase === 'stopping' && stopping.sessionId === null, 'stop invalidates the active session id immediately')
  check(lateSuggestion === stopping, 'late callbacks are ignored after stop')
  check(interviewerMessage.question === 'Tell me about yourself.', 'system audio transcript becomes the interviewer question')
  check(assistantMessage.messages.map((message) => message.role).join(',') === 'interviewer,me,me,assistant', 'chat snapshot preserves interviewer, user, follow-up, and AI roles')
  check(assistantMessage.messages.map((message) => message.source).join(',') === 'system-stt,microphone-stt,follow-up,llm', 'chat snapshot preserves all four message sources in order')
}

check(!sessionState || sessionState.includes("revision: snapshot.revision + 1"), 'snapshots carry a monotonic revision')
check(session.includes("type: 'request-snapshot'"), 'floating clients request a fresh snapshot after connecting')

const windowState = source('src/lib/copilotWindowState.ts')
if (windowState) {
  const { protectionMessageKey } = loadTypeScriptModule(
    'src/lib/copilotWindowState.ts',
    ['protectionMessageKey'],
  )
  check(protectionMessageKey(null) === 'copilot.protection.disabled', 'missing window status is reported as protection disabled')
  check(protectionMessageKey({ platform_supported: true, protection_requested: true, protection_applied: true, request_dispatched: true }) === 'copilot.protection.enabled', 'confirmed protection has an enabled status')
  check(protectionMessageKey({ platform_supported: true, protection_requested: true, protection_applied: false, request_dispatched: true }) === 'copilot.protection.unconfirmed', 'unconfirmed native protection is not reported as enabled')
}

const { parseSseEventData } = loadTypeScriptModule('src/lib/llm.ts', ['parseSseEventData'])
const multilineSse = parseSseEventData('event: message\ndata: {\ndata: "value": 1\ndata: }')
check(JSON.parse(multilineSse).value === 1, 'multi-line SSE data fields are reassembled before parsing')

let latestSocket = null
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    latestSocket = this
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
}

const { startDeepgramStream } = loadTypeScriptModule(
  'src/lib/llm.ts',
  ['startDeepgramStream'],
  {
    loadApiKeys: async () => ({ deepgram: 'test-key' }),
    getLlmApiKey: async () => null,
    useAppStore: { getState: () => ({ settings: { sttProvider: 'deepgram', sttModel: 'nova-3', sttLanguage: 'zh-CN' } }) },
    WebSocket: FakeWebSocket,
  },
)
let deepgramReady = false
const deepgramOpening = startDeepgramStream(() => {}).then((socket) => {
  deepgramReady = true
  return socket
})
await new Promise((resolve) => setImmediate(resolve))
check(latestSocket !== null && !deepgramReady, 'capture waits for the Deepgram socket to open')
check(latestSocket?.url.includes('endpointing=300') && latestSocket.url.includes('vad_events=true'), 'fixed-language STT uses stable endpoint detection')
latestSocket?.open()
check(await deepgramOpening === latestSocket, 'Deepgram startup resolves with the opened socket')

console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
