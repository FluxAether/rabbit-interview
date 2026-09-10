export type ResumeSuggestionCategory = 'format' | 'clarity' | 'impact' | 'keywords'

export interface ResumeReplacement {
  before: string
  after: string
}

export interface ResumeSuggestion {
  id: string
  title?: string
  description?: string
  titleKey?: string
  descriptionKey?: string
  descriptionParams?: Record<string, string | number>
  category: ResumeSuggestionCategory
  replacement: ResumeReplacement | null
  applied: boolean
  anchor?: string
  resolution?: 'done' | 'skipped'
  resolutionFingerprint?: string
}

export interface ResumeAnalysisResult {
  optimizedText: string
  suggestions: ResumeSuggestion[]
  requirements: ResumeRequirement[]
  targetKeywords: string[]
  matchedKeywords: string[]
  missingKeywords: string[]
}

export type ResumeRequirementPriority = 'required' | 'preferred'
export type ResumeRequirementStatus = 'supported' | 'unsupported'
export type ResumeAnalysisSource = 'original' | 'optimized' | ''

export interface ResumeRequirement {
  keyword: string
  priority: ResumeRequirementPriority
  status: ResumeRequirementStatus
  evidence: string
}

export interface ResumeAnalysisContext {
  source: Exclude<ResumeAnalysisSource, ''>
  originalFingerprint: string
  jobDescriptionFingerprint: string
  targetFingerprint: string
  resumeFingerprint: string
}

export interface ResumeWorkspace {
  original: string
  optimized: string
  jobDescription: string
  suggestions: ResumeSuggestion[]
  sourceFileName: string
  requirements: ResumeRequirement[]
  targetKeywords: string[]
  matchedKeywords: string[]
  missingKeywords: string[]
  analysisOriginalFingerprint: string
  analysisJobDescriptionFingerprint: string
  analysisSource: ResumeAnalysisSource
  targetRole: string
  targetCompany: string
  profileUpdatedAt: string
  analysisTargetFingerprint: string
  analysisResumeFingerprint: string
  reviewedFingerprint: string
  reviewedAt: string
}

const RESUME_SUGGESTION_CATEGORIES: ResumeSuggestionCategory[] = ['format', 'clarity', 'impact', 'keywords']

