import {
  createEmptyResumeWorkspace,
  resumeTextFingerprint,
  type ResumeWorkspace,
} from './resumeOptimizer'

export interface InterviewProfile extends ResumeWorkspace {
  targetRole: string
  targetCompany: string
  profileUpdatedAt: string
}

export interface InterviewSessionIdentity {
  mode: 'copilot' | 'mock'
  targetRole: string
  targetCompany: string
  startedAt: string
  profileUpdatedAt: string
  isTestSession: boolean
}

export function createEmptyInterviewProfile(): InterviewProfile {
  return {
    ...createEmptyResumeWorkspace(),
    targetRole: '',
    targetCompany: '',
    profileUpdatedAt: '',
  }
}

export function normalizeInterviewProfile(value: unknown): InterviewProfile {
  const empty = createEmptyInterviewProfile()
  if (!value || typeof value !== 'object') return empty
  const saved = value as Partial<InterviewProfile>
  return {
    ...empty,
    original: typeof saved.original === 'string' ? saved.original : '',
    optimized: typeof saved.optimized === 'string' ? saved.optimized : '',
    jobDescription: typeof saved.jobDescription === 'string' ? saved.jobDescription.slice(0, 5000) : '',
    suggestions: Array.isArray(saved.suggestions) ? saved.suggestions as InterviewProfile['suggestions'] : [],
    sourceFileName: typeof saved.sourceFileName === 'string' ? saved.sourceFileName : '',
    requirements: Array.isArray(saved.requirements) ? saved.requirements as InterviewProfile['requirements'] : [],
    targetKeywords: Array.isArray(saved.targetKeywords)
      ? saved.targetKeywords.filter((item): item is string => typeof item === 'string')
      : [],
    matchedKeywords: Array.isArray(saved.matchedKeywords)
      ? saved.matchedKeywords.filter((item): item is string => typeof item === 'string')
      : [],
    missingKeywords: Array.isArray(saved.missingKeywords)
      ? saved.missingKeywords.filter((item): item is string => typeof item === 'string')
      : [],
    analysisOriginalFingerprint: typeof saved.analysisOriginalFingerprint === 'string' ? saved.analysisOriginalFingerprint : '',
    analysisJobDescriptionFingerprint: typeof saved.analysisJobDescriptionFingerprint === 'string' ? saved.analysisJobDescriptionFingerprint : '',
    analysisSource: saved.analysisSource === 'original' || saved.analysisSource === 'optimized' ? saved.analysisSource : '',
    targetRole: typeof saved.targetRole === 'string' ? saved.targetRole.trim().slice(0, 160) : '',
    targetCompany: typeof saved.targetCompany === 'string' ? saved.targetCompany.trim().slice(0, 160) : '',
    profileUpdatedAt: typeof saved.profileUpdatedAt === 'string' ? saved.profileUpdatedAt : '',
  }
}

export function interviewProfileFromWorkspace(
  workspace: ResumeWorkspace,
  extras: Partial<Pick<InterviewProfile, 'targetRole' | 'targetCompany' | 'profileUpdatedAt'>> = {},
): InterviewProfile {
  return {
    ...createEmptyInterviewProfile(),
    ...workspace,
    targetRole: extras.targetRole?.trim() ?? '',
    targetCompany: extras.targetCompany?.trim() ?? '',
    profileUpdatedAt: extras.profileUpdatedAt ?? '',
  }
}

export function isOptimizedResumeCurrent(profile: InterviewProfile): boolean {
  if (!profile.optimized.trim() || !profile.analysisOriginalFingerprint) return false
  if (profile.analysisSource !== 'original' && profile.analysisSource !== 'optimized') return false
  if (resumeTextFingerprint(profile.original) !== profile.analysisOriginalFingerprint) return false
  return resumeTextFingerprint(profile.jobDescription) === profile.analysisJobDescriptionFingerprint
}

export function selectInterviewResume(profile: InterviewProfile): string {
  return isOptimizedResumeCurrent(profile) ? profile.optimized : profile.original
}

export function buildInterviewContext(profile: InterviewProfile, recentTurns = ''): string {
  const resume = selectInterviewResume(profile).slice(0, 6_000)
  return [
    profile.targetRole ? `Target role:\n${profile.targetRole}` : '',
    profile.targetCompany ? `Target company:\n${profile.targetCompany}` : '',
    resume ? `Resume:\n${resume}` : '',
    profile.jobDescription.trim() ? `Job description:\n${profile.jobDescription.slice(0, 4_000)}` : '',
    recentTurns,
  ].filter(Boolean).join('\n\n')
}

export function formatSessionTitle(
  profile: Pick<InterviewProfile, 'targetRole' | 'targetCompany'>,
  fallback: string,
  now = new Date(),
): string {
  const date = now.toISOString().slice(0, 10)
  const company = profile.targetCompany.trim()
  const role = profile.targetRole.trim() || fallback
  return company ? `${company} · ${role} · ${date}` : `${role} · ${date}`
}

export function createSessionIdentity(
  mode: InterviewSessionIdentity['mode'],
  profile: InterviewProfile,
  isTestSession = false,
  now = new Date(),
): InterviewSessionIdentity {
  return {
    mode,
    targetRole: profile.targetRole,
    targetCompany: profile.targetCompany,
    startedAt: now.toISOString(),
    profileUpdatedAt: profile.profileUpdatedAt,
    isTestSession,
  }
}
