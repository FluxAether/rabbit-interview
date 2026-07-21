import type { Suggestion } from '../stores/useAppStore'

export type CopilotPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'
export type CopilotAnswerStatus = 'idle' | 'generating' | 'continuing' | 'incomplete'
export type CopilotArchiveStatus = 'idle' | 'saving' | 'saved' | 'error'
export type CopilotMessageRole = 'interviewer' | 'assistant' | 'me'
export type CopilotMessageSource = 'system-stt' | 'microphone-stt' | 'follow-up' | 'llm'

export interface CopilotMessage {
  id: number
  role: CopilotMessageRole
  source: CopilotMessageSource
  text: string
  createdAt: number
}

export interface CopilotSnapshot {
  phase: CopilotPhase
  question: string
  suggestions: Suggestion[]
  messages: CopilotMessage[]
  activeAnswerId: number | null
  answerStatus: CopilotAnswerStatus
  answerNotice: string | null
  archiveStatus: CopilotArchiveStatus
  archiveNotice: string | null
  amplitude: number
  hasRecording: boolean
  audioMode: string
  capabilityNotice: string | null
  error: string | null
  revision: number
  sessionId: number | null
  startedAt: number | null
}

export type CopilotSnapshotAction =
  | { type: 'start'; sessionId: number }
  | { type: 'started'; sessionId: number; mode: string }
  | { type: 'capability'; sessionId: number; notice: string | null }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'clear' }
  | { type: 'question'; sessionId: number; question: string }
  | { type: 'message'; sessionId: number; message: CopilotMessage }
  | { type: 'suggestion'; sessionId: number; suggestion: Suggestion }
  | { type: 'stream-answer'; sessionId: number; suggestion: Suggestion; continuing?: boolean }
  | { type: 'complete-answer'; sessionId: number; answerId: number; answer: string; suggestions: Suggestion[] }
  | { type: 'incomplete-answer'; sessionId: number; answerId: number; text: string; reason: string }
  | { type: 'cancel-answer'; sessionId: number; answerId: number }
  | { type: 'archive-saving' }
  | { type: 'archive-saved'; notice: string }
  | { type: 'archive-error'; notice: string }
  | { type: 'amplitude'; sessionId: number; amplitude: number }
  | { type: 'recording'; sessionId: number }
  | { type: 'recoverable-error'; sessionId: number; error: string }
  | { type: 'error'; sessionId: number | null; error: string }

export function createInitialSnapshot(): CopilotSnapshot {
  return {
    phase: 'idle',
    question: '',
    suggestions: [],
    messages: [],
    activeAnswerId: null,
    answerStatus: 'idle',
    answerNotice: null,
    archiveStatus: 'idle',
    archiveNotice: null,
    amplitude: 0,
    hasRecording: false,
    audioMode: 'idle',
    capabilityNotice: null,
    error: null,
    revision: 0,
    sessionId: null,
    startedAt: null,
  }
}

function isCurrent(snapshot: CopilotSnapshot, sessionId: number): boolean {
  return snapshot.sessionId === sessionId
}

