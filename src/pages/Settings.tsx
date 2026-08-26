import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { invoke } from '@tauri-apps/api/core'
import { useState, useEffect, useRef } from 'react'
import { emit } from '@tauri-apps/api/event'
import {
  Sliders,
  Cpu,
  Mic,
  Shield,
  Sun,
  Moon,
  Laptop,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Loader2,
  Zap,
  RefreshCw,
  Download,
  CheckCircle2,
  HardDrive,
  History as HistoryIcon,
  Trash2,
} from 'lucide-react'
import { KeyRound } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../i18n'
import { LANGUAGE_OPTIONS, SupportedLanguage, DEFAULT_LANGUAGE } from '../i18n/types'
import {
  APPLE_STT_MODEL,
  GEMINI_LIVE_TRANSLATE_MODEL,
  saveAppSettings,
  type AppSettings as PersistedSettings,
  type SttLanguage,
  type SttProvider,
} from '../lib/settingsStore'
import type { SettingsTab } from '../lib/readiness'
import type { Page } from '../lib/navigation'
import { deriveLicenseState, parseLicensePayload } from '../lib/license'
import { saveSetting } from '../lib/db'

type TabType = SettingsTab

type ProviderKeyType = 'groq' | 'openai' | 'anthropic' | 'gemini' | 'deepgram'

interface TestResult {
  loading: boolean
  success?: boolean
  message?: string
  latencyMs?: number
}

interface RecordingStorageUsage {
  bytes: number
  fileCount: number
}

