import type { SupportedLanguage } from '../i18n/types'

export type MockInterviewType = 'mixed' | 'behavioral' | 'technical'
export type MockInterviewDifficulty = 'junior' | 'mid' | 'senior'
export type MockInterviewStage = 'introduction' | 'core' | 'behavioral' | 'technical' | 'conclusion'

export const EVIDENCE_GAPS = [
  'metric',
  'role',
  'decision',
  'tradeoff',
  'failure',
  'technical-depth',
  'scope',
] as const

export type EvidenceGap = (typeof EVIDENCE_GAPS)[number]
export type CoverageStatus = 'pending' | 'asked' | 'covered' | 'weak'
export type EvidenceBriefSource = 'workspace' | 'extracted' | 'empty'

export interface MockInterviewConfig {
  role: string
  company: string
  interviewType: MockInterviewType
  difficulty: MockInterviewDifficulty
  questionCount: number
  language: SupportedLanguage
  resumeContext: string
  jobDescription: string
  voiceInputEnabled: boolean
  speechEnabled: boolean
  microphoneDevice: string | null
}

export interface MockInterviewScores {
  clarity: number
  relevance: number
  structure: number
  specificity: number
  impact: number
  technicalAccuracy: number | null
}

export interface MockInterviewFeedback {
  scores: MockInterviewScores
  overallScore: number
  strengths: string[]
  improvements: string[]
  evidence: string[]
  suggestedAnswer: string
  summary: string
  gaps: EvidenceGap[]
  coveredCompetency: boolean
}

export interface MockInterviewQuestion {
  id: string
  sequence: number
  stage: MockInterviewStage
  kind: 'primary' | 'follow-up'
  text: string
  intent: string
  competencies: string[]
  parentQuestionId: string | null
  createdAt: number
  slotId: string | null
  evidenceRefs: string[]
}

export interface MockInterviewTurn {
  question: MockInterviewQuestion
  answer: {
    text: string
    source: 'text' | 'voice' | 'mixed'
    startedAt: number
    submittedAt: number
  } | null
  feedback: MockInterviewFeedback | null
}

export interface CoverageSummaryItem {
  competency: string
  status: CoverageStatus
}

export interface MockInterviewReport {
  overallScore: number
  dimensionScores: MockInterviewScores
  strengths: string[]
  risks: string[]
  priorityImprovements: string[]
  recommendedPractice: string[]
  summary: string
  answeredQuestionCount: number
  targetQuestionCount: number
  completedNormally: boolean
  coverageSummary: CoverageSummaryItem[]
  uncoveredCompetencies: string[]
}

export type MockInterviewPhase = 'setup' | 'starting' | 'speaking' | 'answering' | 'evaluating' | 'generating-report' | 'saving' | 'completed' | 'error'

export interface EvidenceProject {
  name: string
  summary: string
  skills: string[]
  source: 'resume'
}

export interface EvidenceBrief {
  projects: EvidenceProject[]
  skills: string[]
  jdRequired: string[]
  jdPreferred: string[]
  overlap: string[]
  gaps: string[]
  resumeEmpty: boolean
  jobDescriptionEmpty: boolean
  source: EvidenceBriefSource
}

export interface InterviewSlot {
  id: string
  sequence: number
  stage: MockInterviewStage
  competency: string
  focus: string
  evidenceRefs: string[]
  allowFollowUp: boolean
}

export interface InterviewPlan {
  primaryCount: number
  maxFollowUpsPerPrimary: 1
  maxFollowUpsSession: number
  slots: InterviewSlot[]
  brief: EvidenceBrief
}

export interface SlotCoverage {
  slotId: string
  status: CoverageStatus
  followUpsUsed: number
  lastGaps: EvidenceGap[]
}

export type NextAction =
  | { type: 'follow-up'; slotId: string; gaps: EvidenceGap[] }
  | { type: 'next-primary'; slotId: string }
  | { type: 'end' }

export interface MockInterviewSnapshot {
  phase: MockInterviewPhase
  config: MockInterviewConfig
  turns: MockInterviewTurn[]
  currentQuestion: MockInterviewQuestion | null
  draftAnswer: string
  interimTranscript: string
  startedAt: number | null
  elapsedSeconds: number
  report: MockInterviewReport | null
  error: string | null
  recordId: number | null
  recordingPath: string | null
  plan: InterviewPlan | null
  coverage: SlotCoverage[]
}

