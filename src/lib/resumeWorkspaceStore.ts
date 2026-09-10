import {
  clearResumeWorkspaceJson,
  loadResumeWorkspaceJson,
  migrateLegacyJsonStoresIfNeeded,
  saveResumeWorkspaceJson,
} from './db.ts'
import { encryptSecret } from './secretCrypto.ts'
import {
  createEmptyResumeWorkspace,
  matchResumeKeywords,
  type ResumeRequirement,
  type ResumeSuggestion,
  type ResumeWorkspace,
} from './resumeOptimizer.ts'

export function createResumeWriteQueue(): (operation: () => Promise<void>) => Promise<void> {
  let queue: Promise<void> = Promise.resolve()
  return (operation) => {
    queue = queue.catch(() => {}).then(operation)
    return queue
  }
}

const enqueueWrite = createResumeWriteQueue()

async function ensureMigrated(): Promise<void> {
  await migrateLegacyJsonStoresIfNeeded(encryptSecret)
}

function isRequirement(value: unknown): value is ResumeRequirement {
  if (!value || typeof value !== 'object') return false
  const requirement = value as Partial<ResumeRequirement>
  return typeof requirement.keyword === 'string'
    && ['required', 'preferred'].includes(String(requirement.priority))
    && ['supported', 'unsupported'].includes(String(requirement.status))
    && typeof requirement.evidence === 'string'
}

function isSuggestion(value: unknown): value is ResumeSuggestion {
  if (!value || typeof value !== 'object') return false
  const suggestion = value as Partial<ResumeSuggestion>
  const replacement = suggestion.replacement
  const params = suggestion.descriptionParams
  const hasCopy = typeof suggestion.title === 'string' && typeof suggestion.description === 'string'
  const hasTranslationKeys = typeof suggestion.titleKey === 'string' && typeof suggestion.descriptionKey === 'string'
  return typeof suggestion.id === 'string'
    && (hasCopy || hasTranslationKeys)
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
  const targetKeywords = Array.isArray(saved.targetKeywords)
    ? saved.targetKeywords.filter((keyword): keyword is string => typeof keyword === 'string' && Boolean(keyword.trim())).slice(0, 12)
    : []
  const keywordMatch = matchResumeKeywords(optimized || original, jobDescription, targetKeywords)
  const analysisSource = saved.analysisSource === 'original' || saved.analysisSource === 'optimized'
    ? saved.analysisSource
    : ''
  return {
    original,
    optimized,
    jobDescription,
    suggestions: Array.isArray(saved.suggestions) ? saved.suggestions.filter(isSuggestion) : [],
    sourceFileName: typeof saved.sourceFileName === 'string' ? saved.sourceFileName : '',
    requirements: Array.isArray(saved.requirements) ? saved.requirements.filter(isRequirement).slice(0, 12) : [],
    targetKeywords,
    analysisOriginalFingerprint: typeof saved.analysisOriginalFingerprint === 'string' ? saved.analysisOriginalFingerprint : '',
    analysisJobDescriptionFingerprint: typeof saved.analysisJobDescriptionFingerprint === 'string' ? saved.analysisJobDescriptionFingerprint : '',
    analysisSource,
    targetRole: typeof saved.targetRole === 'string' ? saved.targetRole.trim().slice(0, 160) : '',
    targetCompany: typeof saved.targetCompany === 'string' ? saved.targetCompany.trim().slice(0, 160) : '',
    profileUpdatedAt: typeof saved.profileUpdatedAt === 'string' ? saved.profileUpdatedAt : '',
    analysisTargetFingerprint: typeof saved.analysisTargetFingerprint === 'string' ? saved.analysisTargetFingerprint : '',
    analysisResumeFingerprint: typeof saved.analysisResumeFingerprint === 'string' ? saved.analysisResumeFingerprint : '',
    reviewedFingerprint: typeof saved.reviewedFingerprint === 'string' ? saved.reviewedFingerprint : '',
    reviewedAt: typeof saved.reviewedAt === 'string' ? saved.reviewedAt : '',
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
    requirements: workspace.requirements,
    targetKeywords: workspace.targetKeywords,
    analysisOriginalFingerprint: workspace.analysisOriginalFingerprint,
    analysisJobDescriptionFingerprint: workspace.analysisJobDescriptionFingerprint,
    analysisSource: workspace.analysisSource,
    targetRole: workspace.targetRole,
    targetCompany: workspace.targetCompany,
    profileUpdatedAt: workspace.profileUpdatedAt,
    analysisTargetFingerprint: workspace.analysisTargetFingerprint,
    analysisResumeFingerprint: workspace.analysisResumeFingerprint,
    reviewedFingerprint: workspace.reviewedFingerprint,
    reviewedAt: workspace.reviewedAt,
  }
}

export function hasResumeWorkspaceContent(workspace: ResumeWorkspace): boolean {
  return Boolean(
    workspace.original.trim()
    || workspace.optimized.trim()
    || workspace.jobDescription.trim()
    || workspace.sourceFileName
    || workspace.targetRole?.trim()
    || workspace.targetCompany?.trim(),
  )
}

export async function loadResumeWorkspace(): Promise<ResumeWorkspace> {
  await ensureMigrated()
  const raw = await loadResumeWorkspaceJson()
  if (raw === null) return createEmptyResumeWorkspace()
  const saved = JSON.parse(raw)
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)
    || typeof saved.original !== 'string' || typeof saved.optimized !== 'string') {
    throw new Error('Invalid saved resume workspace')
  }
  return normalizeResumeWorkspace(saved)
}

export async function saveResumeWorkspace(workspace: ResumeWorkspace): Promise<void> {
  return enqueueWrite(async () => {
    await ensureMigrated()
    await saveResumeWorkspaceJson(JSON.stringify(toPersistedResumeWorkspace(workspace)))
  })
}

export async function clearResumeWorkspace(): Promise<void> {
  return enqueueWrite(async () => {
    await ensureMigrated()
    await clearResumeWorkspaceJson()
  })
}

export async function persistResumeWorkspace(workspace: ResumeWorkspace): Promise<void> {
  // Only the explicit Clear action may delete the saved workspace.
  if (hasResumeWorkspaceContent(workspace)) await saveResumeWorkspace(workspace)
}
