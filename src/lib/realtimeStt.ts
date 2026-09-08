import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  closeDeepgramStream,
  startDeepgramStream,
  type DeepgramTranscriptEvent,
  type TranscriptBoundary,
} from './llm'
import { useAppStore } from '../stores/useAppStore'
import { loadApiKeys } from './keyStore'
import { hostedFetch, registerHostedConnection } from './hostedAuth'

export interface RealtimeSttConfig {
  source: 'system' | 'microphone'
  sampleRate: number
  sessionId: number
  captureId: number
  sources?: Array<'system' | 'microphone'>
  signal?: AbortSignal
  acceptAudio?: boolean
  language?: string
  endpointingMs?: number
  utteranceEndMs?: number
}

export interface RealtimeSttHandlers {
  onTranscript: (event: DeepgramTranscriptEvent) => void
  onError?: (error: unknown) => void
  onReady?: () => void
}

export interface RealtimeSttHandle {
  stop(): Promise<void>
  setAcceptAudio(accept: boolean): Promise<void>
}

function isTauriRuntime(): boolean {
  return typeof globalThis !== 'undefined'
    && '__TAURI_INTERNALS__' in (globalThis as typeof globalThis & Record<string, unknown>)
}

function nativeProvider(): 'deepgram' | 'gemini' | 'hosted' | 'apple' | null {
  if (!isTauriRuntime()) return null
  const settings = useAppStore.getState().settings
  const configured = settings?.aiAccessMode === 'hosted' ? 'hosted' : settings?.sttProvider
  if (configured === 'hosted' || configured === 'gemini' || configured === 'apple' || configured === 'deepgram') {
    return configured
  }
  return 'deepgram'
}

const hostedInterviews = new Map<number, string>()
const hostedInterviewUsers = new Map<number, number>()

function retainHostedInterview(sessionId: number): string {
  const interviewId = hostedInterviews.get(sessionId) ?? crypto.randomUUID()
  hostedInterviews.set(sessionId, interviewId)
  hostedInterviewUsers.set(sessionId, (hostedInterviewUsers.get(sessionId) ?? 0) + 1)
  return interviewId
}

function releaseHostedInterview(sessionId: number): void {
  const remaining = (hostedInterviewUsers.get(sessionId) ?? 1) - 1
  if (remaining <= 0) {
    hostedInterviewUsers.delete(sessionId)
    hostedInterviews.delete(sessionId)
    return
  }
  hostedInterviewUsers.set(sessionId, remaining)
}

interface NativeStatus { generation: number }

async function startNativeSession(
  config: RealtimeSttConfig,
  provider: Exclude<ReturnType<typeof nativeProvider>, null>,
  signal: AbortSignal,
  interviewId?: string,
): Promise<NativeStatus> {
  const settings = useAppStore.getState().settings
  const nativeConfig: Record<string, unknown> = {
    provider, source: config.source, sources: config.sources,
    captureId: config.captureId, sampleRate: config.sampleRate, sessionId: config.sessionId,
    language: config.language || settings?.sttLanguage || 'zh-CN',
    appLanguage: settings?.language, model: settings?.sttModel,
    endpointingMs: config.endpointingMs, utteranceEndMs: config.utteranceEndMs,
  }
  if (provider === 'hosted') {
    const clientRequestId = crypto.randomUUID()
    const response = await hostedFetch('/v1/stt/sessions', {
      signal, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientRequestId },
      body: JSON.stringify({
        client_request_id: clientRequestId, interview_id: interviewId,
        source: config.source, language: nativeConfig.language,
        audio: { encoding: 'pcm_s16le', sample_rate: 16_000, channels: 1 },
      }),
    })
    signal.throwIfAborted()
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string; code?: string } | null
      throw Object.assign(new Error(body?.message || body?.code || `Hosted STT failed with ${response.status}`), {
        retryable: response.status >= 500 || (response.status === 429 && !/quota|exhaust/i.test(body?.code || '')),
      })
    }
    const session = await response.json() as { ws_url: string; ws_ticket: string }
    nativeConfig.wsUrl = session.ws_url
    nativeConfig.wsTicket = session.ws_ticket
  } else if (provider !== 'apple') {
    const keys = await loadApiKeys()
    nativeConfig.apiKey = provider === 'gemini' ? keys?.gemini : keys?.deepgram
  }
  signal.throwIfAborted()
  return invoke<NativeStatus>('start_realtime_stt', { config: nativeConfig })
}

