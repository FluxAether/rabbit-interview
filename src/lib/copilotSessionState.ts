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
  replyToId?: number
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
  generatingReplyToIds: number[]
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
  | { type: 'drop-message'; sessionId: number; messageId: number }
  | { type: 'suggestion'; sessionId: number; suggestion: Suggestion }
  | { type: 'regenerate-start'; sessionId: number; replyToId: number; answerId: number }
  | { type: 'stream-answer'; sessionId: number; suggestion: Suggestion; continuing?: boolean; replyToId?: number; background?: boolean }
  | { type: 'complete-answer'; sessionId: number; answerId: number; answer: string; suggestions: Suggestion[]; replyToId?: number; background?: boolean }
  | { type: 'incomplete-answer'; sessionId: number; answerId: number; text: string; reason: string; replyToId?: number; background?: boolean }
  | { type: 'cancel-answer'; sessionId: number; answerId: number; replyToId?: number }
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
    generatingReplyToIds: [],
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
      && messages[index].replyToId === message.replyToId
    ) return messages
    const next = messages.slice()
    next[index] = message
    return next
  }
  return [...messages, message]
}

/** Preserve unchanged row identities when a snapshot crosses the WebView boundary. */
export function reconcileCopilotSnapshot(current: CopilotSnapshot, incoming: CopilotSnapshot): CopilotSnapshot {
  const previous = new Map(current.messages.map((message) => [message.id, message]))
  const messages = incoming.messages.map((message) => {
    const old = previous.get(message.id)
    return old && old.text === message.text && old.role === message.role
      && old.source === message.source && old.createdAt === message.createdAt
      && old.replyToId === message.replyToId ? old : message
  })
  return {
    ...incoming,
    messages: messages.length === current.messages.length && messages.every((message, index) => message === current.messages[index])
      ? current.messages : messages,
    generatingReplyToIds: incoming.generatingReplyToIds.length === current.generatingReplyToIds.length
      && incoming.generatingReplyToIds.every((id, index) => id === current.generatingReplyToIds[index])
      ? current.generatingReplyToIds : incoming.generatingReplyToIds,
  }
}

function isFollowUp(message: CopilotMessage): boolean {
  return message.role === 'me' && message.source === 'follow-up'
}

function isDisplayAnchor(message: CopilotMessage): boolean {
  return message.role === 'interviewer' || isFollowUp(message)
}

