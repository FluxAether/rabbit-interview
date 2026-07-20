import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { closeDeepgramStream, generateSuggestionsStream, sendAudioChunk, startDeepgramStream } from './llm'
import { chunksToWavBuffer } from './wav'
import { loadAppSettings } from './settingsStore'
import { openMicrophoneSettings, tryRequestMicrophone } from './permissions'
import { upsertCopilotMessage } from './db'
import {
  createInitialSnapshot,
  reduceCopilotSnapshot,
  type CopilotMessage,
  type CopilotSnapshot,
  type CopilotSnapshotAction,
} from './copilotSessionState'
import { useAppStore, type Suggestion } from '../stores/useAppStore'

const COMMAND_EVENT = 'copilot-session-command'
const SNAPSHOT_EVENT = 'copilot-session-snapshot'
const MAX_RECORDING_SECONDS = 15 * 60

export interface AudioCapabilities {
  system_audio_available: boolean
  microphone_available: boolean
  system_audio_reason: string | null
  microphone_reason: string | null
  current_mode: string
  failure_reason: string | null
  sample_rate: number
  audiotee_commit: string
}

export interface CopilotStartConfig {
  useSystemAudio?: boolean
  useMicrophone?: boolean
  deviceName?: string | null
}

type CopilotAudioSource = 'system' | 'microphone'

interface AudioSourceChunk {
  source: CopilotAudioSource
  samples: number[]
}

interface TranscriptState {
  finalParts: string[]
  lastFinal: string
  lastFinalAt: number
}

function createTranscriptState(): TranscriptState {
  return { finalParts: [], lastFinal: '', lastFinalAt: 0 }
}

export type CopilotSessionCommand =
  | { type: 'start'; config?: CopilotStartConfig }
  | { type: 'stop' }
  | { type: 'toggle'; config?: CopilotStartConfig }
  | { type: 'clear' }
  | { type: 'retry' }
  | { type: 'follow-up'; text: string }
  | { type: 'request-snapshot' }

function splitSuggestions(text: string, category: string, idBase: number): Suggestion[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim().replace(/^[-•*\d.)\s]+/, ''))
    .filter((line) => line.length > 3)
    .slice(0, 6)
  return (lines.length > 0 ? lines : [text.trim()])
    .filter(Boolean)
    .map((line, index) => ({ id: idBase + index, text: line, category }))
}

class CopilotSessionHost {
  private snapshot: CopilotSnapshot = createInitialSnapshot()
  private sessionSequence = 0
  private answerSequence = 0
  private messageSequence = 0
  private deepgrams: Record<CopilotAudioSource, WebSocket | null> = {
    system: null,
    microphone: null,
  }
  private enabledSources: CopilotAudioSource[] = []
  private transcripts: Record<CopilotAudioSource, TranscriptState> = {
    system: createTranscriptState(),
    microphone: createTranscriptState(),
  }
  private unlisteners: UnlistenFn[] = []
  private commandUnlisten: UnlistenFn | null = null
  private recording: number[][] = []
  private sampleRate = 16_000
  private abortController: AbortController | null = null
  private stopPromise: Promise<void> | null = null
  private persistenceSessionId: string | null = null
  private persistenceQueue: Promise<void> = Promise.resolve()
  private previousTurn = ''

  async mount(): Promise<void> {
    this.commandUnlisten = await listen<CopilotSessionCommand>(COMMAND_EVENT, (event) => {
      void this.handle(event.payload)
    })
    await this.publish(true)
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.commandUnlisten?.()
    this.commandUnlisten = null
  }

  getRecording(): { chunks: number[][]; sampleRate: number } {
    return { chunks: this.recording.slice(), sampleRate: this.sampleRate }
  }

  private isCurrent(sessionId: number): boolean {
    return this.snapshot.sessionId === sessionId
  }

  private transition(action: CopilotSnapshotAction): void {
    const previous = this.snapshot
    const next = reduceCopilotSnapshot(previous, action)
    if (next === previous) return
    this.snapshot = next
    this.queueMessagePersistence(previous.messages, next.messages, next.sessionId)
    void this.publish()
  }

