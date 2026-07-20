import type { Suggestion } from '../stores/useAppStore'

export type CopilotPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

export interface CopilotSnapshot {
  phase: CopilotPhase
  question: string
  suggestions: Suggestion[]
  amplitude: number
  hasRecording: boolean
  audioMode: string
  capabilityNotice: string | null
  error: string | null
  revision: number
  sessionId: number | null
}

export type CopilotSnapshotAction =
  | { type: 'start'; sessionId: number }
  | { type: 'started'; sessionId: number; mode: string }
  | { type: 'capability'; sessionId: number; notice: string | null }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'clear' }
  | { type: 'question'; sessionId: number; question: string }
  | { type: 'suggestion'; sessionId: number; suggestion: Suggestion }
  | { type: 'replace-suggestions'; sessionId: number; suggestions: Suggestion[] }
  | { type: 'amplitude'; sessionId: number; amplitude: number }
  | { type: 'recording'; sessionId: number }
  | { type: 'recoverable-error'; sessionId: number; error: string }
  | { type: 'error'; sessionId: number | null; error: string }

export function createInitialSnapshot(): CopilotSnapshot {
  return {
    phase: 'idle',
    question: '',
    suggestions: [],
    amplitude: 0,
    hasRecording: false,
    audioMode: 'idle',
    capabilityNotice: null,
    error: null,
    revision: 0,
    sessionId: null,
  }
}

function isCurrent(snapshot: CopilotSnapshot, sessionId: number): boolean {
  return snapshot.sessionId === sessionId
}

export function reduceCopilotSnapshot(
  snapshot: CopilotSnapshot,
  action: CopilotSnapshotAction,
): CopilotSnapshot {
  if (action.type === 'start') {
    if (snapshot.phase === 'starting' || snapshot.phase === 'listening' || snapshot.phase === 'stopping') {
      return snapshot
    }
    return {
      ...snapshot,
      phase: 'starting',
      question: '',
      suggestions: [],
      amplitude: 0,
      hasRecording: false,
      audioMode: 'starting',
      capabilityNotice: null,
      error: null,
      sessionId: action.sessionId,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'stop') {
    if (snapshot.phase === 'idle' || snapshot.phase === 'stopping') return snapshot
    return {
      ...snapshot,
      phase: 'stopping',
      amplitude: 0,
      audioMode: 'stopping',
      sessionId: null,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'stopped') {
    if (snapshot.phase === 'idle') return snapshot
    return {
      ...snapshot,
      phase: 'idle',
      amplitude: 0,
      audioMode: 'idle',
      sessionId: null,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'clear') {
    if (!snapshot.question && snapshot.suggestions.length === 0 && !snapshot.error) return snapshot
    return {
      ...snapshot,
      question: '',
      suggestions: [],
      error: null,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'error') {
    if (action.sessionId !== null && !isCurrent(snapshot, action.sessionId)) return snapshot
    return {
      ...snapshot,
      phase: 'error',
      amplitude: 0,
      audioMode: 'error',
      error: action.error,
      sessionId: null,
      revision: snapshot.revision + 1,
    }
  }

  if (!isCurrent(snapshot, action.sessionId)) return snapshot

  switch (action.type) {
    case 'started':
      return {
        ...snapshot,
        phase: 'listening',
        audioMode: action.mode,
        revision: snapshot.revision + 1,
      }
    case 'capability':
      return {
        ...snapshot,
        capabilityNotice: action.notice,
        revision: snapshot.revision + 1,
      }
    case 'question':
      if (snapshot.question === action.question) return snapshot
      return {
        ...snapshot,
        question: action.question,
        revision: snapshot.revision + 1,
      }
    case 'suggestion': {
      const suggestions = [...snapshot.suggestions, action.suggestion]
      return {
        ...snapshot,
        suggestions: suggestions.length > 40 ? suggestions.slice(-40) : suggestions,
        revision: snapshot.revision + 1,
      }
    }
    case 'replace-suggestions':
      return {
        ...snapshot,
        suggestions: action.suggestions.slice(-40),
        error: null,
        revision: snapshot.revision + 1,
      }
    case 'amplitude':
      return {
        ...snapshot,
        amplitude: Math.max(0, Math.min(1, action.amplitude)),
        revision: snapshot.revision + 1,
      }
    case 'recording':
      if (snapshot.hasRecording) return snapshot
      return {
        ...snapshot,
        hasRecording: true,
        revision: snapshot.revision + 1,
      }
    case 'recoverable-error':
      return {
        ...snapshot,
        error: action.error,
        revision: snapshot.revision + 1,
      }
  }
}
