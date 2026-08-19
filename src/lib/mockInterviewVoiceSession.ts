import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { SupportedLanguage } from '../i18n/types'
import {
  closeDeepgramStream,
  sendAudioChunk,
  startDeepgramStream,
  type DeepgramTranscriptEvent,
} from './llm'
import { tryRequestMicrophone } from './permissions'
import {
  applyVoiceTranscriptEvent,
  createVoiceEndpointState,
  isMinimumVoiceAnswer,
  SPEECH_FINAL_GRACE_MS,
  transcriptFromEndpointState,
  type VoiceEndpointState,
} from './mockInterviewVoiceEndpoint'

export type MockInterviewVoicePhase =
  | 'idle'
  | 'starting'
  | 'interviewer-speaking'
  | 'listening'
  | 'candidate-speaking'
  | 'finalizing'
  | 'paused'
  | 'stopping'
  | 'error'

export interface MockInterviewVoiceConfig {
  language: SupportedLanguage
  microphoneDevice: string | null
  speechEnabled: boolean
}

export interface MockInterviewVoiceSnapshot {
  phase: MockInterviewVoicePhase
  captureActive: boolean
  finalTranscript: string
  interimTranscript: string
  amplitude: number
  error: string | null
}

export interface SavedRecording {
  path: string
  duration_seconds: number
  sample_rate: number
}

export type MockInterviewVoiceEvent =
  | { type: 'snapshot'; snapshot: MockInterviewVoiceSnapshot }
  | {
      type: 'answer-final'
      text: string
      startedAt: number
      endedAt: number
      reason: 'utterance-end' | 'speech-final' | 'manual'
    }
  | { type: 'limit-reached' }
  | { type: 'error'; error: string }

type VoiceListener = (event: MockInterviewVoiceEvent) => void

interface AudioChunk {
  source: 'system' | 'microphone'
  samples: number[]
}

interface AudioConfig {
  sample_rate: number
  mode: string
  capture_id: number
}

export function createMockInterviewVoiceSnapshot(): MockInterviewVoiceSnapshot {
  return {
    phase: 'idle',
    captureActive: false,
    finalTranscript: '',
    interimTranscript: '',
    amplitude: 0,
    error: null,
  }
}

export class MockInterviewVoiceSession {
  private snapshot = createMockInterviewVoiceSnapshot()
  private readonly listeners = new Set<VoiceListener>()
  private config: MockInterviewVoiceConfig | null = null
  private socket: WebSocket | null = null
  private unlisteners: UnlistenFn[] = []
  private sampleRate = 16_000
  private captureId: number | null = null
  private recordingSessionId = crypto.randomUUID()
  private recordingAvailable = false
  private acceptingAudio = false
  private endpoint: VoiceEndpointState = createVoiceEndpointState()
  private finalizeTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private runtimeGeneration = 0
  private answerGeneration = 0
  private finalizedAnswerGeneration = -1
  private startPromise: Promise<void> | null = null
  private stopPromise: Promise<SavedRecording | null> | null = null

  subscribe(listener: VoiceListener): () => void {
    this.listeners.add(listener)
    listener({ type: 'snapshot', snapshot: this.copySnapshot() })
    return () => this.listeners.delete(listener)
  }

