import type { SupportedLanguage } from '../i18n/types'

export type MockInterviewType = 'mixed' | 'behavioral' | 'technical'
export type MockInterviewDifficulty = 'junior' | 'mid' | 'senior'
export type MockInterviewStage = 'introduction' | 'core' | 'behavioral' | 'technical' | 'conclusion'

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
}

export type MockInterviewPhase = 'setup' | 'starting' | 'speaking' | 'answering' | 'evaluating' | 'generating-report' | 'saving' | 'completed' | 'error'

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
}

export function defaultMockInterviewConfig(language: SupportedLanguage): MockInterviewConfig {
  return {
    role: '', company: '', interviewType: 'mixed', difficulty: 'mid', questionCount: 5,
    language, resumeContext: '', jobDescription: '', voiceInputEnabled: false,
    speechEnabled: true, microphoneDevice: null,
  }
}

export function createMockInterviewSnapshot(language: SupportedLanguage): MockInterviewSnapshot {
  return {
    phase: 'setup', config: defaultMockInterviewConfig(language), turns: [], currentQuestion: null,
    draftAnswer: '', interimTranscript: '', startedAt: null, elapsedSeconds: 0,
    report: null, error: null, recordId: null, recordingPath: null,
  }
}

export function clampScore(value: unknown): number {
  const score = Number(value)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

export function normalizeFeedback(input: any): MockInterviewFeedback {
  const scores: MockInterviewScores = {
    clarity: clampScore(input?.scores?.clarity), relevance: clampScore(input?.scores?.relevance),
    structure: clampScore(input?.scores?.structure), specificity: clampScore(input?.scores?.specificity),
    impact: clampScore(input?.scores?.impact),
    technicalAccuracy: input?.scores?.technicalAccuracy == null ? null : clampScore(input.scores.technicalAccuracy),
  }
  const values = Object.values(scores).filter((v): v is number => v != null)
  return {
    scores,
    overallScore: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    strengths: stringArray(input?.strengths), improvements: stringArray(input?.improvements),
    evidence: stringArray(input?.evidence), suggestedAnswer: String(input?.suggestedAnswer || ''),
    summary: String(input?.summary || ''),
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map(v => v.trim()).filter(Boolean).slice(0, 8) : []
}

export function calculateDimensionScores(turns: MockInterviewTurn[]): MockInterviewScores {
  const feedback = turns.flatMap(turn => turn.feedback ? [turn.feedback.scores] : [])
  const average = (key: keyof MockInterviewScores) => {
    const values = feedback.map(item => item[key]).filter((v): v is number => v != null)
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
  }
  return {
    clarity: average('clarity'), relevance: average('relevance'), structure: average('structure'),
    specificity: average('specificity'), impact: average('impact'),
    technicalAccuracy: feedback.some(item => item.technicalAccuracy != null) ? average('technicalAccuracy') : null,
  }
}

export function calculateOverallScore(turns: MockInterviewTurn[]): number {
  const values = turns.flatMap(turn => turn.feedback ? [turn.feedback.overallScore] : [])
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
}

export function buildMockTranscript(turns: MockInterviewTurn[]): string {
  return turns.flatMap(turn => [
    `Interviewer: ${turn.question.text}`,
    ...(turn.answer ? [`User: ${turn.answer.text}`] : []),
  ]).join('\n')
}

export function buildMockReportMarkdown(snapshot: MockInterviewSnapshot): string {
  const report = snapshot.report
  if (!report) return ''
  const lines = [
    `# ${snapshot.config.role} 模拟面试报告`, '',
    `- 公司：${snapshot.config.company || '未指定'}`,
    `- 综合分：${report.overallScore}/100`,
    `- 完成题数：${report.answeredQuestionCount}/${report.targetQuestionCount}`, '',
    '## 总结', report.summary, '', '## 优势', ...report.strengths.map(v => `- ${v}`), '',
    '## 优先改进', ...report.priorityImprovements.map(v => `- ${v}`), '',
  ]
  snapshot.turns.forEach((turn, index) => {
    lines.push(`## 第 ${index + 1} 题`, turn.question.text, '', '**回答**', turn.answer?.text || '', '', '**反馈**', turn.feedback?.summary || '', '')
  })
  return lines.join('\n')
}
