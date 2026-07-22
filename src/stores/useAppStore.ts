import { create } from 'zustand'
import { SupportedLanguage } from '../i18n/types'
import { createInitialSnapshot, type CopilotSnapshot } from '../lib/copilotSessionState'
import {
  applyAllResumeSuggestions,
  applyResumeSuggestion as applySuggestionToText,
  createEmptyResumeWorkspace,
  type ResumeAnalysisResult,
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

interface AppState {
  // Global
  currentPage: string
  settings: Record<string, any>
  setLanguage: (lang: SupportedLanguage) => void
  setSettings: (newSettings: Partial<Record<string, any>>) => void
  // Copilot (real-time)
  copilot: CopilotSnapshot
  setCopilotSnapshot: (snapshot: CopilotSnapshot) => void
  
  // History
  history: InterviewRecord[]
  addHistory: (record: InterviewRecord) => void
  loadHistory: (records: InterviewRecord[]) => void
  
  // Resume
  resumeOriginal: string
  resumeOptimized: string
  jobDescription: string
  resumeSuggestions: ResumeSuggestion[]
  resumeSourceFileName: string
  resumeMatchedKeywords: string[]
  resumeMissingKeywords: string[]
  resumeHydrated: boolean
  hydrateResumeWorkspace: (workspace: ResumeWorkspace) => void
  updateResumeWorkspace: (workspace: Partial<ResumeWorkspace>) => void
  setResumeAnalysis: (result: ResumeAnalysisResult) => void
  applyResumeSuggestion: (id: string) => boolean
  applyAllResumeSuggestions: () => number
  clearResumeWorkspace: () => void
  
  // Mock Interview
  mockConversation: Array<{role: 'ai' | 'user', text: string}>
  mockFeedback: Array<{label: string, score: number, text: string}>
  addMockMessage: (role: 'ai' | 'user', text: string) => void
  setMockFeedback: (fb: any[]) => void
  resetMock: () => void
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'dashboard',
  settings: {
    theme: 'Light',
    launchAtStartup: true,
    autoUpdate: true,
    updateChannel: 'Stable',
    stealthEnabled: true,
    aiModel: 'groq-llama-3.1',
    aiModels: {
      groq: 'llama-3.1-8b-instant',
      openai: 'gpt-5.6-luna',
      anthropic: 'claude-haiku-4-5',
      gemini: 'gemini-3.5-flash',
    },
    language: 'zh-CN' as const,
    // STT (Speech-to-Text) provider for real-time transcription
    sttProvider: 'deepgram',
    sttModel: 'nova-3',
    sttLanguage: 'zh-CN',
  },

  copilot: createInitialSnapshot(),
  setCopilotSnapshot: (snapshot) => set({ copilot: snapshot }),

  history: [],
  addHistory: (record) => set((state) => ({ history: [record, ...state.history] })),
  loadHistory: (records) => set({ history: records }),

  resumeOriginal: '',
  resumeOptimized: '',
  jobDescription: '',
  resumeSuggestions: [],
  resumeSourceFileName: '',
  resumeMatchedKeywords: [],
  resumeMissingKeywords: [],
  resumeHydrated: false,
  hydrateResumeWorkspace: (workspace) => set({
    resumeOriginal: workspace.original,
    resumeOptimized: workspace.optimized,
    jobDescription: workspace.jobDescription,
    resumeSuggestions: workspace.suggestions,
    resumeSourceFileName: workspace.sourceFileName,
    resumeMatchedKeywords: workspace.matchedKeywords,
    resumeMissingKeywords: workspace.missingKeywords,
    resumeHydrated: true,
  }),
  updateResumeWorkspace: (workspace) => set((state) => ({
    resumeOriginal: workspace.original ?? state.resumeOriginal,
    resumeOptimized: workspace.optimized ?? state.resumeOptimized,
    jobDescription: workspace.jobDescription ?? state.jobDescription,
    resumeSuggestions: workspace.suggestions ?? state.resumeSuggestions,
    resumeSourceFileName: workspace.sourceFileName ?? state.resumeSourceFileName,
    resumeMatchedKeywords: workspace.matchedKeywords ?? state.resumeMatchedKeywords,
    resumeMissingKeywords: workspace.missingKeywords ?? state.resumeMissingKeywords,
  })),
  setResumeAnalysis: (result) => set({
    resumeOptimized: result.optimizedText,
    resumeSuggestions: result.suggestions,
    resumeMatchedKeywords: result.matchedKeywords,
    resumeMissingKeywords: result.missingKeywords,
  }),
  applyResumeSuggestion: (id) => {
    let applied = false
    set((state) => {
      const target = state.resumeSuggestions.find((suggestion) => suggestion.id === id)
      if (!target) return state
      const result = applySuggestionToText(state.resumeOptimized, target)
      applied = result.applied
      if (!applied) return state
      return {
        resumeOptimized: result.text,
        resumeSuggestions: state.resumeSuggestions.map((suggestion) =>
          suggestion.id === id ? result.suggestion : suggestion
        ),
      }
    })
    return applied
  },
  applyAllResumeSuggestions: () => {
    let appliedCount = 0
    set((state) => {
      const result = applyAllResumeSuggestions(state.resumeOptimized, state.resumeSuggestions)
      appliedCount = result.suggestions.filter((suggestion, index) =>
        suggestion.applied && !state.resumeSuggestions[index]?.applied
      ).length
      return { resumeOptimized: result.text, resumeSuggestions: result.suggestions }
    })
    return appliedCount
  },
  clearResumeWorkspace: () => {
    const empty = createEmptyResumeWorkspace()
    set({
      resumeOriginal: empty.original,
      resumeOptimized: empty.optimized,
      jobDescription: empty.jobDescription,
      resumeSuggestions: empty.suggestions,
      resumeSourceFileName: empty.sourceFileName,
      resumeMatchedKeywords: empty.matchedKeywords,
      resumeMissingKeywords: empty.missingKeywords,
    })
  },

  mockConversation: [],
  mockFeedback: [],
  addMockMessage: (role, text) =>
    set((state) => ({
      mockConversation: [...state.mockConversation, { role, text }],
    })),
  setMockFeedback: (fb) => set({ mockFeedback: fb }),
  resetMock: () =>
    set({ mockConversation: [], mockFeedback: [] }),

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
