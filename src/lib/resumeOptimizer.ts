export type ResumeSuggestionCategory = 'format' | 'clarity' | 'impact' | 'keywords'
export type ResumeAnalysisLanguage = 'zh-CN' | 'zh-TW' | 'en-US'

export interface ResumeReplacement {
  before: string
  after: string
}

export interface ResumeSuggestion {
  id: string
  title: string
  description: string
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

function getRuleCopy(language: ResumeAnalysisLanguage) {
  if (language === 'en-US') return {
    formatTitle: 'Formatting normalized',
    formatDescription: 'Whitespace, line breaks, and bullet markers were normalized.',
    clarityTitle: 'Remove first-person filler',
    clarityDescription: (line: string) => `Rewrite “${excerpt(line)}” as a more direct resume statement.`,
    impactTitle: 'Add a verifiable outcome',
    impactDescription: (line: string) => `“${excerpt(line)}” has no verifiable scale, efficiency, or outcome. Add only factual details.`,
    longTitle: 'Split a long statement',
    longDescription: (line: string) => `“${excerpt(line)}” is dense. Split it into shorter bullets manually.`,
    keywordTitle: 'Review job keywords',
    keywordDescription: (keywords: string[]) => `Not found from the JD: ${keywords.join(', ')}. Add them only when supported by your experience.`,
  }
  if (language === 'zh-TW') return {
    formatTitle: '已規範文字格式',
    formatDescription: '已統一空白、換行和項目符號。',
    clarityTitle: '精簡第一人稱表達',
    clarityDescription: (line: string) => `將「${excerpt(line)}」改為更直接的履歷表達。`,
    impactTitle: '補充可驗證成果',
    impactDescription: (line: string) => `「${excerpt(line)}」缺少可驗證的規模、效率或結果，請按真實情況手動補充。`,
    longTitle: '拆分過長表述',
    longDescription: (line: string) => `「${excerpt(line)}」資訊較密集，建議手動拆分為更短的項目符號。`,
    keywordTitle: '核對職缺關鍵字',
    keywordDescription: (keywords: string[]) => `JD 中尚未出現：${keywords.join('、')}。僅在符合真實經歷時手動補充。`,
  }
  return {
    formatTitle: '已规范文本格式',
    formatDescription: '已统一空白、换行和项目符号。',
    clarityTitle: '精简第一人称表达',
    clarityDescription: (line: string) => `将“${excerpt(line)}”改为更直接的简历表达。`,
    impactTitle: '补充可验证成果',
    impactDescription: (line: string) => `“${excerpt(line)}”缺少可验证的规模、效率或结果，请按真实情况手动补充。`,
    longTitle: '拆分过长表述',
    longDescription: (line: string) => `“${excerpt(line)}”信息较密集，建议手动拆分为更短的项目符号。`,
    keywordTitle: '核对职位关键词',
    keywordDescription: (keywords: string[]) => `JD 中尚未出现：${keywords.join('、')}。仅在与你的真实经历相符时手动补充。`,
  }
}

export function analyzeResume(
  sourceText: string,
  jobDescription: string,
  language: ResumeAnalysisLanguage = 'zh-CN',
): ResumeAnalysisResult {
  const optimizedText = normalizeResumeText(sourceText)
  const copy = getRuleCopy(language)
  const suggestions: ResumeSuggestion[] = []
  let sequence = 0
  const add = (suggestion: Omit<ResumeSuggestion, 'id'>) => {
    suggestions.push({ id: `resume-${++sequence}`, ...suggestion })
  }

  if (optimizedText !== sourceText.trim().replace(/\r\n?/g, '\n')) {
    add({
      title: copy.formatTitle,
      description: copy.formatDescription,
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
        title: copy.clarityTitle,
        description: copy.clarityDescription(line),
        category: 'clarity',
        replacement: { before: line, after: line.replace(pattern, replacement) },
        applied: false,
      })
      break
    }
  }

  for (const line of lines.filter((line) => IMPACT_CUES.test(line) && !METRIC_CUES.test(line)).slice(0, 3)) {
    add({
      title: copy.impactTitle,
      description: copy.impactDescription(line),
      category: 'impact',
      replacement: null,
      applied: false,
    })
  }

  for (const line of lines.filter((line) => countResumeWords(line) > 45).slice(0, 2)) {
    add({
      title: copy.longTitle,
      description: copy.longDescription(line),
      category: 'clarity',
      replacement: null,
      applied: false,
    })
  }

  const keywords = extractKeywords(jobDescription)
  const comparableResume = optimizedText.toLocaleLowerCase()
  const matchedKeywords = keywords.filter((keyword) => comparableResume.includes(keyword.toLocaleLowerCase()))
  const missingKeywords = keywords.filter((keyword) => !comparableResume.includes(keyword.toLocaleLowerCase()))
  if (missingKeywords.length > 0) {
    add({
      title: copy.keywordTitle,
      description: copy.keywordDescription(missingKeywords.slice(0, 6)),
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
