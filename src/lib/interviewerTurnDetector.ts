import type { TranscriptBoundary } from './llm'

const INCOMPLETE_ENDING_PATTERN = /(?:以及|并且|而且|还有|然后|或者|比如|例如|包括|主要是|我想问的是|另外一个是|and|or|because|including|such as|as well as|what about)\s*[，,、:：-]?\s*$/i
const COMPLETE_PROMPT_PATTERN = /(?:为什么|怎么|如何|什么|哪些|是否|能不能|可不可以|介绍一下|讲讲|说说|描述一下|谈谈|解释一下|分析一下|举个例子|\b(?:what|why|how|when|where|which)\b|\b(?:tell me|describe|explain|walk me through)\b)/i
const CONTINUATION_START_PATTERN = /^(?:另外(?!一个问题)|还有|以及|并且|而且|同时|再补充|补充一下|具体来说|例如|比如|尤其是|请结合|并结合|最好|also\b|and\b|plus\b|additionally\b|to add\b|more specifically\b|for example\b|including\b|please also\b|could you also\b|and could you\b)/i
const TERMINAL_PUNCTUATION_PATTERN = /[?？。.!！]$/
export const NEW_QUESTION_START_PATTERN = /^(?:另一个问题|另外一个问题|下一个问题|再问一个问题|新问题|another question\b|next question\b|new question\b)/i

export const INTERVIEWER_CONTINUATION_WINDOW_MS = 3_000
export const INTERVIEWER_COMMIT_DELAY_MS = {
  utteranceEnd: 0,
  completePrompt: 180,
  longPrompt: 300,
  shortPrompt: 450,
  incompletePrompt: 700,
} as const

function compactLength(text: string): number {
  return text.replace(/\s/g, '').length
}

export function isLikelyIncompleteInterviewPrompt(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return true
  if (/[，,、:：-]$/.test(normalized)) return true
  return INCOMPLETE_ENDING_PATTERN.test(normalized)
}

export function isCompleteInterviewPrompt(text: string): boolean {
  const normalized = text.trim()
  if (compactLength(normalized) < 8 || isLikelyIncompleteInterviewPrompt(normalized)) return false
  if (TERMINAL_PUNCTUATION_PATTERN.test(normalized)) return true
  return COMPLETE_PROMPT_PATTERN.test(normalized)
}

export function isNewInterviewQuestion(text: string): boolean {
  return NEW_QUESTION_START_PATTERN.test(text.trim())
}

export function shouldHoldOpenUtterance(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return true
  if (isNewInterviewQuestion(normalized)) return false
  if (isLikelyIncompleteInterviewPrompt(normalized)) return true
  return !TERMINAL_PUNCTUATION_PATTERN.test(normalized)
}

export function getInterviewerCommitDelay(
  text: string,
  boundary: TranscriptBoundary,
): number {
  if (boundary === 'utterance-end') return INTERVIEWER_COMMIT_DELAY_MS.utteranceEnd
  if (isLikelyIncompleteInterviewPrompt(text)) return INTERVIEWER_COMMIT_DELAY_MS.incompletePrompt
  if (isCompleteInterviewPrompt(text)) return INTERVIEWER_COMMIT_DELAY_MS.completePrompt
  if (compactLength(text) >= 20) return INTERVIEWER_COMMIT_DELAY_MS.longPrompt
  return INTERVIEWER_COMMIT_DELAY_MS.shortPrompt
}

export function shouldInterruptForInterviewerContinuation(
  activeQuestion: string,
  nextText: string,
  activeForMs: number,
): boolean {
  const normalized = nextText.trim()
  if (!normalized || activeForMs > INTERVIEWER_CONTINUATION_WINDOW_MS) return false
  if (isNewInterviewQuestion(normalized)) return false
  return isLikelyIncompleteInterviewPrompt(activeQuestion)
    || CONTINUATION_START_PATTERN.test(normalized)
}

export function shouldQueueSeparateInterviewerQuestion(
  currentQuestion: string,
  nextText: string,
): boolean {
  const current = currentQuestion.trim()
  const next = nextText.trim()
  if (!current || !next) return false
  if (isNewInterviewQuestion(next)) return true
  if (shouldInterruptForInterviewerContinuation(current, next, 0)) return false
  return isCompleteInterviewPrompt(current) && isCompleteInterviewPrompt(next)
}
