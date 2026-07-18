import { useState, useEffect, useRef } from 'react'
import { Sun, Mic, Shield } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n'
import { LANGUAGE_OPTIONS, SupportedLanguage, DEFAULT_LANGUAGE } from '../i18n/types'
import { saveAppSettings, type AppSettings as PersistedSettings } from '../lib/settingsStore'

export default function Settings() {
  const { settings, setLanguage: setStoreLanguage } = useAppStore()
  const t = useTranslation()

  const [theme, setTheme] = useState<'Light' | 'Dark' | 'System'>('Light')
  const [launchAtStartup, setLaunchAtStartup] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateChannel, setUpdateChannel] = useState<'Stable' | 'Beta'>('Stable')
  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE)
  const [aiModel, setAiModel] = useState('groq-llama-3.1')
  const [stealth, setStealth] = useState(true)

  // Per-provider model selections (so each provider can remember its own model)
  const [activeProvider, setActiveProvider] = useState<'groq' | 'openai' | 'anthropic' | 'gemini'>('groq')
  const [groqModel, setGroqModel] = useState('llama-3.1-8b-instant')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o')
  const [anthropicModel, setAnthropicModel] = useState('claude-3-5-sonnet-20241022')
  const [geminiModel, setGeminiModel] = useState('gemini-3.5-flash')

  // Track which API keys are already configured (without exposing the actual keys)
  const [keyStatus, setKeyStatus] = useState({
    groq: false,
    openai: false,
    anthropic: false,
    gemini: false,
    deepgram: false,
  })

  // STT (real-time speech-to-text) configuration
  const [sttProvider, setSttProvider] = useState<'deepgram'>('deepgram')
  const [sttModel, setSttModel] = useState('nova-2')

  // --- Auto-save implementation ---
  const saveTimeoutRef = useRef<number | null>(null)
  const isHydratedRef = useRef(false)

  // Build payload from current local state values
  const buildPayload = () => ({
    theme,
    launchAtStartup,
    autoUpdate,
    updateChannel,
    language,
    aiModel,
    stealthEnabled: stealth,
    aiModels: {
      groq: groqModel,
      openai: openaiModel,
      anthropic: anthropicModel,
      gemini: geminiModel,
    },
    sttProvider,
    sttModel,
  })

  const persistToDisk = async (payload: ReturnType<typeof buildPayload>) => {
    try {
      await saveAppSettings(payload as Partial<PersistedSettings>)

      // Optional Rust side (non-critical)
      try {
        await invoke('save_settings', { settings: payload })
      } catch (e) {
        console.warn('Rust save_settings (non-critical):', e)
      }
    } catch (e) {
      console.warn('Auto-save to disk failed:', e)
    }
  }

  // Force immediate persist (bypasses debounce)
  const saveNow = async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    const payload = buildPayload()
    useAppStore.setState((s) => ({ settings: { ...s.settings, ...payload } }))
    await persistToDisk(payload)
  }

  // React to any setting change after hydration → update Zustand immediately + debounce disk save
  useEffect(() => {
    if (!isHydratedRef.current) return

    const payload = buildPayload()

    // Make change visible to the rest of the app right away (LLM, STT, language, etc.)
    useAppStore.setState((s) => ({ settings: { ...s.settings, ...payload } }))

    // Debounce actual write to app-settings.json
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      void persistToDisk(payload)
    }, 350)

    // Cleanup pending timer on unmount or before next run
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [
    theme, launchAtStartup, autoUpdate, updateChannel,
    language, aiModel, stealth,
    groqModel, openaiModel, anthropicModel, geminiModel,
    sttProvider, sttModel,
  ])

  // Load key configuration status (presence only)
  useEffect(() => {
    (async () => {
      try {
        const { getApiKey } = await import('../lib/keyStore')
        const [g, o, a, ge, dg] = await Promise.all([
          getApiKey('GROQ_API_KEY'),
          getApiKey('OPENAI_API_KEY'),
          getApiKey('ANTHROPIC_API_KEY'),
          getApiKey('GEMINI_API_KEY'),
          getApiKey('DEEPGRAM_API_KEY'),
        ])
        setKeyStatus({
          groq: !!g,
          openai: !!o,
          anthropic: !!a,
          gemini: !!ge,
          deepgram: !!dg,
        })
      } catch {}
    })()
  }, [])

  // Initialize ALL local UI state from the global persisted settings
  // This runs when the app loads settings from disk into Zustand
  useEffect(() => {
    if (!settings) return

    // Basic settings
    if (settings.theme) setTheme(settings.theme as any)
    if (typeof settings.launchAtStartup === 'boolean') setLaunchAtStartup(settings.launchAtStartup)
    if (typeof settings.autoUpdate === 'boolean') setAutoUpdate(settings.autoUpdate)
    if (settings.updateChannel) setUpdateChannel(settings.updateChannel as any)
    if (settings.stealthEnabled !== undefined) setStealth(!!settings.stealthEnabled)

    // Language
    const lang = (settings.language as SupportedLanguage) || DEFAULT_LANGUAGE
    setLanguage(lang)

    // AI model + per provider models
    const currentAiModel = (settings.aiModel as string) || 'groq-llama-3.1'
    setAiModel(currentAiModel)

    const aiModels = (settings.aiModels as Record<string, string>) || {}
    if (aiModels.groq) setGroqModel(aiModels.groq)
    if (aiModels.openai) setOpenaiModel(aiModels.openai)
    if (aiModels.anthropic) setAnthropicModel(aiModels.anthropic)
    // Gemini only supports the latest single model now: gemini-3.5-flash
    setGeminiModel('gemini-3.5-flash')

    // Activate the correct provider tab based on current aiModel
    if (currentAiModel.includes('gemini')) {
      setActiveProvider('gemini')
    } else if (currentAiModel.includes('claude')) {
      setActiveProvider('anthropic')
    } else if (currentAiModel.includes('gpt') || currentAiModel.startsWith('openai')) {
      setActiveProvider('openai')
    } else {
      setActiveProvider('groq')
    }

    // STT
    if (settings.sttProvider) setSttProvider(settings.sttProvider as 'deepgram')
    if (settings.sttModel) setSttModel(settings.sttModel as string)
  }, [settings])

  // Mark as hydrated after the first settings load so we don't auto-save during initial population
  useEffect(() => {
    if (settings) {
      // Use microtask so any pending setState from the population effect above have been processed
      queueMicrotask(() => {
        isHydratedRef.current = true
      })
    }
  }, [settings])

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLanguage(newLang)
    setStoreLanguage(newLang)
    // Immediate store update for instant UI translation feedback
    useAppStore.setState((s) => ({ settings: { ...s.settings, language: newLang } }))
  }

  // Update the active provider + aiModel in both local state and global store
  const activateProvider = (provider: 'groq' | 'openai' | 'anthropic' | 'gemini', model: string) => {
    setActiveProvider(provider)
    const finalModel = provider === 'gemini' ? 'gemini-3.5-flash' : model
    setAiModel(finalModel)

    useAppStore.setState((s) => ({
      settings: { ...s.settings, aiModel: finalModel },
    }))
    // auto-save useEffect will handle persistence
  }

  // Change model for a specific provider. If it is currently active, also update global aiModel.
  const updateProviderModel = (provider: 'groq' | 'openai' | 'anthropic' | 'gemini', model: string) => {
    if (provider === 'groq') setGroqModel(model)
    else if (provider === 'openai') setOpenaiModel(model)
    else if (provider === 'anthropic') setAnthropicModel(model)
    else {
      // Gemini: only one supported model (as requested)
      model = 'gemini-3.5-flash'
      setGeminiModel(model)
    }

    // Update the aiModels map in global state (persisted automatically)
    useAppStore.setState((s) => {
      const currentModels = (s.settings?.aiModels as Record<string, string>) || {}
      return {
        settings: {
          ...s.settings,
          aiModels: { ...currentModels, [provider]: model },
          ...(provider === activeProvider ? { aiModel: model } : {}),
        },
      }
    })

    if (provider === activeProvider) {
      setAiModel(model)
    }
    // auto-save useEffect will trigger on groqModel/openaiModel/... changes
  }

  // Save an API key for a provider and refresh status
  const saveProviderKey = async (provider: 'groq' | 'openai' | 'anthropic' | 'gemini' | 'deepgram', value: string) => {
    const keyMap = {
      groq: 'GROQ_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY',
    } as const

    const { setApiKey } = await import('../lib/keyStore')
    const { clearKeyCache } = await import('../lib/llm')
    await setApiKey(keyMap[provider], value)
    clearKeyCache()

    // Update visual status
    setKeyStatus((prev) => ({ ...prev, [provider]: value.trim().length > 0 }))
  }

  // Update STT provider/model and sync to global store immediately
  const updateSttConfig = (provider: 'deepgram', model: string) => {
    setSttProvider(provider)
    setSttModel(model)

    useAppStore.setState((s) => ({
      settings: {
        ...s.settings,
        sttProvider: provider,
        sttModel: model,
      },
    }))
    // auto-save effect reacts to sttProvider / sttModel
  }

  // saveNow() can be called to force immediate persistence if needed.

  return (
    <div className="p-8 overflow-auto">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">{t('settings.title')}</h1>
        <p className="text-[#475569] mb-8">{t('settings.description')}</p>

        {/* Application Card */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-4">{t('settings.application')}</div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <Sun className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">{t('settings.theme')}</div>
                  <div className="text-xs text-[#64748b]">{t('settings.themeDesc')}</div>
                </div>
              </div>
              <select
                value={theme}
                onChange={(e) => {
                  const val = e.target.value as 'Light' | 'Dark' | 'System'
                  setTheme(val)
                }}
                className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
              >
                <option>Light</option>
                <option>Dark</option>
                <option>System</option>
              </select>
            </div>

            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <Mic className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">{t('settings.launchAtStartup')}</div>
                  <div className="text-xs text-[#64748b]">{t('settings.launchAtStartupDesc')}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={launchAtStartup}
                  onChange={(e) => {
                    setLaunchAtStartup(e.target.checked)
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none peer-focus:ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1]"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Updates Card */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-4">{t('settings.updates')}</div>

          <div className="space-y-4">
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <Mic className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">{t('settings.autoUpdate')}</div>
                  <div className="text-xs text-[#64748b]">{t('settings.autoUpdateDesc')}</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={e => {
                    setAutoUpdate(e.target.checked)
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <Mic className="w-4 h-4 text-[#64748b]" />
                <div>
                  <div className="font-medium">{t('settings.updateChannel')}</div>
                  <div className="text-xs text-[#64748b]">{t('settings.updateChannelDesc')}</div>
                </div>
              </div>
              <select
                value={updateChannel}
                onChange={e => {
                  setUpdateChannel(e.target.value as any)
                }}
                className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
              >
                <option>Stable</option>
                <option>Beta</option>
              </select>
            </div>
          </div>
        </div>

        {/* Language */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-4">{t('settings.language')}</div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-[#64748b]" />
              <div>
                <div className="font-medium">{t('settings.language')}</div>
                <div className="text-xs text-[#64748b]">{t('settings.languageDesc')}</div>
              </div>
            </div>
            <select
              value={language}
              onChange={e => handleLanguageChange(e.target.value as SupportedLanguage)}
              className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm min-w-[190px]"
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* AI Providers - each provider has its own section for model + API key */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-1">{t('settings.aiModel')}</div>
          <div className="text-xs text-[#64748b] mb-4">{t('settings.aiModel.lowLatency')}</div>

          <div className="space-y-4">
            {/* Groq */}
            <div className={`border rounded-xl p-4 transition-colors ${activeProvider === 'groq' ? 'border-[#6366f1] bg-[#f5f5ff]' : 'border-[#e2e8f0] hover:border-[#cbd5e1]'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Groq</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Fast &amp; cheap</span>
                </div>
                {activeProvider === 'groq' ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">Active</span>
                ) : (
                  <button
                    onClick={() => activateProvider('groq', groqModel)}
                    className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors"
                  >
                    Use Groq
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Model</span>
                  <select
                    value={groqModel}
                    onChange={(e) => updateProviderModel('groq', e.target.value)}
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                  >
                    <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant</option>
                    <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</option>
                    <option value="gemma2-9b-it">Gemma 2 9B IT</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Key</span>
                  <input
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-xs font-mono"
                    placeholder={keyStatus.groq ? "•••••••• (configured)" : "GROQ_API_KEY"}
                    onBlur={(e) => saveProviderKey('groq', e.target.value)}
                    defaultValue=""
                    type="password"
                  />
                </div>
              </div>
            </div>

            {/* OpenAI */}
            <div className={`border rounded-xl p-4 transition-colors ${activeProvider === 'openai' ? 'border-[#6366f1] bg-[#f5f5ff]' : 'border-[#e2e8f0] hover:border-[#cbd5e1]'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">OpenAI</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">GPT family</span>
                </div>
                {activeProvider === 'openai' ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">Active</span>
                ) : (
                  <button
                    onClick={() => activateProvider('openai', openaiModel)}
                    className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors"
                  >
                    Use OpenAI
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Model</span>
                  <select
                    value={openaiModel}
                    onChange={(e) => updateProviderModel('openai', e.target.value)}
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                  >
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="gpt-4o-mini">GPT-4o mini</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Key</span>
                  <input
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-xs font-mono"
                    placeholder={keyStatus.openai ? "•••••••• (configured)" : "OPENAI_API_KEY"}
                    onBlur={(e) => saveProviderKey('openai', e.target.value)}
                    defaultValue=""
                    type="password"
                  />
                </div>
              </div>
            </div>

            {/* Anthropic / Claude */}
            <div className={`border rounded-xl p-4 transition-colors ${activeProvider === 'anthropic' ? 'border-[#6366f1] bg-[#f5f5ff]' : 'border-[#e2e8f0] hover:border-[#cbd5e1]'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Anthropic</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Claude</span>
                </div>
                {activeProvider === 'anthropic' ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">Active</span>
                ) : (
                  <button
                    onClick={() => activateProvider('anthropic', anthropicModel)}
                    className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors"
                  >
                    Use Claude
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Model</span>
                  <select
                    value={anthropicModel}
                    onChange={(e) => updateProviderModel('anthropic', e.target.value)}
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                  >
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (2024-10)</option>
                    <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (Latest)</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Key</span>
                  <input
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-xs font-mono"
                    placeholder={keyStatus.anthropic ? "•••••••• (configured)" : "ANTHROPIC_API_KEY"}
                    onBlur={(e) => saveProviderKey('anthropic', e.target.value)}
                    defaultValue=""
                    type="password"
                  />
                </div>
              </div>
            </div>

            {/* Google Gemini */}
            <div className={`border rounded-xl p-4 transition-colors ${activeProvider === 'gemini' ? 'border-[#6366f1] bg-[#f5f5ff]' : 'border-[#e2e8f0] hover:border-[#cbd5e1]'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Google Gemini</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Multimodal</span>
                </div>
                {activeProvider === 'gemini' ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">Active</span>
                ) : (
                  <button
                    onClick={() => activateProvider('gemini', 'gemini-3.5-flash')}
                    className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors"
                  >
                    Use Gemini
                  </button>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Model</span>
                  <div className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm text-[#0f172a] font-medium">
                    gemini-3.5-flash <span className="text-[10px] ml-1 text-emerald-600">(latest)</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Key</span>
                  <input
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-xs font-mono"
                    placeholder={keyStatus.gemini ? "•••••••• (configured)" : "GEMINI_API_KEY (Google AI Studio)"}
                    onBlur={(e) => saveProviderKey('gemini', e.target.value)}
                    defaultValue=""
                    type="password"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-[#64748b]">
            {t('settings.apiKeys.help')}
          </div>
        </div>

        {/* Speech-to-Text (Real-time Transcription Provider) */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-1">Speech-to-Text</div>
          <div className="text-xs text-[#64748b] mb-4">
            Real-time transcription for Stealth Copilot. Currently powered by Deepgram (high accuracy, low latency).
          </div>

          <div className="space-y-4">
            {/* Deepgram STT Provider */}
            <div className="border border-[#6366f1] bg-[#f5f5ff] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Deepgram</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">Real-time WS</span>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">Active</span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Model</span>
                  <select
                    value={sttModel}
                    onChange={(e) => updateSttConfig('deepgram', e.target.value)}
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm"
                  >
                    <option value="nova-2">nova-2 (Recommended - general)</option>
                    <option value="nova-2-meeting">nova-2-meeting (Optimized for meetings)</option>
                    <option value="nova-2-general">nova-2-general</option>
                    <option value="nova-2-phonecall">nova-2-phonecall</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-12 text-[#64748b] text-xs">Key</span>
                  <input
                    className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-xs font-mono"
                    placeholder={keyStatus.deepgram ? "•••••••• (configured)" : "DEEPGRAM_API_KEY"}
                    onBlur={(e) => saveProviderKey('deepgram', e.target.value)}
                    defaultValue=""
                    type="password"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-[#64748b]">
            The selected STT model is used for live transcription. Deepgram keys are separate from LLM keys.
          </div>
        </div>

        {/* Stealth Mode */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-3">{t('settings.stealth.title')}</div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={stealth}
              onChange={e => {
                setStealth(e.target.checked)
              }}
            />
            <span>{t('settings.stealth.desc')}</span>
          </label>
          <p className="text-xs mt-2 text-[#64748b]">{t('settings.stealth.note')}</p>
        </div>

        {/* Audio Capture */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-3">{t('settings.audio.title')}</div>
          <div className="text-sm mb-2">{t('settings.audio.device')}</div>

          <button
            onClick={async () => {
              const { invoke } = await import('@tauri-apps/api/core');
              const devices = await invoke<string[]>('list_audio_devices');
              alert(t('settings.audio.listDevices') + ':\n' + devices.join('\n'));
            }}
            className="text-xs px-3 py-1 border rounded mb-3"
          >
            {t('settings.audio.listDevices')}
          </button>

          <div className="text-xs p-3 bg-emerald-50 border border-emerald-200 rounded space-y-2">
            <div><b>✅ Recommended: macOS Native Capture (ScreenCaptureKit)</b></div>
            <div className="text-emerald-700">
              Enable "Use system audio" in the Stealth Copilot panel. This uses Apple's native API to capture interviewer audio + your mic without installing BlackHole.
            </div>
            <div className="pt-1 text-[10px] text-emerald-600">Requires macOS 13+. Best experience on macOS 15+. You will be prompted for "Screen Recording" permission once.</div>
          </div>

          <div className="text-xs p-3 bg-amber-50 border border-amber-200 rounded space-y-2 mt-3">
            <div><b>{t('settings.audio.blackhole.title')} (fallback)</b></div>
            <ol className="list-decimal pl-4 space-y-1">
              <li>{t('settings.audio.blackhole.step1')}</li>
              <li>{t('settings.audio.blackhole.step2')}</li>
              <li>{t('settings.audio.blackhole.step3')}</li>
              <li>{t('settings.audio.blackhole.step4')}</li>
            </ol>
            <div className="pt-1">{t('settings.audio.blackhole.alt')}</div>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-3">{t('settings.shortcuts.title')}</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>{t('settings.shortcuts.toggle')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧I</span></div>
            <div className="flex justify-between"><span>{t('settings.shortcuts.capture')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧C</span></div>
            <div className="flex justify-between"><span>{t('settings.shortcuts.mock')}</span> <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded">⌘⇧M</span></div>
          </div>
        </div>

        {/* Privacy */}
        <div className="card p-6 mb-4">
          <div className="font-semibold text-[#6366f1] mb-3">{t('settings.privacy.title')}</div>
          <p className="text-sm">{t('settings.privacy.desc')}</p>
          <button onClick={() => alert('All local data cleared (demo)')} className="mt-4 text-red-600 text-sm">{t('settings.privacy.clear')}</button>
        </div>

        {/* Auto-save is enabled — no manual save required */}
        <div className="mt-6 text-xs text-[#64748b]">
          {t('settings.saved')} automatically
        </div>

        <div className="mt-8 text-xs text-[#64748b] flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" /> {t('settings.secureNote')}
        </div>

        {/* Saved indicator matching design */}
        <div className="fixed bottom-6 right-8 bg-white shadow border border-[#e2e8f0] text-sm px-4 py-2 rounded-2xl flex items-center gap-2 text-[#166534]">
          <div className="w-5 h-5 rounded-full bg-[#22c55e] flex items-center justify-center">
            <span className="text-white text-[10px]">✓</span>
          </div>
          {t('settings.saved')}
        </div>
      </div>
    </div>
  )
}
