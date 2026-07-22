import { Store } from '@tauri-apps/plugin-store'
import {
  createEmptyResumeWorkspace,
  matchResumeKeywords,
  type ResumeSuggestion,
  type ResumeWorkspace,
} from './resumeOptimizer.ts'

let store: Store | null = null

export function createResumeWriteQueue(): (operation: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return (operation) => {
    queue = queue.catch(() => {}).then(operation)
    return queue
  }
}

const enqueueWrite = createResumeWriteQueue()

async function getStore(): Promise<Store> {
  if (!store) store = await Store.load('resume-workspace.json')
  return store
}

function isSuggestion(value: unknown): value is ResumeSuggestion {
  if (!value || typeof value !== 'object') return false
  const suggestion = value as Partial<ResumeSuggestion>
  const replacement = suggestion.replacement
  const params = suggestion.descriptionParams
  return typeof suggestion.id === 'string'
    && typeof suggestion.titleKey === 'string'
    && typeof suggestion.descriptionKey === 'string'
    && ['format', 'clarity', 'impact', 'keywords'].includes(String(suggestion.category))
    && typeof suggestion.applied === 'boolean'
    && (params === undefined || (
      typeof params === 'object'
      && Object.values(params).every((item) => typeof item === 'string' || typeof item === 'number')
    ))
    && (replacement === null || (
      typeof replacement === 'object'
      && typeof replacement.before === 'string'
      && typeof replacement.after === 'string'
    ))
}

export function normalizeResumeWorkspace(value: unknown): ResumeWorkspace {
  const empty = createEmptyResumeWorkspace()
  if (!value || typeof value !== 'object') return empty
  const saved = value as Partial<ResumeWorkspace>
  const original = typeof saved.original === 'string' ? saved.original : ''
  const optimized = typeof saved.optimized === 'string' ? saved.optimized : ''
  const jobDescription = typeof saved.jobDescription === 'string' ? saved.jobDescription.slice(0, 5000) : ''
  const keywordMatch = matchResumeKeywords(optimized || original, jobDescription)
  return {
    original,
    optimized,
    jobDescription,
    suggestions: Array.isArray(saved.suggestions) ? saved.suggestions.filter(isSuggestion) : [],
    sourceFileName: typeof saved.sourceFileName === 'string' ? saved.sourceFileName : '',
    ...keywordMatch,
  }
}

export function toPersistedResumeWorkspace(workspace: ResumeWorkspace): Omit<ResumeWorkspace, 'matchedKeywords' | 'missingKeywords'> {
  return {
    original: workspace.original,
    optimized: workspace.optimized,
    jobDescription: workspace.jobDescription,
    suggestions: workspace.suggestions,
    sourceFileName: workspace.sourceFileName,
  }
}

export async function loadResumeWorkspace(): Promise<ResumeWorkspace> {
  return normalizeResumeWorkspace(await (await getStore()).get<unknown>('workspace'))
}

export async function saveResumeWorkspace(workspace: ResumeWorkspace): Promise<void> {
  return enqueueWrite(async () => {
    const currentStore = await getStore()
    await currentStore.set('workspace', toPersistedResumeWorkspace(workspace))
    await currentStore.save()
  })
}

export async function clearResumeWorkspace(): Promise<void> {
  return enqueueWrite(async () => {
    const currentStore = await getStore()
    await currentStore.delete('workspace')
    await currentStore.save()
  })
}
