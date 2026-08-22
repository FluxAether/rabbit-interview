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
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import ['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export /gm, '')
  return new Function(...Object.keys(dependencies), `${script}\nreturn { ${exports.join(', ')} }`)(...Object.values(dependencies))
}

console.log('=== Stealth Copilot refactor verification ===')

const app = source('src/App.tsx')
const page = source('src/pages/StealthCopilot.tsx')
const settingsPage = source('src/pages/Settings.tsx')
const settingsStore = source('src/lib/settingsStore.ts')
const translations = source('src/i18n/translations.ts')
const historyPage = source('src/pages/History.tsx')
const panel = source('src/components/CopilotPanel.tsx')
const session = source('src/lib/copilotSession.ts')
const sessionState = source('src/lib/copilotSessionState.ts')
const db = source('src/lib/db.ts')
const archive = source('src/lib/copilotArchive.ts')
const turnDetector = source('src/lib/interviewerTurnDetector.ts')
const llm = source('src/lib/llm.ts')
const windowBridge = source('src/lib/copilotWindow.ts')
const rustLib = source('src-tauri/src/lib.rs')
const rustWindow = source('src-tauri/src/copilot_window.rs')
const rustAudio = source('src-tauri/src/audio/mod.rs')
const cargo = source('src-tauri/Cargo.toml')
const defaultCapability = source('src-tauri/capabilities/default.json')
const tauriConfig = source('src-tauri/tauri.conf.json')

check(session.length > 0, 'single Copilot session host exists')
check(panel.length > 0 && app.includes('CopilotPanel') && page.includes('CopilotPanel'), 'main and floating views share CopilotPanel')
check(page.includes('values.includes(preferredDevice) ? preferredDevice : values[0] ||'), 'unavailable saved microphone falls back to an available device')
check(!app.includes('startDeepgramStream') && !page.includes('startDeepgramStream'), 'views do not own STT connections')
check(
  settingsPage.includes('testDeepgramConnection(targetKey)')
    && !settingsPage.includes("fetch('https://api.deepgram.com/v1/projects'"),
  'Deepgram connectivity uses the speech WebSocket instead of a CORS-blocked REST request',
)
check(
  settingsPage.includes('Google AI Studio')
    && settingsPage.includes('GEMINI_LIVE_TRANSLATE_MODEL')
    && settingsPage.includes("updateSttConfig('gemini'")
    && /testGeminiLiveConnection\(\s*targetKey,\s*sttLanguage,\s*language\s*\)/.test(settingsPage),
  'STT settings expose Google AI Studio and test its Live API handshake',
)
check(
  (translations.match(/'settings\.stt\.(?:desc|help)': .*Google/g) || []).length >= 3
    && (translations.match(/'settings\.stt\.sourceOnly'/g) || []).length === 3
    && (translations.match(/'settings\.stt\.inputLanguage'/g) || []).length === 3
    && !translations.includes('currently powered by Deepgram')
    && !translations.includes('隐形助手的实时转写，目前由 Deepgram 提供。')
    && !translations.includes('隱形助手的即時轉寫，目前由 Deepgram 提供。'),
  'STT provider guidance covers Google in all locales without claiming Deepgram exclusivity',
)
check(
  settingsStore.includes("export type SttProvider = 'deepgram' | 'gemini'")
    && !llm.match(/SUPPORTED_GEMINI_MODELS[^;]+;/s)?.[0].includes('gemini-3.5-live-translate-preview'),
  'Gemini Live Translate is typed as STT-only and is not offered as a regular LLM',
)
check(!app.includes("listen<number[]>('audio-chunk'") && !page.includes("listen<number[]>('audio-chunk'"), 'views do not own audio listeners')
check(
  session.includes('startDeepgramStream')
    && session.includes("listen<AudioSourceChunk>('audio-source-chunk'")
    && session.includes("listen<number>('audio-amplitude'"),
  'session host owns STT and lightweight audio events',
)
check(
  session.includes('private captureId: number | null = null')
    && session.includes("captureOwner: 'copilot'"),
  'Copilot tracks its native audio capture lease',
)
check(
  session.includes('if (this.captureId === null) return')
    && session.includes("invoke('stop_audio_capture', { captureId })")
    && !session.includes("invoke('stop_audio_capture').catch"),
  'Copilot can only stop the native capture it owns',
)
check(rustAudio.includes('"audio-source-chunk"') && session.includes("listen<AudioSourceChunk>('audio-source-chunk'"), 'system and microphone audio retain their source through transcription')
check(sessionState.includes("'system-stt' | 'microphone-stt' | 'follow-up' | 'llm'"), 'chat messages retain their exact source')
check(!db.includes('upsertCopilotMessage') && !db.includes('copilot_messages'), 'write-only copilot_messages path is removed')
check(!session.includes('upsertCopilotMessage'), 'copilot session no longer writes per-message SQLite rows')
check(
  session.includes('archiveSession(archiveSnapshot, persistenceSessionId)')
    && session.includes("invoke<SavedRecording | null>('save_audio_recording'")
    && session.includes('saveInterview(record)'),
  'stopping capture automatically archives the session and native recording',
)
check(
  rustAudio.includes('live_recording: Mutex<Option<LiveRecording>>')
    && rustAudio.includes('append_live_recording')
    && rustAudio.includes('finalize_live_recording')
    && rustAudio.includes('save_audio_recording')
    && rustAudio.includes('write_wav_header'),
  'the native audio layer streams capture data into a live WAV file',
)
check(
  rustLib.includes('save_audio_recording') && rustLib.includes('export_audio_recording'),
  'native archive and export recording commands are registered with Tauri',
)
check(
  !rustAudio.includes('"audio-chunk"')
    && !session.includes("listen<number[]>('audio-chunk'")
    && session.includes("invoke<SavedRecording | null>('export_audio_recording'"),
  'full recordings stay in native storage instead of being duplicated in the WebView',
)
check(
  rustAudio.includes('finalize_live_recording')
    && rustAudio.includes('last_recording: Mutex<Option<SavedRecording>>'),
  'successful native archive finalizes the live recording file',
)
check(
  db.includes('recording_path TEXT')
    && db.includes('ALTER TABLE interviews ADD COLUMN recording_path TEXT')
    && db.includes('recording_path AS recordingPath'),
  'interview history migrates and stores the recording path',
)
check(archive.includes('createCopilotInterviewRecord'), 'automatic archives use one transcript record builder')
check(source('src/lib/copilotScoring.ts').includes('buildCopilotQaPairs') && session.includes('scoreCopilotSession'), 'ending a session scores interviewer questions against microphone answers')
check(!page.includes('saveSession = async') && page.includes('copilot.archive.autoSaveHint'), 'the page no longer requires a manual session-save action')
check(
  historyPage.includes('convertFileSrc(selected.recordingPath)')
    && !historyPage.includes('data:audio/wav;base64')
    && tauriConfig.includes('$APPDATA/recordings/**'),
  'history replay loads the saved WAV file through the scoped asset protocol',
)
check(defaultCapability.includes('sql:allow-execute'), 'SQLite write operations are explicitly allowed')
check(
  turnDetector.includes('getInterviewerCommitDelay')
    && session.includes('getInterviewerCommitDelay')
    && session.includes('shouldInterruptForInterviewerContinuation'),
  'interviewer turns use adaptive commit timing and continuation-aware interruption',
)
check(
  llm.includes("'speech-final' | 'utterance-end'")
    && session.includes("event.boundary === 'utterance-end'"),
  'Deepgram speech-final and utterance-end signals remain distinct through turn detection',
)
check(session.includes('MAX_AUTO_CONTINUATIONS') && session.includes('continuationAttempt < MAX_AUTO_CONTINUATIONS'), 'token-limited answers are automatically continued with a bounded retry count')
check(session.includes('textSimilarity') && session.includes('isLikelyEcho'), 'system-audio echo is filtered against recent AI and microphone text')
check(session.includes("text.replace(/\\s/g, '').length < 12"), 'short interviewer acknowledgements are never discarded as echo')
check(!session.includes('queueMessagePersistence'), 'per-message SQLite persistence queue is gone')
check(panel.includes('copilot.answerStatus') && panel.includes('copilot.answerNotice'), 'the UI distinguishes generating, continuing, and incomplete answers')
check(session.includes("type: 'cancel-answer'"), 'interrupted streaming answers are removed instead of remaining as partial chat messages')
check(session.includes("type: 'cancel-answer'") && session.includes("type: 'archive-saving'"), 'streaming answers still cancel and archive without per-message DB writes')
check(session.includes('copilot-session-command') && session.includes('copilot-session-snapshot'), 'session commands and snapshots cross webviews')
check(session.includes('await host.dispatch(command)'), 'main-window commands are handled directly by the active session host')
check(!llm.includes('STAR') && !llm.includes('interview suggestions'), 'AI answers directly without a fixed STAR or suggestion template')
check(llm.includes('without Markdown headings'), 'AI answers are requested as speakable plain paragraphs rather than raw Markdown headings')
check(llm.includes('MAX_DEEPGRAM_BUFFERED_BYTES') && llm.includes('ws.bufferedAmount'), 'STT websocket backpressure bounds queued audio memory')
check(llm.includes('KeepAlive') && llm.includes('scheduleDeepgramReconnect') && llm.includes('onSocketChange'), 'Deepgram streams keep alive and reconnect after disconnects')
check(rustAudio.includes('24 * 60 * 60') && rustAudio.includes('begin_live_recording'), 'native live recording starts with the session and caps at 24 hours')
check(
  rustAudio.includes('notify_recording_limit')
    && rustAudio.includes('"audio-recording-limit"')
    && rustAudio.includes('limit_notified'),
  'native live recording emits a one-shot limit event at the 24-hour cap',
)
check(
  source('src/lib/recordingLimits.ts').includes('export const MAX_RECORDING_SECONDS = 24 * 60 * 60')
    && session.includes("from './recordingLimits'")
    && session.includes("listen('audio-recording-limit'")
    && session.includes("void this.stop({ reason: 'limit' })")
    && session.includes('scheduleLimitStop(sessionId)')
    && session.includes("'copilot.archive.limitReached'"),
  'Copilot auto-stops and archives when the recording limit is reached',
)
check(
  (source('src/i18n/translations.ts').split("'copilot.archive.limitReached'").length - 1) === 3,
  'copilot.archive.limitReached is translated in all locales',
)
check(sessionState.includes('createdAt: number') && sessionState.includes('startedAt: number | null'), 'chat messages and sessions track timestamps')
check(panel.includes('formatClock') && panel.includes('formatElapsed') && panel.includes('copilot.sessionDuration'), 'chat UI shows message times and interview duration')

