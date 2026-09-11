import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(file, names, dependencies = {}) {
  dependencies = { requireAppAccess: async () => {}, refreshHostedEntitlements: async () => {}, ...dependencies }
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*$/gm, '').replace(/^export /gm, '')
  return new Function(...Object.keys(dependencies), `${js}\nreturn {${names.join(',')}}`)(...Object.values(dependencies))
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const config = { source: 'microphone', captureId: 12, sessionId: 1, sampleRate: 16000 }
function harness() {
  const events = new Map(), connections = new Set(), calls = [], requests = [], timers = new Map()
  let generation = 0, fetchImpl = async () => ({ ok: true, json: async () => ({ ws_url: 'wss://test', ws_ticket: 'test' }) })
  let nativeImpl = async () => ({ generation: ++generation })
  const api = load('src/lib/realtimeStt.ts', ['startRealtimeStt', 'hostedInterviewUsers'], {
    globalThis: { __TAURI_INTERNALS__: {} },
    useAppStore: { getState: () => ({ settings: { aiAccessMode: 'hosted' } }) },
    hostedFetch: async (...args) => { requests.push(args); return fetchImpl(...args) },
    registerHostedConnection: (close) => { connections.add(close); return () => connections.delete(close) },
    invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'start_realtime_stt') return nativeImpl(args)
    },
    listen: async (name, listener) => { events.set(name, listener); return () => events.delete(name) },
    setTimeout: (callback, delay) => { const id = {}; timers.set(id, { callback, delay }); return id },
    clearTimeout: (id) => timers.delete(id),
  })
  return { ...api, events, connections, calls, requests, timers,
    fetch: (impl) => { fetchImpl = impl }, native: (impl) => { nativeImpl = impl },
    disconnect: () => events.get('stt-error')?.({ payload: { ...config, generation, retryable: true, message: 'disconnected' } }),
    tick: async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); await flush() },
  }
}

// A stopped reconnect must not send a new native start after its HTTP response arrives.
{
  const h = harness(), handle = await h.startRealtimeStt(config, {})
  const pending = deferred()
  h.fetch(() => pending.promise)
  h.disconnect(); await flush()
  const stopping = handle.stop()
  pending.resolve({ ok: true, json: async () => ({ ws_url: 'wss://late', ws_ticket: 'late' }) })
  await stopping; await flush()
  assert.equal(h.calls.filter(c => c.command === 'start_realtime_stt').length, 1)
  assert.equal(h.events.size + h.connections.size + h.timers.size + h.hostedInterviewUsers.size, 0)
}
// Commands already sent over IPC return a disabled acquisition which must be closed.
{
  const h = harness(), pending = deferred(), controller = new AbortController()
  h.native(() => pending.promise)
  const opening = h.startRealtimeStt({ ...config, signal: controller.signal }, {}).catch(error => error)
  await flush(); controller.abort(); pending.resolve({ generation: 99 })
  assert.equal((await opening).name, 'AbortError')
  assert(h.calls.some(c => c.command === 'stop_realtime_stt' && c.args.generation === 99 && c.args.captureId === 12))
  assert(!h.calls.some(c => c.command === 'set_realtime_stt_accept_audio'))
  assert.equal(h.connections.size + h.events.size + h.hostedInterviewUsers.size, 0)
}
// Transient failures keep retrying, one loop at a time, and preserve the paused gate.
{
  const h = harness(), handle = await h.startRealtimeStt({ ...config, acceptAudio: false }, {})
  let failures = 2
  h.fetch(async () => {
    if (failures-- > 0) throw new TypeError('network unavailable')
    return { ok: true, json: async () => ({ ws_url: 'wss://test', ws_ticket: 'test' }) }
  })
  h.disconnect(); h.disconnect(); await flush()
  assert.equal(h.timers.size, 1)
  await h.tick(); assert.equal(h.timers.size, 1)
  await h.tick(); assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 4)
  assert.equal(h.hostedInterviewUsers.get(12), 1)
  assert(h.calls.filter(c => c.command === 'set_realtime_stt_accept_audio').every(c => c.args.accept === false))
  await handle.stop()
  assert.equal(h.hostedInterviewUsers.size, 0)
}
// Sign-out uses the registered close path, both while ready and during HTTP startup.
for (const pendingStart of [false, true]) {
  const h = harness(), pending = deferred()
  if (pendingStart) h.fetch(() => pending.promise)
  const opening = h.startRealtimeStt(config, {}).catch(error => error)
  await flush()
  const closing = [...h.connections].map(close => close())
  if (pendingStart) pending.resolve({ ok: true, json: async () => ({ ws_url: 'wss://late', ws_ticket: 'late' }) })
  await Promise.all(closing); await opening
  assert.equal(h.events.size + h.connections.size + h.hostedInterviewUsers.size, 0)
  assert.equal(h.calls.filter(c => c.command === 'start_realtime_stt').length, pendingStart ? 0 : 1)
}
// Auth/entitlement errors terminate retry instead of consuming requests indefinitely.
{
  const h = harness(), handle = await h.startRealtimeStt(config, {})
  h.fetch(async () => ({ ok: false, status: 403, json: async () => ({ code: 'QUOTA_EXHAUSTED' }) }))
  h.disconnect(); await flush()
  assert.equal(h.timers.size + h.connections.size, 0)
  await handle.stop()
}

