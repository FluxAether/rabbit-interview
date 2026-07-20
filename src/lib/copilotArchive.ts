import type { InterviewRecord } from '../stores/useAppStore'
import type { CopilotMessage } from './copilotSessionState'

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

export function createCopilotInterviewRecord(
  messages: CopilotMessage[],
  duration: number,
  recordingPath: string | null,
  now = new Date(),
): InterviewRecord {
  return {
    date: now.toISOString().slice(0, 16).replace('T', ' '),
    role: 'Live Interview',
    company: 'Real-time',
    score: null,
    transcript: messages
      .map((message) => `${ROLE_LABELS[message.role]}: ${message.text}`)
      .join('\n'),
    duration,
    mode: 'copilot',
    recordingPath,
  }
}
