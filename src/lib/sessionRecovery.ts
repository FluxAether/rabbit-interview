import type { CopilotMessage } from './copilotSessionState'
import type { InterviewSessionIdentity } from './interviewProfile'

export const SESSION_RECOVERY_KEY = 'copilot_recovery_v1'

export interface CopilotRecoverySnapshot {
  identity: InterviewSessionIdentity
  messages: CopilotMessage[]
  question: string
  startedAt: number
  updatedAt: number
}

export function createRecoverySnapshot(
  identity: InterviewSessionIdentity,
  messages: CopilotMessage[],
  question: string,
  startedAt: number,
  now = Date.now(),
): CopilotRecoverySnapshot | null {
  if (identity.isTestSession) return null
  if (messages.length === 0 && !question.trim()) return null
  return {
    identity,
    messages,
    question,
    startedAt,
    updatedAt: now,
  }
}

export function parseRecoverySnapshot(raw: string | null | undefined): CopilotRecoverySnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CopilotRecoverySnapshot>
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.identity || typeof parsed.identity !== 'object') return null
    if (!Array.isArray(parsed.messages)) return null
    return {
      identity: parsed.identity as InterviewSessionIdentity,
      messages: parsed.messages as CopilotMessage[],
      question: typeof parsed.question === 'string' ? parsed.question : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}