/** Keep stored order. Only move replies that explicitly name their question. */
export function orderCopilotMessagesForDisplay(messages: CopilotMessage[]): CopilotMessage[] {
  if (messages.length < 2) return messages

  const anchorOf = new Map<number, number>()
  const anchors = new Map<number, CopilotMessage>()
  for (const message of messages) {
    if (isDisplayAnchor(message)) anchors.set(message.id, message)
  }
  const replies = new Map<number, CopilotMessage[]>()
  let lastAnchor: CopilotMessage | null = null
  for (const message of messages) {
    if (isDisplayAnchor(message)) {
      lastAnchor = message
      continue
    }
    if (message.role !== 'assistant') continue
    const named = message.replyToId != null
      ? anchors.get(message.replyToId)
      : null
    const anchor = named ?? lastAnchor
    if (anchor) {
      anchorOf.set(message.id, anchor.id)
      const block = replies.get(anchor.id)
      if (block) block.push(message)
      else replies.set(anchor.id, [message])
    }
  }

  const ordered: CopilotMessage[] = []
  const placed = new Set<number>()
  const push = (message: CopilotMessage) => {
    if (placed.has(message.id)) return
    placed.add(message.id)
    ordered.push(message)
  }

  let blockAnchorId: number | null = null
  const flushBlockReplies = () => {
    if (blockAnchorId == null) return
    for (const message of replies.get(blockAnchorId) ?? []) push(message)
  }

  for (const message of messages) {
    if (isDisplayAnchor(message)) {
      flushBlockReplies()
      blockAnchorId = message.id
      push(message)
      continue
    }
    if (message.role === 'assistant') {
      const anchorId = anchorOf.get(message.id)
      if (anchorId != null && anchorId !== blockAnchorId) continue
      if (anchorId == null && blockAnchorId == null) continue
    }
    push(message)
  }
  flushBlockReplies()
  for (const message of messages) {
    push(message)
  }
  return ordered
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
      generatingReplyToIds: [],
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
      generatingReplyToIds: [],
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
      generatingReplyToIds: [],
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
    if (
      action.sessionId !== null
      && !isCurrent(snapshot, action.sessionId)
      && snapshot.phase !== 'stopping'
      && snapshot.sessionId !== null
    ) {
      return snapshot
    }
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
      generatingReplyToIds: [],
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
    case 'drop-message': {
      const messages = snapshot.messages.filter((message) => message.id !== action.messageId)
      if (messages.length === snapshot.messages.length) return snapshot
      const previousInterviewer = [...messages].reverse().find((message) => message.role === 'interviewer')
      return {
        ...snapshot,
        question: previousInterviewer?.text ?? '',
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
    case 'regenerate-start': {
      const current = snapshot.generatingReplyToIds || []
      if (current.includes(action.replyToId)) return snapshot
      return {
        ...snapshot,
        generatingReplyToIds: [...current, action.replyToId],
        revision: snapshot.revision + 1,
      }
    }
    case 'stream-answer': {
      const previousActiveId = snapshot.activeAnswerId
      const baseMessages = (!action.background && previousActiveId !== null && previousActiveId !== action.suggestion.id)
        ? snapshot.messages.filter((message) => message.id !== previousActiveId)
        : snapshot.messages
      const existing = baseMessages.find((message) => message.id === action.suggestion.id)
      const messages = upsertMessage(baseMessages, {
        id: action.suggestion.id,
        role: 'assistant',
        source: 'llm',
        text: action.suggestion.text,
        createdAt: existing?.createdAt ?? Date.now(),
        replyToId: action.replyToId ?? existing?.replyToId,
      })
      if (action.background) {
        return {
          ...snapshot,
          messages,
          error: null,
          revision: snapshot.revision + 1,
        }
      }
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
      const baseMessages = (!action.background && snapshot.activeAnswerId !== null && snapshot.activeAnswerId !== action.answerId)
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
            replyToId: action.replyToId ?? existing?.replyToId,
          })
        : baseMessages
      const currentGenerating = snapshot.generatingReplyToIds || []
      const generatingReplyToIds = action.replyToId != null
        ? currentGenerating.filter((id) => id !== action.replyToId)
        : currentGenerating
      if (action.background) {
        return {
          ...snapshot,
          messages,
          generatingReplyToIds,
          error: null,
          revision: snapshot.revision + 1,
        }
      }
      return {
        ...snapshot,
        suggestions,
        messages,
        generatingReplyToIds,
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
      const messages = upsertMessage(snapshot.messages, {
        id: action.answerId,
        role: 'assistant',
        source: 'llm',
        text: action.text,
        createdAt: snapshot.messages.find((message) => message.id === action.answerId)?.createdAt ?? Date.now(),
        replyToId: action.replyToId ?? snapshot.messages.find((message) => message.id === action.answerId)?.replyToId,
      })
      const currentGenerating = snapshot.generatingReplyToIds || []
      const generatingReplyToIds = action.replyToId != null
        ? currentGenerating.filter((id) => id !== action.replyToId)
        : currentGenerating
      if (action.background) {
        return {
          ...snapshot,
          messages,
          generatingReplyToIds,
          revision: snapshot.revision + 1,
        }
      }
      return {
        ...snapshot,
        suggestions: [suggestion],
        messages,
        generatingReplyToIds,
        activeAnswerId: action.answerId,
        answerStatus: 'incomplete',
        answerNotice: action.reason,
        revision: snapshot.revision + 1,
      }
    }
    case 'cancel-answer': {
      const isForeground = snapshot.activeAnswerId === action.answerId
      const hasMessage = snapshot.messages.some((m) => m.id === action.answerId)
      const hasSuggestion = snapshot.suggestions.some((s) => s.id === action.answerId)
      const currentGenerating = snapshot.generatingReplyToIds || []
      const targetMsg = snapshot.messages.find((m) => m.id === action.answerId)
      const replyToIdToRemove = action.replyToId ?? targetMsg?.replyToId
      const isGeneratingToRemove = replyToIdToRemove != null && currentGenerating.includes(replyToIdToRemove)
      if (!isForeground && !hasMessage && !hasSuggestion && !isGeneratingToRemove) return snapshot
      const generatingReplyToIds = replyToIdToRemove != null
        ? currentGenerating.filter((id) => id !== replyToIdToRemove)
        : currentGenerating
      return {
        ...snapshot,
        suggestions: hasSuggestion ? snapshot.suggestions.filter((suggestion) => suggestion.id !== action.answerId) : snapshot.suggestions,
        messages: hasMessage ? snapshot.messages.filter((message) => message.id !== action.answerId) : snapshot.messages,
        generatingReplyToIds,
        activeAnswerId: isForeground ? null : snapshot.activeAnswerId,
        answerStatus: isForeground ? 'idle' : snapshot.answerStatus,
        answerNotice: isForeground ? null : snapshot.answerNotice,
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
