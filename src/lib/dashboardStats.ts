import type { InterviewRecord } from "../stores/useAppStore"
import { isDashboardEligible, type SessionQuality } from "./sessionQuality"
import { parseHistoryFeedback } from "./historyFeedback"

export interface DashboardStats {
  interviewCount: number
  averageScore: number | null
  scoredCount: number
  interviewDeltaPct: number | null
  scoreDeltaPts: number | null
  scoredDeltaPct: number | null
}

type InterviewLike = Pick<InterviewRecord, "date" | "score">
  & Partial<Pick<InterviewRecord, "detailsJson">>

function parseInterviewDate(date: string): Date | null {
  if (!date) return null
  let normalized = date.includes("T") ? date : date.replace(" ", "T")
  if (!normalized.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += "Z"
  }
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

function averageScore(scores: number[]): number | null {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
}

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0
  return Math.round(((current - previous) / previous) * 100)
}

function collectMonthStats(records: InterviewLike[], targetMonth: number) {
  let interviewCount = 0
  let scoredCount = 0
  const scores: number[] = []

  for (const record of records) {
    const quality = parseHistoryFeedback(record.detailsJson)?.quality as SessionQuality | null
    if (quality && !isDashboardEligible(quality)) continue
    const date = parseInterviewDate(record.date)
    if (!date || monthIndex(date) !== targetMonth) continue
    interviewCount += 1
    if (typeof record.score === "number" && Number.isFinite(record.score)) {
      scoredCount += 1
      scores.push(record.score)
    }
  }

  return {
    interviewCount,
    scoredCount,
    averageScore: averageScore(scores),
  }
}

export function computeDashboardStats(
  records: InterviewLike[],
  now = new Date(),
): DashboardStats {
  const currentMonth = monthIndex(now)
  const previousMonth = currentMonth - 1
  const current = collectMonthStats(records, currentMonth)
  const previous = collectMonthStats(records, previousMonth)
  const eligible = records.filter((record) => {
    const quality = parseHistoryFeedback(record.detailsJson)?.quality as SessionQuality | null
    return !quality || isDashboardEligible(quality)
  })
  const scoredScores = eligible.flatMap((record) =>
    typeof record.score === "number" && Number.isFinite(record.score) ? [record.score] : [],
  )

  return {
    interviewCount: eligible.length,
    averageScore: averageScore(scoredScores),
    scoredCount: scoredScores.length,
    interviewDeltaPct: percentDelta(current.interviewCount, previous.interviewCount),
    scoreDeltaPts:
      current.averageScore == null || previous.averageScore == null
        ? null
        : current.averageScore - previous.averageScore,
    scoredDeltaPct: percentDelta(current.scoredCount, previous.scoredCount),
  }
}