check(rustWindow.includes('.content_protected(protected)') && rustWindow.includes('set_content_protected(protected)'), 'window protection is applied on create and reuse')
check(rustWindow.includes('protection_requested') && rustWindow.includes('protection_applied'), 'native window returns truthful protection status')
check(rustWindow.includes('toggle_copilot_window'), 'native window has a real visibility toggle')
check(
  panel.includes('setCopilotWindowOpacity(value / 100)')
    && windowBridge.includes("invoke('set_copilot_window_opacity', { opacity })")
    && (rustLib.match(/set_copilot_window_opacity/g)?.length ?? 0) >= 2
    && rustWindow.includes('setAlphaValue')
    && rustWindow.includes('SetLayeredWindowAttributes')
    && cargo.includes('"Win32_Foundation"'),
  'opacity control updates the entire native Copilot window on macOS and Windows',
)

check(!cargo.includes('screencapturekit') && !cargo.includes('macos-system-audio'), 'ScreenCaptureKit dependency and feature are removed')
check(!rustAudio.includes('start_macos_capture') && !rustAudio.includes('stop_macos_capture'), 'platform-specific ScreenCaptureKit commands are removed')
check(source('src-tauri/src/audio/audiotee.rs').includes('--sample-rate') && source('src-tauri/src/audio/audiotee.rs').includes('16000'), 'AudioTee adapter is fixed to 16 kHz PCM')
check(source('src-tauri/Info.plist').includes('NSAudioCaptureUsageDescription') && !source('src-tauri/Info.plist').includes('NSScreenCaptureUsageDescription'), 'macOS declares audio capture rather than screen capture permission')