function protectedFactCounts(text: string): Map<string, number> {
  const normalizedNumbers = text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',')
    .replace(/．/g, '.')
    .replace(/％/g, '%')
    .replace(/[＋]/g, '+')
    .replace(/[－−]/g, '-')
    .replace(/￥/g, '¥')
    .replace(/＄/g, '$')
    .replace(/([$€£¥])\s*([+-])\s*/g, '$2$1')
    .replace(/(?<=\d)\s*-\s*(?=\d)/g, '–')
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '')
  const numbers = [...normalizedNumbers.matchAll(
    /(?<![\p{L}\p{N}])([+-])?\s*([$€£¥])?\s*(\d[\d,]*(?:\.\d+)?)\s*(%)?/gu,
  )].map((match) => {
    const normalized = match[3].replace(/,/g, '.')
    const year = Number(normalized)
    if (!match[1] && !match[2] && !match[4] && /^\d{4}$/.test(normalized) && year >= 1900 && year <= 2100) {
      return `year:${normalized}`
    }
    return `number:${match[1] ?? ''}${match[2] ?? ''}${normalized}${match[4] ?? ''}`
  })
  const facts = [
    ...numbers,
    ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((value) => `email:${value.toLocaleLowerCase()}`),
    ...(text.match(/(?:(?:https?:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+(?:com|org|io|dev|ai|me|co|app|tech|site|xyz|edu|gov)(?:[/?#]\S*)?)/gi) ?? [])
      .map((value) => `url:${value.replace(/[)\],.;:!?，。]+$/, '').toLocaleLowerCase()}`),
  ]
  const counts = new Map<string, number>()
  for (const fact of facts) counts.set(fact, (counts.get(fact) ?? 0) + 1)
  return counts
}

function canonicalEvidenceText(text: string): string {
  return normalizeResumeText(text).toLocaleLowerCase().replace(/\s+/g, ' ')
}

function normalizeResumeRequirements(
  value: unknown,
  sourceText: string,
  jobDescription: string,
): ResumeRequirement[] {
  if (!Array.isArray(value) || !jobDescription.trim()) return []
  const source = canonicalEvidenceText(sourceText)
  const posting = canonicalEvidenceText(jobDescription)
  const seen = new Set<string>()
  const requirements: ResumeRequirement[] = []

  for (const item of value.slice(0, 16)) {
    if (!item || typeof item !== 'object') continue
    const requirement = item as Record<string, unknown>
    const keyword = typeof requirement.keyword === 'string' ? requirement.keyword.trim().slice(0, 120) : ''
    const priority = requirement.priority as ResumeRequirementPriority
    const status = requirement.status as ResumeRequirementStatus
    const evidence = typeof requirement.evidence === 'string' ? requirement.evidence.trim().slice(0, 500) : ''
    const normalizedKeyword = canonicalEvidenceText(keyword)
    const normalizedEvidence = canonicalEvidenceText(evidence)

    if (!keyword || !['required', 'preferred'].includes(priority) || !['supported', 'unsupported'].includes(status)) continue
    if (!normalizedKeyword || !posting.includes(normalizedKeyword) || seen.has(normalizedKeyword)) continue
    if (status === 'supported' && (!normalizedEvidence || !source.includes(normalizedEvidence))) continue
    if (status === 'unsupported' && evidence) continue

    seen.add(normalizedKeyword)
    requirements.push({ keyword, priority, status, evidence })
    if (requirements.length >= 12) break
  }

  return requirements.sort((left, right) => {
    if (left.priority === right.priority) return 0
    return left.priority === 'required' ? -1 : 1
  })
}

function protectedFactsAreSafe(sourceFacts: Map<string, number>, optimizedFacts: Map<string, number>): boolean {
  for (const [fact, optimizedCount] of optimizedFacts) {
    if (optimizedCount > (sourceFacts.get(fact) ?? 0)) return false
  }
  for (const [fact, sourceCount] of sourceFacts) {
    if ((fact.startsWith('year:') || fact.startsWith('email:') || fact.startsWith('url:'))
      && optimizedFacts.get(fact) !== sourceCount) {
      return false
    }
  }
  return true
}

export function normalizeLlmResumeResult(
  value: unknown,
  sourceText: string,
  jobDescription: string,
): ResumeAnalysisResult {
  if (!value || typeof value !== 'object') throw new Error('The LLM returned an invalid resume result.')
  const result = value as { optimizedText?: unknown; suggestions?: unknown; requirements?: unknown }
  if (typeof result.optimizedText !== 'string' || !result.optimizedText.trim()) {
    throw new Error('The LLM returned an empty optimized resume.')
  }
  if (!Array.isArray(result.suggestions)) throw new Error('The LLM returned invalid resume suggestions.')

  const optimizedText = normalizeResumeText(result.optimizedText)
  const normalizedSource = normalizeResumeText(sourceText)
  // ponytail: protect verifiable literals here; export requires explicit review
  // because semantic factual changes cannot be proven safely with local heuristics.
  if (optimizedText.length < normalizedSource.length * 0.5) {
    throw new Error('The LLM returned an incomplete optimized resume.')
  }
  const sourceFacts = protectedFactCounts(normalizedSource)
  const optimizedFacts = protectedFactCounts(optimizedText)
  if (!protectedFactsAreSafe(sourceFacts, optimizedFacts)) {
    throw new Error('The LLM changed protected factual content.')
  }
  const requirements = normalizeResumeRequirements(result.requirements, normalizedSource, jobDescription)
  const targetKeywords = requirements.length
    ? requirements.map((requirement) => requirement.keyword)
    : extractKeywords(jobDescription)
  const keywordMatch = matchResumeKeywords(optimizedText, jobDescription, targetKeywords)

  const suggestions = result.suggestions
    .slice(0, 12)
    .map((item, index): ResumeSuggestion => {
      if (!item || typeof item !== 'object') throw new Error('The LLM returned an invalid resume suggestion.')
      const suggestion = item as Record<string, unknown>
      const title = typeof suggestion.title === 'string' ? suggestion.title.trim().slice(0, 160) : ''
      const description = typeof suggestion.description === 'string' ? suggestion.description.trim().slice(0, 1_000) : ''
      const category = suggestion.category as ResumeSuggestionCategory
      if (!title || !description || !RESUME_SUGGESTION_CATEGORIES.includes(category)
        || typeof suggestion.requiresUserInput !== 'boolean') {
        throw new Error('The LLM returned an invalid resume suggestion.')
      }
      return {
        id: `resume-ai-${index + 1}`,
        title,
        description,
        category,
        replacement: null,
        applied: !suggestion.requiresUserInput,
        anchor: typeof suggestion.anchor === 'string' && optimizedText.includes(suggestion.anchor.trim())
          ? suggestion.anchor.trim().slice(0, 500) : '',
      }
    })

  return { optimizedText, suggestions, requirements, targetKeywords, ...keywordMatch }
}

const ENGLISH_STOPWORDS = new Set([
  'and', 'are', 'for', 'from', 'have', 'into', 'job', 'our', 'role', 'that', 'the', 'their',
  'this', 'with', 'will', 'work', 'working', 'years', 'you', 'your', 'ability', 'experience',
  'preferred', 'required', 'requirements', 'responsibilities', 'skills', 'must', 'should', 'need',
  'needs', 'needed', 'strong', 'proficient', 'proficiency', 'expertise', 'essential', 'nice', 'bonus',
  'ideal', 'ideally', 'candidate', 'candidates', 'looking', 'team', 'teams', 'including', 'using', 'knowledge',
])

export function createEmptyResumeWorkspace(): ResumeWorkspace {
  return {
    original: '',
    optimized: '',
    jobDescription: '',
    suggestions: [],
    sourceFileName: '',
    requirements: [],
    targetKeywords: [],
    matchedKeywords: [],
    missingKeywords: [],
    analysisOriginalFingerprint: '',
    analysisJobDescriptionFingerprint: '',
    analysisSource: '',
    targetRole: '',
    targetCompany: '',
    profileUpdatedAt: '',
    analysisTargetFingerprint: '',
    analysisResumeFingerprint: '',
    reviewedFingerprint: '',
    reviewedAt: '',
  }
}

export function mergeResumeWorkspace(
  current: ResumeWorkspace,
  update: Partial<ResumeWorkspace>,
): ResumeWorkspace {
  const jobDescriptionChanged = update.jobDescription !== undefined && update.jobDescription !== current.jobDescription
  const hasAnalysisContext = Boolean(current.analysisOriginalFingerprint || current.analysisJobDescriptionFingerprint)
  const targetKeywords = jobDescriptionChanged && update.targetKeywords === undefined && !hasAnalysisContext
    ? []
    : update.targetKeywords ?? current.targetKeywords
  const next = { ...current, ...update, targetKeywords }
  if (['original', 'optimized', 'jobDescription', 'targetRole', 'targetCompany'].some(
    key => next[key as keyof ResumeWorkspace] !== current[key as keyof ResumeWorkspace],
  )) {
    next.reviewedFingerprint = ''
    next.reviewedAt = ''
  }
  return {
    ...next,
    ...matchResumeKeywords(next.optimized || next.original, next.jobDescription, next.targetKeywords),
  }
}

export function resumeTargetFingerprint(role: string, company: string): string {
  return resumeTextFingerprint(JSON.stringify([role.trim(), company.trim()]))
}

export function isResumeAnalysisStale(workspace: ResumeWorkspace): boolean {
  return !workspace.analysisOriginalFingerprint
    || workspace.analysisOriginalFingerprint !== resumeTextFingerprint(workspace.original)
    || workspace.analysisJobDescriptionFingerprint !== resumeTextFingerprint(workspace.jobDescription)
    || workspace.analysisTargetFingerprint !== resumeTargetFingerprint(workspace.targetRole, workspace.targetCompany)
}

export function isResumeReviewed(workspace: ResumeWorkspace): boolean {
  return Boolean(workspace.optimized.trim() && workspace.reviewedAt)
    && !isResumeAnalysisStale(workspace)
    && workspace.reviewedFingerprint === resumeTextFingerprint(workspace.optimized)
}

export function createResumeAnalysisRequestCoordinator(timeoutMs = 60_000) {
  let current: AbortController | null = null
  let currentTimeout: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (currentTimeout !== null) clearTimeout(currentTimeout)
    current?.abort()
    current = null
    currentTimeout = null
  }

  return {
    start() {
      cancel()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      current = controller
      currentTimeout = timeout
      return {
        signal: controller.signal,
        isLatest: () => current === controller,
        finish: () => {
          clearTimeout(timeout)
          if (current !== controller) return
          current = null
          currentTimeout = null
        },
      }
    },
    cancel,
  }
}

export function countResumeWords(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const words = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
    .match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return cjk + words
}

export function resumeTextFingerprint(text: string): string {
  const normalized = normalizeResumeText(text)
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${normalized.length}:${(hash >>> 0).toString(16)}`
}

export function normalizeResumeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]{2,}/g, ' ').replace(/^[-*·▪●]\s*/, '• '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractKeywords(jobDescription: string): string[] {
  const keywords = new Map<string, { display: string; score: number; firstIndex: number }>()
  const requiredContext = /\b(?:must|required|requirements?|proficient|proficiency|strong|expertise|hands-on|need(?:ed)?|essential)\b/i
  const preferredContext = /\b(?:preferred|nice[- ]to[- ]have|bonus|ideally|plus)\b/i
  let tokenIndex = 0

  for (const line of jobDescription.split(/\r?\n/)) {
    const contextScore = requiredContext.test(line) ? 4 : preferredContext.test(line) ? 2 : 0
    for (const token of line.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) ?? []) {
      const display = token.replace(/[.-]+$/, '')
      const normalized = display.toLowerCase()
      if (normalized.length < 3 || ENGLISH_STOPWORDS.has(normalized)) continue
      const technicalScore = /[+#]/.test(display) || /\d/.test(display) || /^[A-Z0-9]{2,}$/.test(display) ? 3 : 0
      const existing = keywords.get(normalized)
      keywords.set(normalized, {
        display: existing?.display ?? display,
        score: (existing?.score ?? 0) + 1 + contextScore + technicalScore,
        firstIndex: existing?.firstIndex ?? tokenIndex,
      })
      tokenIndex += 1
    }
  }

  for (const run of jobDescription.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const parts = run.split(/(?:以及|并且|同时|具有|具备|熟悉|掌握|负责|要求|必须|优先|能力|经验|相关|岗位|职位|工作|和|与|及|或|的)+/)
    for (const part of parts) {
      if (part.length < 2 || part.length > 8) continue
      const existing = keywords.get(part)
      const contextScore = /(?:必须|要求|具备|掌握|熟悉)/.test(run) ? 4 : /优先/.test(run) ? 2 : 0
      keywords.set(part, {
        display: part,
        score: (existing?.score ?? 0) + 1 + contextScore,
        firstIndex: existing?.firstIndex ?? tokenIndex,
      })
      tokenIndex += 1
    }
  }

  return [...keywords.values()]
    .sort((left, right) => right.score - left.score || left.firstIndex - right.firstIndex)
    .slice(0, 12)
    .map((item) => item.display)
}

function resumeContainsKeyword(resumeText: string, keyword: string): boolean {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) return false
  if (/[^\x00-\x7F]/.test(normalizedKeyword)) return resumeText.toLocaleLowerCase().includes(normalizedKeyword)

  const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startsWithWord = /^[A-Za-z0-9]/.test(normalizedKeyword)
  const endsWithWord = /[A-Za-z0-9]$/.test(normalizedKeyword)
  const pattern = `${startsWithWord ? '(?<![A-Za-z0-9])' : ''}${escaped}${endsWithWord ? '(?![A-Za-z0-9])' : ''}`
  return new RegExp(pattern, 'i').test(resumeText)
}

export function matchResumeKeywords(resumeText: string, jobDescription: string, explicitKeywords?: readonly string[]): {
  matchedKeywords: string[]
  missingKeywords: string[]
} {
  const keywords = explicitKeywords?.length
    ? [...new Map(explicitKeywords
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => [keyword.toLocaleLowerCase(), keyword] as const)).values()].slice(0, 12)
    : extractKeywords(jobDescription)
  return {
    matchedKeywords: keywords.filter((keyword) => resumeContainsKeyword(resumeText, keyword)),
    missingKeywords: keywords.filter((keyword) => !resumeContainsKeyword(resumeText, keyword)),
  }
}