const endpoint = load('src/lib/mockInterviewVoiceEndpoint.ts', ['createVoiceEndpointState', 'transcriptFromEndpointState', 'isMinimumVoiceAnswer', 'applyVoiceTranscriptEvent', 'SPEECH_FINAL_GRACE_MS'])
function mockHarness({ capture, stt } = {}) {
  const calls = [], listeners = new Set()
  const { MockInterviewVoiceSession } = load('src/lib/mockInterviewVoiceSession.ts', ['MockInterviewVoiceSession'], {
    ...endpoint, tryRequestMicrophone: async () => true,
    listen: async () => { const id = {}; listeners.add(id); return () => listeners.delete(id) },
    invoke: async (name, args) => { calls.push({ name, args }); if (name === 'start_audio_capture') return capture ? capture() : { capture_id: 42, sample_rate: 16000 } },
    startRealtimeStt: async (...args) => stt ? stt(...args) : { stop: async () => {}, setAcceptAudio: async () => {} },
  })
  return { voice: new MockInterviewVoiceSession(), calls, listeners }
}
const voiceConfig = { language: 'en-US', speechEnabled: false, microphoneDevice: null }
{
  const h = mockHarness({ stt: async () => { throw new Error('STT rejected') } })
  await assert.rejects(h.voice.start(voiceConfig), /STT rejected/)
  assert(h.calls.some(c => c.name === 'stop_audio_capture' && c.args.captureId === 42))
  assert.equal(h.listeners.size, 0)
}
{
  const pending = deferred(), h = mockHarness({ capture: () => pending.promise })
  const opening = h.voice.start(voiceConfig)
  await flush(); await h.voice.stop({ saveRecording: false })
  pending.resolve({ capture_id: 43, sample_rate: 16000 })
  await opening
  assert(h.calls.some(c => c.name === 'stop_audio_capture' && c.args.captureId === 43))
  assert.equal(h.listeners.size, 0)
}
{
  const gate = deferred(), sequence = []
  let finalizing = false
  const h = mockHarness({ stt: async () => ({ stop: async () => {}, setAcceptAudio: async (accept) => { sequence.push(accept); if (!accept && finalizing) await gate.promise } }) })
  await h.voice.start(voiceConfig)
  await h.voice.ask('Question')
  sequence.length = 0
  finalizing = true
  h.voice.endpoint = { finalParts: ['A complete answer'], interimTranscript: '', answerStartedAt: 1 }
  h.voice.subscribe(event => { if (event.type === 'answer-final') sequence.push('final') })
  h.voice.finalizeAnswer(); await flush()
  assert.deepEqual(sequence, [false])
  gate.resolve(); await flush()
  assert.deepEqual(sequence, [false, 'final'])
  assert.equal(h.voice.snapshot.phase, 'paused')
  await h.voice.stop({ saveRecording: false })
}
const state = load('src/lib/copilotSessionState.ts', ['createInitialSnapshot', 'reduceCopilotSnapshot'])
function copilotHarness({ capture, stt } = {}) {
  const calls = [], listeners = new Set()
  const { CopilotSessionHost } = load('src/lib/copilotSession.ts', ['CopilotSessionHost'], {
    ...state, ...endpoint,
    useAppStore: { getState: () => ({ settings: {} }) },
    createEmptyResumeWorkspace: () => ({}), interviewProfileFromWorkspace: value => value,
    createSessionIdentity: () => ({}), resetRealtimeTurnMetrics: () => {}, markRealtimeEvent: () => {},
    loadAppSettings: async () => ({ useSystemAudio: true, useMicWithSystem: true }),
    tryRequestMicrophone: async () => true,
    listen: async () => { const token = {}; listeners.add(token); return () => listeners.delete(token) },
    invoke: async (name, args) => {
      calls.push({ name, args })
      if (name === 'get_audio_capabilities') return { system_audio_available: true, microphone_available: true, sample_rate: 16000 }
      if (name === 'start_audio_capture') return capture ? capture() : { capture_id: 50, sample_rate: 16000, mode: 'system+microphone' }
    },
    startRealtimeStt: async (...args) => stt ? stt(...args) : { stop: async () => {}, setAcceptAudio: async () => {} },
  })
  const host = new CopilotSessionHost()
  host.transition = action => { host.snapshot = state.reduceCopilotSnapshot(host.snapshot, action) }
  host.archiveSession = async () => {}
  host.scheduleLimitStop = () => {}
  return { host, calls, listeners }
}
{
  const closed = [], late = deferred()
  const h = copilotHarness({ stt: async (config) => {
    if (config.source === 'system') throw new Error('system STT failed')
    await late.promise
    return { stop: async () => closed.push('microphone'), setAcceptAudio: async () => {} }
  } })
  const opening = h.host.start()
  await flush(); late.resolve(); await opening
  assert(closed.includes('microphone'))
  assert(h.calls.some(c => c.name === 'stop_audio_capture' && c.args.captureId === 50))
  assert.equal(h.listeners.size, 0)
  assert.equal(h.host.snapshot.phase, 'error')
}
{
  let sttStarts = 0
  const h = copilotHarness({ capture: async () => { throw new Error('capture occupied') }, stt: async () => { sttStarts++ } })
  await h.host.start()
  assert.equal(sttStarts, 0)
  assert.equal(h.listeners.size, 0)
}
{
  const late = deferred(), h = copilotHarness({ capture: () => late.promise })
  const opening = h.host.start()
  await flush(); await h.host.stop()
  late.resolve({ capture_id: 51, sample_rate: 16000, mode: 'system' })
  await opening
  assert(h.calls.some(c => c.name === 'stop_audio_capture' && c.args.captureId === 51))
  assert.equal(h.host.snapshot.phase, 'idle')
  assert.equal(h.listeners.size, 0)
}
console.log('Realtime lifecycle verification passed (13 cancellation, retry, ownership and pause scenarios)')
