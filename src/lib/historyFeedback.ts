export interface HistoryFeedback {
  overallScore: number | null
  summary: string
  strengths: string[]
  improvements: string[]
  nextAction: string
  quality: string | null
  archivePartial: boolean
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : []
}

export function parseHistoryFeedback(detailsJson?: string | null, fallbackScore: number | null = null): HistoryFeedback | null {
  if (!detailsJson) {
    return fallbackScore == null ? null : {
      overallScore: fallbackScore,
      summary: '',
      strengths: [],
      improvements: [],
      nextAction: '',
      quality: null,
      archivePartial: false,
    }
  }
  try {
    const parsed = JSON.parse(detailsJson) as Record<string, unknown>
    const score = parsed.score && typeof parsed.score === 'object'
      ? parsed.score as Record<string, unknown>
      : parsed.report && typeof parsed.report === 'object'
        ? parsed.report as Record<string, unknown>
        : parsed
    const overall = typeof score.overallScore === 'number'
      ? score.overallScore
      : fallbackScore
    const improvements = stringArray(score.improvements)
    return {
      overallScore: overall ?? null,
      summary: String(score.summary || '').trim(),
      strengths: stringArray(score.strengths),
      improvements,
      nextAction: String(parsed.nextAction || improvements[0] || '').trim(),
      quality: typeof parsed.quality === 'string' ? parsed.quality : null,
      archivePartial: Boolean(parsed.archivePartial),
    }
  } catch {
    return {
      overallScore: fallbackScore,
      summary: '',
      strengths: [],
      improvements: [],
      nextAction: '',
      quality: null,
      archivePartial: true,
    }
  }
}