export async function startRealtimeStt(
  config: RealtimeSttConfig,
  handlers: RealtimeSttHandlers,
): Promise<RealtimeSttHandle> {
  const provider = nativeProvider()
  if (!provider) {
    let socket: WebSocket | null = await startDeepgramStream(
      handlers.onTranscript, handlers.onError, config.sampleRate,
      (next) => { socket = next },
      { language: config.language, endpointingMs: config.endpointingMs, utteranceEndMs: config.utteranceEndMs, source: config.source },
    )
    if (config.signal?.aborted) { closeDeepgramStream(socket); config.signal.throwIfAborted() }
    const stop = async () => { closeDeepgramStream(socket); socket = null; config.signal?.removeEventListener('abort', cancel) }
    const cancel = () => { void stop() }
    config.signal?.addEventListener('abort', cancel, { once: true })
    handlers.onReady?.()
    return { stop, async setAcceptAudio() {} }
  }

  const controller = new AbortController()
  const unlisteners: UnlistenFn[] = []
  let stopped = false
  let acceptAudio = config.acceptAudio ?? true
  let current: NativeStatus | null = null
  let opening: Promise<NativeStatus> | null = null
  let reconnecting: Promise<void> | null = null
  let stopping: Promise<void> | null = null
  const interviewId = provider === 'hosted' ? retainHostedInterview(config.captureId) : undefined
  let unregister: (() => void) | undefined
  const nativeStop = (status: NativeStatus) => invoke('stop_realtime_stt', {
    source: config.source, captureId: config.captureId, generation: status.generation,
  })
  const setGate = (status: NativeStatus, accept: boolean) => invoke<void>('set_realtime_stt_accept_audio', {
    source: config.source, captureId: config.captureId, generation: status.generation, accept,
  })
  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopped = true
    controller.abort()
    config.signal?.removeEventListener('abort', cancel)
    unlisteners.splice(0).forEach((unlisten) => unlisten())
    unregister?.()
    const active = current
    const pending = opening
    current = null
    stopping = (async () => {
      try {
        if (active) await nativeStop(active)
      } finally {
        try {
          const late = await pending?.catch(() => null)
          if (late && late.generation !== active?.generation) await nativeStop(late)
        } finally {
          if (provider === 'hosted') releaseHostedInterview(config.captureId)
        }
      }
    })()
    return stopping
  }
  const cancel = () => { void stop().catch((error) => handlers.onError?.(error)) }
  if (provider === 'hosted') unregister = registerHostedConnection(stop)
  config.signal?.addEventListener('abort', cancel, { once: true })
  if (config.signal?.aborted) cancel()
  const forget = (unlisten: UnlistenFn) => { if (stopped) unlisten(); else unlisteners.push(unlisten) }
  const connect = async () => {
    controller.signal.throwIfAborted()
    opening = startNativeSession(config, provider, controller.signal, interviewId)
    const next = await opening
    // stop() owns late acquisitions, including commands already sent over IPC.
    controller.signal.throwIfAborted()
    current = next
    await setGate(next, acceptAudio)
    controller.signal.throwIfAborted()
    handlers.onReady?.()
  }
  const retry = () => {
    if (stopped || reconnecting) return
    reconnecting = (async () => {
      let attempt = 0
      while (!stopped) {
        try {
          if (current) await nativeStop(current)
          current = null
          await connect()
          return
        } catch (error) {
          if (stopped) return
          handlers.onError?.(error)
          if ((error as { retryable?: boolean })?.retryable === false
            || /sign-in is required/i.test(String(error))) { await stop(); return }
          const delay = Math.min(4_000, 250 * 2 ** Math.min(attempt++, 4))
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, delay)
            controller.signal.addEventListener('abort', done, { once: true })
            if (stopped) done()
          })
        }
      }
    })().finally(() => { reconnecting = null })
    void reconnecting.catch((error) => handlers.onError?.(error))
  }

  try {
    controller.signal.throwIfAborted()
    forget(await listen<{ sessionId?: number; generation?: number; source: string; text: string; is_final?: boolean; isFinal?: boolean; boundary: string }>('stt-transcript', (event) => {
      if (stopped || !acceptAudio || event.payload.source !== config.source || !current) return
      if (event.payload.sessionId !== config.sessionId || event.payload.generation !== current.generation) return
      const boundary = (event.payload.boundary || 'interim') as TranscriptBoundary
      handlers.onTranscript({ text: event.payload.text || '', isFinal: Boolean(event.payload.is_final ?? event.payload.isFinal) || boundary !== 'interim', boundary })
    }))
    forget(await listen<{ sessionId?: number; generation?: number; source: string; message: string; retryable?: boolean }>('stt-error', (event) => {
      if (stopped || event.payload.source !== config.source || !current) return
      if (event.payload.sessionId !== config.sessionId || event.payload.generation !== current.generation) return
      handlers.onError?.(new Error(event.payload.message || 'Realtime STT failed'))
      if (provider === 'hosted' && event.payload.retryable) retry()
    }))
    await connect()
  } catch (error) {
    await stop()
    throw error
  }
  return {
    stop,
    async setAcceptAudio(accept: boolean) {
      if (stopped) return
      acceptAudio = accept
      if (current) {
        try { await setGate(current, accept) }
        catch (error) { await stop(); throw error }
      }
    },
  }
}
