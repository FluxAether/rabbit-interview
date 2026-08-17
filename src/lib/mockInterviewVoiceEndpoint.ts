import type { DeepgramTranscriptEvent } from './llm'

export const SPEECH_FINAL_GRACE_MS = 900

export interface VoiceEndpointState {
  finalParts: string[]
  interimTranscript: string
  answerStartedAt: number | null
}

export interface VoiceEndpointUpdate {
  state: VoiceEndpointState
  activity: boolean
  endpoint: 'speech-final' | 'utterance-end' | null
}

export function createVoiceEndpointState(): VoiceEndpointState {
  return {
    finalParts: [],
    interimTranscript: '',
    answerStartedAt: null,
  }
}

export function transcriptFromEndpointState(state: VoiceEndpointState, includeInterim = false): string {
  return joinTranscriptParts([
    ...state.finalParts,
    ...(includeInterim && state.interimTranscript.trim() ? [state.interimTranscript.trim()] : []),
  ])
}

export function applyVoiceTranscriptEvent(
  current: VoiceEndpointState,
  event: DeepgramTranscriptEvent,
  now = Date.now(),
): VoiceEndpointUpdate {
  const text = event.text.trim()
  const next: VoiceEndpointState = {
    finalParts: [...current.finalParts],
    interimTranscript: current.interimTranscript,
    answerStartedAt: current.answerStartedAt,
  }

  if (text && next.answerStartedAt == null) next.answerStartedAt = now

  if (event.boundary === 'interim') {
    next.interimTranscript = text
    return { state: next, activity: Boolean(text), endpoint: null }
  }

  if (text && (event.isFinal || event.boundary === 'final' || event.boundary === 'speech-final')) {
    appendFinalPart(next.finalParts, text)
    next.interimTranscript = ''
  }

  if (event.boundary === 'utterance-end') {
    return { state: next, activity: Boolean(text), endpoint: 'utterance-end' }
  }

  if (event.boundary === 'speech-final') {
    return { state: next, activity: Boolean(text), endpoint: 'speech-final' }
  }

  return { state: next, activity: Boolean(text), endpoint: null }
}

export function isMinimumVoiceAnswer(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (/\p{Script=Han}/u.test(trimmed)) {
    const meaningful = [...trimmed].filter(char => /[\p{L}\p{N}]/u.test(char))
    return meaningful.length >= 4
  }

  const tokens = trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []
  return tokens.length >= 3
}

function appendFinalPart(parts: string[], text: string): void {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return

  const current = joinTranscriptParts(parts)
  const last = parts[parts.length - 1] || ''
  if (normalized === last || current.endsWith(normalized)) return
  if (current && normalized.startsWith(current)) {
    parts.splice(0, parts.length, normalized)
    return
  }
  if (last && normalized.startsWith(last)) {
    parts[parts.length - 1] = normalized
    return
  }
  parts.push(normalized)
}

function joinTranscriptParts(parts: string[]): string {
  return parts
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .trim()
}
