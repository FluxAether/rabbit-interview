import { invoke } from '@tauri-apps/api/core'

export type RealtimeTurnEvent =
  | 'stt.connected'
  | 'stt.firstInterim'
  | 'stt.speechFinal'
  | 'turn.sealed'
  | 'llm.requestStart'
  | 'llm.firstDelta'
  | 'ui.firstPaint'

export interface NativeRealtimeMetrics {
  lastTurnE2eMs?: number | null
  llmTtftMs?: number | null
  lastEvents?: Partial<Record<RealtimeTurnEvent, number>>
  elapsedMs: number
  audioCallbacksPerSecond: number
  capturedSamplesPerSecond: number
  audioIpcEventsPerSecond: number
  audioIpcKbPerSecond: number
  sttQueueMs: number
  recorderQueueMs: number
  droppedAudioMs: number
  sttReconnects: number
  systemCaptureCallbacks: number
  microphoneCaptureCallbacks: number
}

export interface RealtimePerformanceSnapshot extends NativeRealtimeMetrics {
  snapshotEventsPerSecond: number
  patchEventsPerSecond: number
  lastTurnE2eMs: number | null
  llmTtftMs: number | null
  lastEvents: Partial<Record<RealtimeTurnEvent, number>>
}

const startedAt = now()
const events = new Map<RealtimeTurnEvent, number>()
let snapshotEvents = 0
let patchEvents = 0
let firstInterimMarked = false
let firstDeltaMarked = false
let activeAnswerId: number | undefined
let firstPaintMarked = false

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function markRealtimeEvent(event: RealtimeTurnEvent, timestamp = now(), answerId?: number, questionId?: number): void {
  // Native timestamps provide one clock and one deduplication point across WebViews.
  void invoke('record_realtime_event', { event, answerId, questionId }).catch(() => {})
  if (event === 'ui.firstPaint') {
    if (answerId == null || answerId !== activeAnswerId || firstPaintMarked) return
    firstPaintMarked = true
  }
  if (event === 'stt.firstInterim') {
    if (firstInterimMarked) return
    firstInterimMarked = true
  }
  if (event === 'llm.requestStart') {
    activeAnswerId = answerId
    firstPaintMarked = false
    events.delete('ui.firstPaint')
    events.delete('llm.firstDelta')
    firstDeltaMarked = false
  }
  if (event === 'llm.firstDelta') {
    if (firstDeltaMarked) return
    firstDeltaMarked = true
  }
  events.set(event, timestamp)
}

export function resetRealtimeTurnMetrics(): void {
  void invoke('record_realtime_event', { event: 'reset' }).catch(() => {})
  activeAnswerId = undefined
  firstPaintMarked = false
  events.clear()
  firstInterimMarked = false
  firstDeltaMarked = false
}

export function recordSnapshotEvent(): void {
  snapshotEvents += 1
}

export function recordPatchEvent(): void {
  patchEvents += 1
}

export async function resetRealtimePerformanceMetrics(): Promise<void> {
  snapshotEvents = 0
  patchEvents = 0
  resetRealtimeTurnMetrics()
  await invoke('reset_realtime_metrics').catch(() => {})
}

export async function getRealtimePerformanceSnapshot(): Promise<RealtimePerformanceSnapshot> {
  const native: NativeRealtimeMetrics = await invoke<NativeRealtimeMetrics>('get_realtime_metrics').catch(() => ({
    elapsedMs: Math.max(1, now() - startedAt),
    audioCallbacksPerSecond: 0,
    capturedSamplesPerSecond: 0,
    audioIpcEventsPerSecond: 0,
    audioIpcKbPerSecond: 0,
    sttQueueMs: 0,
    recorderQueueMs: 0,
    droppedAudioMs: 0,
    sttReconnects: 0,
    systemCaptureCallbacks: 0,
    microphoneCaptureCallbacks: 0,
  }))
  const elapsedSeconds = Math.max(0.001, native.elapsedMs / 1000)
  const requestStart = events.get('llm.requestStart')
  const firstDelta = events.get('llm.firstDelta')
  const sealed = events.get('turn.sealed')
  const firstPaint = events.get('ui.firstPaint')
  return {
    ...native,
    snapshotEventsPerSecond: snapshotEvents / elapsedSeconds,
    patchEventsPerSecond: patchEvents / elapsedSeconds,
    lastTurnE2eMs: 'lastTurnE2eMs' in native ? native.lastTurnE2eMs ?? null : sealed != null && firstPaint != null ? Math.max(0, firstPaint - sealed) : null,
    llmTtftMs: 'llmTtftMs' in native ? native.llmTtftMs ?? null : requestStart != null && firstDelta != null ? Math.max(0, firstDelta - requestStart) : null,
    lastEvents: native.lastEvents ?? Object.fromEntries(events) as Partial<Record<RealtimeTurnEvent, number>>,
  }
}

export function useRealtimeHudVisible(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.hash.split('?')[1] || window.location.search).has('realtimeHud')
    || Boolean((globalThis as { __ONCUE_REALTIME_HUD?: boolean }).__ONCUE_REALTIME_HUD)
}
