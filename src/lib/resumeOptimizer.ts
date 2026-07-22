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

const RESUME_SUGGESTION_CATEGORIES: ResumeSuggestionCategory[] = ['format', 'clarity', 'impact', 'keywords']

const NEUTRAL_EDITOR_TOKENS = new Set([
  ...'a an and are as at by for from in into is of on or the to using via with'.split(' '),
  ...'achievements certifications competencies contact core education employment experience included mainly professional profile projects skills summary technical work'.split(' '),
  ...'工作经历教育技能项目个人总结简介证书联系方式核心能力的与和及并在通过使用'.split(''),
])
const OMITTABLE_EDITOR_TOKENS = new Set([
  ...NEUTRAL_EDITOR_TOKENS,
  ...'i my responsible responsibilities was were included mainly'.split(' '),
  ...'负责本人主要曾经相关'.split(''),
])

function resumeTokenCounts(text: string): Map<string, number> {
  const tokens = text.toLocaleLowerCase().match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\p{Script=Latin}[\p{Script=Latin}\p{N}+#]*(?:[.-][\p{Script=Latin}\p{N}+#]+)*|\p{N}+(?:[.,]\p{N}+)?/gu,
  ) ?? []
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

export function normalizeLlmResumeResult(
  value: unknown,
  sourceText: string,
  jobDescription: string,
): ResumeAnalysisResult {
  if (!value || typeof value !== 'object') throw new Error('The LLM returned an invalid resume result.')
  const result = value as { optimizedText?: unknown; suggestions?: unknown }
  if (typeof result.optimizedText !== 'string' || !result.optimizedText.trim()) {
    throw new Error('The LLM returned an empty optimized resume.')
  }
  if (!Array.isArray(result.suggestions)) throw new Error('The LLM returned invalid resume suggestions.')

  const optimizedText = normalizeResumeText(result.optimizedText)
  const normalizedSource = normalizeResumeText(sourceText)
  // ponytail: lexical preservation catches added/removed facts, not semantic repurposing;
  // require source-grounded NLI or user-approved diffs if stronger guarantees become necessary.
  if (optimizedText.length < normalizedSource.length * 0.5) {
    throw new Error('The LLM returned an incomplete optimized resume.')
  }
  const sourceTokens = resumeTokenCounts(normalizedSource)
  const optimizedTokens = resumeTokenCounts(optimizedText)
  const changedFact = [...new Set([...sourceTokens.keys(), ...optimizedTokens.keys()])].find((token) => {
    const sourceCount = sourceTokens.get(token) ?? 0
    const optimizedCount = optimizedTokens.get(token) ?? 0
    return optimizedCount > sourceCount
      ? !NEUTRAL_EDITOR_TOKENS.has(token)
      : optimizedCount < sourceCount && !OMITTABLE_EDITOR_TOKENS.has(token)
  })
  if (changedFact) {
    throw new Error('The LLM changed unsupported factual content.')
  }

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
      }
    })

  return { optimizedText, suggestions, ...matchResumeKeywords(optimizedText, jobDescription) }
}

const ENGLISH_STOPWORDS = new Set([
  'and', 'are', 'for', 'from', 'have', 'into', 'job', 'our', 'role', 'that', 'the', 'their',
  'this', 'with', 'will', 'work', 'working', 'years', 'you', 'your', 'ability', 'experience',
  'preferred', 'required', 'requirements', 'responsibilities', 'skills',
])

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
