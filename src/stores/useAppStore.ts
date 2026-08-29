import { create } from 'zustand'
import { SupportedLanguage } from '../i18n/types'
import { createInitialSnapshot, type CopilotSnapshot } from '../lib/copilotSessionState'
import {
  createEmptyResumeWorkspace,
  mergeResumeWorkspace,
  type ResumeAnalysisContext,
  type ResumeAnalysisResult,
  type ResumeAnalysisSource,
  type ResumeRequirement,
  type ResumeSuggestion,
  type ResumeWorkspace,
} from '../lib/resumeOptimizer'

export interface InterviewRecord {
  id?: number
  date: string
  role: string
  company: string
  score: number | null
  transcript: string
  duration: number
  mode: string
  recordingPath?: string | null
  detailsJson?: string | null
}

export interface Suggestion {
  id: number
  text: string
  category: string
  applied?: boolean
}

export interface AppState {
  // Global
  settings: Record<string, any>
  setLanguage: (lang: SupportedLanguage) => void
  setSettings: (newSettings: Partial<Record<string, any>>) => void
  // Copilot (real-time)
  copilot: CopilotSnapshot
  setCopilotSnapshot: (snapshot: CopilotSnapshot) => void
  
  // History
  history: InterviewRecord[]
  historyStatus: 'loading' | 'ready' | 'error'
  addHistory: (record: InterviewRecord) => void
  loadHistory: (records: InterviewRecord[]) => void
  setHistoryLoadError: () => void
  
  // Resume
  resumeOriginal: string
  resumeOptimized: string
  jobDescription: string
  resumeSuggestions: ResumeSuggestion[]
  resumeSourceFileName: string
  resumeRequirements: ResumeRequirement[]
  resumeTargetKeywords: string[]
  resumeMatchedKeywords: string[]
  resumeMissingKeywords: string[]
  resumeAnalysisOriginalFingerprint: string
  resumeAnalysisJobDescriptionFingerprint: string
  resumeAnalysisSource: ResumeAnalysisSource
  resumeTargetRole: string
  resumeTargetCompany: string
  resumeProfileUpdatedAt: string
  resumeHydrated: boolean
  resumePersistenceError: boolean
  hydrateResumeWorkspace: (workspace: ResumeWorkspace) => void
  updateResumeWorkspace: (workspace: Partial<ResumeWorkspace>) => void
  setResumeAnalysis: (result: ResumeAnalysisResult, context: ResumeAnalysisContext) => void
  clearResumeWorkspace: () => void
  setResumePersistenceError: (failed: boolean) => void
  

}

function resumeStateFromWorkspace(workspace: ResumeWorkspace) {
  return {
    resumeOriginal: workspace.original,
    resumeOptimized: workspace.optimized,
    jobDescription: workspace.jobDescription,
    resumeSuggestions: workspace.suggestions,
    resumeSourceFileName: workspace.sourceFileName,
    resumeRequirements: workspace.requirements,
    resumeTargetKeywords: workspace.targetKeywords,
    resumeMatchedKeywords: workspace.matchedKeywords,
    resumeMissingKeywords: workspace.missingKeywords,
    resumeAnalysisOriginalFingerprint: workspace.analysisOriginalFingerprint,
    resumeAnalysisJobDescriptionFingerprint: workspace.analysisJobDescriptionFingerprint,
    resumeAnalysisSource: workspace.analysisSource,
    resumeTargetRole: workspace.targetRole || '',
    resumeTargetCompany: workspace.targetCompany || '',
    resumeProfileUpdatedAt: workspace.profileUpdatedAt || '',
  }
}

export function selectResumeWorkspace(state: AppState): ResumeWorkspace {
  return {
    original: state.resumeOriginal,
    optimized: state.resumeOptimized,
    jobDescription: state.jobDescription,
    suggestions: state.resumeSuggestions,
    sourceFileName: state.resumeSourceFileName,
    requirements: state.resumeRequirements,
    targetKeywords: state.resumeTargetKeywords,
    matchedKeywords: state.resumeMatchedKeywords,
    missingKeywords: state.resumeMissingKeywords,
    analysisOriginalFingerprint: state.resumeAnalysisOriginalFingerprint,
    analysisJobDescriptionFingerprint: state.resumeAnalysisJobDescriptionFingerprint,
    analysisSource: state.resumeAnalysisSource,
    targetRole: state.resumeTargetRole,
    targetCompany: state.resumeTargetCompany,
    profileUpdatedAt: state.resumeProfileUpdatedAt,
  }
}

export const useAppStore = create<AppState>((set) => ({
  settings: {
    theme: 'Light',
    autoUpdate: true,
    updateChannel: 'Stable',
    stealthEnabled: true,
    aiModel: 'groq-llama-3.1',
    aiAccessMode: 'byok',
    aiModels: {
      groq: 'llama-3.1-8b-instant',
      openai: 'gpt-5.6-luna',
      anthropic: 'claude-haiku-4-5',
      gemini: 'gemini-3.6-flash',
    },
    language: 'zh-CN' as const,
    // STT (Speech-to-Text) provider for real-time transcription
    sttProvider: 'deepgram',
    sttModel: 'nova-3',
    sttLanguage: 'zh-CN',
    useSystemAudio: true,
    useMicWithSystem: false,
  },

  copilot: createInitialSnapshot(),
  setCopilotSnapshot: (snapshot) => set({ copilot: snapshot }),

  history: [],
  historyStatus: 'loading',
  addHistory: (record) => set((state) => ({ history: [record, ...state.history], historyStatus: 'ready' })),
  loadHistory: (records) => set({ history: records, historyStatus: 'ready' }),
  setHistoryLoadError: () => set({ historyStatus: 'error' }),

  resumeOriginal: '',
  resumeOptimized: '',
  jobDescription: '',
  resumeSuggestions: [],
  resumeSourceFileName: '',
  resumeRequirements: [],
  resumeTargetKeywords: [],
  resumeMatchedKeywords: [],
  resumeMissingKeywords: [],
  resumeAnalysisOriginalFingerprint: '',
  resumeAnalysisJobDescriptionFingerprint: '',
  resumeAnalysisSource: '',
  resumeTargetRole: '',
  resumeTargetCompany: '',
  resumeProfileUpdatedAt: '',
  resumeHydrated: false,
  resumePersistenceError: false,
  hydrateResumeWorkspace: (workspace) => set({ ...resumeStateFromWorkspace(workspace), resumeHydrated: true }),
  updateResumeWorkspace: (workspace) => set((state) => resumeStateFromWorkspace(
    mergeResumeWorkspace(selectResumeWorkspace(state), workspace),
  )),
  setResumeAnalysis: (result, context) => set((state) => resumeStateFromWorkspace(
    mergeResumeWorkspace(selectResumeWorkspace(state), {
      optimized: result.optimizedText,
      suggestions: result.suggestions,
      requirements: result.requirements,
      targetKeywords: result.targetKeywords,
      analysisOriginalFingerprint: context.originalFingerprint,
      analysisJobDescriptionFingerprint: context.jobDescriptionFingerprint,
      analysisSource: context.source,
    }),
  )),
  clearResumeWorkspace: () => {
    set(resumeStateFromWorkspace(createEmptyResumeWorkspace()))
  },
  setResumePersistenceError: (failed) => set({ resumePersistenceError: failed }),

  setLanguage: (lang) =>
    set((state) => ({
      settings: { ...state.settings, language: lang },
    })),

  // Initialize or update the settings object (used for persistence + LLM/STT)
  setSettings: (newSettings: Partial<Record<string, any>>) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),

}))