let storedSettings = JSON.stringify({ sttProvider: 'gemini', sttModel: 'not-a-live-model' })
let savedSettings = ''
const { DEFAULT_SETTINGS, loadAppSettings, saveAppSettings } = loadTypeScriptModule(
  'src/lib/settingsStore.ts',
  ['DEFAULT_SETTINGS', 'loadAppSettings', 'saveAppSettings'],
  {
    loadAppSettingsJson: async () => storedSettings,
    migrateLegacyJsonStoresIfNeeded: async () => {},
    saveAppSettingsJson: async (value) => { savedSettings = value },
    encryptSecret: async (value) => value,
  },
)
const normalizedGeminiSettings = await loadAppSettings()
check(
  normalizedGeminiSettings.sttProvider === 'gemini'
    && normalizedGeminiSettings.sttModel === 'gemini-3.5-live-translate-preview',
  'Gemini STT settings normalize to the only supported Live Translate model',
)
storedSettings = JSON.stringify({ sttProvider: 'unknown', sttModel: 'unknown' })
const normalizedUnknownSettings = await loadAppSettings()
check(
  normalizedUnknownSettings.sttProvider === 'deepgram'
    && normalizedUnknownSettings.sttModel === 'nova-3',
  'unknown STT settings fall back to Deepgram nova-3',
)
await saveAppSettings({ sttProvider: 'gemini', sttModel: 'gemini-3.5-live-translate-preview' })
check(
  JSON.parse(savedSettings).sttProvider === 'gemini'
    && JSON.parse(savedSettings).sttModel === 'gemini-3.5-live-translate-preview'
    && DEFAULT_SETTINGS.sttProvider === 'deepgram'
    && DEFAULT_SETTINGS.sttModel === 'nova-3',
  'Google STT selection persists without changing the Deepgram default',
)

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
    message: { id: 1, role: 'interviewer', source: 'system-stt', text: 'Tell me about yourself.', createdAt: 1_000 },
  })
  const myMessage = reduceCopilotSnapshot(interviewerMessage, {
    type: 'message',
    sessionId: 7,
    message: { id: 2, role: 'me', source: 'microphone-stt', text: 'I build desktop applications.', createdAt: 2_000 },
  })
  const followUpMessage = reduceCopilotSnapshot(myMessage, {
    type: 'message',
    sessionId: 7,
    message: { id: 3, role: 'me', source: 'follow-up', text: 'Can you make that more concise?', createdAt: 3_000 },
  })
  const longAnswer = Array.from({ length: 12 }, (_, index) => `完整回答第 ${index + 1} 段`).join('\n')
  const assistantMessage = reduceCopilotSnapshot(followUpMessage, {
    type: 'complete-answer',
    sessionId: 7,
    answerId: 4,
    answer: longAnswer,
    suggestions: [{ id: 4, text: 'Lead with a concise example.', category: 'test' }],
  })
  const firstStreamingAnswer = reduceCopilotSnapshot(followUpMessage, {
    type: 'stream-answer',
    sessionId: 7,
    suggestion: { id: 10, text: 'partial first answer', category: 'test' },
  })
  const secondStreamingAnswer = firstStreamingAnswer && reduceCopilotSnapshot(firstStreamingAnswer, {
    type: 'stream-answer',
    sessionId: 7,
    suggestion: { id: 11, text: 'partial replacement answer', category: 'test' },
  })
  const cancelledStreamingAnswer = secondStreamingAnswer && reduceCopilotSnapshot(secondStreamingAnswer, {
    type: 'cancel-answer',
    sessionId: 7,
    answerId: 11,
  })
  const continuingAnswer = reduceCopilotSnapshot(firstStreamingAnswer, {
    type: 'stream-answer',
    sessionId: 7,
    continuing: true,
    suggestion: { id: 10, text: 'partial first answer continued', category: 'test' },
  })
  const incompleteAnswer = reduceCopilotSnapshot(continuingAnswer, {
    type: 'incomplete-answer',
    sessionId: 7,
    answerId: 10,
    text: 'partial first answer continued but unfinished',
    reason: 'copilot.answer.incomplete.connection',
  })
  const stoppedIncompleteAnswer = reduceCopilotSnapshot(incompleteAnswer, { type: 'stop' })
  const savingArchive = reduceCopilotSnapshot(stopping, { type: 'archive-saving' })
  const savedArchive = reduceCopilotSnapshot(savingArchive, {
    type: 'archive-saved',
    notice: 'copilot.archive.saved',
  })
  const failedArchive = reduceCopilotSnapshot(savingArchive, {
    type: 'archive-error',
    notice: 'disk full',
  })
  check(starting.phase === 'starting' && starting.sessionId === 7 && typeof starting.startedAt === 'number', 'idle session starts with an explicit id and start time')
  check(listening.phase === 'listening' && listening.audioMode === 'system+microphone', 'native audio mode is reflected in the shared snapshot')
  check(duplicateStart === starting, 'duplicate start is idempotent')
  check(stopping.phase === 'stopping' && stopping.sessionId === null, 'stop invalidates the active session id immediately')
  check(lateSuggestion === stopping, 'late callbacks are ignored after stop')
  check(interviewerMessage.question === 'Tell me about yourself.', 'system audio transcript becomes the interviewer question')
  check(assistantMessage?.messages.map((message) => message.role).join(',') === 'interviewer,me,me,assistant', 'chat snapshot preserves interviewer, user, follow-up, and AI roles')
  check(assistantMessage?.messages.map((message) => message.source).join(',') === 'system-stt,microphone-stt,follow-up,llm', 'chat snapshot preserves all four message sources in order')
  check(assistantMessage?.messages.every((message) => typeof message.createdAt === 'number'), 'chat messages always include a send timestamp')
  check(assistantMessage?.activeAnswerId === null, 'completed AI answers are marked final')
  check(
    assistantMessage?.messages.find((message) => message.id === 4)?.text === longAnswer,
    'completed chat messages retain the full answer instead of the six-line suggestion preview',
  )
  check(
    secondStreamingAnswer?.activeAnswerId === 11
      && secondStreamingAnswer.messages.filter((message) => message.role === 'assistant').map((message) => message.id).join(',') === '11',
    'starting a replacement stream cannot leave the previous partial AI answer in chat',
  )
  check(
    cancelledStreamingAnswer?.activeAnswerId === null
      && cancelledStreamingAnswer.messages.every((message) => message.id !== 11),
    'cancelling a stream removes its incomplete AI message',
  )
  check(continuingAnswer?.answerStatus === 'continuing', 'automatic continuation has a distinct shared UI state')
  check(
    incompleteAnswer?.answerStatus === 'incomplete'
      && incompleteAnswer.answerNotice === 'copilot.answer.incomplete.connection',
    'terminal partial answers are explicitly marked incomplete',
  )
  check(
    stoppedIncompleteAnswer?.messages.some((message) => message.id === 10)
      && stoppedIncompleteAnswer.activeAnswerId === null,
    'stopping capture preserves a terminal incomplete answer instead of deleting it',
  )
  check(
    savingArchive?.archiveStatus === 'saving'
      && savedArchive?.archiveStatus === 'saved'
      && savedArchive.archiveNotice === 'copilot.archive.saved',
    'automatic archive progress remains visible after the active session id is invalidated',
  )
  check(
    failedArchive?.archiveStatus === 'error' && failedArchive.archiveNotice === 'disk full',
    'automatic archive failures are exposed to the user',
  )
  let retainedHistory = starting
  for (let index = 1; index <= 81; index += 1) {
    retainedHistory = reduceCopilotSnapshot(retainedHistory, {
      type: 'message',
      sessionId: 7,
      message: {
        id: 100 + index,
        role: index % 2 === 0 ? 'me' : 'interviewer',
        source: index % 2 === 0 ? 'microphone-stt' : 'system-stt',
        text: `turn ${index}`,
        createdAt: index,
      },
    })
  }
  check(
    retainedHistory.messages.length === 81
      && retainedHistory.messages[0]?.text === 'turn 1'
      && retainedHistory.messages[80]?.text === 'turn 81',
    'chat snapshot keeps the full current session instead of dropping messages after 80',
  )
}

