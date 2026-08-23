import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import {
  closeDeepgramStream,
  generateSuggestionsStream,
  sendAudioChunk,
  startDeepgramStream,
  type SuggestionRequestType,
  type TranscriptBoundary,
} from './llm'
import { loadAppSettings } from './settingsStore'
import { openMicrophoneSettings, tryRequestMicrophone } from './permissions'
import { saveInterview } from './db'
import {
  createInitialSnapshot,
  reduceCopilotSnapshot,
  type CopilotSnapshot,
  type CopilotSnapshotAction,
} from './copilotSessionState'
import { useAppStore, type Suggestion } from '../stores/useAppStore'
import { mergeContinuationText, textSimilarity } from './copilotText'
import { createCopilotInterviewRecord, type SavedRecording } from './copilotArchive'
import { scoreCopilotSession, type CopilotSessionScore } from './copilotScoring'
import {
  getInterviewerCommitDelay,
  INTERVIEWER_COMMIT_DELAY_MS,
  INTERVIEWER_CONTINUATION_WINDOW_MS,
  isLikelyIncompleteInterviewPrompt,
  isNewInterviewQuestion,
  shouldInterruptForInterviewerContinuation,
} from './interviewerTurnDetector'
import { MAX_RECORDING_SECONDS } from './recordingLimits'
import {
  applyVoiceTranscriptEvent,
  createVoiceEndpointState,
  isMinimumVoiceAnswer,
  SPEECH_FINAL_GRACE_MS,
  transcriptFromEndpointState,
  type VoiceEndpointState,
} from './mockInterviewVoiceEndpoint'

const COMMAND_EVENT = 'copilot-session-command'
const SNAPSHOT_EVENT = 'copilot-session-snapshot'
const MAX_AUTO_CONTINUATIONS = 2
const ECHO_WINDOW_MS = 15_000
const UTTERANCE_HARD_CAP_MS = INTERVIEWER_CONTINUATION_WINDOW_MS
const INCOMPLETE_EXTEND_MS = INTERVIEWER_COMMIT_DELAY_MS.incompletePrompt
const SEAL_DEDUP_MS = 2_000
const COPILOT_ENDPOINTING_MS = 500
const COPILOT_UTTERANCE_END_MS = 1_500

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

interface CopilotUtteranceState {
  endpoint: VoiceEndpointState
  openMessageId: number | null
  openedAt: number | null
  lastSealedText: string
  lastSealedAt: number
  commitTimer: ReturnType<typeof globalThis.setTimeout> | null
  hardCapTimer: ReturnType<typeof globalThis.setTimeout> | null
}

interface ActiveAnswer {
  controller: AbortController
  answerId: number
  question: string
  startedAt: number
}

function createUtteranceState(): CopilotUtteranceState {
  return {
    endpoint: createVoiceEndpointState(),
    openMessageId: null,
    openedAt: null,
    lastSealedText: '',
    lastSealedAt: 0,
    commitTimer: null,
    hardCapTimer: null,
  }
}

