import { generateStructuredJson } from './llm'
import { clampScore } from './mockInterviewState'
import type { CopilotMessage } from './copilotSessionState'

export interface CopilotQaPair {
  question: string
  answer: string
}

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

/** Pair each interviewer question with following microphone answers. */
export function buildCopilotQaPairs(messages: CopilotMessage[]): CopilotQaPair[] {
  const pairs: CopilotQaPair[] = []
  let question = ''
  let answers: string[] = []

  const flush = () => {
    if (!question || answers.length === 0) {
      answers = []
      return
    }
    pairs.push({ question, answer: answers.join(' ').trim() })
    answers = []
  }

  for (const message of messages) {
    if (message.role === 'interviewer') {
      flush()
      question = message.text.trim()
      answers = []
      continue
    }
    if (message.role === 'me' && message.source === 'microphone-stt' && message.text.trim()) {
      answers.push(message.text.trim())
    }
  }
  flush()
  return pairs
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
