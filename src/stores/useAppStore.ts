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
  setSettings: (newSettings: Partial<Record<string, any>>) => void
  
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
    autoUpdate: true,
    updateChannel: 'Stable',
    stealthEnabled: true,
    aiModel: 'groq-llama-3.1',
    aiModels: {
      groq: 'llama-3.1-8b-instant',
      openai: 'gpt-4o',
      anthropic: 'claude-3-5-sonnet-20241022',
      gemini: 'gemini-3.5-flash',
    },
    language: 'zh-CN' as const,
    // STT (Speech-to-Text) provider for real-time transcription
    sttProvider: 'deepgram',
    sttModel: 'nova-2',
  },

  copilot: {
    isActive: false,
    currentQuestion: '请介绍一下你自己。',
    suggestions: [
      { id: 1, text: '情境：清晰描述项目背景。', category: 'STAR' },
      { id: 2, text: '任务：说明你的具体职责。', category: 'STAR' },
    ],
    amplitude: 0,
    isStealth: true,
  },

  setCopilotActive: (active) =>
    set((state) => ({ copilot: { ...state.copilot, isActive: active } })),

  updateCopilotQuestion: (q) =>
    set((state) => ({ copilot: { ...state.copilot, currentQuestion: q } })),

  addSuggestion: (s) =>
    set((state) => {
      const next = [...state.copilot.suggestions, { ...s, id: Date.now() }];
      // Cap suggestions to avoid memory / UI bloat during long sessions
      return {
        copilot: {
          ...state.copilot,
          suggestions: next.length > 40 ? next.slice(next.length - 40) : next,
        },
      };
    }),

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

  // Initialize or update the settings object (used for persistence + LLM/STT)
  setSettings: (newSettings: Partial<Record<string, any>>) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
}))