export function defaultMockInterviewConfig(language: SupportedLanguage): MockInterviewConfig {
  return {
    role: '', company: '', interviewType: 'mixed', difficulty: 'mid', questionCount: 5,
    language, resumeContext: '', jobDescription: '', voiceInputEnabled: true,
    speechEnabled: true, microphoneDevice: null,
  }
}

export function createMockInterviewSnapshot(language: SupportedLanguage): MockInterviewSnapshot {
  return {
    phase: 'setup', config: defaultMockInterviewConfig(language), turns: [], currentQuestion: null,
    draftAnswer: '', interimTranscript: '', startedAt: null, elapsedSeconds: 0,
    report: null, error: null, recordId: null, recordingPath: null,
    plan: null, coverage: [],
  }
}

export function clampScore(value: unknown): number {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

export function normalizeGaps(value: unknown): EvidenceGap[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<EvidenceGap>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    if ((EVIDENCE_GAPS as readonly string[]).includes(item)) seen.add(item as EvidenceGap)
  }
  return [...seen]
}

export function scoresFromUnknown(input: any, requireTechnicalAccuracy: boolean): MockInterviewScores {
  return {
    clarity: clampScore(input?.clarity),
    relevance: clampScore(input?.relevance),
    structure: clampScore(input?.structure),
    specificity: clampScore(input?.specificity),
    impact: clampScore(input?.impact),
    technicalAccuracy: requireTechnicalAccuracy
      ? clampScore(input?.technicalAccuracy)
      : input?.technicalAccuracy == null ? null : clampScore(input.technicalAccuracy),
  }
}

