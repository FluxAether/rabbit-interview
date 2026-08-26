export type SessionQuality = 'test' | 'noise' | 'valid' | 'incomplete'

export interface SessionQualityInput {
  isTestSession?: boolean
  endedUnexpectedly?: boolean
  interviewerQuestionCount?: number
  suggestionCount?: number
  durationSeconds?: number
  userMarkedValid?: boolean | null
}

const MIN_VALID_SECONDS = 20

export function classifySessionQuality(input: SessionQualityInput): SessionQuality {
  if (input.isTestSession) return 'test'
  if (input.userMarkedValid === true) return 'valid'
  if (input.userMarkedValid === false) return 'noise'
  if (input.endedUnexpectedly) return 'incomplete'
  const questions = input.interviewerQuestionCount ?? 0
  const suggestions = input.suggestionCount ?? 0
  const duration = input.durationSeconds ?? 0
  if (questions >= 1 && suggestions >= 1 && duration >= MIN_VALID_SECONDS) return 'valid'
  return 'noise'
}

export function isDashboardEligible(quality: SessionQuality): boolean {
  return quality === 'valid'
}