const { createCopilotInterviewRecord, generateCopilotSessionTitle } = loadTypeScriptModule(
  'src/lib/copilotArchive.ts',
  ['createCopilotInterviewRecord', 'generateCopilotSessionTitle'],
)
const archivedRecord = createCopilotInterviewRecord(
  [
    { id: 1, role: 'interviewer', source: 'system-stt', text: 'Tell me about yourself.', createdAt: 1_000 },
    { id: 2, role: 'assistant', source: 'llm', text: 'I build reliable desktop systems.', createdAt: 2_000 },
  ],
  42,
  '/tmp/interview.wav',
  new Date('2026-07-20T15:55:00.000Z'),
)
check(
  archivedRecord.transcript === 'Interviewer: Tell me about yourself.\nAI: I build reliable desktop systems.'
    && archivedRecord.duration === 42
    && archivedRecord.recordingPath === '/tmp/interview.wav'
    && archivedRecord.role === 'Tell me about yourself.'
    && archivedRecord.company === 'Stealth Copilot'
    && archivedRecord.score === null,
  'automatic archive records contain the complete transcript, duration, and recording path',
)
const scoredRecord = createCopilotInterviewRecord(
  [
    { id: 1, role: 'interviewer', source: 'system-stt', text: 'Tell me about yourself.', createdAt: 1_000 },
    { id: 2, role: 'me', source: 'microphone-stt', text: 'I ship desktop interview tools.', createdAt: 2_000 },
  ],
  42,
  '/tmp/interview.wav',
  new Date('2026-07-20T15:55:00.000Z'),
  {
    overallScore: 86,
    strengths: ['clear'],
    improvements: ['add metrics'],
    summary: 'Solid answers with room for metrics.',
    answeredQuestionCount: 1,
  },
)
check(
  scoredRecord.score === 86
    && scoredRecord.detailsJson?.includes('"overallScore":86'),
  'scored archive records persist overall score details',
)

const { buildCopilotQaPairs } = loadTypeScriptModule(
  'src/lib/copilotScoring.ts',
  ['buildCopilotQaPairs'],
)
const pairs = buildCopilotQaPairs([
  { id: 1, role: 'interviewer', source: 'system-stt', text: 'Tell me about yourself.', createdAt: 1 },
  { id: 2, role: 'assistant', source: 'llm', text: 'Ignore this AI suggestion.', createdAt: 2 },
  { id: 3, role: 'me', source: 'microphone-stt', text: 'I build desktop tools.', createdAt: 3 },
  { id: 4, role: 'me', source: 'follow-up', text: 'make it shorter', createdAt: 4 },
  { id: 5, role: 'interviewer', source: 'system-stt', text: 'Why this role?', createdAt: 5 },
  { id: 6, role: 'me', source: 'microphone-stt', text: 'I enjoy product interviews.', createdAt: 6 },
])
check(
  pairs.length === 2
    && pairs[0].question === 'Tell me about yourself.'
    && pairs[0].answer === 'I build desktop tools.'
    && pairs[1].question === 'Why this role?'
    && pairs[1].answer === 'I enjoy product interviews.',
  'scoring pairs use interviewer questions and microphone answers only',
)
check(
  generateCopilotSessionTitle([
    { id: 1, role: 'me', source: 'microphone-stt', text: '  我先介绍项目背景，  然后讲结果。  ', createdAt: 1_000 },
  ]) === '我先介绍项目背景， 然后讲结果。',
  'session titles fall back to the first user message when no interviewer question exists',
)
check(
  generateCopilotSessionTitle([
    { id: 1, role: 'interviewer', source: 'system-stt', text: '请详细说明你在高峰流量下如何定位并修复支付超时问题，并给出具体指标，同时说明你如何和业务方对齐优先级。', createdAt: 1_000 },
  ]) === '请详细说明你在高峰流量下如何定位并修复支付超时问题，并给出具体指标，同时说明你如何和业务方对齐…',
  'long session titles are truncated for history display',
)
check(
  generateCopilotSessionTitle([]) === 'Live Interview',
  'empty sessions keep a default title',
)

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

const { mergeContinuationText, textSimilarity } = loadTypeScriptModule(
  'src/lib/copilotText.ts',
  ['mergeContinuationText', 'textSimilarity'],
)
check(
  mergeContinuationText('前半段回答包含关键细节', '回答包含关键细节，并给出最终结果。') === '前半段回答包含关键细节，并给出最终结果。',
  'continuation chunks are merged without repeating their overlapping prefix',
)
check(
  textSimilarity('在周五晚餐高峰，我先安抚排队顾客并协调后厨。', '周五晚餐高峰时，我先安抚排队的顾客，同时协调后厨。') >= 0.68,
  'near-duplicate spoken AI text is recognized as likely audio echo',
)
check(
  textSimilarity('完整回答：在周五晚餐高峰，我先安抚排队顾客并协调后厨，随后恢复系统。', '我先安抚排队顾客并协调后厨') === 1,
  'an exact spoken fragment inside a longer AI answer is treated as strong echo',
)
check(
  textSimilarity('请介绍一下你的项目经验', '我先安抚顾客并协调后厨') < 0.5,
  'unrelated interviewer questions are not suppressed by the echo filter',
)