interface HistoryStorageUsage {
  bytes: number
  recordCount: number
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${Number(value.toFixed(1))} ${units[unitIndex]}`
}

export default function Settings({
  initialTab = 'general',
  returnTo,
  onReturn,
}: {
  initialTab?: SettingsTab
  returnTo?: Page
  onReturn?: (page: Page) => void
} = {}) {
  const { settings, copilot, setLanguage: setStoreLanguage } = useAppStore()
  const t = useTranslation()

  const [activeTab, setActiveTab] = useState<TabType>(initialTab)

  const [theme, setTheme] = useState<'Light' | 'Dark' | 'System'>('Light')
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
  const [sttProvider, setSttProvider] = useState<SttProvider>('deepgram')
  const [sttModel, setSttModel] = useState('nova-3')
  const [sttLanguage, setSttLanguage] = useState<SttLanguage>('zh-CN')
  const [appleStt, setAppleStt] = useState<{ available: boolean; reason: string | null }>({ available: false, reason: null })
  const [appleTest, setAppleTest] = useState<TestResult>({ loading: false })

  const [recordingStorage, setRecordingStorage] = useState<RecordingStorageUsage>({ bytes: 0, fileCount: 0 })
  const [historyStorage, setHistoryStorage] = useState<HistoryStorageUsage>({ bytes: 0, recordCount: 0 })
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageAction, setStorageAction] = useState<'recordings' | 'history' | null>(null)
  const [storageError, setStorageError] = useState('')
  const [storageNotice, setStorageNotice] = useState('')

  // Auto-save toast status (temporary 2-second fade badge)
  const [showSavedToast, setShowSavedToast] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const [licenseRaw, setLicenseRaw] = useState('')
  const [licenseNotice, setLicenseNotice] = useState('')
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

  const refreshStorageUsage = async (preserveError = false) => {
    setStorageLoading(true)
    if (!preserveError) setStorageError('')
    try {
      const { loadHistoryStorageUsage } = await import('../lib/db')
      const [recordings, history] = await Promise.all([
        invoke<RecordingStorageUsage>('get_recording_storage_usage'),
        loadHistoryStorageUsage(),
      ])
      setRecordingStorage(recordings)
      setHistoryStorage(history)
    } catch (error) {
      setStorageError(t('settings.storage.loadFailed'))
    } finally {
      setStorageLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'storage') {
      setStorageNotice('')
      void refreshStorageUsage()
    }
  }, [activeTab])

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab)
  }, [initialTab])

  const handleClearRecordings = async () => {
    if (copilot.phase === 'starting' || copilot.phase === 'listening' || copilot.phase === 'stopping') {
      setStorageNotice('')
      setStorageError(t('settings.storage.recordingActive'))
      return
    }
    if (!window.confirm(t('settings.storage.clearRecordingsConfirm'))) return
    setStorageAction('recordings')
    setStorageError('')
    setStorageNotice('')
    try {
      const { clearInterviewRecordingPaths } = await import('../lib/db')
      await invoke<RecordingStorageUsage>('clear_audio_recordings')
      await clearInterviewRecordingPaths()
      const state = useAppStore.getState()
      state.loadHistory(state.history.map((record) => ({ ...record, recordingPath: null })))
      setStorageNotice(t('settings.storage.recordingsCleared'))
    } catch (error) {
      const message = String(error)
      setStorageError(message.includes('recording-active')
        ? t('settings.storage.recordingActive')
        : `${t('settings.storage.clearRecordingsFailed')}: ${message}`)
    } finally {
      await refreshStorageUsage(true)
      setStorageAction(null)
    }
  }

  const handleClearHistory = async () => {
    if (!window.confirm(t('settings.storage.clearHistoryConfirm'))) return
    setStorageAction('history')
    setStorageError('')
    setStorageNotice('')
    try {
      const { clearInterviewHistory } = await import('../lib/db')
      await clearInterviewHistory()
      useAppStore.getState().loadHistory([])
      setStorageNotice(t('settings.storage.historyCleared'))
    } catch (error) {
      setStorageError(`${t('settings.storage.clearHistoryFailed')}: ${String(error)}`)
    } finally {
      await refreshStorageUsage(true)
      setStorageAction(null)
    }
  }

  const buildPayload = () => ({
    theme,
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
      setSaveError('')
      triggerSavedToast()
    } catch (e) {
      console.warn('Auto-save to disk failed:', e)
      setSaveError(t('settings.saveFailed'))
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
    theme, autoUpdate, updateChannel,
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

  useEffect(() => {
    if (!settingsHydrated || !autoUpdate) return
    void handleCheckUpdate(true)
  }, [settingsHydrated, autoUpdate])

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

    if (settings.sttProvider) setSttProvider(settings.sttProvider as SttProvider)
    if (settings.sttModel) setSttModel(settings.sttModel as string)
    if (settings.sttLanguage) setSttLanguage(settings.sttLanguage as SttLanguage)
  }, [settings])

  useEffect(() => {
    if (settings) {
      queueMicrotask(() => {
        isHydratedRef.current = true
        setSettingsHydrated(true)
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

  const saveProviderKey = async (provider: ProviderKeyType, value: string, { clear = false } = {}) => {
    const trimmed = value.trim()
    if (!trimmed && !clear) return
    const keyMap = {
      groq: 'GROQ_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      deepgram: 'DEEPGRAM_API_KEY',
    } as const
    try {
      const { setApiKey } = await import('../lib/keyStore')
      const { clearKeyCache } = await import('../lib/llm')
      await setApiKey(keyMap[provider], trimmed)
      clearKeyCache()
      setKeyStatus((prev) => ({ ...prev, [provider]: Boolean(trimmed) }))
      setSaveError('')
      triggerSavedToast()
    } catch (e) {
      console.warn('Save API key failed:', e)
      setSaveError(t('settings.saveFailed'))
    }
  }

  const updateSttConfig = (provider: SttProvider, model: string) => {
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
  const testConnection = async (provider: ProviderKeyType, useGeminiLive = false) => {
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
      let res: Response | undefined
      if (provider === 'gemini' && useGeminiLive) {
        const { testGeminiLiveConnection } = await import('../lib/llm')
        await testGeminiLiveConnection(targetKey, sttLanguage, language)
      } else if (provider === 'deepgram') {
        const { testDeepgramConnection } = await import('../lib/llm')
        await testDeepgramConnection(targetKey)
      } else if (provider === 'groq') {
        res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${targetKey}` },
          signal: AbortSignal.timeout(12_000),
        })
      } else if (provider === 'openai') {
        res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${targetKey}` },
          signal: AbortSignal.timeout(12_000),
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
          signal: AbortSignal.timeout(12_000),
        })
      } else {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${targetKey}`, {
          signal: AbortSignal.timeout(12_000),
        })
      }

      const elapsed = Math.round(performance.now() - start)

      if (!res || res.ok) {
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
    useGeminiLive = false,
  ) => {
    const isConfigured = keyStatus[provider]
    const testResult = testResults[provider]
    const isVisible = showKey[provider]

    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.keyLabel')}</span>
          <div className="relative flex-1">
            <input
              type={isVisible ? 'text' : 'password'}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] py-1 pl-3 pr-9 text-xs font-mono text-[var(--text-main)]"
              aria-label={t('settings.keyLabel')}
              placeholder={isConfigured ? t('settings.keyConfigured') : placeholderName}
              value={keyInputs[provider]}
              onChange={(e) => {
                const val = e.target.value
                setKeyInputs((prev) => ({ ...prev, [provider]: val }))
              }}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (!next) return
                void saveProviderKey(provider, next)
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
              title={isVisible ? t('settings.hideKey') : t('settings.showKey')}
              aria-label={isVisible ? t('settings.hideKey') : t('settings.showKey')}
            >
              {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {isConfigured && (
            <button
              type="button"
              onClick={() => {
                setKeyInputs((prev) => ({ ...prev, [provider]: '' }))
                void saveProviderKey(provider, '', { clear: true })
              }}
              className="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            >
              {t('settings.clearKey')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void testConnection(provider, useGeminiLive)}
            disabled={testResult.loading}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50"
          >
            {testResult.loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t('settings.test.testing')}</span>
              </>
            ) : (
              <>
                <Zap className="h-3 w-3" />
                <span>{t('settings.test.testConnection')}</span>
              </>
            )}
          </button>
        </div>

        {testResult.message && (
          <div role="status" className="pl-14 flex items-center gap-1.5 text-xs">
            {testResult.success ? (
              <span className="flex items-center gap-1 font-medium text-[var(--success)]">
                <Check className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            ) : (
              <span className="flex items-center gap-1 font-medium text-[var(--danger)]">
                <AlertCircle className="w-3.5 h-3.5" />
                {testResult.message}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }


  const handleClearLocalData = async () => {
    const ok = window.confirm(t('settings.privacy.clearConfirm') || 'Clear all local interview history, settings, and API keys?')
    if (!ok) return
    try {
      const { clearAllLocalData } = await import('../lib/db')
      const { clearApiKeys } = await import('../lib/keyStore')
      const { clearKeyCache } = await import('../lib/llm')
      const { clearResumeWorkspace } = await import('../lib/resumeWorkspaceStore')
      await clearAllLocalData()
      await clearApiKeys()
      clearKeyCache()
      await clearResumeWorkspace()
      useAppStore.getState().loadHistory([])
      useAppStore.getState().clearResumeWorkspace()
      useAppStore.getState().setSettings({
        theme: 'Light',
        autoUpdate: true,
        updateChannel: 'Stable',
        stealthEnabled: true,
        aiModel: 'groq-llama-3.1',
        language: DEFAULT_LANGUAGE,
        sttProvider: 'deepgram',
        sttModel: 'nova-3',
        sttLanguage: 'zh-CN',
      })
      setKeyStatus({ groq: false, openai: false, anthropic: false, gemini: false, deepgram: false })
      setKeyInputs({ groq: '', openai: '', anthropic: '', gemini: '', deepgram: '' })
      triggerSavedToast()
    } catch (e) {
      console.warn('Clear local data failed:', e)
      alert(String(e))
    }
  }


  useEffect(() => {
    let cancelled = false
    void invoke<{ available: boolean; reason?: string | null }>('get_apple_stt_status')
      .then((status) => {
        if (!cancelled) setAppleStt({ available: Boolean(status?.available), reason: status?.reason || null })
      })
      .catch((error) => {
        if (!cancelled) setAppleStt({ available: false, reason: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [])

  const shortcutMod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'

  return (
    <div className="h-full overflow-auto bg-[var(--bg-app)] p-6 text-[var(--text-main)] sm:p-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t(`settings.heading.${activeTab}`)}</h1>
            <p className="text-sm text-[var(--text-muted)]">{t('settings.description')}</p>
          </div>

          {/* Auto-save toast badge (fades after 2s) */}
          <div className="flex items-center gap-3">
            {returnTo && onReturn && (
              <button
                type="button"
                onClick={() => onReturn(returnTo)}
                className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]"
              >
                {t('settings.returnToTask')}
              </button>
            )}
            {saveError && (
              <div role="alert" className="text-xs text-[var(--danger)]">{saveError}</div>
            )}
            <div
              role="status"
              className={`flex items-center gap-1.5 text-xs text-[var(--success)] transition-opacity duration-300 ${
                showSavedToast ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <span aria-hidden="true">✓</span>
              <span>{t('settings.saved')}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-start gap-6 lg:flex-row lg:gap-8">
          <nav className="flex w-full gap-1 overflow-x-auto border-b border-[var(--border-color)] pb-2 lg:w-52 lg:shrink-0 lg:flex-col lg:border-b-0 lg:pb-0">
            <button
              onClick={() => setActiveTab('general')} aria-current={activeTab === 'general' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'general'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>{t('settings.tab.general')}</span>
            </button>

            <button
              onClick={() => setActiveTab('ai')} aria-current={activeTab === 'ai' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'ai'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <Cpu className="w-4 h-4" />
              <span>{t('settings.tab.ai')}</span>
            </button>

            <button
              onClick={() => setActiveTab('stt')} aria-current={activeTab === 'stt' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'stt'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>{t('settings.tab.stt')}</span>
            </button>

            <button
              onClick={() => setActiveTab('shortcuts_privacy')} aria-current={activeTab === 'shortcuts_privacy' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'shortcuts_privacy'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>{t('settings.tab.shortcutsPrivacy')}</span>
            </button>

            <button
              onClick={() => setActiveTab('storage')} aria-current={activeTab === 'storage' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'storage'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>{t('settings.tab.storage')}</span>
            </button>
            <button
              onClick={() => setActiveTab('license')} aria-current={activeTab === 'license' ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                activeTab === 'license'
                  ? 'bg-[var(--bg-subtle)] text-[var(--text-main)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>{t('settings.tab.license')}</span>
            </button>
          </nav>

          <div className="w-full min-w-0 flex-1 space-y-4">
            {/* TAB 1: General */}
            {activeTab === 'general' && (
              <>
                {/* Application Card */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-4 font-semibold">{t('settings.application')}</div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Sun className="h-4 w-4 text-[var(--text-muted)]" />
                        <div>
                          <div className="font-medium">{t('settings.theme')}</div>
                          <div className="text-xs text-[var(--text-muted)]">{t('settings.themeDesc')}</div>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-1">
                      {[
                        { id: 'Light', label: t('settings.theme.light'), icon: Sun },
                        { id: 'Dark', label: t('settings.theme.dark'), icon: Moon },
                        { id: 'System', label: t('settings.theme.system'), icon: Laptop },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            const val = opt.id as 'Light' | 'Dark' | 'System'
                            setTheme(val)
                            useAppStore.setState((s) => ({ settings: { ...s.settings, theme: val } }))
                            void persistToDisk({ theme: val }).then(() =>
                              emit('app-theme-changed', val).catch((error) => console.warn('Theme sync failed:', error))
                            )
                          }}
                          className={`flex flex-col items-center gap-2 rounded-lg border p-3.5 text-center transition-all ${
                            theme === opt.id
                              ? 'border-[var(--action)] bg-[var(--bg-subtle)] font-medium text-[var(--text-main)] shadow-sm'
                              : 'border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]'
                          }`}
                        >
                          <opt.icon className="h-5 w-5" />
                          <span className="text-xs font-semibold">{opt.label}</span>
                        </button>
                      ))}
                    </div>

                  </div>
                </div>

                {/* Updates Card */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="font-semibold">{t('settings.updates')}</div>
                    <button
                      type="button"
                      onClick={() => void handleCheckUpdate(false)}
                      disabled={checkingUpdate || downloading}
                      className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50"
                    >
                      {checkingUpdate ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{t('settings.checkingUpdate')}</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5" />
                          <span>{t('settings.checkUpdate')}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-4">
                    {updateStatusMsg && (
                      <div className="flex items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          {availableUpdate ? <Download className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
                          <span>{updateStatusMsg}</span>
                        </div>
                        {availableUpdate && (
                          <button
                            type="button"
                            onClick={() => void handleDownloadAndInstall()}
                            disabled={downloading}
                            className="flex items-center gap-1.5 rounded-md bg-[var(--action)] px-3 py-1.5 text-xs text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                          >
                            {downloading ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
                        <RefreshCw className="h-4 w-4 text-[var(--text-muted)]" />
                        <div>
                          <div className="font-medium">{t('settings.autoUpdate')}</div>
                          <div className="text-xs text-[var(--text-muted)]">{t('settings.autoUpdateDesc')}</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoUpdate}
                          onChange={(e) => setAutoUpdate(e.target.checked)}
                          className="sr-only peer"
                          aria-label={t('settings.autoUpdate')}
                        />
                        <div className="peer h-5 w-9 rounded-full bg-[var(--bg-subtle)] after:absolute after:left-[1px] after:top-[1px] after:h-4 after:w-4 after:rounded-full after:border after:border-[var(--border-color)] after:bg-[var(--bg-surface)] after:content-[''] after:transition-all peer-checked:bg-[var(--action)] peer-checked:after:translate-x-full peer-focus:outline-none"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-3">
                        <Sliders className="h-4 w-4 text-[var(--text-muted)]" />
                        <div>
                          <div className="font-medium">{t('settings.updateChannel')}</div>
                          <div className="text-xs text-[var(--text-muted)]">{t('settings.updateChannelDesc')}</div>
                        </div>
                      </div>
                      <select
                        value={updateChannel}
                        onChange={(e) => setUpdateChannel(e.target.value as any)}
                        className="rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
                      >
                        <option value="Stable">{t('settings.channel.stable')}</option>
                        <option value="Beta">{t('settings.channel.beta')}</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Language Card */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-4 font-semibold">{t('settings.language')}</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Shield className="h-4 w-4 text-[var(--text-muted)]" />
                      <div>
                        <div className="font-medium">{t('settings.language')}</div>
                        <div className="text-xs text-[var(--text-muted)]">{t('settings.languageDesc')}</div>
                      </div>
                    </div>
                    <select
                      value={language}
                      onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                      className="min-w-[190px] rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
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
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-3 font-semibold">{t('settings.stealth.title')}</div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={stealth}
                      onChange={(e) => setStealth(e.target.checked)}
                    />
                    <span>{t('settings.stealth.desc')}</span>
                  </label>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">{t('settings.stealth.note')}</p>
                </div>
              </>
            )}

            {/* TAB 2: AI Model & Key */}
            {activeTab === 'ai' && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                <div className="mb-1 font-semibold">{t('settings.aiModel')}</div>
                <div className="mb-4 text-xs text-[var(--text-muted)]">{t('settings.aiModel.lowLatency')}</div>

                <div className="space-y-4">
                  {/* Groq */}
                  <div
                    className={`rounded-md border p-4 transition-colors ${
                      activeProvider === 'groq'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
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
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('groq', groqModel)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t("settings.useProvider", { name: "Groq" })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={groqModel}
                          onChange={(e) => updateProviderModel('groq', e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
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
                    className={`rounded-md border p-4 transition-colors ${
                      activeProvider === 'openai'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">OpenAI</span>
                        <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                          GPT family
                        </span>
                      </div>
                      {activeProvider === 'openai' ? (
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('openai', openaiModel)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t("settings.useProvider", { name: "OpenAI" })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={openaiModel}
                          onChange={(e) => updateProviderModel('openai', e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
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
                    className={`rounded-md border p-4 transition-colors ${
                      activeProvider === 'anthropic'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Anthropic</span>
                        <span className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                          Claude
                        </span>
                      </div>
                      {activeProvider === 'anthropic' ? (
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('anthropic', anthropicModel)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t("settings.useProvider", { name: "Claude" })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={anthropicModel}
                          onChange={(e) => updateProviderModel('anthropic', e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
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
                    className={`rounded-md border p-4 transition-colors ${
                      activeProvider === 'gemini'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
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
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          onClick={() => activateProvider('gemini', geminiModel)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t("settings.useProvider", { name: "Gemini" })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={geminiModel}
                          onChange={(e) => updateProviderModel('gemini', e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
                        >
                          <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
                          <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                          <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                        </select>
                      </div>

                      {renderKeyInputRow('gemini', 'GEMINI_API_KEY (Google AI Studio)')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 text-[11px] text-[var(--text-muted)]">{t('settings.apiKeys.help')}</div>
              </div>
            )}

            {/* TAB 3: STT Speech-to-Text */}
            {activeTab === 'stt' && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                <div className="mb-1 font-semibold">{t('settings.stt.title')}</div>
                <div className="mb-4 text-xs text-[var(--text-muted)]">
                  {t('settings.stt.desc')}
                </div>

                <div className="space-y-4">
                  <div
                    className={`rounded-md border p-4 transition-colors ${
                      sttProvider === 'deepgram'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Deepgram</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                          {t('settings.stt.badge')}
                        </span>
                      </div>
                      {sttProvider === 'deepgram' ? (
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateSttConfig('deepgram', 'nova-3')}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t('settings.useProvider', { name: 'Deepgram' })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={sttProvider === 'deepgram' ? sttModel : 'nova-3'}
                          onChange={(e) => updateSttConfig('deepgram', e.target.value)}
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
                        >
                          <option value="nova-3">nova-3 (Recommended - multilingual)</option>
                          <option value="nova-2">nova-2 (general)</option>
                          <option value="nova-2-meeting">nova-2-meeting (Optimized for meetings)</option>
                          <option value="nova-2-general">nova-2-general</option>
                          <option value="nova-2-phonecall">nova-2-phonecall</option>
                        </select>
                      </div>

                      {renderKeyInputRow('deepgram', 'DEEPGRAM_API_KEY')}
                    </div>
                  </div>

                  <div
                    className={`rounded-md border p-4 transition-colors ${
                      sttProvider === 'gemini'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Google AI Studio</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {t('settings.stt.sourceOnly')}
                        </span>
                      </div>
                      {sttProvider === 'gemini' ? (
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateSttConfig('gemini', GEMINI_LIVE_TRANSLATE_MODEL)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t('settings.useProvider', { name: 'Google AI Studio' })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={GEMINI_LIVE_TRANSLATE_MODEL}
                          disabled
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm disabled:opacity-100"
                        >
                          <option value={GEMINI_LIVE_TRANSLATE_MODEL}>{GEMINI_LIVE_TRANSLATE_MODEL}</option>
                        </select>
                      </div>

                      {renderKeyInputRow('gemini', 'GEMINI_API_KEY (Google AI Studio)', true)}
                    </div>
                  </div>

                  <div
                    className={`rounded-md border p-4 transition-colors ${
                      sttProvider === 'apple'
                        ? 'border-[var(--text-muted)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--border-color)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{t('settings.stt.appleTitle')}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {t('settings.stt.appleBadge')}
                        </span>
                      </div>
                      {sttProvider === 'apple' ? (
                        <span className="rounded-full bg-[var(--action)] px-2 py-0.5 text-[10px] font-medium text-[var(--action-text)]">
                          {t('settings.active')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!appleStt.available || sttLanguage === 'multi'}
                          onClick={() => updateSttConfig('apple', APPLE_STT_MODEL)}
                          className="rounded-md border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          {t('settings.useProvider', { name: t('settings.stt.appleTitle') })}
                        </button>
                      )}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs font-medium text-[var(--text-muted)]">{t('settings.modelLabel')}</span>
                        <select
                          value={APPLE_STT_MODEL}
                          disabled
                          className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm disabled:opacity-100"
                        >
                          <option value={APPLE_STT_MODEL}>{APPLE_STT_MODEL}</option>
                        </select>
                      </div>

                      <div className="text-[11px] text-[var(--text-muted)]">{appleStt.available ? t('settings.stt.appleReady') : (appleStt.reason || t('settings.stt.appleUnavailable'))}</div>
                      {sttLanguage === 'multi' && (
                        <div className="text-[11px] text-[var(--text-muted)]">{t('settings.stt.appleNoMulti')}</div>
                      )}
                      <button type="button" disabled={appleTest.loading || !appleStt.available || sttLanguage === 'multi'} onClick={() => { setAppleTest({ loading: true }); void import('../lib/llm').then(({ testAppleSttConnection }) => testAppleSttConnection(sttLanguage === 'multi' ? 'zh-CN' : sttLanguage)).then(() => setAppleTest({ loading: false, success: true, message: t('settings.test.ok') })).catch((error) => setAppleTest({ loading: false, success: false, message: error instanceof Error ? error.message : String(error) })); }} className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50">{appleTest.loading ? t('settings.test.testing') : t('settings.test.testConnection')}</button>
                      {appleTest.message && <div className="text-xs">{appleTest.message}</div>}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm">
                  <span className="w-24 text-xs font-medium text-[var(--text-muted)]">{t('settings.stt.inputLanguage')}</span>
                  <select
                    aria-label={t('settings.stt.inputLanguage')}
                    value={sttLanguage}
                    onChange={(e) => setSttLanguage(e.target.value as SttLanguage)}
                    className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1 text-sm"
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-TW">繁體中文</option>
                    <option value="en-US">English</option>
                    <option value="multi">{t('settings.stt.langMulti')}</option>
                  </select>
                </div>

                <div className="mt-4 text-[11px] text-[var(--text-muted)]">
                  {t('settings.stt.help')}
                </div>
              </div>
            )}

            {/* TAB 4: Shortcuts & Privacy */}
            {activeTab === 'shortcuts_privacy' && (
              <>
                {/* Audio Capture */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-3 font-semibold">{t('settings.audio.title')}</div>
                  <div className="text-sm mb-2">{t('settings.audio.device')}</div>

                  <button
                    onClick={async () => {
                      const granted = await invoke<string>('request_microphone_permission_command').catch(() => 'denied')
                      if (granted !== 'granted') {
                        alert(t('settings.audio.listDevices') + ':\n' + (granted || 'denied'))
                        return
                      }
                      const devices = await invoke<string[]>('list_audio_devices')
                      alert(t('settings.audio.listDevices') + ':\n' + devices.join('\n'))
                    }}
                    className="mb-3 rounded-md border border-[var(--border-color)] px-3 py-1 text-xs transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {t('settings.audio.listDevices')}
                  </button>

                  <div className="space-y-2 rounded-md border border-[var(--success)] p-3 text-xs">
                    <div><b>{t('settings.audio.macosTitle')}</b></div>
                    <div className="text-[var(--success)]">{t('settings.audio.macosDesc')}</div>
                    <div><b>{t('settings.audio.windowsTitle')}</b></div>
                    <div className="text-[var(--success)]">{t('settings.audio.windowsDesc')}</div>
                    <div className="pt-1 text-[10px] text-[var(--success)]">{t('settings.audio.platformNote')}</div>
                    <div className="pt-1 text-[10px] text-[var(--text-muted)]">{t('settings.audio.deviceHint')}</div>
                  </div>
                </div>

                {/* Keyboard Shortcuts */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-3 font-semibold">{t('settings.shortcuts.title')}</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>{t('settings.shortcuts.toggle')}</span>
                      <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-px font-mono text-xs">
                        {`${shortcutMod}⇧I`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settings.shortcuts.capture')}</span>
                      <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-px font-mono text-xs">
                        {`${shortcutMod}⇧C`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Privacy */}
                <div className="rounded-lg border border-[var(--danger)] bg-[var(--bg-surface)] p-5">
                  <div className="mb-3 font-semibold text-[var(--danger)]">{t('settings.privacy.title')}</div>
                  <p className="text-sm">{t('settings.privacy.desc')}</p>
                  <button
                    type="button"
                    onClick={() => void handleClearLocalData()}
                    className="mt-4 rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {t('settings.privacy.clear')}
                  </button>
                </div>
              </>
            )}

            {/* TAB 5: Storage */}
            {activeTab === 'storage' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex items-start gap-3">
                      <HardDrive className="mt-0.5 h-5 w-5 text-[var(--text-muted)]" />
                      <div>
                        <div className="font-semibold">{t('settings.storage.recordings')}</div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">
                          {t('settings.storage.recordingsDesc')}
                        </div>
                        <div className="mt-3 text-lg font-semibold">
                          {storageLoading ? '—' : formatStorageBytes(recordingStorage.bytes)}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {storageLoading ? '—' : t('settings.storage.fileCount', { count: recordingStorage.fileCount })}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleClearRecordings()}
                      disabled={storageLoading || storageAction !== null}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {storageAction === 'recordings' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {t('settings.storage.clearRecordings')}
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex items-start gap-3">
                      <HistoryIcon className="mt-0.5 h-5 w-5 text-[var(--text-muted)]" />
                      <div>
                        <div className="font-semibold">{t('settings.storage.history')}</div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">
                          {t('settings.storage.historyDesc')}
                        </div>
                        <div className="mt-3 text-lg font-semibold">
                          {storageLoading ? '—' : formatStorageBytes(historyStorage.bytes)}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {storageLoading ? '—' : t('settings.storage.recordCount', { count: historyStorage.recordCount })}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleClearHistory()}
                      disabled={storageLoading || storageAction !== null || historyStorage.recordCount === 0}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--danger)] px-3 py-1.5 text-sm font-medium text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {storageAction === 'history' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      {t('settings.storage.clearHistory')}
                    </button>
                  </div>
                </div>

                {storageError && (
                  <div role="alert" className="flex items-start gap-2 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{storageError}</span>
                  </div>
                )}
                {storageNotice && !storageError && (
                  <div role="status" className="flex items-start gap-2 rounded-md border border-[var(--success)] p-3 text-sm text-[var(--success)]">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{storageNotice}</span>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'license' && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
                <div className="mb-2 font-semibold">{t('settings.license.title')}</div>
                <p className="mb-4 text-sm text-[var(--text-muted)]">{t('settings.license.desc')}</p>
                <textarea
                  value={licenseRaw}
                  onChange={(event) => setLicenseRaw(event.target.value)}
                  className="h-32 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 font-mono text-xs outline-none"
                  placeholder='{"kind":"season-pass-90","licenseId":"...","expiresAt":"...","issuedAt":"..."}'
                  aria-label={t('settings.license.title')}
                />
                <button
                  type="button"
                  className="mt-3 rounded-md bg-[var(--action)] px-3 py-1.5 text-xs font-medium text-[var(--action-text)]"
                  onClick={() => {
                    const payload = parseLicensePayload(licenseRaw)
                    const state = deriveLicenseState(payload, 0)
                    if (!payload || state.status === 'invalid' || state.status === 'expired') {
                      setLicenseNotice(t('settings.license.invalid'))
                      return
                    }
                    void saveSetting('season_pass_license', licenseRaw).then(() => {
                      setLicenseNotice(t('settings.license.activated', { date: payload.expiresAt.slice(0, 10) }))
                    }).catch(() => setLicenseNotice(t('settings.saveFailed')))
                  }}
                >
                  {t('settings.license.activate')}
                </button>
                {licenseNotice && <div className="mt-2 text-xs" role="status">{licenseNotice}</div>}
              </div>
            )}

            <div className="mt-8 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Shield className="w-3.5 h-3.5" /> {t('settings.secureNote')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
