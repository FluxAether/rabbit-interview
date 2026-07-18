import { create } from 'zustand'
import { SupportedLanguage } from '../i18n/types'

export interface InterviewRecord {
  id?: number
  date: string
  role: string
  company: string
  score: number
  transcript: string
  duration: number
  mode: string
}

export interface Suggestion {
  id: number
  text: string
  category: string
  applied?: boolean
}

export interface CopilotState {
  isActive: boolean
  currentQuestion: string
  suggestions: Suggestion[]
  amplitude: number
  isStealth: boolean
}

interface AppState {
  // Global
  currentPage: string
  settings: Record<string, any>
  setLanguage: (lang: SupportedLanguage) => void
  
  // Copilot (real-time)
  copilot: CopilotState
  setCopilotActive: (active: boolean) => void
  updateCopilotQuestion: (q: string) => void
  addSuggestion: (s: Omit<Suggestion, 'id'>) => void
  updateAmplitude: (amp: number) => void
  applySuggestion: (id: number) => void
  
  // History
  history: InterviewRecord[]
  addHistory: (record: InterviewRecord) => void
  loadHistory: (records: InterviewRecord[]) => void
  
  // Resume
  resumeOriginal: string
  resumeOptimized: string
  jobDescription: string
  resumeSuggestions: Suggestion[]
  setResumeData: (original: string, optimized: string, jd: string) => void
  applyResumeSuggestion: (id: number) => void
  
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
    stealthEnabled: true,
    aiModel: 'groq-llama-3.1',
    language: 'en-US' as const,
  },

  copilot: {
    isActive: false,
    currentQuestion: 'Tell me about yourself.',
    suggestions: [
      { id: 1, text: 'Situation: Set clear context of the project.', category: 'STAR' },
      { id: 2, text: 'Task: Describe your specific responsibility.', category: 'STAR' },
    ],
    amplitude: 0,
    isStealth: true,
  },

  setCopilotActive: (active) =>
    set((state) => ({ copilot: { ...state.copilot, isActive: active } })),

  updateCopilotQuestion: (q) =>
    set((state) => ({ copilot: { ...state.copilot, currentQuestion: q } })),

  addSuggestion: (s) =>
    set((state) => ({
      copilot: {
        ...state.copilot,
        suggestions: [...state.copilot.suggestions, { ...s, id: Date.now() }],
      },
    })),

  updateAmplitude: (amp) =>
    set((state) => ({ copilot: { ...state.copilot, amplitude: amp } })),

  applySuggestion: (id) =>
    set((state) => ({
      copilot: {
        ...state.copilot,
        suggestions: state.copilot.suggestions.map((s) =>
          s.id === id ? { ...s, applied: true } : s
        ),
      },
    })),

  history: [],
  addHistory: (record) => set((state) => ({ history: [record, ...state.history] })),
  loadHistory: (records) => set({ history: records }),

  resumeOriginal: '',
  resumeOptimized: '',
  jobDescription: '',
  resumeSuggestions: [],
  setResumeData: (original, optimized, jd) =>
    set({
      resumeOriginal: original,
      resumeOptimized: optimized,
      jobDescription: jd,
      resumeSuggestions: [
        { id: 1, text: 'Quantify achievements with metrics', category: 'Impact', applied: false },
        { id: 2, text: 'Add keywords from JD', category: 'Keywords', applied: false },
        { id: 3, text: 'Improve clarity of bullets', category: 'Clarity', applied: false },
      ],
    }),
  applyResumeSuggestion: (id) =>
    set((state) => ({
      resumeSuggestions: state.resumeSuggestions.map((s) =>
        s.id === id ? { ...s, applied: true } : s
      ),
    })),

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
}))