const { parseSseEventData } = loadTypeScriptModule('src/lib/llm.ts', ['parseSseEventData'])
const multilineSse = parseSseEventData('event: message\ndata: {\ndata: "value": 1\ndata: }')
check(JSON.parse(multilineSse).value === 1, 'multi-line SSE data fields are reassembled before parsing')

let followUpRequest = null
const { generateSuggestionsStream: generateFollowUp } = loadTypeScriptModule(
  'src/lib/llm.ts',
  ['generateSuggestionsStream'],
  {
    loadApiKeys: async () => ({}),
    getLlmApiKey: async () => 'test-key',
    useAppStore: { getState: () => ({ settings: { aiModel: 'gpt-4o-mini' } }) },
    fetch: async (_url, init) => {
      followUpRequest = JSON.parse(init.body)
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    },
  },
)
const followUpResult = await generateFollowUp(
  '请把上一条答案改短一些',
  'Previous turn:\nQuestion: 介绍一下你自己\nAnswer: 原答案',
  { onDelta: () => {}, onComplete: () => {} },
  undefined,
  'follow-up',
)
check(followUpRequest?.messages?.[0]?.content.includes('user follow-up'), 'follow-up uses a conversational system instruction')
check(followUpResult?.status === 'complete' && followUpResult?.finishReason === 'stop', 'normal model stop reasons are preserved as complete stream results')
check(followUpRequest?.max_completion_tokens >= 600, 'streaming answers have enough output budget to finish detailed responses')
check(llm.includes("normalizedModel.startsWith('gpt-5')") && llm.includes('2_400'), 'reasoning-heavy OpenAI models receive a larger completion budget')
check(
  followUpRequest?.messages?.[1]?.content.includes('User follow-up: 请把上一条答案改短一些')
    && !followUpRequest?.messages?.[1]?.content.includes('Interviewer question: 请把上一条答案改短一些'),
  'follow-up is not mislabeled as a new interviewer question',
)

const createOpenAiStreamHarness = (body) => loadTypeScriptModule(
  'src/lib/llm.ts',
  ['generateSuggestionsStream'],
  {
    loadApiKeys: async () => ({}),
    getLlmApiKey: async () => 'test-key',
    useAppStore: { getState: () => ({ settings: { aiModel: 'gpt-4o-mini' } }) },
    fetch: async () => new Response(body),
  },
).generateSuggestionsStream

const truncatedStreamResult = await createOpenAiStreamHarness(
  'data: {"choices":[{"delta":{"content":"回答停在半句"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
)('问题', '', { onDelta: () => {}, onComplete: () => {} })
check(
  truncatedStreamResult?.status === 'max-tokens' && truncatedStreamResult?.finishReason === 'length',
  'token-limit finishes are detected instead of being marked complete',
)

const missingFinishResult = await createOpenAiStreamHarness(
  'data: {"choices":[{"delta":{"content":"连接提前结束"},"finish_reason":null}]}\n\ndata: [DONE]\n\n',
)('问题', '', { onDelta: () => {}, onComplete: () => {} })
check(
  missingFinishResult?.status === 'incomplete',
  'streams without an explicit finish reason are treated as incomplete',
)

let connectionChunkSent = false
const connectionLostStream = new ReadableStream({
  pull(controller) {
    if (!connectionChunkSent) {
      connectionChunkSent = true
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"网络中断前的部分回答"},"finish_reason":null}]}\n\n'))
      return
    }
    controller.error(new Error('socket reset'))
  },
})
const { generateSuggestionsStream: generateConnectionLost } = loadTypeScriptModule(
  'src/lib/llm.ts',
  ['generateSuggestionsStream'],
  {
    loadApiKeys: async () => ({}),
    getLlmApiKey: async () => 'test-key',
    useAppStore: { getState: () => ({ settings: { aiModel: 'gpt-4o-mini' } }) },
    fetch: async () => new Response(connectionLostStream),
  },
)
const connectionLostResult = await generateConnectionLost('问题', '', { onDelta: () => {} })
check(
  connectionLostResult?.status === 'incomplete'
    && connectionLostResult?.finishReason === 'connection_lost'
    && connectionLostResult?.text.includes('网络中断前的部分回答'),
  'reader failures preserve partial text and report a connection-lost terminal state',
)

