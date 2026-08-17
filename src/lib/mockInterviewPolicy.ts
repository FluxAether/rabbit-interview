import type {
  EvidenceGap,
  InterviewPlan,
  InterviewSlot,
  MockInterviewFeedback,
  MockInterviewType,
  NextAction,
  SlotCoverage,
} from './mockInterviewState.ts'
import { sessionFollowUpsUsed, slotById } from './mockInterviewState.ts'

export function decideNextAction(input: {
  plan: InterviewPlan
  coverage: SlotCoverage[]
  currentSlotId: string
  feedback: MockInterviewFeedback
}): NextAction {
  const current = slotById(input.plan, input.currentSlotId)
  const currentCoverage = input.coverage.find(item => item.slotId === input.currentSlotId)
  const gaps = legalGaps(current, input.plan, input.feedback.gaps)

  if (
    current
    && current.allowFollowUp
    && (currentCoverage?.followUpsUsed ?? 0) < input.plan.maxFollowUpsPerPrimary
    && sessionFollowUpsUsed(input.coverage) < input.plan.maxFollowUpsSession
    && gaps.length > 0
  ) {
    return { type: 'follow-up', slotId: current.id, gaps }
  }

  const next = nextPendingPrimary(input.plan, input.coverage)
  return next ? { type: 'next-primary', slotId: next.id } : { type: 'end' }
}

export function legalGaps(
  slot: InterviewSlot | null,
  plan: InterviewPlan,
  gaps: EvidenceGap[],
): EvidenceGap[] {
  if (!slot?.allowFollowUp) return []
  const interviewType = interviewTypeFromPlan(plan)
  return gaps.filter(gap => isGapAllowed(gap, slot, interviewType))
}

export function isGapAllowed(gap: EvidenceGap, slot: InterviewSlot, interviewType: MockInterviewType): boolean {
  if (slot.stage === 'introduction' || slot.stage === 'conclusion') return false
  if (interviewType === 'behavioral' && gap === 'technical-depth') return false
  if (slot.stage === 'behavioral' && gap === 'technical-depth') return false
  return true
}

export function nextPendingPrimary(plan: InterviewPlan, coverage: SlotCoverage[]): InterviewSlot | null {
  return plan.slots.find(slot => {
    const item = coverage.find(entry => entry.slotId === slot.id)
    return !item || item.status === 'pending'
  }) ?? null
}

export function isNearDuplicateQuestion(candidate: string, previous: string[]): boolean {
  const next = normalizeQuestionText(candidate)
  if (!next) return false
  return previous.some(item => similarQuestions(next, normalizeQuestionText(item)))
}

export function normalizeQuestionText(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function similarQuestions(left: string, right: string): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (left.length > 16 && right.length > 16 && (left.includes(right) || right.includes(left))) return true
  const leftTokens = tokensFor(left)
  const rightTokens = tokensFor(right)
  if (!leftTokens.size || !rightTokens.size) return false
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection) >= 0.75
}

function tokensFor(text: string): Set<string> {
  if (/[㐀-鿿]/.test(text)) {
    const compact = text.replace(/\s+/g, '')
    const grams = new Set<string>()
    for (let index = 0; index < compact.length - 1; index += 1) grams.add(compact.slice(index, index + 2))
    return grams
  }
  return new Set(text.split(' ').filter(token => token.length > 1))
}

function interviewTypeFromPlan(plan: InterviewPlan): MockInterviewType {
  const cores = plan.slots.filter(slot => slot.stage === 'behavioral' || slot.stage === 'technical')
  if (cores.length > 0 && cores.every(slot => slot.stage === 'behavioral')) return 'behavioral'
  if (cores.length > 0 && cores.every(slot => slot.stage === 'technical')) return 'technical'
  return 'mixed'
}
