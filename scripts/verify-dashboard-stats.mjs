import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/lib/dashboardStats.ts'), 'utf8')
const dashboard = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8')
const i18n = fs.readFileSync(path.join(root, 'src/i18n/translations.ts'), 'utf8')

// Keep a tiny pure copy of the aggregation rules so this script stays dependency-free.
function parseInterviewDate(date) {
  const normalized = date.includes('T') ? date : date.replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function monthIndex(date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}

function averageScore(scores) {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
}

function percentDelta(current, previous) {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function collectMonthStats(records, targetMonth) {
  let interviewCount = 0
  let scoredCount = 0
  const scores = []
  for (const record of records) {
    const date = parseInterviewDate(record.date)
    if (!date || monthIndex(date) !== targetMonth) continue
    interviewCount += 1
    if (typeof record.score === 'number' && Number.isFinite(record.score)) {
      scoredCount += 1
      scores.push(record.score)
    }
  }
  return { interviewCount, scoredCount, averageScore: averageScore(scores) }
}

function computeDashboardStats(records, now = new Date()) {
  const currentMonth = monthIndex(now)
  const previousMonth = currentMonth - 1
  const current = collectMonthStats(records, currentMonth)
  const previous = collectMonthStats(records, previousMonth)
  const scoredScores = records.flatMap((record) =>
    typeof record.score === 'number' && Number.isFinite(record.score) ? [record.score] : [],
  )
  return {
    interviewCount: records.length,
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

const now = new Date('2026-07-22T12:00:00.000Z')
const records = [
  { date: '2026-07-10 10:00', score: 80 },
  { date: '2026-07-12 11:00', score: 90 },
  { date: '2026-07-15 09:00', score: null },
  { date: '2026-06-05 08:00', score: 70 },
  { date: '2026-06-20 08:00', score: 60 },
]

const stats = computeDashboardStats(records, now)
assert.equal(stats.interviewCount, 5)
assert.equal(stats.averageScore, 75)
assert.equal(stats.scoredCount, 4)
assert.equal(stats.interviewDeltaPct, 50)
assert.equal(stats.scoreDeltaPts, 20)
assert.equal(stats.scoredDeltaPct, 0)

const empty = computeDashboardStats([], now)
assert.equal(empty.interviewCount, 0)
assert.equal(empty.averageScore, null)
assert.equal(empty.scoredCount, 0)
assert.equal(empty.interviewDeltaPct, null)

// Source wiring checks
assert.match(source, /export function computeDashboardStats/)
assert.match(source, /interviewCount: records\.length/)
assert.match(source, /scoredDeltaPct/)
assert.match(dashboard, /computeDashboardStats\(history\)/)
assert.doesNotMatch(dashboard, />24</)
assert.doesNotMatch(dashboard, />82</)
assert.doesNotMatch(dashboard, /dashboard\.stat\.offers/)
assert.match(dashboard, /dashboard\.stat\.scored/)
assert.match(i18n, /'dashboard\.stat\.scored': 'Scored Interviews'/)
assert.match(i18n, /'dashboard\.stat\.scored': '已评分次数'/)
assert.doesNotMatch(i18n, /dashboard\.stat\.offers/)

console.log('✓ dashboard stats use real history aggregates')
