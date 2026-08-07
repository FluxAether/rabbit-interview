import type { InterviewRecord } from '../stores/useAppStore'
import type { CopilotMessage } from './copilotSessionState'
import type { CopilotSessionScore } from './copilotScoring'

const ROLE_LABELS: Record<CopilotMessage['role'], string> = {
  interviewer: 'Interviewer',
  assistant: 'AI',
  me: 'Me',
}

export interface SavedRecording {
  path: string
  duration_seconds: number
  sample_rate: number
}

export function generateCopilotSessionTitle(
  messages: CopilotMessage[],
  maxLen = 48,
): string {
  const preferred = messages.find((message) => message.role === 'interviewer' && message.text.trim())
    ?? messages.find((message) => message.role === 'me' && message.text.trim())
    ?? messages.find((message) => message.text.trim())

  if (!preferred) return 'Live Interview'

  const normalized = preferred.text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLen) return normalized
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`
}

export function createCopilotInterviewRecord(
  messages: CopilotMessage[],
  duration: number,
  recordingPath: string | null,
  now = new Date(),
  score: CopilotSessionScore | null = null,
): InterviewRecord {
  return {
    date: now.toISOString().slice(0, 16).replace('T', ' '),
    role: generateCopilotSessionTitle(messages),
    company: 'Stealth Copilot',
    score: score?.overallScore ?? null,
    transcript: messages
      .map((message) => `${ROLE_LABELS[message.role]}: ${message.text}`)
      .join('\n'),
    duration,
    mode: 'copilot',
    recordingPath,
    detailsJson: score
      ? JSON.stringify({
          score,
        })
      : null,
  }
}