export function averageScore(scores: MockInterviewScores): number {
  const values = Object.values(scores).filter((value): value is number => value != null)
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

export function normalizeFeedback(input: any, options: { requireTechnicalAccuracy?: boolean } = {}): MockInterviewFeedback {
  const requireTechnicalAccuracy = options.requireTechnicalAccuracy === true
  const scores = scoresFromUnknown(input?.scores, requireTechnicalAccuracy)
  if (!requireTechnicalAccuracy && input?.scores?.technicalAccuracy == null) {
    scores.technicalAccuracy = null
  }
  return {
    scores,
    overallScore: averageScore(scores),
    strengths: stringArray(input?.strengths),
    improvements: stringArray(input?.improvements),
    evidence: stringArray(input?.evidence),
    suggestedAnswer: String(input?.suggestedAnswer || ''),
    summary: String(input?.summary || ''),
    gaps: normalizeGaps(input?.gaps),
    coveredCompetency: input?.coveredCompetency === true,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8) : []
}

export function calculateDimensionScores(turns: MockInterviewTurn[]): MockInterviewScores {
  const feedback = turns.flatMap(turn => turn.feedback ? [turn.feedback.scores] : [])
  const average = (key: keyof MockInterviewScores) => {
    const values = feedback.map(item => item[key]).filter((value): value is number => value != null)
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
  }
  return {
    clarity: average('clarity'), relevance: average('relevance'), structure: average('structure'),
    specificity: average('specificity'), impact: average('impact'),
    technicalAccuracy: feedback.some(item => item.technicalAccuracy != null) ? average('technicalAccuracy') : null,
  }
}

export function calculateOverallScore(turns: MockInterviewTurn[]): number {
  const values = turns.flatMap(turn => turn.feedback ? [turn.feedback.overallScore] : [])
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
}

export function buildMockTranscript(turns: MockInterviewTurn[]): string {
  return turns.flatMap(turn => [
    `Interviewer: ${turn.question.text}`,
    ...(turn.answer ? [`User: ${turn.answer.text}`] : []),
  ]).join('\n')
}

export function createInitialCoverage(plan: InterviewPlan): SlotCoverage[] {
  return plan.slots.map(slot => ({
    slotId: slot.id,
    status: 'pending' as const,
    followUpsUsed: 0,
    lastGaps: [],
  }))
}

export function applyAnswerCoverage(
  coverage: SlotCoverage[],
  slotId: string,
  feedback: MockInterviewFeedback,
): SlotCoverage[] {
  return coverage.map(item => {
    if (item.slotId !== slotId) return item
    const status: CoverageStatus = feedback.coveredCompetency && feedback.gaps.length === 0
      ? 'covered'
      : feedback.gaps.length > 0
        ? 'weak'
        : feedback.coveredCompetency
          ? 'covered'
          : 'asked'
    return { ...item, status, lastGaps: feedback.gaps }
  })
}

export function markFollowUpIssued(coverage: SlotCoverage[], slotId: string): SlotCoverage[] {
  return coverage.map(item => item.slotId === slotId
    ? { ...item, followUpsUsed: item.followUpsUsed + 1 }
    : item)
}

export function sessionFollowUpsUsed(coverage: SlotCoverage[]): number {
  return coverage.reduce((sum, item) => sum + item.followUpsUsed, 0)
}

export function countPrimaryQuestions(turns: MockInterviewTurn[]): number {
  return turns.filter(turn => turn.question.kind === 'primary').length
}

export function countFollowUpQuestions(turns: MockInterviewTurn[]): number {
  return turns.filter(turn => turn.question.kind === 'follow-up').length
}

export function slotById(plan: InterviewPlan | null, slotId: string | null | undefined): InterviewSlot | null {
  if (!plan || !slotId) return null
  return plan.slots.find(slot => slot.id === slotId) ?? null
}

export function buildCoverageSummary(plan: InterviewPlan, coverage: SlotCoverage[]): CoverageSummaryItem[] {
  return plan.slots.map(slot => ({
    competency: slot.competency,
    status: coverage.find(item => item.slotId === slot.id)?.status ?? 'pending',
  }))
}

export function uncoveredCompetencies(plan: InterviewPlan, coverage: SlotCoverage[]): string[] {
  return plan.slots
    .filter(slot => slot.stage !== 'introduction' && slot.stage !== 'conclusion')
    .filter(slot => {
      const status = coverage.find(item => item.slotId === slot.id)?.status
      return !status || status === 'pending'
    })
    .map(slot => slot.competency)
}

export function buildMockQuestion(input: {
  slot: InterviewSlot
  text: string
  sequence: number
  intent?: string
  kind?: 'primary' | 'follow-up'
  parentQuestionId?: string | null
}): MockInterviewQuestion {
  const text = input.text.trim()
  if (!text) throw new Error('The LLM did not return an interview question.')
  const kind = input.kind === 'follow-up' ? 'follow-up' : 'primary'
  return {
    id: crypto.randomUUID(),
    sequence: input.sequence,
    stage: input.slot.stage,
    kind,
    text,
    intent: String(input.intent || input.slot.focus),
    competencies: [input.slot.competency],
    parentQuestionId: kind === 'follow-up' ? input.parentQuestionId ?? null : null,
    createdAt: Date.now(),
    slotId: input.slot.id,
    evidenceRefs: input.slot.evidenceRefs,
  }
}

export function maxFollowUpsSession(primaryCount: number): number {
  return Math.floor(Math.max(3, primaryCount) * 0.4)
}

export function buildMockReportMarkdown(snapshot: MockInterviewSnapshot): string {
  const report = snapshot.report
  if (!report) return ''
  const lines = [
    `# ${snapshot.config.role} 模拟面试报告`, '',
    `- 公司：${snapshot.config.company || '未指定'}`,
    `- 综合分：${report.overallScore}/100`,
    `- 完成轮数：${report.answeredQuestionCount}`,
    `- 主问题：${report.targetQuestionCount}`, '',
    '## 总结', report.summary, '', '## 优势', ...report.strengths.map(value => `- ${value}`), '',
    '## 优先改进', ...report.priorityImprovements.map(value => `- ${value}`), '',
  ]
  if (report.coverageSummary.length) {
    lines.push('## 本场覆盖', ...report.coverageSummary.map(item => `- ${item.competency}：${item.status}`), '')
  }
  if (report.uncoveredCompetencies.length) {
    lines.push('## 未覆盖', ...report.uncoveredCompetencies.map(value => `- ${value}`), '')
  }
  snapshot.turns.forEach((turn, index) => {
    const kindLabel = turn.question.kind === 'follow-up' ? '追问' : '主问'
    lines.push(`## 第 ${index + 1} 题（${kindLabel}）`, turn.question.text, '', '**回答**', turn.answer?.text || '', '', '**反馈**', turn.feedback?.summary || '', '')
  })
  return lines.join('\n')
}