function createChatMessage(
  id: number,
  role: 'interviewer' | 'assistant' | 'me',
  source: 'system-stt' | 'microphone-stt' | 'follow-up' | 'llm',
  text: string,
  createdAt = Date.now(),
) {
  return { id, role, source, text, createdAt }
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
  private transcripts: Record<CopilotAudioSource, CopilotUtteranceState> = {
    system: createUtteranceState(),
    microphone: createUtteranceState(),
  }
  private unlisteners: UnlistenFn[] = []
  private commandUnlisten: UnlistenFn | null = null
  private sampleRate = 16_000
  private captureId: number | null = null
  private activeAnswer: ActiveAnswer | null = null
  private pendingInterviewerQuestion = ''
  private interviewerQuestionTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private stopPromise: Promise<void> | null = null
  private limitTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private limitReached = false
  private persistenceSessionId: string | null = null
  private previousTurn = ''
  private lastRequestType: SuggestionRequestType = 'interviewer-question'
  private recentAssistantText = ''
  private recentAssistantAt = 0
  private recentMicrophoneText = ''
  private recentMicrophoneAt = 0

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

  private isCurrent(sessionId: number): boolean {
    return this.snapshot.sessionId === sessionId
  }

  private transition(action: CopilotSnapshotAction): void {
    const previous = this.snapshot
    const next = reduceCopilotSnapshot(previous, action)
    if (next === previous) return
    this.snapshot = next
    void this.publish()
  }

  private async archiveSession(
    snapshot: CopilotSnapshot,
    persistenceSessionId: string | null,
  ): Promise<void> {
    if (!persistenceSessionId) return

    let recording: SavedRecording | null = null
    let recordingError: string | null = null
    try {
      recording = await invoke<SavedRecording | null>('save_audio_recording', {
        sessionId: persistenceSessionId,
      })
    } catch (error) {
      recordingError = error instanceof Error ? error.message : String(error)
      console.error('[Copilot] Failed to save recording', error)
    }
    if (
      snapshot.messages.length === 0
      && !recording
      && !recordingError
    ) return

    this.transition({ type: 'archive-saving' })
    const duration = recording?.duration_seconds ?? 0

    let score: CopilotSessionScore | null = null
    let scoreError: string | null = null
    try {
      score = await scoreCopilotSession(snapshot.messages)
    } catch (error) {
      scoreError = error instanceof Error ? error.message : String(error)
      console.error('[Copilot] Failed to score session', error)
    }

    const record = createCopilotInterviewRecord(
      snapshot.messages,
      duration,
      recording?.path ?? null,
      new Date(),
      score,
    )

    try {
      const id = await saveInterview(record)
      useAppStore.getState().addHistory({ ...record, id })
      if (recordingError || scoreError) {
        const parts = []
        if (recordingError) parts.push(`recording could not be saved: ${recordingError}`)
        if (scoreError) parts.push(`score could not be generated: ${scoreError}`)
        this.transition({
          type: 'archive-error',
          notice: `Session saved, but ${parts.join('; ')}`,
        })
      } else {
        this.transition({
          type: 'archive-saved',
          notice: this.limitReached
            ? 'copilot.archive.limitReached'
            : recording
              ? (score ? 'copilot.archive.savedScored' : 'copilot.archive.saved')
              : (score ? 'copilot.archive.sessionSavedScored' : 'copilot.archive.sessionSaved'),
        })
      }
      console.info('[Copilot] Session archived', {
        interviewId: id,
        recordingPath: recording?.path ?? null,
        duration,
        score: score?.overallScore ?? null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Copilot] Failed to archive session', error)
      this.transition({
        type: 'archive-error',
        notice: recording
          ? `Recording saved, but the session record could not be saved: ${message}`
          : `Session could not be saved: ${message}`,
      })
    }
  }

  private clearPendingInterviewerQuestion(): void {
    if (this.interviewerQuestionTimer !== null) {
      globalThis.clearTimeout(this.interviewerQuestionTimer)
      this.interviewerQuestionTimer = null
    }
    this.pendingInterviewerQuestion = ''
  }

  private scheduleInterviewerAnswer(
    sessionId: number,
    text: string,
    boundary: TranscriptBoundary,
  ): void {
    if (!this.isCurrent(sessionId)) return
    const normalized = text.trim()
    const active = this.activeAnswer

    if (normalized && active && shouldInterruptForInterviewerContinuation(
      active.question,
      normalized,
      Date.now() - active.startedAt,
    )) {
      this.pendingInterviewerQuestion = [
        active.question,
        this.pendingInterviewerQuestion,
        normalized,
      ].filter(Boolean).join(' ')
      this.cancelActiveAnswer(sessionId)
    } else if (normalized) {
      this.pendingInterviewerQuestion = [this.pendingInterviewerQuestion, normalized]
        .filter(Boolean)
        .join(' ')
    }

    if (!this.pendingInterviewerQuestion) return
    if (this.interviewerQuestionTimer !== null) {
      globalThis.clearTimeout(this.interviewerQuestionTimer)
    }
    const delay = getInterviewerCommitDelay(this.pendingInterviewerQuestion, boundary)
    this.interviewerQuestionTimer = globalThis.setTimeout(() => {
      this.interviewerQuestionTimer = null
      void this.flushPendingInterviewerAnswer(sessionId)
    }, delay)
  }

  private async flushPendingInterviewerAnswer(sessionId: number): Promise<void> {
    if (!this.isCurrent(sessionId) || !this.pendingInterviewerQuestion || this.activeAnswer) return
    const question = this.pendingInterviewerQuestion
    this.pendingInterviewerQuestion = ''
    this.transition({ type: 'question', sessionId, question })
    await this.answer(sessionId, question, 'interviewer-question')
  }

  private resumePendingInterviewerAnswer(sessionId: number): void {
    if (
      !this.isCurrent(sessionId)
      || !this.pendingInterviewerQuestion
      || this.interviewerQuestionTimer !== null
      || this.activeAnswer
    ) return
    this.interviewerQuestionTimer = globalThis.setTimeout(() => {
      this.interviewerQuestionTimer = null
      void this.flushPendingInterviewerAnswer(sessionId)
    }, 0)
  }

  private cancelActiveAnswer(sessionId: number | null): void {
    const active = this.activeAnswer
    if (!active) return
    this.activeAnswer = null
    active.controller.abort()
    if (sessionId !== null && this.isCurrent(sessionId)) {
      this.transition({ type: 'cancel-answer', sessionId, answerId: active.answerId })
    }
  }

  private isLikelyEcho(text: string, now: number): boolean {
    if (text.replace(/\s/g, '').length < 12) return false
    const assistantEcho = now - this.recentAssistantAt <= ECHO_WINDOW_MS
      && textSimilarity(text, this.recentAssistantText) >= 0.68
    const microphoneEcho = now - this.recentMicrophoneAt <= ECHO_WINDOW_MS
      && textSimilarity(text, this.recentMicrophoneText) >= 0.68
    return assistantEcho || microphoneEcho
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
      case 'clear': {
        const sessionId = this.snapshot.sessionId
        this.clearPendingInterviewerQuestion()
        this.cancelActiveAnswer(sessionId)
        this.transition({ type: 'clear' })
        break
      }
      case 'retry':
        if (this.snapshot.sessionId !== null && this.snapshot.question) {
          const sessionId = this.snapshot.sessionId
          this.clearPendingInterviewerQuestion()
          void this.answer(sessionId, this.snapshot.question, this.lastRequestType, true)
        }
        break
      case 'follow-up':
        if (this.snapshot.sessionId !== null && command.text.trim()) {
          const text = command.text.trim()
          const sessionId = this.snapshot.sessionId
          this.clearPendingInterviewerQuestion()
          this.cancelActiveAnswer(sessionId)
          this.transition({ type: 'question', sessionId, question: text })
          this.transition({
            type: 'message',
            sessionId,
            message: createChatMessage(
              -(sessionId * 1_000_000 + ++this.messageSequence),
              'me',
              'follow-up',
              text,
            ),
          })
          void this.answer(sessionId, text, 'follow-up', true)
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

    this.clearPendingInterviewerQuestion()
    this.cancelActiveAnswer(this.snapshot.sessionId)
    const sessionId = ++this.sessionSequence
    this.persistenceSessionId = globalThis.crypto.randomUUID()
    this.transition({ type: 'start', sessionId })
    this.sampleRate = 16_000
    this.messageSequence = 0
    this.resetUtterances()
    this.previousTurn = ''
    this.lastRequestType = 'interviewer-question'
    this.recentAssistantText = ''
    this.recentAssistantAt = 0
    this.recentMicrophoneText = ''
    this.recentMicrophoneAt = 0
    this.limitReached = false
    this.clearLimitTimer()

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

      const audioConfig = await invoke<{ sample_rate: number; mode: string; capture_id: number }>('start_audio_capture', {
        useSystemAudio,
        useMicrophone,
        deviceName: config.deviceName ?? settings.micDevice ?? null,
        captureOwner: 'copilot',
      })
      this.captureId = audioConfig.capture_id
      if (!this.isCurrent(sessionId)) {
        await this.stopOwnedCapture()
        await this.cleanupRuntime()
        return
      }
      this.sampleRate = audioConfig.sample_rate || 16_000
      this.transition({ type: 'started', sessionId, mode: audioConfig.mode })
      this.scheduleLimitStop(sessionId)
    } catch (error) {
      if (!this.isCurrent(sessionId)) return
      await this.stopOwnedCapture()
      await this.cleanupRuntime()
      this.transition({
        type: 'error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async stop(options: { reason?: 'limit' } = {}): Promise<void> {
    if (this.snapshot.phase === 'idle') return
    if (this.stopPromise) return this.stopPromise

    if (options.reason === 'limit') this.limitReached = true
    const sessionId = this.snapshot.sessionId
    this.clearLimitTimer()
    if (sessionId != null) this.flushOpenUtterances(sessionId)
    this.clearPendingInterviewerQuestion()
    this.cancelActiveAnswer(sessionId)
    const archiveSnapshot = this.snapshot
    const persistenceSessionId = this.persistenceSessionId
    this.transition({ type: 'stop' })
    this.stopPromise = (async () => {
      this.closeDeepgrams()
      await this.stopOwnedCapture()
      await this.cleanupRuntime()
      await this.archiveSession(archiveSnapshot, persistenceSessionId)
      this.transition({ type: 'stopped' })
      this.persistenceSessionId = null
    })().finally(() => {
      this.stopPromise = null
    })
    return this.stopPromise
  }

  private async cleanupRuntime(): Promise<void> {
    this.clearLimitTimer()
    this.closeDeepgrams()
    this.resetUtterances()
    this.enabledSources = []
    this.unlisteners.splice(0).forEach((unlisten) => unlisten())
  }

  private async stopOwnedCapture(): Promise<void> {
    if (this.captureId === null) return
    const captureId = this.captureId
    this.captureId = null
    await invoke('stop_audio_capture', { captureId }).catch(() => {})
  }

  private clearLimitTimer(): void {
    if (this.limitTimer == null) return
    globalThis.clearTimeout(this.limitTimer)
    this.limitTimer = null
  }

  private scheduleLimitStop(sessionId: number): void {
    this.clearLimitTimer()
    const startedAt = this.snapshot.startedAt
    if (startedAt == null) return
    const remainingMs = Math.max(0, MAX_RECORDING_SECONDS * 1000 - (Date.now() - startedAt))
    this.limitTimer = globalThis.setTimeout(() => {
      this.limitTimer = null
      if (!this.isCurrent(sessionId)) return
      void this.stop({ reason: 'limit' })
    }, remainingMs)
    ;(this.limitTimer as { unref?: () => void }).unref?.()
  }

  private closeDeepgrams(): void {
    closeDeepgramStream(this.deepgrams.system)
    closeDeepgramStream(this.deepgrams.microphone)
    this.deepgrams.system = null
    this.deepgrams.microphone = null
  }

  private resetUtterances(): void {
    this.clearUtteranceTimers(this.transcripts.system)
    this.clearUtteranceTimers(this.transcripts.microphone)
    this.transcripts = {
      system: createUtteranceState(),
      microphone: createUtteranceState(),
    }
  }

  private clearUtteranceTimers(utterance: CopilotUtteranceState): void {
    if (utterance.commitTimer != null) {
      globalThis.clearTimeout(utterance.commitTimer)
      utterance.commitTimer = null
    }
    if (utterance.hardCapTimer != null) {
      globalThis.clearTimeout(utterance.hardCapTimer)
      utterance.hardCapTimer = null
    }
  }

  private nextMessageId(sessionId: number): number {
    return -(sessionId * 1_000_000 + ++this.messageSequence)
  }

  private utteranceText(utterance: CopilotUtteranceState, includeInterim = false): string {
    return transcriptFromEndpointState(utterance.endpoint, includeInterim)
  }

  private upsertUtteranceMessage(
    sessionId: number,
    source: CopilotAudioSource,
    text: string,
    createdAt: number,
  ): void {
    const utterance = this.transcripts[source]
    if (!text || utterance.openMessageId == null) return
    this.transition({
      type: 'message',
      sessionId,
      message: createChatMessage(
        utterance.openMessageId,
        source === 'system' ? 'interviewer' : 'me',
        source === 'system' ? 'system-stt' : 'microphone-stt',
        text,
        createdAt,
      ),
    })
  }

  private ensureOpenUtterance(sessionId: number, source: CopilotAudioSource, now: number): CopilotUtteranceState {
    const utterance = this.transcripts[source]
    if (utterance.openMessageId == null) {
      utterance.openMessageId = this.nextMessageId(sessionId)
      utterance.openedAt = now
    }
    if (utterance.hardCapTimer == null) {
      const remaining = Math.max(0, UTTERANCE_HARD_CAP_MS - (now - (utterance.openedAt ?? now)))
      utterance.hardCapTimer = globalThis.setTimeout(() => {
        utterance.hardCapTimer = null
        this.trySeal(sessionId, source, 'speech-final', true)
      }, remaining)
      ;(utterance.hardCapTimer as { unref?: () => void }).unref?.()
    }
    return utterance
  }

  private cancelDeferredSeal(utterance: CopilotUtteranceState): void {
    if (utterance.commitTimer == null) return
    globalThis.clearTimeout(utterance.commitTimer)
    utterance.commitTimer = null
  }

  private scheduleSeal(
    sessionId: number,
    source: CopilotAudioSource,
    boundary: TranscriptBoundary,
    delayMs: number,
  ): void {
    const utterance = this.transcripts[source]
    this.cancelDeferredSeal(utterance)
    utterance.commitTimer = globalThis.setTimeout(() => {
      utterance.commitTimer = null
      this.trySeal(sessionId, source, boundary)
    }, delayMs)
    ;(utterance.commitTimer as { unref?: () => void }).unref?.()
  }

  private trySeal(
    sessionId: number,
    source: CopilotAudioSource,
    boundary: TranscriptBoundary,
    force = false,
  ): void {
    if (!this.isCurrent(sessionId)) return
    const utterance = this.transcripts[source]
    const text = this.utteranceText(utterance)
    if (!text || !isMinimumVoiceAnswer(text)) return

    const now = Date.now()
    if (text === utterance.lastSealedText && now - utterance.lastSealedAt < SEAL_DEDUP_MS) {
      this.resetOpenUtterance(utterance)
      return
    }
    if (source === 'system' && this.isLikelyEcho(text, now)) {
      this.resetOpenUtterance(utterance)
      return
    }

    const openedAt = utterance.openedAt ?? now
    const withinHardCap = now - openedAt < UTTERANCE_HARD_CAP_MS
    if (
      !force
      && !isNewInterviewQuestion(text)
      && isLikelyIncompleteInterviewPrompt(text)
      && withinHardCap
    ) {
      this.scheduleSeal(sessionId, source, boundary, INCOMPLETE_EXTEND_MS)
      return
    }

    this.sealUtterance(sessionId, source, text, boundary, now)
  }

  private sealUtterance(
    sessionId: number,
    source: CopilotAudioSource,
    text: string,
    boundary: TranscriptBoundary,
    now: number,
  ): void {
    const utterance = this.transcripts[source]
    this.ensureOpenUtterance(sessionId, source, utterance.openedAt ?? now)
    this.upsertUtteranceMessage(sessionId, source, text, utterance.openedAt ?? now)
    if (source === 'microphone') {
      this.recentMicrophoneText = text
      this.recentMicrophoneAt = now
    }
    utterance.lastSealedText = text
    utterance.lastSealedAt = now
    this.resetOpenUtterance(utterance)
    if (source === 'system') this.scheduleInterviewerAnswer(sessionId, text, boundary)
  }

  private resetOpenUtterance(utterance: CopilotUtteranceState): void {
    this.clearUtteranceTimers(utterance)
    utterance.endpoint = createVoiceEndpointState()
    utterance.openMessageId = null
    utterance.openedAt = null
  }

  private handleTranscriptEvent(
    sessionId: number,
    source: CopilotAudioSource,
    event: { text: string; isFinal: boolean; boundary: TranscriptBoundary },
  ): void {
    if (!this.isCurrent(sessionId)) return
    const now = Date.now()
    const utterance = this.transcripts[source]
    const update = applyVoiceTranscriptEvent(utterance.endpoint, event, now)
    utterance.endpoint = update.state
    const preview = this.utteranceText(utterance, true)
    if (preview) {
      this.ensureOpenUtterance(sessionId, source, utterance.openedAt ?? now)
      if (source === 'microphone') {
        this.upsertUtteranceMessage(sessionId, source, preview, utterance.openedAt ?? now)
      }
    }
    if (update.activity) this.cancelDeferredSeal(utterance)

    if (update.endpoint === 'utterance-end') {
      this.trySeal(sessionId, source, 'utterance-end')
      return
    }
    if (update.endpoint === 'speech-final' && isMinimumVoiceAnswer(this.utteranceText(utterance))) {
      this.scheduleSeal(sessionId, source, 'speech-final', SPEECH_FINAL_GRACE_MS)
    }
  }

  private flushOpenUtterances(sessionId: number): void {
    for (const source of ['system', 'microphone'] as const) {
      const utterance = this.transcripts[source]
      if (utterance.openMessageId == null) continue
      this.trySeal(sessionId, source, 'speech-final', true)
    }
  }

  private async installAudioListeners(sessionId: number): Promise<void> {
    await this.cleanupRuntime()
    const listeners = await Promise.all([
      listen<{ sample_rate: number }>('audio-config', (event) => {
        if (!this.isCurrent(sessionId)) return
        const nextRate = event.payload.sample_rate || 16_000
        if (nextRate !== this.sampleRate) {
          this.sampleRate = nextRate
          void this.startDeepgrams(sessionId, this.enabledSources, nextRate).catch((error) => {
            if (this.isCurrent(sessionId)) void this.fail(sessionId, String(error))
          })
        }
      }),
      listen<AudioSourceChunk>('audio-source-chunk', (event) => {
        if (!this.isCurrent(sessionId)) return
        sendAudioChunk(this.deepgrams[event.payload.source], new Float32Array(event.payload.samples))
      }),
      listen<number>('audio-amplitude', (event) => {
        if (!this.isCurrent(sessionId)) return
        if (!this.snapshot.hasRecording) {
          this.transition({ type: 'recording', sessionId })
        }
        // Amplitude is UI-only; skip no-op updates that still bump revision/publish.
        if (Math.abs(this.snapshot.amplitude - event.payload) < 0.01) return
        this.transition({ type: 'amplitude', sessionId, amplitude: event.payload })
      }),
      listen<string>('audio-error', (event) => {
        if (!this.isCurrent(sessionId)) return
        void this.fail(sessionId, event.payload)
      }),
      listen('audio-recording-limit', () => {
        if (!this.isCurrent(sessionId)) return
        void this.stop({ reason: 'limit' })
      }),
    ])

    if (!this.isCurrent(sessionId)) {
      listeners.forEach((unlisten) => unlisten())
      return
    }

    this.unlisteners.push(...listeners)
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
    this.clearUtteranceTimers(this.transcripts[source])
    this.transcripts[source] = createUtteranceState()
    this.deepgrams[source] = await startDeepgramStream(
      (event) => this.handleTranscriptEvent(sessionId, source, event),
      (error) => {
        // Reconnect handles transient socket failures; only surface non-socket parse issues.
        console.warn('[Copilot] Deepgram stream warning', error)
      },
      sampleRate,
      (socket) => {
        if (!this.isCurrent(sessionId)) {
          closeDeepgramStream(socket)
          return
        }
        this.deepgrams[source] = socket
      },
      {
        endpointingMs: COPILOT_ENDPOINTING_MS,
        utteranceEndMs: COPILOT_UTTERANCE_END_MS,
      },
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

  private async answer(
    sessionId: number,
    question: string,
    requestType: SuggestionRequestType,
    interrupt = false,
  ): Promise<void> {
    if (!this.isCurrent(sessionId)) return
    if (this.activeAnswer) {
      if (!interrupt && requestType === 'interviewer-question') {
        this.pendingInterviewerQuestion = [question, this.pendingInterviewerQuestion]
          .filter(Boolean)
          .join(' ')
        return
      }
      this.cancelActiveAnswer(sessionId)
    }

    this.lastRequestType = requestType
    const controller = new AbortController()
    const answerSequence = ++this.answerSequence
    const idBase = sessionId * 1_000_000 + answerSequence * 100
    this.activeAnswer = {
      controller,
      answerId: idBase,
      question,
      startedAt: Date.now(),
    }
    const category = String(useAppStore.getState().settings?.aiModel || 'AI')

    try {
      const context = this.buildContext()
      let fullText = ''
      let continuationAttempt = 0

      while (!controller.signal.aborted && this.isCurrent(sessionId)) {
        const attemptBaseText = fullText
        const result = await generateSuggestionsStream(
          question,
          context,
          {
            onDelta: (_delta, accumulated) => {
              if (!this.isCurrent(sessionId) || controller.signal.aborted) return
              fullText = attemptBaseText
                ? mergeContinuationText(attemptBaseText, accumulated)
                : accumulated
              this.recentAssistantText = fullText
              this.recentAssistantAt = Date.now()
              this.transition({
                type: 'stream-answer',
                sessionId,
                suggestion: { id: idBase, text: fullText, category },
                continuing: continuationAttempt > 0,
              })
            },
          },
          controller.signal,
          requestType,
          continuationAttempt > 0
            ? { continuationText: attemptBaseText, continuationAttempt }
            : {},
        )

        if (!this.isCurrent(sessionId) || controller.signal.aborted) return
        fullText = attemptBaseText
          ? mergeContinuationText(attemptBaseText, result.text)
          : result.text
        this.recentAssistantText = fullText
        this.recentAssistantAt = Date.now()
        const madeProgress = fullText.length > attemptBaseText.length
        console.info('[Copilot][LLM]', {
          answerId: idBase,
          provider: result.provider,
          model: result.model,
          status: result.status,
          finishReason: result.finishReason,
          characters: fullText.length,
          continuationAttempt,
          madeProgress,
        })

        if (result.status === 'complete' && fullText.trim() && (continuationAttempt === 0 || madeProgress)) {
          this.transition({
            type: 'complete-answer',
            sessionId,
            answerId: idBase,
            answer: fullText,
            suggestions: splitSuggestions(fullText, category, idBase),
          })
          this.previousTurn = `Question: ${question}\nAnswer: ${fullText}`
          break
        }

        if (result.status === 'max-tokens' && continuationAttempt < MAX_AUTO_CONTINUATIONS && madeProgress) {
          continuationAttempt += 1
          this.transition({
            type: 'stream-answer',
            sessionId,
            suggestion: { id: idBase, text: fullText, category },
            continuing: true,
          })
          continue
        }

        if (!fullText.trim()) {
          throw new Error(`LLM stream ended without a complete answer (${result.finishReason || 'unknown reason'})`)
        }
        const reason = result.status === 'max-tokens'
          ? 'copilot.answer.incomplete.maxTokens'
          : result.finishReason === 'connection_lost'
            ? 'copilot.answer.incomplete.connection'
            : 'copilot.answer.incomplete.unknown'
        this.transition({
          type: 'incomplete-answer',
          sessionId,
          answerId: idBase,
          text: fullText,
          reason,
        })
        break
      }
    } catch (error) {
      if (controller.signal.aborted || !this.isCurrent(sessionId)) return
      this.transition({ type: 'cancel-answer', sessionId, answerId: idBase })
      this.transition({
        type: 'recoverable-error',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      const wasActive = this.activeAnswer?.controller === controller
      if (wasActive) {
        this.activeAnswer = null
      }
      if (wasActive || controller.signal.aborted) {
        this.resumePendingInterviewerAnswer(sessionId)
      }
    }
  }

  private async fail(sessionId: number, error: string): Promise<void> {
    if (!this.isCurrent(sessionId)) return
    this.clearLimitTimer()
    this.flushOpenUtterances(sessionId)
    this.clearPendingInterviewerQuestion()
    this.cancelActiveAnswer(sessionId)
    const archiveSnapshot = this.snapshot
    const persistenceSessionId = this.persistenceSessionId
    await this.stopOwnedCapture()
    await this.cleanupRuntime()
    await this.archiveSession(archiveSnapshot, persistenceSessionId)
    this.persistenceSessionId = null
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
    activeHostPromise = host
      .mount()
      .then(() => {
        activeHost = host
        return host
      })
      .catch((error) => {
        activeHostPromise = null
        throw error
      })
  }
  try {
    await activeHostPromise
  } catch (error) {
    activeHostUsers -= 1
    throw error
  }
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

export async function exportCopilotRecording(): Promise<boolean> {
  const recording = await invoke<SavedRecording | null>('export_audio_recording')
  if (!recording) return false
  await revealItemInDir(recording.path).catch((error) => {
    console.warn('[Copilot] Unable to reveal exported recording', error)
  })
  return true
}
