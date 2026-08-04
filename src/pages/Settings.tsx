import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { useState, useEffect, useRef } from 'react'
import { emit } from '@tauri-apps/api/event'
import {
  Sliders,
  Cpu,
  Mic,
  Shield,
  Sun,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
  Zap,
  RefreshCw,
  Download,
  CheckCircle2,
} from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../i18n'
import { LANGUAGE_OPTIONS, SupportedLanguage, DEFAULT_LANGUAGE } from '../i18n/types'
import { saveAppSettings, type AppSettings as PersistedSettings, type SttLanguage } from '../lib/settingsStore'

type TabType = 'general' | 'ai' | 'stt' | 'shortcuts_privacy'

type ProviderKeyType = 'groq' | 'openai' | 'anthropic' | 'gemini' | 'deepgram'

interface TestResult {
  loading: boolean
  success?: boolean
  message?: string
  latencyMs?: number
}

export default function Settings() {
  const { settings, setLanguage: setStoreLanguage } = useAppStore()
  const t = useTranslation()

  const [activeTab, setActiveTab] = useState<TabType>('general')

  const [theme, setTheme] = useState<'Light' | 'Dark' | 'System'>('Light')
  const [launchAtStartup, setLaunchAtStartup] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [updateChannel, setUpdateChannel] = useState<'Stable' | 'Beta'>('Stable')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null)
  const [updateStatusMsg, setUpdateStatusMsg] = useState<string>('')
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number>(0)
  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE)
  const [aiModel, setAiModel] = useState('groq-llama-3.1')
  const [stealth, setStealth] = useState(true)

  // Per-provider model selections
  const [activeProvider, setActiveProvider] = useState<'groq' | 'openai' | 'anthropic' | 'gemini'>('groq')
  const [groqModel, setGroqModel] = useState('llama-3.1-8b-instant')
  const [openaiModel, setOpenaiModel] = useState('gpt-5.6-luna')
  const [anthropicModel, setAnthropicModel] = useState('claude-haiku-4-5')
  const [geminiModel, setGeminiModel] = useState('gemini-3.6-flash')

  // Key input values & visibility toggles
  const [keyInputs, setKeyInputs] = useState<Record<ProviderKeyType, string>>({
    groq: '',
    openai: '',
    anthropic: '',
    gemini: '',
    deepgram: '',
  })
  const [showKey, setShowKey] = useState<Record<ProviderKeyType, boolean>>({
    groq: false,
    openai: false,
    anthropic: false,
    gemini: false,
    deepgram: false,
  })

  // Key status (configured presence)
  const [keyStatus, setKeyStatus] = useState<Record<ProviderKeyType, boolean>>({
    groq: false,
    openai: false,
    anthropic: false,
    gemini: false,
    deepgram: false,
  })

  // Connectivity test status per provider
  const [testResults, setTestResults] = useState<Record<ProviderKeyType, TestResult>>({
    groq: { loading: false },
    openai: { loading: false },
    anthropic: { loading: false },
    gemini: { loading: false },
    deepgram: { loading: false },
  })

  // STT configuration
  const [sttProvider, setSttProvider] = useState<'deepgram'>('deepgram')
  const [sttModel, setSttModel] = useState('nova-3')
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>('zh-CN')

  // Auto-save toast status (temporary 2-second fade badge)
  const [showSavedToast, setShowSavedToast] = useState(false)
  const toastTimeoutRef = useRef<number | null>(null)

  const saveTimeoutRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<Partial<PersistedSettings> | null>(null)
  const isHydratedRef = useRef(false)

  const triggerSavedToast = () => {
    setShowSavedToast(true)
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current)
    toastTimeoutRef.current = window.setTimeout(() => {
      setShowSavedToast(false)
    }, 2000)
  }

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
    sttLanguage,
  })

  const persistToDisk = async (payload: Partial<PersistedSettings>) => {
    try {
      await saveAppSettings(payload as Partial<PersistedSettings>)
      triggerSavedToast()
    } catch (e) {
      console.warn('Auto-save to disk failed:', e)
    }
  }

  useEffect(() => {
    if (!isHydratedRef.current) return

    const payload = buildPayload()
    pendingSaveRef.current = payload

    useAppStore.setState((s) => ({ settings: { ...s.settings, ...payload } }))

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      const pending = pendingSaveRef.current
      pendingSaveRef.current = null
      if (pending) void persistToDisk(pending)
    }, 350)

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [
    theme, launchAtStartup, autoUpdate, updateChannel,
    language, aiModel, stealth,
    groqModel, openaiModel, anthropicModel, geminiModel,
    sttProvider, sttModel, sttLanguage,
  ])

  useEffect(() => () => {
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current)
    const pending = pendingSaveRef.current
    pendingSaveRef.current = null
    if (pending) void persistToDisk(pending)
  }, [])

  // Auto check for updates if enabled
  useEffect(() => {
    if (autoUpdate) {
      void handleCheckUpdate(true)
    }
  }, [])

  // Load key configuration status
  useEffect(() => {
    ;(async () => {
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

  // Initialize UI state from global settings
  useEffect(() => {
    if (!settings) return

    if (settings.theme) setTheme(settings.theme as any)
    if (typeof settings.launchAtStartup === 'boolean') setLaunchAtStartup(settings.launchAtStartup)
    if (typeof settings.autoUpdate === 'boolean') setAutoUpdate(settings.autoUpdate)
    if (settings.updateChannel) setUpdateChannel(settings.updateChannel as any)
    if (settings.stealthEnabled !== undefined) setStealth(!!settings.stealthEnabled)

    const lang = (settings.language as SupportedLanguage) || DEFAULT_LANGUAGE
    setLanguage(lang)

    const currentAiModel = (settings.aiModel as string) || 'groq-llama-3.1'
    setAiModel(currentAiModel)

    const aiModels = (settings.aiModels as Record<string, string>) || {}
    if (aiModels.groq) setGroqModel(aiModels.groq)
    if (aiModels.openai) setOpenaiModel(aiModels.openai)
    if (aiModels.anthropic) setAnthropicModel(aiModels.anthropic)
    setGeminiModel(aiModels.gemini || 'gemini-3.6-flash')

    if (currentAiModel.includes('gemini')) {
      setActiveProvider('gemini')
    } else if (currentAiModel.includes('claude')) {
      setActiveProvider('anthropic')
    } else if (currentAiModel.startsWith('groq:')) {
      setActiveProvider('groq')
    } else if (currentAiModel.includes('gpt') || currentAiModel.startsWith('openai')) {
      setActiveProvider('openai')
    } else {
      setActiveProvider('groq')
    }

    if (settings.sttProvider) setSttProvider(settings.sttProvider as 'deepgram')
    if (settings.sttModel) setSttModel(settings.sttModel as string)
    if (settings.sttLanguage) setSttLanguage(settings.sttLanguage as SttLanguage)
  }, [settings])

  useEffect(() => {
    if (settings) {
      queueMicrotask(() => {
        isHydratedRef.current = true
      })
    }
  }, [settings])

  const handleCheckUpdate = async (silent = false) => {
    try {
      setCheckingUpdate(true)
      if (!silent) setUpdateStatusMsg('')
      const update = await check()
      if (update) {
        setAvailableUpdate(update)
        setUpdateStatusMsg(`${t('settings.updateAvailable')}: v${update.version}`)
      } else {
        setAvailableUpdate(null)
        if (!silent) setUpdateStatusMsg(t('settings.noUpdate'))
      }
    } catch (e: any) {
      console.warn('Check update failed:', e)
      if (!silent) setUpdateStatusMsg(`${t('settings.updateFailed')}: ${e?.message || e}`)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleDownloadAndInstall = async () => {
    if (!availableUpdate) return
    try {
      setDownloading(true)
      let downloaded = 0
      let contentLength = 0
      await availableUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (contentLength) {
              setDownloadProgress(Math.round((downloaded / contentLength) * 100))
            }
            break
          case 'Finished':
            setDownloading(false)
            break
        }
      })
      await relaunch()
    } catch (e: any) {
      console.error('Download/install update failed:', e)
      setUpdateStatusMsg(`${t('settings.updateFailed')}: ${e?.message || e}`)
      setDownloading(false)
    }
  }

  const handleLanguageChange = (newLang: SupportedLanguage) => {
    setLanguage(newLang)
    setStoreLanguage(newLang)
    useAppStore.setState((s) => ({ settings: { ...s.settings, language: newLang } }))
  }

  const activateProvider = (provider: 'groq' | 'openai' | 'anthropic' | 'gemini', model: string) => {
    setActiveProvider(provider)
    const finalModel = model
    setAiModel(finalModel)

    useAppStore.setState((s) => ({
      settings: { ...s.settings, aiModel: finalModel },
    }))
  }

  const updateProviderModel = (provider: 'groq' | 'openai' | 'anthropic' | 'gemini', model: string) => {
    if (provider === 'groq') setGroqModel(model)
    else if (provider === 'openai') setOpenaiModel(model)
    else if (provider === 'anthropic') setAnthropicModel(model)
    else setGeminiModel(model)

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
  }

  const saveProviderKey = async (provider: ProviderKeyType, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const keyMap = {
      groq: 'GROQ_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY',
    } as const

    const { setApiKey } = await import('../lib/keyStore')
    const { clearKeyCache } = await import('../lib/llm')
    await setApiKey(keyMap[provider], trimmed)
    clearKeyCache()

    setKeyStatus((prev) => ({ ...prev, [provider]: true }))
    triggerSavedToast()
  }

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
  }

  // --- API Connectivity Testing ---
  const testConnection = async (provider: ProviderKeyType) => {
    setTestResults((prev) => ({ ...prev, [provider]: { loading: true } }))

    const { getApiKey } = await import('../lib/keyStore')
    const keyMap = {
      groq: 'GROQ_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY',
    } as const

    let targetKey = keyInputs[provider].trim()
    if (!targetKey) {
      const stored = await getApiKey(keyMap[provider])
      if (stored) targetKey = stored
    }

    if (!targetKey) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { loading: false, success: false, message: t('settings.test.promptKey') },
      }))
      return
    }

    const start = performance.now()
    try {
      let res: Response
      if (provider === 'groq') {
        res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${targetKey}` },
        })
      } else if (provider === 'openai') {
        res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${targetKey}` },
        })
      } else if (provider === 'anthropic') {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': targetKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
        })
      } else if (provider === 'gemini') {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${targetKey}`)
      } else {
        // Deepgram
        res = await fetch('https://api.deepgram.com/v1/projects', {
          headers: { Authorization: `Token ${targetKey}` },
        })
      }

      const elapsed = Math.round(performance.now() - start)

      if (res.ok) {
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            loading: false,
            success: true,
            latencyMs: elapsed,
            message: `${elapsed}ms - ${t('settings.test.connected')}`,
          },
        }))
      } else {
        let errDetail = ''
        try {
          const json = await res.json()
          errDetail = json?.error?.message || json?.message || res.statusText
        } catch {
          errDetail = `HTTP ${res.status}`
        }
        setTestResults((prev) => ({
          ...prev,
          [provider]: {
            loading: false,
            success: false,
            message: `${t('settings.test.failed')}: ${errDetail || t('settings.test.invalidKey')}`,
          },
        }))
      }
    } catch (e: any) {
      setTestResults((prev) => ({
        ...prev,
        [provider]: {
          loading: false,
          success: false,
          message: `${t('settings.test.failed')}: ${e?.message || t('settings.test.networkError')}`,
        },
      }))
    }
  }

  const renderKeyInputRow = (
    provider: ProviderKeyType,
    placeholderName: string,
  ) => {
    const isConfigured = keyStatus[provider]
    const testResult = testResults[provider]
    const isVisible = showKey[provider]

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Key</span>
          <div className="relative flex-1">
            <input
              type={isVisible ? 'text' : 'password'}
              className="w-full bg-white border border-[#e2e8f0] rounded-lg pl-3 pr-9 py-1 text-xs font-mono dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
              placeholder={isConfigured ? '•••••••• (configured)' : placeholderName}
              value={keyInputs[provider]}
              onChange={(e) => {
                const val = e.target.value
                setKeyInputs((prev) => ({ ...prev, [provider]: val }))
              }}
              onBlur={(e) => saveProviderKey(provider, e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569] dark:hover:text-[#f8fafc]"
              title={isVisible ? 'Hide key' : 'Show key'}
            >
              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void testConnection(provider)}
            disabled={testResult.loading}
            className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg border border-[#e2e8f0] text-[#475569] bg-white hover:bg-[#f8fafc] hover:border-[#cbd5e1] disabled:opacity-50 transition-colors dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#cbd5e1] dark:hover:bg-[#1e293b]"
          >
            {testResult.loading ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-[#6366f1]" />
                <span>{t('settings.test.testing')}</span>
              </>
            ) : (
              <>
                <Zap className="w-3 h-3 text-[#6366f1]" />
                <span>{t('settings.test.testConnection')}</span>
              </>
            )}
          </button>
        </div>

        {testResult.message && (
          <div className="pl-14 flex items-center gap-1.5 text-xs">
            {testResult.success ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="w-full max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight mb-1">{t('settings.title')}</h1>
            <p className="text-[#475569] dark:text-[#94a3b8]">{t('settings.description')}</p>
          </div>

          {/* Auto-save toast badge (fades after 2s) */}
          <div
            className={`transition-opacity duration-300 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800 ${
              showSavedToast ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] font-bold">
              ✓
            </div>
            <span>{t('settings.saved')}</span>
          </div>
        </div>

        {/* Sidebar + Main Content Layout */}
        <div className="flex gap-8 items-start">
          {/* Left Navigation Sidebar */}
          <nav className="w-56 shrink-0 space-y-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'general'
                  ? 'bg-[#6366f1] text-white shadow-sm'
                  : 'text-[#475569] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>{t('settings.tab.general')}</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'ai'
                  ? 'bg-[#6366f1] text-white shadow-sm'
                  : 'text-[#475569] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]'
              }`}
            >
              <Cpu className="w-4 h-4" />
              <span>{t('settings.tab.ai')}</span>
            </button>

            <button
              onClick={() => setActiveTab('stt')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'stt'
                  ? 'bg-[#6366f1] text-white shadow-sm'
                  : 'text-[#475569] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>{t('settings.tab.stt')}</span>
            </button>

            <button
              onClick={() => setActiveTab('shortcuts_privacy')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${
                activeTab === 'shortcuts_privacy'
                  ? 'bg-[#6366f1] text-white shadow-sm'
                  : 'text-[#475569] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>{t('settings.tab.shortcutsPrivacy')}</span>
            </button>
          </nav>

          {/* Right Main Content Panel */}
          <div className="flex-1 space-y-6">
            {/* TAB 1: General */}
            {activeTab === 'general' && (
              <>
                {/* Application Card */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-4">{t('settings.application')}</div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Sun className="w-4 h-4 text-[#64748b] dark:text-[#94a3b8]" />
                        <div>
                          <div className="font-medium">{t('settings.theme')}</div>
                          <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{t('settings.themeDesc')}</div>
                        </div>
                      </div>
                      <select
                        value={theme}
                        onChange={(e) => {
                          const val = e.target.value as 'Light' | 'Dark' | 'System'
                          setTheme(val)
                          useAppStore.setState((s) => ({ settings: { ...s.settings, theme: val } }))
                          void persistToDisk({ theme: val }).then(() =>
                            emit('app-theme-changed', val).catch((error) => console.warn('Theme sync failed:', error))
                          )
                        }}
                        className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                      >
                        <option value="Light">{t('settings.theme.light')}</option>
                        <option value="Dark">{t('settings.theme.dark')}</option>
                        <option value="System">{t('settings.theme.system')}</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Mic className="w-4 h-4 text-[#64748b] dark:text-[#94a3b8]" />
                        <div>
                          <div className="font-medium">{t('settings.launchAtStartup')}</div>
                          <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{t('settings.launchAtStartupDesc')}</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={launchAtStartup}
                          onChange={(e) => setLaunchAtStartup(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1] dark:bg-[#334155]"></div>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Updates Card */}
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold text-[#6366f1]">{t('settings.updates')}</div>
                    <button
                      type="button"
                      onClick={() => void handleCheckUpdate(false)}
                      disabled={checkingUpdate || downloading}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#e2e8f0] text-[#475569] bg-white hover:bg-[#f8fafc] hover:border-[#cbd5e1] disabled:opacity-50 transition-colors dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#cbd5e1] dark:hover:bg-[#1e293b]"
                    >
                      {checkingUpdate ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6366f1]" />
                          <span>{t('settings.checkingUpdate')}</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 text-[#6366f1]" />
                          <span>{t('settings.checkUpdate')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-4">
                    {updateStatusMsg && (
                      <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e2e8f0] dark:bg-[#0f172a] dark:border-[#334155]">
                        <div className="text-xs font-medium text-[#334155] dark:text-[#cbd5e1] flex items-center gap-2">
                          {availableUpdate ? <Download className="w-4 h-4 text-[#6366f1]" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                          <span>{updateStatusMsg}</span>
                        </div>
                        {availableUpdate && (
                          <button
                            type="button"
                            onClick={() => void handleDownloadAndInstall()}
                            disabled={downloading}
                            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[#6366f1] text-white hover:bg-[#4f46e5] disabled:opacity-50 transition-colors"
                          >
                            {downloading ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                                <span>{downloadProgress > 0 ? `${downloadProgress}%` : t('settings.downloadingUpdate')}</span>
                              </>
                            ) : (
                              <span>{t('settings.downloadAndInstall')}</span>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <RefreshCw className="w-4 h-4 text-[#64748b] dark:text-[#94a3b8]" />
                        <div>
                          <div className="font-medium">{t('settings.autoUpdate')}</div>
                          <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{t('settings.autoUpdateDesc')}</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoUpdate}
                          onChange={(e) => setAutoUpdate(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-[#e2e8f0] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#6366f1] dark:bg-[#334155]"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Sliders className="w-4 h-4 text-[#64748b] dark:text-[#94a3b8]" />
                        <div>
                          <div className="font-medium">{t('settings.updateChannel')}</div>
                          <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{t('settings.updateChannelDesc')}</div>
                        </div>
                      </div>
                      <select
                        value={updateChannel}
                        onChange={(e) => setUpdateChannel(e.target.value as any)}
                        className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                      >
                        <option value="Stable">Stable</option>
                        <option value="Beta">Beta</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Language Card */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-4">{t('settings.language')}</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className="w-4 h-4 text-[#64748b] dark:text-[#94a3b8]" />
                      <div>
                        <div className="font-medium">{t('settings.language')}</div>
                        <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{t('settings.languageDesc')}</div>
                      </div>
                    </div>
                    <select
                      value={language}
                      onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                      className="bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm min-w-[190px] dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                    >
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Stealth Mode */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-3">{t('settings.stealth.title')}</div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={stealth}
                      onChange={(e) => setStealth(e.target.checked)}
                    />
                    <span>{t('settings.stealth.desc')}</span>
                  </label>
                  <p className="text-xs mt-2 text-[#64748b] dark:text-[#94a3b8]">{t('settings.stealth.note')}</p>
                </div>
              </>
            )}

            {/* TAB 2: AI Model & Key */}
            {activeTab === 'ai' && (
              <div className="card p-6">
                <div className="font-semibold text-[#6366f1] mb-1">{t('settings.aiModel')}</div>
                <div className="text-xs text-[#64748b] dark:text-[#94a3b8] mb-4">{t('settings.aiModel.lowLatency')}</div>

                <div className="space-y-4">
                  {/* Groq */}
                  <div
                    className={`border rounded-xl p-4 transition-colors ${
                      activeProvider === 'groq'
                        ? 'border-[#6366f1] bg-[#f5f5ff] dark:bg-[#1e1b4b]'
                        : 'border-[#e2e8f0] hover:border-[#cbd5e1] dark:border-[#334155] dark:hover:border-[#64748b]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Groq</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          Fast &amp; cheap
                        </span>
                      </div>
                      {activeProvider === 'groq' ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('groq', groqModel)}
                          className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors dark:border-[#818cf8] dark:text-[#a5b4fc] dark:hover:bg-[#312e81]"
                        >
                          Use Groq
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Model</span>
                        <select
                          value={groqModel}
                          onChange={(e) => updateProviderModel('groq', e.target.value)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="llama-3.1-8b-instant">Llama 3.1 8B Instant</option>
                          <option value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</option>
                          <option value="groq:openai/gpt-oss-20b">GPT-OSS 20B</option>
                        </select>
                      </div>

                      {renderKeyInputRow('groq', 'GROQ_API_KEY')}
                    </div>
                  </div>

                  {/* OpenAI */}
                  <div
                    className={`border rounded-xl p-4 transition-colors ${
                      activeProvider === 'openai'
                        ? 'border-[#6366f1] bg-[#f5f5ff] dark:bg-[#1e1b4b]'
                        : 'border-[#e2e8f0] hover:border-[#cbd5e1] dark:border-[#334155] dark:hover:border-[#64748b]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">OpenAI</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          GPT family
                        </span>
                      </div>
                      {activeProvider === 'openai' ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('openai', openaiModel)}
                          className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors dark:border-[#818cf8] dark:text-[#a5b4fc] dark:hover:bg-[#312e81]"
                        >
                          Use OpenAI
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Model</span>
                        <select
                          value={openaiModel}
                          onChange={(e) => updateProviderModel('openai', e.target.value)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
                          <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
                          <option value="gpt-5.6-sol">GPT-5.6 Sol</option>
                        </select>
                      </div>

                      {renderKeyInputRow('openai', 'OPENAI_API_KEY')}
                    </div>
                  </div>

                  {/* Anthropic / Claude */}
                  <div
                    className={`border rounded-xl p-4 transition-colors ${
                      activeProvider === 'anthropic'
                        ? 'border-[#6366f1] bg-[#f5f5ff] dark:bg-[#1e1b4b]'
                        : 'border-[#e2e8f0] hover:border-[#cbd5e1] dark:border-[#334155] dark:hover:border-[#64748b]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Anthropic</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          Claude
                        </span>
                      </div>
                      {activeProvider === 'anthropic' ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('anthropic', anthropicModel)}
                          className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors dark:border-[#818cf8] dark:text-[#a5b4fc] dark:hover:bg-[#312e81]"
                        >
                          Use Claude
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Model</span>
                        <select
                          value={anthropicModel}
                          onChange={(e) => updateProviderModel('anthropic', e.target.value)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                          <option value="claude-sonnet-5">Claude Sonnet 5</option>
                        </select>
                      </div>

                      {renderKeyInputRow('anthropic', 'ANTHROPIC_API_KEY')}
                    </div>
                  </div>

                  {/* Google Gemini */}
                  <div
                    className={`border rounded-xl p-4 transition-colors ${
                      activeProvider === 'gemini'
                        ? 'border-[#6366f1] bg-[#f5f5ff] dark:bg-[#1e1b4b]'
                        : 'border-[#e2e8f0] hover:border-[#cbd5e1] dark:border-[#334155] dark:hover:border-[#64748b]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Google Gemini</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          Multimodal
                        </span>
                      </div>
                      {activeProvider === 'gemini' ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">
                          Active
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('gemini', geminiModel)}
                          className="text-xs px-3 py-1 rounded-lg border border-[#6366f1] text-[#6366f1] hover:bg-[#6366f1] hover:text-white transition-colors dark:border-[#818cf8] dark:text-[#a5b4fc] dark:hover:bg-[#312e81]"
                        >
                          Use Gemini
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Model</span>
                        <select
                          value={geminiModel}
                          onChange={(e) => updateProviderModel('gemini', e.target.value)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        </select>
                      </div>

                      {renderKeyInputRow('gemini', 'GEMINI_API_KEY (Google AI Studio)')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-[11px] text-[#64748b] dark:text-[#94a3b8]">{t('settings.apiKeys.help')}</div>
              </div>
            )}

            {/* TAB 3: STT Speech-to-Text */}
            {activeTab === 'stt' && (
              <div className="card p-6">
                <div className="font-semibold text-[#6366f1] mb-1">Speech-to-Text</div>
                <div className="text-xs text-[#64748b] dark:text-[#94a3b8] mb-4">
                  Real-time transcription for Stealth Copilot. Currently powered by Deepgram (high accuracy, low latency).
                </div>

                <div className="space-y-4">
                  <div className="border border-[#6366f1] bg-[#f5f5ff] rounded-xl p-4 dark:bg-[#1e1b4b]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Deepgram</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                          Real-time WS
                        </span>
                      </div>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#6366f1] text-white">
                        Active
                      </span>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Model</span>
                        <select
                          value={sttModel}
                          onChange={(e) => updateSttConfig('deepgram', e.target.value)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="nova-3">nova-3 (Recommended - multilingual)</option>
                          <option value="nova-2">nova-2 (general)</option>
                          <option value="nova-2-meeting">nova-2-meeting (Optimized for meetings)</option>
                          <option value="nova-2-general">nova-2-general</option>
                          <option value="nova-2-phonecall">nova-2-phonecall</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-12 text-[#64748b] dark:text-[#94a3b8] text-xs font-medium">Language</span>
                        <select
                          aria-label="Deepgram language"
                          value={sttLanguage}
                          onChange={(e) => setSttLanguage(e.target.value as SttLanguage)}
                          className="flex-1 bg-white border border-[#e2e8f0] rounded-lg px-3 py-1 text-sm dark:bg-[#0f172a] dark:text-[#f8fafc] dark:border-[#334155]"
                        >
                          <option value="zh-CN">简体中文</option>
                          <option value="zh-TW">繁體中文</option>
                          <option value="en-US">English</option>
                          <option value="multi">{t('settings.stt.langMulti')}</option>
                        </select>
                      </div>

                      {renderKeyInputRow('deepgram', 'DEEPGRAM_API_KEY')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-[11px] text-[#64748b] dark:text-[#94a3b8]">
                  The selected STT model is used for live transcription. Deepgram keys are separate from LLM keys.
                </div>
              </div>
            )}

            {/* TAB 4: Shortcuts & Privacy */}
            {activeTab === 'shortcuts_privacy' && (
              <>
                {/* Audio Capture */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-3">{t('settings.audio.title')}</div>
                  <div className="text-sm mb-2">{t('settings.audio.device')}</div>

                  <button
                    onClick={async () => {
                      const { invoke } = await import('@tauri-apps/api/core')
                      const devices = await invoke<string[]>('list_audio_devices')
                      alert(t('settings.audio.listDevices') + ':\n' + devices.join('\n'))
                    }}
                    className="text-xs px-3 py-1 border border-[#e2e8f0] rounded mb-3 hover:bg-[#f8fafc] transition-colors dark:border-[#334155] dark:hover:bg-[#1e293b]"
                  >
                    {t('settings.audio.listDevices')}
                  </button>

                  <div className="text-xs p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2 dark:border-emerald-900 dark:bg-emerald-950/60">
                    <div>
                      <b>✅ macOS system audio: AudioTee</b>
                    </div>
                    <div className="text-emerald-700 dark:text-emerald-300">
                      The bundled, pinned AudioTee sidecar captures the default system output. Microphone capture remains a separate option.
                    </div>
                    <div>
                      <b>✅ Windows system audio: WASAPI loopback</b>
                    </div>
                    <div className="text-emerald-700 dark:text-emerald-300">
                      Shared-mode loopback captures the default render endpoint mix. Microphone capture remains a separate option.
                    </div>
                    <div className="pt-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                      macOS requires 14.2+. Windows uses the default output device for the active session. Unsupported platforms use microphone-only mode.
                    </div>
                  </div>
                </div>

                {/* Keyboard Shortcuts */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-3">{t('settings.shortcuts.title')}</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>{t('settings.shortcuts.toggle')}</span>
                      <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded dark:bg-[#0f172a]">
                        ⌘⇧I
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settings.shortcuts.capture')}</span>
                      <span className="font-mono text-xs bg-[#f1f5f9] px-1.5 py-px rounded dark:bg-[#0f172a]">
                        ⌘⇧C
                      </span>
                    </div>
                  </div>
                </div>

                {/* Privacy */}
                <div className="card p-6">
                  <div className="font-semibold text-[#6366f1] mb-3">{t('settings.privacy.title')}</div>
                  <p className="text-sm">{t('settings.privacy.desc')}</p>
                  <button
                    onClick={() => alert('All local data cleared (demo)')}
                    className="mt-4 text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                  >
                    {t('settings.privacy.clear')}
                  </button>
                </div>
              </>
            )}

            <div className="mt-8 text-xs text-[#64748b] dark:text-[#94a3b8] flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> {t('settings.secureNote')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
