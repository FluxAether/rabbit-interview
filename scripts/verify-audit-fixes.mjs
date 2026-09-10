import assert from 'node:assert/strict'
import { computeResumeDiff, revertResumeDiff } from '../src/lib/resumeDiff.ts'
import {
  createEmptyResumeWorkspace,
  isResumeAnalysisStale,
  isResumeReviewed,
  normalizeLlmResumeResult,
  resumeTextFingerprint,
} from '../src/lib/resumeOptimizer.ts'
import { buildEvidenceBrief } from '../src/lib/mockInterviewEvidence.ts'
import { parseHistoryFeedback } from '../src/lib/historyFeedback.ts'
import {
  calculateDimensionScores,
  createMockInterviewSnapshot,
  createMockPractice,
  markQuestionAsked,
} from '../src/lib/mockInterviewState.ts'
import { buildInterviewPlan } from '../src/lib/mockInterviewPlan.ts'
import { parseMockDraft } from '../src/lib/mockInterviewPersistence.ts'

console.log('--- Testing Audit Fixes ---')

// 1. R1: Reverting diff restores only the targeted change at its exact location
const originalResume = 'Heading\nRepeated line\nMiddle\nRepeated line\nEnd'
const optimizedResume = 'Heading\nRewritten line A\nMiddle\nRewritten line B\nEnd'
const blocks = computeResumeDiff(originalResume, optimizedResume)
const changeA = blocks.find(b => b.after.includes('Rewritten line A'))
assert.ok(changeA, 'finds first change block')
const revertedA = revertResumeDiff(optimizedResume, changeA)
assert.ok(revertedA.includes('Repeated line'), 'restores original text for targeted change')
assert.ok(revertedA.includes('Rewritten line B'), 'keeps other change intact')
console.log('✓ R1: revertResumeDiff safely restores original segment without deleting siblings')

// 2. R2 & R4: Analysis staleness and fact review checks
const workspace = {
  ...createEmptyResumeWorkspace(),
  original: 'Original text',
  optimized: 'Optimized text',
  jobDescription: 'Frontend JD',
  targetRole: 'Senior Frontend',
  targetCompany: 'Acme',
  analysisOriginalFingerprint: resumeTextFingerprint('Original text'),
  analysisJobDescriptionFingerprint: resumeTextFingerprint('Frontend JD'),
  analysisTargetFingerprint: resumeTextFingerprint(JSON.stringify(['Senior Frontend', 'Acme'])),
  reviewedFingerprint: resumeTextFingerprint('Optimized text'),
  reviewedAt: new Date().toISOString(),
}
assert.equal(isResumeAnalysisStale(workspace), false, 'workspace is fresh')
assert.equal(isResumeReviewed(workspace), true, 'workspace is reviewed')

const modifiedJDWorkspace = { ...workspace, jobDescription: 'Backend JD' }
assert.equal(isResumeAnalysisStale(modifiedJDWorkspace), true, 'changing JD invalidates freshness')
assert.equal(isResumeReviewed(modifiedJDWorkspace), false, 'stale analysis invalidates review status')
console.log('✓ R2 & R4: fact review status and target role/company are tied to analysis freshness')

// 3. C1: Evidence brief recognizes verified optimized resume
const briefSource = buildEvidenceBrief(
  workspace.optimized,
  workspace.jobDescription,
  {
    requirements: [{ keyword: 'React', priority: 'required', status: 'supported', evidence: 'React' }],
    analysisResumeFingerprint: resumeTextFingerprint(workspace.optimized),
    analysisJobDescriptionFingerprint: resumeTextFingerprint(workspace.jobDescription),
    analysisFresh: true,
  },
)
assert.equal(briefSource.source, 'workspace', 'verified rewritten resume reuses workspace evidence')
console.log('✓ C1: mock interview reuses evidence when given verified optimized draft')

// 4. M1: Real dimension scores calculation
const turns = [
  {
    question: { id: 'q1', sequence: 1, stage: 'core', kind: 'primary', text: 'Q1', intent: '', competencies: ['structure'], parentQuestionId: null, createdAt: 1, slotId: 's1', evidenceRefs: [] },
    answer: { text: 'A1', source: 'text', startedAt: 1, submittedAt: 2 },
    feedback: {
      overallScore: 80,
      scores: { clarity: 85, relevance: 85, structure: 80, specificity: 75, impact: 50, technicalAccuracy: null },
      strengths: ['Clear structure'],
      improvements: ['Quantify metrics'],
      evidence: ['Did A and B'],
      suggestedAnswer: 'Here is a model answer',
      summary: 'Good start',
      gaps: ['metric'],
      coveredCompetency: true,
    },
  },
]
const scores = calculateDimensionScores(turns)
assert.equal(scores.structure, 80)
assert.equal(scores.relevance, 85)
assert.equal(scores.clarity, 85)
assert.equal(scores.specificity, 75)
assert.equal(scores.impact, 50)
assert.equal(scores.technicalAccuracy, null)
console.log('✓ M1: calculateDimensionScores produces authentic aggregations without artificial offsets')

// 5. M2: Single question practice creates isolated session
const sessionSnapshot = createMockInterviewSnapshot('zh-CN')
sessionSnapshot.config.role = 'Frontend Lead'
sessionSnapshot.config.questionCount = 5
const plan = buildInterviewPlan(sessionSnapshot.config, buildEvidenceBrief('resume', 'jd'))
sessionSnapshot.plan = plan
sessionSnapshot.turns = turns
sessionSnapshot.recordId = 42

const practice = createMockPractice(sessionSnapshot, 'q1')
assert.equal(practice.recordId, null, 'practice session resets recordId lock')
assert.equal(practice.turns.length, 1, 'practice contains only the targeted question')
assert.equal(practice.turns[0].answer, null, 'practice answer starts clean')
assert.equal(practice.practice?.sourceRecordId, 42, 'tracks origin interview record')
assert.equal(practice.plan?.primaryCount, 1, 'practice plan limits question count to 1')
console.log('✓ M2: single-question practice has isolated state and resets completion lock')

// 6. M3: Mock draft parsing & recovery
const serialized = JSON.stringify(sessionSnapshot)
const restored = parseMockDraft(serialized)
assert.equal(restored.sessionId, sessionSnapshot.sessionId)
assert.equal(restored.turns.length, 1)
assert.equal(restored.phase, 'paused', 'restores in paused state so user can resume')
console.log('✓ M3: parseMockDraft safely restores in-progress interview state')

// 7. M5: History feedback parser reads priorityImprovements & recommendedPractice
const parsedHistory = parseHistoryFeedback(JSON.stringify({
  report: {
    overallScore: 82,
    priorityImprovements: ['Quantify metrics in STAR format'],
    recommendedPractice: ['Practice question 2 again with metrics'],
    strengths: ['Great technical depth'],
  },
}))
assert.deepEqual(parsedHistory.improvements, ['Quantify metrics in STAR format'])
assert.equal(parsedHistory.nextAction, 'Practice question 2 again with metrics')
console.log('✓ M5: parseHistoryFeedback reads priorityImprovements and recommendedPractice')

console.log('\nAll audit fix verification checks passed successfully!')