let continuationRequest = null
const { generateSuggestionsStream: generateContinuation } = loadTypeScriptModule(
  'src/lib/llm.ts',
  ['generateSuggestionsStream'],
  {
    loadApiKeys: async () => ({}),
    getLlmApiKey: async () => 'test-key',
    useAppStore: { getState: () => ({ settings: { aiModel: 'gpt-4o-mini' } }) },
    fetch: async (_url, init) => {
      continuationRequest = JSON.parse(init.body)
      return new Response('data: {"choices":[{"delta":{"content":"最终结果。"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    },
  },
)
await generateContinuation(
  '请描述最有挑战的经历',
  '',
  { onDelta: () => {} },
  undefined,
  'interviewer-question',
  { continuationText: '当时系统全面瘫痪，我先协调团队', continuationAttempt: 1 },
)
check(
  continuationRequest?.messages?.[1]?.content.includes('Partial answer so far:')
    && continuationRequest?.messages?.[1]?.content.includes('Do not restart, repeat'),
  'continuation requests instruct the model to resume without restarting or repeating',
)

const {
  getInterviewerCommitDelay,
  isLikelyIncompleteInterviewPrompt,
  shouldInterruptForInterviewerContinuation,
} = loadTypeScriptModule(
  'src/lib/interviewerTurnDetector.ts',
  [
    'getInterviewerCommitDelay',
    'isLikelyIncompleteInterviewPrompt',
    'shouldInterruptForInterviewerContinuation',
  ],
)
check(
  getInterviewerCommitDelay('请介绍一下你上一个项目。', 'speech-final') === 180,
  'complete interview prompts use the fast commit path',
)
check(
  isLikelyIncompleteInterviewPrompt('你负责什么，以及')
    && getInterviewerCommitDelay('你负责什么，以及', 'speech-final') === 700,
  'incomplete prompts retain a longer merge window',
)
check(
  getInterviewerCommitDelay('任意已经确认的文本', 'utterance-end') === 0,
  'Deepgram utterance-end commits an assembled question immediately',
)
check(
  shouldInterruptForInterviewerContinuation(
    '请介绍一下你上一个项目。',
    '另外，请结合一个具体故障举例。',
    1_000,
  ),
  'early interviewer additions interrupt and rebuild an active answer',
)
check(
  !shouldInterruptForInterviewerContinuation(
    '请介绍一下你上一个项目。',
    '下一个问题，为什么离开上一家公司？',
    1_000,
  ),
  'explicit new questions do not interrupt the current answer as continuations',
)

const createProviderHarness = (aiModel, body) => loadTypeScriptModule(
  'src/lib/llm.ts',
  ['generateSuggestionsStream'],
  {
    loadApiKeys: async () => ({}),
    getLlmApiKey: async () => 'test-key',
    useAppStore: { getState: () => ({ settings: { aiModel } }) },
    fetch: async () => new Response(body),
  },
).generateSuggestionsStream

const groqResult = await createProviderHarness(
  'groq:llama-3.1-8b-instant',
  'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
)('question', '', { onDelta: () => {} })
check(groqResult?.provider === 'groq' && groqResult?.status === 'complete', 'Groq finish reasons are parsed from OpenAI-compatible streams')

const anthropicResult = await createProviderHarness(
  'claude-haiku-4-5',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
)('question', '', { onDelta: () => {} })
check(
  anthropicResult?.provider === 'anthropic' && anthropicResult?.status === 'max-tokens',
  'Anthropic max_tokens stop reasons trigger continuation',
)

const geminiResult = await createProviderHarness(
  'gemini-3.6-flash',
  'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\ndata: {"candidates":[{"finishReason":"STOP"}]}\n\n',
)('question', '', { onDelta: () => {} })
check(
  geminiResult?.provider === 'gemini' && geminiResult?.status === 'complete',
  'Gemini finishReason values are parsed as explicit stream completion',
)

let latestSocket = null
const fakeSockets = []
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3

  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.readyState = FakeWebSocket.CONNECTING
    this.bufferedAmount = 0
    this.sent = []
    fakeSockets.push(this)
    latestSocket = this
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({})
  }

  send(data) {
    this.sent.push(data)
  }

  receive(data) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  close(code = 1000) {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, wasClean: code === 1000 })
  }

  disconnect() {
    this.close(1006)
  }
}

const flushTasks = () => new Promise((resolve) => setImmediate(resolve))

function createFakeTimers() {
  const timers = []
  const schedule = (type) => (callback, delay = 0) => {
    const timer = { type, callback, delay, cleared: false, unref() {} }
    timers.push(timer)
    return timer
  }
  const clear = (timer) => {
    if (timer) timer.cleared = true
  }
  return {
    global: {
      setTimeout: schedule('timeout'),
      clearTimeout: clear,
      setInterval: schedule('interval'),
      clearInterval: clear,
    },
    pending(delay) {
      return timers.filter((timer) => timer.type === 'timeout' && !timer.cleared && timer.delay === delay)
    },
    async runTimeout(delay) {
      const timer = this.pending(delay)[0]
      if (!timer) return false
      timer.cleared = true
      timer.callback()
      await flushTasks()
      return true
    },
  }
}

function createGeminiSttHarness(settings, keys = { gemini: 'stored-google-key' }) {
  const timers = createFakeTimers()
  const api = loadTypeScriptModule(
    'src/lib/llm.ts',
    ['startDeepgramStream', 'testGeminiLiveConnection', 'sendAudioChunk', 'closeDeepgramStream'],
    {
      loadApiKeys: async () => keys,
      getLlmApiKey: async () => null,
      useAppStore: { getState: () => ({ settings }) },
      WebSocket: FakeWebSocket,
      GEMINI_LIVE_TRANSLATE_MODEL: 'gemini-3.5-live-translate-preview',
      globalThis: timers.global,
    },
  )
  return { api, timers }
}

const { startDeepgramStream, testDeepgramConnection, sendAudioChunk, closeDeepgramStream } = loadTypeScriptModule(
  'src/lib/llm.ts',
  ['startDeepgramStream', 'testDeepgramConnection', 'sendAudioChunk', 'closeDeepgramStream'],
  {
    loadApiKeys: async () => ({ deepgram: 'test-key' }),
    getLlmApiKey: async () => null,
    useAppStore: { getState: () => ({ settings: { sttProvider: 'deepgram', sttModel: 'nova-3', sttLanguage: 'zh-CN' } }) },
    WebSocket: FakeWebSocket,
  },
)
let connectivityReady = false
const connectivityOpening = testDeepgramConnection('unsaved-test-key').then(() => {
  connectivityReady = true
})
await new Promise((resolve) => setImmediate(resolve))
check(
  latestSocket?.protocols?.[0] === 'token'
    && latestSocket.protocols[1] === 'unsaved-test-key'
    && !connectivityReady,
  'Deepgram connectivity checks the entered key through the speech WebSocket',
)
latestSocket?.open()
await connectivityOpening
check(latestSocket?.readyState === FakeWebSocket.CLOSED, 'Deepgram connectivity closes its test socket')

let deepgramReady = false
const deepgramEvents = []
const deepgramOpening = startDeepgramStream((event) => deepgramEvents.push(event)).then((socket) => {
  deepgramReady = true
  return socket
})
await new Promise((resolve) => setImmediate(resolve))
check(latestSocket !== null && !deepgramReady, 'capture waits for the Deepgram socket to open')
check(latestSocket?.url.includes('endpointing=300') && latestSocket.url.includes('vad_events=true'), 'fixed-language STT uses stable endpoint detection')
latestSocket?.open()
check(await deepgramOpening === latestSocket, 'Deepgram startup resolves with the opened socket')
latestSocket?.onmessage?.({
  data: JSON.stringify({
    is_final: true,
    speech_final: true,
    channel: { alternatives: [{ transcript: '请介绍一下你自己' }] },
  }),
})
latestSocket?.onmessage?.({ data: JSON.stringify({ type: 'UtteranceEnd' }) })
check(
  deepgramEvents[0]?.boundary === 'speech-final'
    && deepgramEvents[1]?.boundary === 'utterance-end',
  'Deepgram boundary events preserve endpoint confidence instead of collapsing to one boolean',
)
latestSocket.bufferedAmount = 512 * 1024
sendAudioChunk(latestSocket, new Float32Array([0.5]))
check(latestSocket.sent.length === 0, 'Deepgram audio is dropped when websocket buffering reaches the memory limit')
latestSocket.bufferedAmount = 0
sendAudioChunk(latestSocket, new Float32Array([0.5]))
check(latestSocket.sent.length === 1, 'Deepgram audio resumes when websocket backpressure clears')
closeDeepgramStream(latestSocket)