  private queueMessagePersistence(
    previousMessages: CopilotMessage[],
    nextMessages: CopilotMessage[],
    sessionId: number | null,
  ): void {
    const persistenceSessionId = this.persistenceSessionId
    if (!persistenceSessionId || sessionId === null || previousMessages === nextMessages) return

    const previousById = new Map(previousMessages.map((message) => [message.id, message]))
    const changedMessages = nextMessages.flatMap((message, messageOrder) => {
      const previous = previousById.get(message.id)
      return !previous
        || previous.role !== message.role
        || previous.source !== message.source
        || previous.text !== message.text
        ? [{ message, messageOrder }]
        : []
    })
    if (changedMessages.length === 0) return

    this.persistenceQueue = this.persistenceQueue
      .then(async () => {
        for (const { message, messageOrder } of changedMessages) {
          await upsertCopilotMessage(persistenceSessionId, message, messageOrder)
        }
      })
      .catch((error) => {
        console.error('[Copilot] Failed to persist chat messages', error)
        if (this.isCurrent(sessionId)) {
          this.transition({
            type: 'recoverable-error',
            sessionId,
            error: `Failed to save chat messages: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      })
  }

  private async publish(force = false): Promise<void> {
    const current = useAppStore.getState().copilot
    if (force || this.snapshot.revision >= current.revision) {
      useAppStore.getState().setCopilotSnapshot(this.snapshot)
    }
    await emit(SNAPSHOT_EVENT, this.snapshot)
  }

  private async handle(command: CopilotSessionCommand): Promise<void> {
    switch (command.type) {
      case 'start':
        await this.start(command.config)
        break
      case 'stop':
        await this.stop()
        break
      case 'toggle':
        if (this.snapshot.phase === 'starting' || this.snapshot.phase === 'listening') {
          await this.stop()
        } else {
          await this.start(command.config)
        }
        break
      case 'clear':
        this.abortController?.abort()
        this.transition({ type: 'clear' })
        break
      case 'retry':
        if (this.snapshot.sessionId !== null && this.snapshot.question) {
          void this.answer(this.snapshot.sessionId, this.snapshot.question)
        }
        break
      case 'follow-up':
        if (this.snapshot.sessionId !== null && command.text.trim()) {
          const text = command.text.trim()
          const sessionId = this.snapshot.sessionId
          this.transition({ type: 'question', sessionId, question: text })
          this.transition({
            type: 'message',
            sessionId,
            message: {
              id: -(sessionId * 1_000_000 + ++this.messageSequence),
              role: 'me',
              source: 'follow-up',
              text,
            },
          })
          void this.answer(sessionId, text)
        }
        break
      case 'request-snapshot':
        await this.publish(true)
        break
    }
  }

  private async start(config: CopilotStartConfig = {}): Promise<void> {
    if (this.snapshot.phase === 'starting' || this.snapshot.phase === 'listening' || this.snapshot.phase === 'stopping') {
      return
    }

    const sessionId = ++this.sessionSequence
    this.persistenceSessionId = globalThis.crypto.randomUUID()
    this.transition({ type: 'start', sessionId })
    this.recording = []
    this.sampleRate = 16_000
    this.messageSequence = 0
    this.transcripts = {
      system: createTranscriptState(),
      microphone: createTranscriptState(),
    }
    this.previousTurn = ''

    try {
      const [settings, capabilities] = await Promise.all([
        loadAppSettings(),
        invoke<AudioCapabilities>('get_audio_capabilities'),
      ])
      if (!this.isCurrent(sessionId)) return

      const systemRequested = config.useSystemAudio ?? settings.useSystemAudio ?? true
      const useSystemAudio = systemRequested && capabilities.system_audio_available
      const microphoneRequested = config.useMicrophone ?? settings.useMicWithSystem ?? true
      const useMicrophone = microphoneRequested

      this.transition({
        type: 'capability',
        sessionId,
        notice: systemRequested && !capabilities.system_audio_available
          ? capabilities.system_audio_reason
          : null,
      })

      if (useMicrophone) {
        if (!capabilities.microphone_available) {
          throw new Error('No microphone input device is available')
        }
        if (!(await tryRequestMicrophone())) {
          await openMicrophoneSettings()
          throw new Error('Microphone permission is required for the selected capture mode')
        }
      }
      if (!useSystemAudio && !useMicrophone) {
        throw new Error(capabilities.system_audio_reason || 'No audio capture mode is available')
      }

      await this.installAudioListeners(sessionId)
      const sources: CopilotAudioSource[] = [
        ...(useSystemAudio ? ['system' as const] : []),
        ...(useMicrophone ? ['microphone' as const] : []),
      ]
      await this.startDeepgrams(sessionId, sources, capabilities.sample_rate || 16_000)
      if (!this.isCurrent(sessionId)) {
        await this.cleanupRuntime()
        return
      }

      const audioConfig = await invoke<{ sample_rate: number; mode: string }>('start_audio_capture', {
        useSystemAudio,
        useMicrophone,
        deviceName: config.deviceName ?? settings.micDevice ?? null,
      })
      if (!this.isCurrent(sessionId)) {
        await invoke('stop_audio_capture').catch(() => {})
        await this.cleanupRuntime()
        return
      }
      this.sampleRate = audioConfig.sample_rate || 16_000
      this.transition({ type: 'started', sessionId, mode: audioConfig.mode })
    } catch (error) {
      if (!this.isCurrent(sessionId)) return
      await invoke('stop_audio_capture').catch(() => {})
      await this.cleanupRuntime()
      this.transition({
        type: 'error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async stop(): Promise<void> {
    if (this.snapshot.phase === 'idle') return
    if (this.stopPromise) return this.stopPromise

    this.transition({ type: 'stop' })
    this.stopPromise = (async () => {
      this.abortController?.abort()
      this.abortController = null
      this.closeDeepgrams()
      await invoke('stop_audio_capture').catch(() => {})
      await this.cleanupRuntime()
      await this.persistenceQueue
      this.transition({ type: 'stopped' })
      this.persistenceSessionId = null
    })().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private async cleanupRuntime(): Promise<void> {
    this.closeDeepgrams()
    this.enabledSources = []
    this.unlisteners.splice(0).forEach((unlisten) => unlisten())
  }

  private closeDeepgrams(): void {
    closeDeepgramStream(this.deepgrams.system)
    closeDeepgramStream(this.deepgrams.microphone)
    this.deepgrams.system = null
    this.deepgrams.microphone = null
  }

  private async installAudioListeners(sessionId: number): Promise<void> {
    await this.cleanupRuntime()
    this.unlisteners.push(
      await listen<{ sample_rate: number }>('audio-config', (event) => {
        if (!this.isCurrent(sessionId)) return
        const nextRate = event.payload.sample_rate || 16_000
        if (nextRate !== this.sampleRate) {
          this.sampleRate = nextRate
          void this.startDeepgrams(sessionId, this.enabledSources, nextRate).catch((error) => {
            if (this.isCurrent(sessionId)) void this.fail(sessionId, String(error))
          })
        }
      }),
      await listen<number[]>('audio-chunk', (event) => {
        if (!this.isCurrent(sessionId)) return
        const payload = event.payload
        this.recording.push(payload)
        const maxSamples = this.sampleRate * MAX_RECORDING_SECONDS
        let samples = this.recording.reduce((total, chunk) => total + chunk.length, 0)
        while (samples > maxSamples && this.recording.length > 0) {
          samples -= this.recording.shift()?.length || 0
        }
        this.transition({ type: 'recording', sessionId })
      }),
      await listen<AudioSourceChunk>('audio-source-chunk', (event) => {
        if (!this.isCurrent(sessionId)) return
        sendAudioChunk(this.deepgrams[event.payload.source], new Float32Array(event.payload.samples))
      }),
      await listen<number>('audio-amplitude', (event) => {
        if (this.isCurrent(sessionId)) {
          this.transition({ type: 'amplitude', sessionId, amplitude: event.payload })
        }
      }),
      await listen<string>('audio-error', (event) => {
        if (!this.isCurrent(sessionId)) return
        void this.fail(sessionId, event.payload)
      }),
    )
  }

  private async startDeepgrams(
    sessionId: number,
    sources: CopilotAudioSource[],
    sampleRate: number,
  ): Promise<void> {
    this.enabledSources = sources
    await Promise.all(sources.map((source) => this.startDeepgram(sessionId, source, sampleRate)))
  }

  private async startDeepgram(
    sessionId: number,
    source: CopilotAudioSource,
    sampleRate: number,
  ): Promise<void> {
    closeDeepgramStream(this.deepgrams[source])
    this.transcripts[source] = createTranscriptState()
    this.deepgrams[source] = await startDeepgramStream(
      (event) => {
        if (!this.isCurrent(sessionId)) return
        const transcript = this.transcripts[source]
        if (
          event.isFinal
          && event.text
          && transcript.finalParts[transcript.finalParts.length - 1] !== event.text
        ) {
          transcript.finalParts.push(event.text)
        }
        if (!event.isUtteranceFinal) return
        const text = (transcript.finalParts.join(' ') || event.text).trim()
        transcript.finalParts = []
        if (!text) return
        const now = Date.now()
        if (text === transcript.lastFinal && now - transcript.lastFinalAt < 2_000) return
        transcript.lastFinal = text
        transcript.lastFinalAt = now
        this.transition({
          type: 'message',
          sessionId,
          message: {
            id: -(sessionId * 1_000_000 + ++this.messageSequence),
            role: source === 'system' ? 'interviewer' : 'me',
            source: source === 'system' ? 'system-stt' : 'microphone-stt',
            text,
          },
        })
        if (source === 'system') void this.answer(sessionId, text)
      },
      (error) => {
        if (this.isCurrent(sessionId)) void this.fail(sessionId, String(error))
      },
      sampleRate,
    )
  }

  private buildContext(): string {
    const { resumeOriginal, jobDescription } = useAppStore.getState()
    return [
      resumeOriginal ? `Resume:\n${resumeOriginal.slice(0, 6_000)}` : '',
      jobDescription ? `Job description:\n${jobDescription.slice(0, 4_000)}` : '',
      this.previousTurn ? `Previous turn:\n${this.previousTurn.slice(0, 2_000)}` : '',
    ].filter(Boolean).join('\n\n')
  }

  private async answer(sessionId: number, question: string): Promise<void> {
    if (!this.isCurrent(sessionId)) return
    this.abortController?.abort()
    const controller = new AbortController()
    this.abortController = controller
    const answerId = ++this.answerSequence
    const idBase = sessionId * 1_000_000 + answerId * 100
    const category = String(useAppStore.getState().settings?.aiModel || 'AI')

    try {
      await generateSuggestionsStream(
        question,
        this.buildContext(),
        {
          onDelta: (_delta, accumulated) => {
            if (!this.isCurrent(sessionId) || controller.signal.aborted) return
            this.transition({
              type: 'replace-suggestions',
              sessionId,
              suggestions: [{ id: idBase, text: accumulated, category }],
            })
          },
          onComplete: (text) => {
            if (!this.isCurrent(sessionId) || controller.signal.aborted) return
            this.transition({
              type: 'replace-suggestions',
              sessionId,
              suggestions: splitSuggestions(text, category, idBase),
            })
            this.previousTurn = `Question: ${question}\nAnswer: ${text}`
          },
        },
        controller.signal,
      )
    } catch (error) {
      if (controller.signal.aborted || !this.isCurrent(sessionId)) return
      this.transition({
        type: 'recoverable-error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async fail(sessionId: number, error: string): Promise<void> {
    if (!this.isCurrent(sessionId)) return
    this.abortController?.abort()
    await invoke('stop_audio_capture').catch(() => {})
    await this.cleanupRuntime()
    this.transition({ type: 'error', sessionId, error })
  }

  async dispatch(command: CopilotSessionCommand): Promise<void> {
    await this.handle(command)
  }
}

let activeHost: CopilotSessionHost | null = null
let activeHostPromise: Promise<CopilotSessionHost> | null = null
let activeHostUsers = 0

export async function mountCopilotSessionHost(): Promise<() => void> {
  activeHostUsers += 1
  if (!activeHostPromise) {
    const host = new CopilotSessionHost()
    activeHostPromise = host.mount().then(() => {
      activeHost = host
      return host
    })
  }
  await activeHostPromise
  let released = false
  return () => {
    if (released) return
    released = true
    activeHostUsers -= 1
    if (activeHostUsers === 0) {
      const host = activeHost
      activeHost = null
      activeHostPromise = null
      void host?.dispose()
    }
  }
}

export async function mountCopilotSessionClient(): Promise<() => void> {
  const unlisten = await listen<CopilotSnapshot>(SNAPSHOT_EVENT, (event) => {
    const current = useAppStore.getState().copilot
    if (event.payload.revision >= current.revision) {
      useAppStore.getState().setCopilotSnapshot(event.payload)
    }
  })
  await sendCopilotCommand({ type: 'request-snapshot' })
  return unlisten
}

export async function sendCopilotCommand(command: CopilotSessionCommand): Promise<void> {
  if (activeHostPromise) {
    const host = await activeHostPromise
    await host.dispatch(command)
    return
  }
  await emit(COMMAND_EVENT, command)
}

export function getCopilotRecording(): { chunks: number[][]; sampleRate: number } {
  return activeHost?.getRecording() || { chunks: [], sampleRate: 16_000 }
}

export function getCopilotRecordingDuration(): number {
  const { chunks, sampleRate } = getCopilotRecording()
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0)
  return Math.round(samples / (sampleRate || 16_000))
}

export function exportCopilotRecording(): boolean {
  const { chunks, sampleRate } = getCopilotRecording()
  if (chunks.length === 0) return false
  const buffer = chunksToWavBuffer(chunks, sampleRate)
  const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `interview-recording-${Date.now()}.wav`
  link.click()
  URL.revokeObjectURL(url)
  return true
}
