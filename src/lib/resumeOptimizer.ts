export type ResumeSuggestionCategory = 'format' | 'clarity' | 'impact' | 'keywords'

export interface ResumeReplacement {
  before: string
  after: string
}

export interface ResumeSuggestion {
  id: string
  titleKey: string
  descriptionKey: string
  descriptionParams?: Record<string, string | number>
  category: ResumeSuggestionCategory
  replacement: ResumeReplacement | null
  applied: boolean
}

export interface ResumeAnalysisResult {
  optimizedText: string
  suggestions: ResumeSuggestion[]
  matchedKeywords: string[]
  missingKeywords: string[]
}

export interface ResumeWorkspace {
  original: string
  optimized: string
  jobDescription: string
  suggestions: ResumeSuggestion[]
  sourceFileName: string
  matchedKeywords: string[]
  missingKeywords: string[]
}

const ENGLISH_STOPWORDS = new Set([
  'and', 'are', 'for', 'from', 'have', 'into', 'job', 'our', 'role', 'that', 'the', 'their',
  'this', 'with', 'will', 'work', 'working', 'years', 'you', 'your', 'ability', 'experience',
  'preferred', 'required', 'requirements', 'responsibilities', 'skills',
])

const IMPACT_CUES = /\b(?:built|created|delivered|designed|developed|drove|grew|improved|increased|launched|led|managed|optimized|reduced|shipped)\b|(?:主导|负责|完成|创建|设计|开发|交付|发布|优化|提升|降低|增长|管理)/i
const METRIC_CUES = /\d|%|％|百分比|倍|万|千|百万|亿元/i

export function createEmptyResumeWorkspace(): ResumeWorkspace {
  return {
    original: '',
    optimized: '',
    jobDescription: '',
    suggestions: [],
    sourceFileName: '',
    matchedKeywords: [],
    missingKeywords: [],
  }
}

export function countResumeWords(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const words = text
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
    .match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  return cjk + words
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
  const keywords = new Map<string, string>()
  for (const token of jobDescription.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) ?? []) {
    const normalized = token.toLowerCase().replace(/[.-]+$/, '')
    if (normalized.length < 3 || ENGLISH_STOPWORDS.has(normalized)) continue
    if (!keywords.has(normalized)) keywords.set(normalized, token.replace(/[.-]+$/, ''))
  }

  for (const run of jobDescription.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const parts = run.split(/(?:以及|并且|同时|具有|具备|熟悉|掌握|负责|要求|优先|能力|经验|相关|岗位|职位|工作|和|与|及|或|的)+/)
    for (const part of parts) {
      if (part.length < 2 || part.length > 8) continue
      if (!keywords.has(part)) keywords.set(part, part)
    }
  }
  return [...keywords.values()].slice(0, 12)
}

function excerpt(text: string, max = 72): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function matchResumeKeywords(resumeText: string, jobDescription: string): {
  matchedKeywords: string[]
  missingKeywords: string[]
} {
  const keywords = extractKeywords(jobDescription)
  const comparableResume = resumeText.toLocaleLowerCase()
  return {
    matchedKeywords: keywords.filter((keyword) => comparableResume.includes(keyword.toLocaleLowerCase())),
    missingKeywords: keywords.filter((keyword) => !comparableResume.includes(keyword.toLocaleLowerCase())),
  }
}

export function analyzeResume(sourceText: string, jobDescription: string): ResumeAnalysisResult {
  const optimizedText = normalizeResumeText(sourceText)
  const suggestions: ResumeSuggestion[] = []
  let sequence = 0
  const add = (suggestion: Omit<ResumeSuggestion, 'id'>) => {
    suggestions.push({ id: `resume-${++sequence}`, ...suggestion })
  }

  if (optimizedText !== sourceText.trim().replace(/\r\n?/g, '\n')) {
    add({
      titleKey: 'resume.rule.format.title',
      descriptionKey: 'resume.rule.format.description',
      category: 'format',
      replacement: null,
      applied: true,
    })
  }

  const safePatterns: Array<[RegExp, string]> = [
    [/^(• )?I (?:was )?responsible for\s+/i, '$1Responsible for '],
    [/^(• )?My responsibilities included\s+/i, '$1'],
    [/^(• )?本人(?:主要)?负责\s*/u, '$1负责'],
  ]
  const lines = optimizedText.split('\n')
  for (const line of lines) {
    for (const [pattern, replacement] of safePatterns) {
      if (!pattern.test(line)) continue
      add({
        titleKey: 'resume.rule.clarity.title',
        descriptionKey: 'resume.rule.clarity.description',
        descriptionParams: { text: excerpt(line) },
        category: 'clarity',
        replacement: { before: line, after: line.replace(pattern, replacement) },
        applied: false,
      })
      break
    }
  }

  for (const line of lines.filter((line) => IMPACT_CUES.test(line) && !METRIC_CUES.test(line)).slice(0, 3)) {
    add({
      titleKey: 'resume.rule.impact.title',
      descriptionKey: 'resume.rule.impact.description',
      descriptionParams: { text: excerpt(line) },
      category: 'impact',
      replacement: null,
      applied: false,
    })
  }

  for (const line of lines.filter((line) => countResumeWords(line) > 45).slice(0, 2)) {
    add({
      titleKey: 'resume.rule.long.title',
      descriptionKey: 'resume.rule.long.description',
      descriptionParams: { text: excerpt(line) },
      category: 'clarity',
      replacement: null,
      applied: false,
    })
  }

  const { matchedKeywords, missingKeywords } = matchResumeKeywords(optimizedText, jobDescription)
  if (missingKeywords.length > 0) {
    add({
      titleKey: 'resume.rule.keywords.title',
      descriptionKey: 'resume.rule.keywords.description',
      descriptionParams: { keywords: missingKeywords.slice(0, 6).join(', ') },
      category: 'keywords',
      replacement: null,
      applied: false,
    })
  }

  return { optimizedText, suggestions, matchedKeywords, missingKeywords }
}

export function applyResumeSuggestion(text: string, suggestion: ResumeSuggestion): {
  text: string
  suggestion: ResumeSuggestion
  applied: boolean
} {
  if (suggestion.applied || !suggestion.replacement) return { text, suggestion, applied: false }
  const index = text.indexOf(suggestion.replacement.before)
  if (index < 0) return { text, suggestion, applied: false }
  const nextText = `${text.slice(0, index)}${suggestion.replacement.after}${text.slice(index + suggestion.replacement.before.length)}`
  return { text: nextText, suggestion: { ...suggestion, applied: true }, applied: true }
}

export function applyAllResumeSuggestions(text: string, suggestions: ResumeSuggestion[]): {
  text: string
  suggestions: ResumeSuggestion[]
} {
  let nextText = text
  const nextSuggestions = suggestions.map((suggestion) => {
    const result = applyResumeSuggestion(nextText, suggestion)
    nextText = result.text
    return result.suggestion
  })
  return { text: nextText, suggestions: nextSuggestions }
}