const customOpening = startDeepgramStream(
  () => {},
  undefined,
  48_000,
  undefined,
  { language: 'en-US', endpointingMs: 450, utteranceEndMs: 1_300 },
)
await new Promise((resolve) => setImmediate(resolve))
check(
  latestSocket?.url.includes('sample_rate=48000')
    && latestSocket.url.includes('language=en-US')
    && latestSocket.url.includes('endpointing=450')
    && latestSocket.url.includes('utterance_end_ms=1300'),
  'Deepgram per-session options override global STT language and endpoint timing',
)
latestSocket?.open()
closeDeepgramStream(await customOpening)

const missingSocketCount = fakeSockets.length
const missingGemini = createGeminiSttHarness({
  sttProvider: 'gemini',
  sttModel: 'gemini-3.5-live-translate-preview',
  sttLanguage: 'zh-CN',
  language: 'zh-CN',
}, {})
let missingGeminiError = null
try {
  await missingGemini.api.startDeepgramStream(() => {})
} catch (error) {
  missingGeminiError = error
}
check(
  missingGeminiError?.message.includes('No Gemini API key') && fakeSockets.length === missingSocketCount,
  'Gemini STT fails before opening a socket when its reused AI Studio key is missing',
)

const deniedGemini = createGeminiSttHarness({ sttProvider: 'gemini', sttLanguage: 'multi', language: 'en-US' })
const deniedOpening = deniedGemini.api.testGeminiLiveConnection('denied-key').then(
  () => null,
  (error) => error,
)
await flushTasks()
const deniedSocket = latestSocket
deniedSocket.open()
deniedSocket.receive({ error: { message: 'Model access denied' } })
const deniedError = await deniedOpening
check(deniedError?.message === 'Model access denied', 'Gemini Live model-access errors fail the connection test')
deniedGemini.api.closeDeepgramStream(deniedSocket)

const liveTestGemini = createGeminiSttHarness({ sttProvider: 'gemini', sttLanguage: 'multi', language: 'en-US' })
let liveTestReady = false
const liveTestOpening = liveTestGemini.api
  .testGeminiLiveConnection('unsaved google/key', 'multi', 'en-US')
  .then(() => { liveTestReady = true })
await flushTasks()
const liveTestSocket = latestSocket
check(
  liveTestSocket.url === 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=unsaved%20google%2Fkey',
  'Gemini connectivity uses the entered key with the exact v1beta Live endpoint',
)
liveTestSocket.open()
const liveTestSetup = JSON.parse(liveTestSocket.sent[0])
check(
  JSON.stringify(liveTestSetup) === JSON.stringify({
    setup: {
      model: 'models/gemini-3.5-live-translate-preview',
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: { targetLanguageCode: 'en', echoTargetLanguage: true },
      },
      inputAudioTranscription: {},
    },
  }) && !liveTestReady,
  'Gemini Live sends the exact source-transcription setup and waits for setupComplete',
)
liveTestSocket.receive({ setupComplete: {} })
await liveTestOpening
check(
  liveTestReady && liveTestSocket.readyState === FakeWebSocket.CLOSED,
  'Gemini connectivity succeeds only after setupComplete and closes its test socket',
)

const binaryFrameGemini = createGeminiSttHarness({ sttProvider: 'gemini', sttLanguage: 'multi', language: 'en-US' })
const binaryFrameOpening = binaryFrameGemini.api.testGeminiLiveConnection('binary-frame-key').then(
  () => null,
  (error) => error,
)
await flushTasks()
const binaryFrameSocket = latestSocket
binaryFrameSocket.open()
binaryFrameSocket.onmessage?.({
  data: new TextEncoder().encode(JSON.stringify({ setupComplete: {} })).buffer,
})
await flushTasks()
const binaryFrameTimedOut = await binaryFrameGemini.timers.runTimeout(10_000)
const binaryFrameError = await binaryFrameOpening
check(
  binaryFrameError === null && !binaryFrameTimedOut && binaryFrameSocket.binaryType === 'arraybuffer',
  'Gemini Live parses binary setupComplete frames instead of timing out',
)
binaryFrameGemini.api.closeDeepgramStream(binaryFrameSocket)

const geminiEvents = []
const geminiSocketChanges = []
const gemini = createGeminiSttHarness({
  sttProvider: 'gemini',
  sttModel: 'gemini-3.5-live-translate-preview',
  sttLanguage: 'zh-CN',
  language: 'zh-CN',
})
let geminiReady = false
const geminiOpening = gemini.api.startDeepgramStream(
  (event) => geminiEvents.push(event),
  undefined,
  16_000,
  (socket) => geminiSocketChanges.push(socket),
).then((socket) => {
  geminiReady = true
  return socket
})
await flushTasks()
const geminiSocket = latestSocket
geminiSocket.open()
const fixedLanguageSetup = JSON.parse(geminiSocket.sent[0])
const sentBeforeSetup = geminiSocket.sent.length
gemini.api.sendAudioChunk(geminiSocket, new Float32Array([0.5]))
check(
  !geminiReady
    && geminiSocket.sent.length === sentBeforeSetup
    && fixedLanguageSetup.setup.generationConfig.translationConfig.targetLanguageCode === 'zh-Hans'
    && fixedLanguageSetup.setup.inputAudioTranscription.languageCodes?.join(',') === 'zh-CN'
    && !('systemInstruction' in fixedLanguageSetup.setup),
  'Gemini capture applies the fixed input-language hint and gates audio until setupComplete',
)
geminiSocket.receive({ setupComplete: {} })
check(await geminiOpening === geminiSocket, 'Gemini startup resolves with the setup-complete socket through the existing STT facade')

gemini.api.sendAudioChunk(geminiSocket, new Float32Array([-1, 0, 0.5, 1]))
const realtimeAudio = JSON.parse(geminiSocket.sent.at(-1))
check(
  JSON.stringify(realtimeAudio) === JSON.stringify({
    realtimeInput: {
      audio: { data: 'AIAAAP8//38=', mimeType: 'audio/pcm;rate=16000' },
    },
  }),
  'Gemini audio uses little-endian PCM16 base64 in realtimeInput.audio',
)
const sentBeforeBackpressure = geminiSocket.sent.length
geminiSocket.bufferedAmount = 512 * 1024
gemini.api.sendAudioChunk(geminiSocket, new Float32Array([0.25]))
check(geminiSocket.sent.length === sentBeforeBackpressure, 'Gemini audio obeys the shared websocket backpressure limit')
geminiSocket.bufferedAmount = 0

