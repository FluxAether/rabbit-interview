import { generateStructuredJson } from './llm'
import { clampScore } from './mockInterviewState'
import { textSimilarity } from './copilotText'
import { isMinimumVoiceAnswer } from './mockInterviewVoiceEndpoint'
import type { CopilotMessage } from './copilotSessionState'

export interface CopilotQaPair {
  question: string
  answer: string
}

export interface CopilotTurn {
  question: string
  candidateSaid: string
  suggestedAnswer: string
}

export const RECENT_TURNS_LIMIT = 3
export const RECENT_TURNS_MAX_CHARS = 2_000
export const UNUSED_SUGGESTION_SIMILARITY = 0.68

export interface CopilotSessionScore {
  overallScore: number
  strengths: string[]
  improvements: string[]
  summary: string
  answeredQuestionCount: number
}

const SCORE_SYSTEM = [
  'You score a live interview using only interviewer questions and the candidate spoken answers.',
  'Ignore AI assistant suggestions completely.',
  'Return strict JSON only.',
].join(' ')

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : []
}

function flushTurn(
  turns: CopilotTurn[],
  question: string,
  candidateParts: string[],
  suggestedAnswer: string,
): void {
  if (!question) return
  turns.push({
    question,
    candidateSaid: candidateParts.join(' ').trim(),
    suggestedAnswer: suggestedAnswer.trim(),
  })
}

/** Group interviewer questions with later microphone answers and completed AI suggestions. */
export function collectCopilotTurns(messages: CopilotMessage[]): CopilotTurn[] {
  const turns: CopilotTurn[] = []
  let question = ''
  let candidateParts: string[] = []
  let suggestedAnswer = ''

  for (const message of messages) {
    if (message.role === 'interviewer') {
      flushTurn(turns, question, candidateParts, suggestedAnswer)
      question = message.text.trim()
      candidateParts = []
      suggestedAnswer = ''
      continue
    }
    if (!question) continue
    if (message.role === 'me' && message.source === 'microphone-stt' && message.text.trim()) {
      candidateParts.push(message.text.trim())
      continue
    }
    if (message.role === 'assistant' && message.source === 'llm' && message.text.trim()) {
      suggestedAnswer = message.text.trim()
    }
  }
  flushTurn(turns, question, candidateParts, suggestedAnswer)
  return turns
}

/** Pair each interviewer question with following microphone answers. */
export function buildCopilotQaPairs(messages: CopilotMessage[]): CopilotQaPair[] {
  return collectCopilotTurns(messages)
    .filter((turn) => turn.candidateSaid)
    .map((turn) => ({ question: turn.question, answer: turn.candidateSaid }))
}

function usedSuggestedAnswer(said: string, suggested: string): boolean {
  if (!said || !suggested) return false
  return textSimilarity(said, suggested) >= UNUSED_SUGGESTION_SIMILARITY
}

function usableCandidateSaid(text: string): string {
  const trimmed = text.trim()
  return isMinimumVoiceAnswer(trimmed) ? trimmed : ''
}

function formatTurn(turn: CopilotTurn): string {
  const said = usableCandidateSaid(turn.candidateSaid)
  const lines = [`Q: ${turn.question}`]
  if (said) {
    lines.push(`Candidate said: ${said}`)
    if (turn.suggestedAnswer && !usedSuggestedAnswer(said, turn.suggestedAnswer)) {
      lines.push(`Suggested but not used: ${turn.suggestedAnswer}`)
    }
  } else if (turn.suggestedAnswer) {
    lines.push(`Suggested answer: ${turn.suggestedAnswer}`)
  }
  return lines.join('\n')
}

function trimOldestSaid(text: string, overflow: number): string {
  if (overflow <= 0) return text
  const keep = Math.max(0, text.length - overflow)
  if (keep <= 0) return ''
  const sliced = text.slice(-keep)
  const cut = sliced.search(/\s/)
  return (cut >= 0 ? sliced.slice(cut + 1) : sliced).trim()
}

/** Keep the newest 2-3 turns, prefer spoken answers, and stay within the context budget. */
export function buildRecentTurnsContext(
  turns: CopilotTurn[],
  currentQuestion = '',
  limit = RECENT_TURNS_LIMIT,
  maxChars = RECENT_TURNS_MAX_CHARS,
): string {
  const normalizedCurrent = currentQuestion.trim()
  const history = normalizedCurrent
    ? turns.filter((turn) => turn.question !== normalizedCurrent)
    : turns
  const recent = history.filter((turn) => usableCandidateSaid(turn.candidateSaid) || turn.suggestedAnswer).slice(-limit)
  if (recent.length === 0) return ''

  const render = (items: CopilotTurn[]) => items.map(formatTurn).join('\n\n')
  let selected = recent
  while (selected.length > 1 && render(selected).length > maxChars) {
    selected = selected.slice(1)
  }

  let block = render(selected)
  if (block.length <= maxChars) return `Recent turns:\n${block}`

  const newest = selected[selected.length - 1]
  const said = usableCandidateSaid(newest.candidateSaid)
  let overflowTurn = newest
  if (said && newest.suggestedAnswer && !usedSuggestedAnswer(said, newest.suggestedAnswer)) {
    overflowTurn = { ...newest, suggestedAnswer: '' }
    block = formatTurn(overflowTurn)
    if (block.length <= maxChars) return `Recent turns:\n${block}`
  }
  if (said) {
    const overflow = formatTurn(overflowTurn).length - maxChars
    const trimmedSaid = trimOldestSaid(overflowTurn.candidateSaid, overflow) || overflowTurn.candidateSaid.slice(-Math.max(1, maxChars - overflowTurn.question.length))
    block = formatTurn({ ...overflowTurn, candidateSaid: trimmedSaid })
  }
  if (block.length > maxChars) block = block.slice(-maxChars).trim()
  return `Recent turns:\n${block}`
}

export async function scoreCopilotSession(
  messages: CopilotMessage[],
  signal?: AbortSignal,
): Promise<CopilotSessionScore | null> {
  const pairs = buildCopilotQaPairs(messages)
  if (pairs.length === 0) return null

  const evidence = pairs
    .map((pair, index) => `Q${index + 1}: ${pair.question}\nA${index + 1}: ${pair.answer}`)
    .join('\n\n')

  const result = await generateStructuredJson<any>(
    SCORE_SYSTEM,
    [
      'Score the candidate answers on clarity, relevance, structure, specificity, and impact (0-100 each).',
      'overallScore must be the rounded average of those five dimensions.',
      'Schema: {"overallScore":0,"strengths":["..."],"improvements":["..."],"summary":"..."}',
      '',
      evidence,
    ].join('\n'),
    signal,
    { maxOutputTokens: 900 },
  )

  return {
    overallScore: clampScore(result?.overallScore),
    strengths: stringArray(result?.strengths),
    improvements: stringArray(result?.improvements),
    summary: String(result?.summary || '').trim(),
    answeredQuestionCount: pairs.length,
  }
}