  async start(config: MockInterviewVoiceConfig): Promise<void> {
    if (this.snapshot.captureActive && this.socket) return
    if (this.startPromise) return this.startPromise
    if (this.stopPromise) await this.stopPromise

    const runtimeGeneration = ++this.runtimeGeneration
    this.startPromise = this.startRuntime(config, runtimeGeneration).finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  async ask(text: string, options: { preserveTranscript?: boolean } = {}): Promise<void> {
    const config = this.config
    if (!config || !this.snapshot.captureActive || !this.socket) {
      throw new Error('Voice session is not ready.')
    }

    const runtimeGeneration = this.runtimeGeneration
    const answerGeneration = ++this.answerGeneration
    this.finalizedAnswerGeneration = -1
    this.acceptingAudio = false
    this.clearFinalizeTimer()
    if (!options.preserveTranscript) this.endpoint = createVoiceEndpointState()
    this.updateSnapshot({
      phase: 'interviewer-speaking',
      amplitude: 0,
      finalTranscript: transcriptFromEndpointState(this.endpoint),
      interimTranscript: options.preserveTranscript ? this.endpoint.interimTranscript : '',
      error: null,
    })

    if (config.speechEnabled) {
      try {
        await invoke('speak_text', {
          text,
          language: config.language,
          rate: 185,
        })
      } catch (error) {
        if (!this.isCurrent(runtimeGeneration, answerGeneration)) return
        const message = error instanceof Error ? error.message : String(error)
        this.fail(message)
        throw error
      }
    }

    if (!this.isCurrent(runtimeGeneration, answerGeneration)) return
    this.acceptingAudio = true
    this.updateSnapshot({
      phase: 'listening',
      amplitude: 0,
      error: null,
    })
  }

  finalizeAnswer(): void {
    this.finalizeCurrentAnswer('manual', true)
  }

  restartAnswer(): void {
    if (!this.snapshot.captureActive || !this.socket) return
    this.answerGeneration += 1
    this.finalizedAnswerGeneration = -1
    this.clearFinalizeTimer()
    this.endpoint = createVoiceEndpointState()
    this.acceptingAudio = true
    this.updateSnapshot({
      phase: 'listening',
      finalTranscript: '',
      interimTranscript: '',
      amplitude: 0,
      error: null,
    })
  }

  async stop(options: { saveRecording?: boolean; preserveRecording?: boolean } = {}): Promise<SavedRecording | null> {
    if (this.stopPromise) return this.stopPromise
    const saveRecording = options.saveRecording !== false
    const preserveRecording = options.preserveRecording === true
    this.stopPromise = this.stopRuntime(saveRecording, preserveRecording).finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private async startRuntime(config: MockInterviewVoiceConfig, runtimeGeneration: number): Promise<void> {
    this.config = config
    this.recordingSessionId = crypto.randomUUID()
    this.recordingAvailable = false
    this.acceptingAudio = false
    this.endpoint = createVoiceEndpointState()
    this.clearFinalizeTimer()
    this.updateSnapshot({
      phase: 'starting',
      captureActive: false,
      finalTranscript: '',
      interimTranscript: '',
      amplitude: 0,
      error: null,
    })

    try {
      if (!(await tryRequestMicrophone())) {
        throw new Error('Microphone permission is required for voice answers.')
      }
      if (runtimeGeneration !== this.runtimeGeneration) return

      await this.installAudioListeners(runtimeGeneration)
      if (runtimeGeneration !== this.runtimeGeneration) return

      const audioConfig = await invoke<AudioConfig>('start_audio_capture', {
        useSystemAudio: false,
        useMicrophone: true,
        deviceName: config.microphoneDevice,
        captureOwner: 'mock-interview',
      })
      this.captureId = audioConfig.capture_id
      if (runtimeGeneration !== this.runtimeGeneration) {
        await this.stopOwnedCapture()
        return
      }

      this.sampleRate = audioConfig.sample_rate || 16_000
      this.updateSnapshot({ captureActive: true })
      this.socket = await this.openDeepgram(runtimeGeneration, this.sampleRate)
      if (runtimeGeneration !== this.runtimeGeneration) {
        closeDeepgramStream(this.socket)
        this.socket = null
        await this.stopOwnedCapture()
        return
      }

      this.updateSnapshot({ phase: 'paused', error: null })
    } catch (error) {
      if (runtimeGeneration !== this.runtimeGeneration) return
      await this.cleanupRuntime(false)
      const message = error instanceof Error ? error.message : String(error)
      this.fail(message)
      throw error
    }
  }

  private async stopRuntime(saveRecording: boolean, preserveRecording: boolean): Promise<SavedRecording | null> {
    this.runtimeGeneration += 1
    this.answerGeneration += 1
    this.acceptingAudio = false
    this.clearFinalizeTimer()
    this.updateSnapshot({ phase: 'stopping', amplitude: 0 })

    await invoke('stop_speaking').catch(() => {})
    const hadCapture = this.snapshot.captureActive
    await this.cleanupRuntime(true)
    if (hadCapture) this.recordingAvailable = true

    let recording: SavedRecording | null = null
    if (saveRecording && this.recordingAvailable) {
      recording = await invoke<SavedRecording | null>('save_audio_recording', {
        sessionId: this.recordingSessionId,
      }).catch(() => null)
      if (recording) this.recordingAvailable = false
    } else if (!preserveRecording) {
      this.recordingAvailable = false
    }

    this.config = null
    this.endpoint = createVoiceEndpointState()
    this.finalizedAnswerGeneration = -1
    this.snapshot = createMockInterviewVoiceSnapshot()
    this.publishSnapshot()
    return recording
  }

  private async installAudioListeners(runtimeGeneration: number): Promise<void> {
    this.removeAudioListeners()
    const listeners = await Promise.all([
      listen<AudioChunk>('audio-source-chunk', event => {
        if (runtimeGeneration !== this.runtimeGeneration) return
        if (!this.acceptingAudio || event.payload.source !== 'microphone') return
        sendAudioChunk(this.socket, new Float32Array(event.payload.samples))
      }),
      listen<number>('audio-amplitude', event => {
        if (runtimeGeneration !== this.runtimeGeneration || !this.acceptingAudio) return
        const amplitude = Math.max(0, Math.min(1, Number(event.payload) || 0))
        if (Math.abs(amplitude - this.snapshot.amplitude) < 0.01) return
        this.updateSnapshot({ amplitude })
      }),
      listen<{ sample_rate: number }>('audio-config', event => {
        if (runtimeGeneration !== this.runtimeGeneration) return
        const nextSampleRate = event.payload.sample_rate || 16_000
        if (nextSampleRate === this.sampleRate) return
        void this.replaceDeepgramForSampleRate(runtimeGeneration, nextSampleRate)
      }),
      listen<string>('audio-error', event => {
        if (runtimeGeneration !== this.runtimeGeneration) return
        this.fail(event.payload)
      }),
      listen('audio-recording-limit', () => {
        if (runtimeGeneration !== this.runtimeGeneration) return
        this.emit({ type: 'limit-reached' })
      }),
    ])

    if (runtimeGeneration !== this.runtimeGeneration) {
      listeners.forEach(unlisten => unlisten())
      return
    }
    this.unlisteners.push(...listeners)
  }

  private async openDeepgram(runtimeGeneration: number, sampleRate: number): Promise<WebSocket> {
    const config = this.config
    if (!config) throw new Error('Voice session configuration is missing.')
    return startDeepgramStream(
      event => this.handleTranscript(runtimeGeneration, event),
      error => {
        if (runtimeGeneration !== this.runtimeGeneration) return
        console.warn('[MockInterviewVoice] Deepgram warning', error)
      },
      sampleRate,
      next => {
        if (runtimeGeneration !== this.runtimeGeneration) {
          closeDeepgramStream(next)
          return
        }
        this.socket = next
      },
      { language: config.language },
    )
  }

  private async replaceDeepgramForSampleRate(runtimeGeneration: number, sampleRate: number): Promise<void> {
    if (runtimeGeneration !== this.runtimeGeneration || !this.snapshot.captureActive) return
    const wasAcceptingAudio = this.acceptingAudio
    this.acceptingAudio = false
    this.updateSnapshot({ amplitude: 0 })
    closeDeepgramStream(this.socket)
    this.socket = null
    this.sampleRate = sampleRate

    try {
      const next = await this.openDeepgram(runtimeGeneration, sampleRate)
      if (runtimeGeneration !== this.runtimeGeneration) {
        closeDeepgramStream(next)
        return
      }
      this.socket = next
      this.acceptingAudio = wasAcceptingAudio
    } catch (error) {
      if (runtimeGeneration !== this.runtimeGeneration) return
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private handleTranscript(runtimeGeneration: number, event: DeepgramTranscriptEvent): void {
    if (runtimeGeneration !== this.runtimeGeneration || !this.acceptingAudio) return
    const answerGeneration = this.answerGeneration
    if (event.text.trim()) this.clearFinalizeTimer()

    const update = applyVoiceTranscriptEvent(this.endpoint, event)
    this.endpoint = update.state
    if (update.activity) {
      this.updateSnapshot({
        phase: 'candidate-speaking',
        finalTranscript: transcriptFromEndpointState(this.endpoint),
        interimTranscript: this.endpoint.interimTranscript,
      })
    } else {
      this.updateSnapshot({
        finalTranscript: transcriptFromEndpointState(this.endpoint),
        interimTranscript: this.endpoint.interimTranscript,
      })
    }

    const finalText = transcriptFromEndpointState(this.endpoint)
    if (update.endpoint === 'utterance-end') {
      if (isMinimumVoiceAnswer(finalText)) this.finalizeCurrentAnswer('utterance-end', false)
      return
    }

    if (update.endpoint === 'speech-final' && isMinimumVoiceAnswer(finalText)) {
      const timerRuntimeGeneration = this.runtimeGeneration
      this.finalizeTimer = globalThis.setTimeout(() => {
        this.finalizeTimer = null
        if (
          timerRuntimeGeneration !== this.runtimeGeneration
          || answerGeneration !== this.answerGeneration
          || !this.acceptingAudio
        ) return
        this.finalizeCurrentAnswer('speech-final', false)
      }, SPEECH_FINAL_GRACE_MS)
      ;(this.finalizeTimer as { unref?: () => void }).unref?.()
    }
  }

  private finalizeCurrentAnswer(
    reason: 'utterance-end' | 'speech-final' | 'manual',
    includeInterim: boolean,
  ): void {
    if (!this.acceptingAudio) return
    if (this.finalizedAnswerGeneration === this.answerGeneration) return

    const text = transcriptFromEndpointState(this.endpoint, includeInterim)
    if (!text) return
    if (reason !== 'manual' && !isMinimumVoiceAnswer(text)) return

    const answerGeneration = this.answerGeneration
    this.finalizedAnswerGeneration = answerGeneration
    this.acceptingAudio = false
    this.clearFinalizeTimer()
    const startedAt = this.endpoint.answerStartedAt ?? Date.now()
    const endedAt = Date.now()
    this.endpoint = {
      finalParts: [text],
      interimTranscript: '',
      answerStartedAt: startedAt,
    }
    this.updateSnapshot({
      phase: 'finalizing',
      finalTranscript: text,
      interimTranscript: '',
      amplitude: 0,
    })
    this.emit({ type: 'answer-final', text, startedAt, endedAt, reason })

    if (answerGeneration === this.answerGeneration && this.snapshot.phase === 'finalizing') {
      this.updateSnapshot({ phase: 'paused' })
    }
  }

  private async cleanupRuntime(stopCapture: boolean): Promise<void> {
    this.acceptingAudio = false
    this.clearFinalizeTimer()
    closeDeepgramStream(this.socket)
    this.socket = null
    this.removeAudioListeners()
    if (stopCapture || this.snapshot.captureActive) {
      await this.stopOwnedCapture()
    }
    this.updateSnapshot({ captureActive: false, amplitude: 0 })
  }

  private async stopOwnedCapture(): Promise<void> {
    if (this.captureId === null) return
    const captureId = this.captureId
    this.captureId = null
    await invoke('stop_audio_capture', { captureId }).catch(() => {})
  }

  private removeAudioListeners(): void {
    this.unlisteners.splice(0).forEach(unlisten => unlisten())
  }

  private clearFinalizeTimer(): void {
    if (this.finalizeTimer == null) return
    globalThis.clearTimeout(this.finalizeTimer)
    this.finalizeTimer = null
  }

  private isCurrent(runtimeGeneration: number, answerGeneration: number): boolean {
    return runtimeGeneration === this.runtimeGeneration && answerGeneration === this.answerGeneration
  }

  private fail(error: string): void {
    this.acceptingAudio = false
    this.clearFinalizeTimer()
    this.updateSnapshot({ phase: 'error', amplitude: 0, error })
    this.emit({ type: 'error', error })
  }

  private updateSnapshot(update: Partial<MockInterviewVoiceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update }
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    this.emit({ type: 'snapshot', snapshot: this.copySnapshot() })
  }

  private copySnapshot(): MockInterviewVoiceSnapshot {
    return { ...this.snapshot }
  }

  private emit(event: MockInterviewVoiceEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

export const mockInterviewVoiceSession = new MockInterviewVoiceSession()