const eventsBeforeTranslatedOutput = geminiEvents.length
geminiSocket.receive({
  serverContent: {
    outputTranscription: { text: 'Translated output' },
    modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'ignored' } }] },
  },
})
check(geminiEvents.length === eventsBeforeTranslatedOutput, 'Gemini translated text and generated audio are ignored')
geminiSocket.receive({ serverContent: { turnComplete: true } })
geminiSocket.receive({ serverContent: { inputTranscription: { text: '乱序到达' } } })
check(
  geminiEvents.map((event) => event.boundary).join(',') === 'final,utterance-end'
    && gemini.timers.pending(1_500).length === 0,
  'Gemini flushes immediately when turnComplete arrives before source transcription',
)
geminiSocket.receive({ serverContent: { inputTranscription: { text: '请介绍一下' } } })
geminiSocket.receive({ serverContent: { inputTranscription: { text: '你自己' } } })
check(
  gemini.timers.pending(1_500).length === 1
    && geminiEvents.slice(-2).map((event) => event.boundary).join(',') === 'final,final',
  'Gemini source transcription resets one silence timer while chunks keep arriving',
)
await gemini.timers.runTimeout(1_500)
check(
  geminiEvents.slice(-3).map((event) => event.boundary).join(',') === 'final,final,utterance-end',
  'Gemini commits source transcription after silence even when Live Translate omits turnComplete',
)
geminiSocket.receive({ serverContent: { turnComplete: true } })
geminiSocket.receive({ serverContent: { inputTranscription: { text: '迟到后的新问题' } } })
check(
  geminiEvents.at(-1)?.boundary === 'final' && gemini.timers.pending(1_500).length === 1,
  'a late turnComplete cannot prematurely end the next Gemini transcription',
)
await gemini.timers.runTimeout(1_500)
geminiSocket.receive({ serverContent: { inputTranscription: { text: '第二个问题' } } })
geminiSocket.receive({ serverContent: { turnComplete: true } })
check(
  geminiEvents.slice(-2).map((event) => event.boundary).join(',') === 'final,utterance-end'
    && geminiEvents.at(-2)?.text === '第二个问题',
  'Gemini turnComplete flushes immediately and cancels its pending silence timer',
)
check(gemini.timers.pending(1_500).length === 0, 'Gemini turnComplete leaves no stale silence timer')

const socketsBeforeGoAway = fakeSockets.length
geminiSocket.receive({ goAway: { timeLeft: '5s' } })
await flushTasks()
const rotatedSocket = fakeSockets[socketsBeforeGoAway]
check(
  rotatedSocket
    && geminiSocket.readyState === FakeWebSocket.OPEN
    && geminiSocketChanges.at(-1) === geminiSocket,
  'Gemini goAway keeps the active socket until its replacement is ready',
)
rotatedSocket.open()
check(
  geminiSocket.readyState === FakeWebSocket.OPEN && geminiSocketChanges.at(-1) === geminiSocket,
  'Gemini goAway does not swap after only the replacement transport opens',
)
rotatedSocket.receive({ setupComplete: {} })
await flushTasks()
check(
  geminiSocket.readyState === FakeWebSocket.CLOSED
    && geminiSocketChanges.at(-1) === rotatedSocket,
  'Gemini goAway atomically swaps after replacement setupComplete, then closes the old socket',
)

const reconnectChanges = []
const reconnectEvents = []
const reconnectGemini = createGeminiSttHarness({
  sttProvider: 'gemini',
  sttLanguage: 'multi',
  language: 'zh-TW',
})
const reconnectOpening = reconnectGemini.api.startDeepgramStream(
  (event) => reconnectEvents.push(event),
  undefined,
  16_000,
  (socket) => reconnectChanges.push(socket),
)
await flushTasks()
const disconnectedSocket = latestSocket
disconnectedSocket.open()
disconnectedSocket.receive({ setupComplete: {} })
await reconnectOpening
disconnectedSocket.receive({ serverContent: { inputTranscription: { text: '换线前的转写' } } })
disconnectedSocket.disconnect()
check(
  reconnectGemini.timers.pending(1_000).length === 1
    && reconnectGemini.timers.pending(1_500).length === 0,
  'an unexpected Gemini close cancels the old silence timer and schedules reconnect',
)
const socketsBeforeReconnect = fakeSockets.length
await reconnectGemini.timers.runTimeout(1_000)
const reconnectedSocket = fakeSockets[socketsBeforeReconnect]
reconnectedSocket.open()
const reconnectSetup = JSON.parse(reconnectedSocket.sent[0])
check(
  reconnectSetup.setup.generationConfig.translationConfig.targetLanguageCode === 'zh-Hant'
    && !('systemInstruction' in reconnectSetup.setup)
    && reconnectChanges.at(-1) === disconnectedSocket,
  'Gemini reconnect preserves app target language and multi-language auto-detect without swapping early',
)
reconnectedSocket.receive({ setupComplete: {} })
await flushTasks()
check(reconnectChanges.at(-1) === reconnectedSocket, 'Gemini reconnect swaps the caller socket after setupComplete')
check(
  reconnectGemini.timers.pending(1_500).length === 1,
  'Gemini reconnect transfers an unfinished transcription to the replacement socket',
)
await reconnectGemini.timers.runTimeout(1_500)
check(
  reconnectEvents.map((event) => event.boundary).join(',') === 'final,utterance-end',
  'Gemini reconnect commits the pending transcription without waiting for another chunk',
)
const socketsBeforeClientClose = fakeSockets.length
reconnectedSocket.receive({ serverContent: { inputTranscription: { text: '关闭前转写' } } })
check(reconnectGemini.timers.pending(1_500).length === 1, 'Gemini close cleanup has a pending silence timer to cancel')
reconnectGemini.api.closeDeepgramStream(reconnectedSocket)
const clientCloseRetried = await reconnectGemini.timers.runTimeout(1_000)
const clientCloseCommitted = await reconnectGemini.timers.runTimeout(1_500)
check(
  !clientCloseRetried && !clientCloseCommitted && fakeSockets.length === socketsBeforeClientClose,
  'client-initiated Gemini close cancels pending transcription and does not reconnect',
)

console.log(`=== RESULT: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