function upsertMessage(messages: CopilotMessage[], message: CopilotMessage): CopilotMessage[] {
  const index = messages.findIndex((item) => item.id === message.id)
  if (index >= 0) {
    if (
      messages[index].text === message.text
      && messages[index].role === message.role
      && messages[index].source === message.source
      && messages[index].createdAt === message.createdAt
    ) return messages
    const next = messages.slice()
    next[index] = message
    return next
  }
  return [...messages, message].slice(-80)
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
      messages: [],
      activeAnswerId: null,
      answerStatus: 'idle',
      answerNotice: null,
      archiveStatus: 'idle',
      archiveNotice: null,
      amplitude: 0,
      hasRecording: false,
      audioMode: 'starting',
      capabilityNotice: null,
      error: null,
      sessionId: action.sessionId,
      startedAt: Date.now(),
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'stop') {
    if (snapshot.phase === 'idle' || snapshot.phase === 'stopping') return snapshot
    const discardActiveStream = snapshot.activeAnswerId !== null && snapshot.answerStatus !== 'incomplete'
    const messages = discardActiveStream
      ? snapshot.messages.filter((message) => message.id !== snapshot.activeAnswerId)
      : snapshot.messages
    const suggestions = discardActiveStream
      ? snapshot.suggestions.filter((suggestion) => suggestion.id !== snapshot.activeAnswerId)
      : snapshot.suggestions
    return {
      ...snapshot,
      phase: 'stopping',
      suggestions,
      messages,
      activeAnswerId: null,
      answerStatus: 'idle',
      answerNotice: null,
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
    if (!snapshot.question && snapshot.suggestions.length === 0 && snapshot.messages.length === 0 && !snapshot.error) return snapshot
    return {
      ...snapshot,
      question: '',
      suggestions: [],
      messages: [],
      activeAnswerId: null,
      answerStatus: 'idle',
      answerNotice: null,
      archiveStatus: 'idle',
      archiveNotice: null,
      error: null,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'archive-saving') {
    return {
      ...snapshot,
      archiveStatus: 'saving',
      archiveNotice: null,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'archive-saved') {
    return {
      ...snapshot,
      archiveStatus: 'saved',
      archiveNotice: action.notice,
      revision: snapshot.revision + 1,
    }
  }

  if (action.type === 'archive-error') {
    return {
      ...snapshot,
      archiveStatus: 'error',
      archiveNotice: action.notice,
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
      activeAnswerId: null,
      answerStatus: 'idle',
      answerNotice: null,
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
    case 'message': {
      const messages = upsertMessage(snapshot.messages, action.message)
      const question = action.message.role === 'interviewer' ? action.message.text : snapshot.question
      if (messages === snapshot.messages && question === snapshot.question) return snapshot
      return {
        ...snapshot,
        question,
        messages,
        revision: snapshot.revision + 1,
      }
    }
    case 'suggestion': {
      const suggestions = [...snapshot.suggestions, action.suggestion]
      return {
        ...snapshot,
        suggestions: suggestions.length > 40 ? suggestions.slice(-40) : suggestions,
        revision: snapshot.revision + 1,
      }
    }
    case 'stream-answer': {
      const previousActiveId = snapshot.activeAnswerId
      const baseMessages = previousActiveId !== null && previousActiveId !== action.suggestion.id
        ? snapshot.messages.filter((message) => message.id !== previousActiveId)
        : snapshot.messages
      const existing = baseMessages.find((message) => message.id === action.suggestion.id)
      const messages = upsertMessage(baseMessages, {
        id: action.suggestion.id,
        role: 'assistant',
        source: 'llm',
        text: action.suggestion.text,
        createdAt: existing?.createdAt ?? Date.now(),
      })
      return {
        ...snapshot,
        suggestions: [action.suggestion],
        messages,
        activeAnswerId: action.suggestion.id,
        answerStatus: action.continuing ? 'continuing' : 'generating',
        answerNotice: null,
        error: null,
        revision: snapshot.revision + 1,
      }
    }
    case 'complete-answer': {
      const suggestions = action.suggestions.slice(-40)
      const baseMessages = snapshot.activeAnswerId !== null && snapshot.activeAnswerId !== action.answerId
        ? snapshot.messages.filter((message) => message.id !== snapshot.activeAnswerId)
        : snapshot.messages
      const existing = baseMessages.find((message) => message.id === action.answerId)
      const messages = action.answer
        ? upsertMessage(baseMessages, {
            id: action.answerId,
            role: 'assistant',
            source: 'llm',
            text: action.answer,
            createdAt: existing?.createdAt ?? Date.now(),
          })
        : baseMessages
      return {
        ...snapshot,
        suggestions,
        messages,
        activeAnswerId: null,
        answerStatus: 'idle',
        answerNotice: null,
        error: null,
        revision: snapshot.revision + 1,
      }
    }
    case 'incomplete-answer': {
      const currentSuggestion = snapshot.suggestions.find((suggestion) => suggestion.id === action.answerId)
      const suggestion = {
        id: action.answerId,
        text: action.text,
        category: currentSuggestion?.category || 'AI',
      }
      return {
        ...snapshot,
        suggestions: [suggestion],
        messages: upsertMessage(snapshot.messages, {
          id: action.answerId,
          role: 'assistant',
          source: 'llm',
          text: action.text,
          createdAt: snapshot.messages.find((message) => message.id === action.answerId)?.createdAt ?? Date.now(),
        }),
        activeAnswerId: action.answerId,
        answerStatus: 'incomplete',
        answerNotice: action.reason,
        revision: snapshot.revision + 1,
      }
    }
    case 'cancel-answer': {
      if (snapshot.activeAnswerId !== action.answerId) return snapshot
      return {
        ...snapshot,
        suggestions: snapshot.suggestions.filter((suggestion) => suggestion.id !== action.answerId),
        messages: snapshot.messages.filter((message) => message.id !== action.answerId),
        activeAnswerId: null,
        answerStatus: 'idle',
        answerNotice: null,
        revision: snapshot.revision + 1,
      }
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
