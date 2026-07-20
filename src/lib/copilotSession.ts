import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { closeDeepgramStream, generateSuggestionsStream, sendAudioChunk, startDeepgramStream } from './llm'
import { chunksToWavBuffer } from './wav'
import { loadAppSettings } from './settingsStore'
import { openMicrophoneSettings, tryRequestMicrophone } from './permissions'
import {
  createInitialSnapshot,
  reduceCopilotSnapshot,
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
  sample_rate: number
  audiotee_commit: string
}

export interface CopilotStartConfig {
  useSystemAudio?: boolean
  useMicrophone?: boolean
  deviceName?: string | null
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
  private deepgram: WebSocket | null = null
  private unlisteners: UnlistenFn[] = []
  private commandUnlisten: UnlistenFn | null = null
  private recording: number[][] = []
  private sampleRate = 16_000
  private abortController: AbortController | null = null
  private stopPromise: Promise<void> | null = null
  private lastFinal = ''
  private lastFinalAt = 0
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
    const next = reduceCopilotSnapshot(this.snapshot, action)
    if (next === this.snapshot) return
    this.snapshot = next
    void this.publish()
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
          this.transition({ type: 'question', sessionId: this.snapshot.sessionId, question: command.text.trim() })
          void this.answer(this.snapshot.sessionId, command.text.trim())
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
    this.transition({ type: 'start', sessionId })
    this.recording = []
    this.sampleRate = 16_000
    this.lastFinal = ''
    this.lastFinalAt = 0
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
      const useMicrophone = microphoneRequested || !useSystemAudio

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
      await this.startDeepgram(sessionId, capabilities.sample_rate || 16_000)
      if (!this.isCurrent(sessionId)) {
        await this.cleanupRuntime()
        return
      }

      const audioConfig = await invoke<{ sample_rate: number }>('start_audio_capture', {
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
      this.transition({ type: 'started', sessionId })
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
      closeDeepgramStream(this.deepgram)
      this.deepgram = null
      await invoke('stop_audio_capture').catch(() => {})
      await this.cleanupRuntime()
      this.transition({ type: 'stopped' })
    })().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private async cleanupRuntime(): Promise<void> {
    closeDeepgramStream(this.deepgram)
    this.deepgram = null
    this.unlisteners.splice(0).forEach((unlisten) => unlisten())
  }

  private async installAudioListeners(sessionId: number): Promise<void> {
    await this.cleanupRuntime()
    this.unlisteners.push(
      await listen<{ sample_rate: number }>('audio-config', (event) => {
        if (!this.isCurrent(sessionId)) return
        const nextRate = event.payload.sample_rate || 16_000
        if (nextRate !== this.sampleRate) {
          this.sampleRate = nextRate
          void this.startDeepgram(sessionId, nextRate)
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
        sendAudioChunk(this.deepgram, new Float32Array(payload))
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

  private async startDeepgram(sessionId: number, sampleRate: number): Promise<void> {
    closeDeepgramStream(this.deepgram)
    this.deepgram = await startDeepgramStream(
      (text, isFinal) => {
        if (!isFinal || !text || !this.isCurrent(sessionId)) return
        const now = Date.now()
        if (text === this.lastFinal && now - this.lastFinalAt < 2_000) return
        this.lastFinal = text
        this.lastFinalAt = now
        this.transition({ type: 'question', sessionId, question: text })
        void this.answer(sessionId, text)
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
