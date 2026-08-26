import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Clock, FileText, LayoutDashboard, MessageSquareText, Mic, PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon } from 'lucide-react'
import CopilotPanel from './components/CopilotPanel'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import MockInterview from './pages/MockInterview'
import ResumeOptimizer from './pages/ResumeOptimizer'
import Settings from './pages/Settings'
import StealthCopilot from './pages/StealthCopilot'
import { useTranslation } from './i18n'
import { DEFAULT_LANGUAGE } from './i18n/types'
import { loadHistory as loadInterviewHistory, migrateLegacyJsonStoresIfNeeded } from './lib/db'
import {
  mountCopilotSessionClient,
  mountCopilotSessionHost,
  sendCopilotCommand,
} from './lib/copilotSession'
import { invoke } from '@tauri-apps/api/core'
import type { AudioCapabilities } from './lib/copilotSession'
import { createEmptyResumeWorkspace } from './lib/resumeOptimizer'
import {
  getCopilotWindowStatus,
  hideCopilotWindow,
  subscribeCopilotWindowStatus,
  toggleCopilotWindow,
  type CopilotWindowStatus,
} from './lib/copilotWindow'
import { loadAppSettings, type AppSettings } from './lib/settingsStore'
import { deriveReadiness, type SettingsTab } from './lib/readiness'
import type { Page, SettingsIntent } from './lib/navigation'
import { getApiKey } from './lib/keyStore'
import { encryptSecret } from './lib/secretCrypto'
import { loadResumeWorkspace, persistResumeWorkspace } from './lib/resumeWorkspaceStore'
import { selectResumeWorkspace, useAppStore } from './stores/useAppStore'

export type { Page, SettingsIntent }

const navItems = [
  { id: 'dashboard' as Page, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'copilot' as Page, labelKey: 'nav.copilot', icon: MessageSquareText },
  { id: 'mock' as Page, labelKey: 'nav.mock', icon: Mic },
  { id: 'resume' as Page, labelKey: 'nav.resume', icon: FileText },
  { id: 'history' as Page, labelKey: 'nav.history', icon: Clock },
  { id: 'settings' as Page, labelKey: 'nav.settings', icon: SettingsIcon },
]

function Sidebar({
  currentPage,
  onNavigate,
  collapsed,
  onToggleCollapse,
  engineReady,
}: {
  currentPage: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
  onToggleCollapse: () => void
  engineReady: boolean
}) {
  const t = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const activeModel = settings.aiModel || 'gpt-5.6-luna'
  return (
    <aside
      className={`flex h-[100dvh] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-sidebar)] p-3 transition-[width] duration-200 ${
        collapsed ? 'w-[64px] items-center' : 'w-[240px]'
      }`}
    >
      {/* Brand Header */}
      {collapsed ? (
        <div className="mb-4 flex flex-col items-center gap-2 py-2">
          <img src="/logo.png" alt={t('app.name')} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            title={t("nav.expandSidebar")}
            aria-label={t("nav.expandSidebar")}
          >
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt={t('app.name')} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-[-0.01em] text-[var(--text-main)]">
                {t('app.name')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            title={t("nav.collapseSidebar")}
            aria-label={t("nav.collapseSidebar")}
          >
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      )}

      {/* Nav List */}
      <nav className="w-full space-y-1">
        {navItems.map((item, idx) => {
          const Icon = item.icon
          const active = item.id === currentPage
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? `${t(item.labelKey)} (⌘${idx + 1})` : undefined}
              aria-current={active ? 'page' : undefined}
              className={`sidebar-item relative flex w-full items-center py-2.5 transition-all ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left'
              } ${
                active
                  ? 'active bg-[var(--bg-surface)] font-medium text-[var(--text-main)] shadow-sm border border-[var(--border-color)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] font-medium'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r-full bg-[var(--action)]" />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
              {!collapsed && (
                <>
                  <span className="truncate text-[13.5px]">{t(item.labelKey)}</span>
                  <span className="ml-auto font-mono text-[10px] text-[var(--text-muted)] opacity-50">⌘{idx + 1}</span>
                </>
              )}
            </button>
          )
        })}
      </nav>

      {/* Sidebar Footer Status */}
      <div className="mt-auto w-full pt-3 border-t border-[var(--border-color)]">
        {!collapsed ? (
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-2 text-left text-xs transition-colors hover:bg-[var(--bg-hover)]"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase font-semibold tracking-wider text-[var(--text-muted)]">AI Engine</div>
            <div className="truncate font-mono text-[11px] text-[var(--text-main)]">{activeModel}</div>
          </div>
            <span className={`h-2 w-2 shrink-0 rounded-full ${engineReady ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
        </button>
      ) : (
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            title={`AI Engine: ${activeModel}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
          >
            <span className={`h-2 w-2 rounded-full ${engineReady ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
        </button>
      )}
      </div>
    </aside>
  )
}

export default function App() {
  const floating = window.location.hash === '#copilot-floating'
  const settings = useAppStore((state) => state.settings)
  const loadHistory = useAppStore((state) => state.loadHistory)
  const setHistoryLoadError = useAppStore((state) => state.setHistoryLoadError)
  const hydrateResumeWorkspace = useAppStore((state) => state.hydrateResumeWorkspace)
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [settingsIntent, setSettingsIntent] = useState<SettingsIntent | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.matchMedia('(max-width: 960px)').matches)
  const [userCollapsed, setUserCollapsed] = useState(false)
  const [windowStatus, setWindowStatus] = useState<CopilotWindowStatus | null>(null)
  useEffect(() => {
    if (floating) return
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= navItems.length) {
          e.preventDefault()
          const target = navItems[num - 1]
          if (target) setCurrentPage(target.id)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [floating])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)')
    const sync = () => {
      if (!userCollapsed) setSidebarCollapsed(media.matches)
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [userCollapsed])

  const floatingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.lang = String(settings.language || DEFAULT_LANGUAGE)

    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => {
      const dark = settings.theme === 'Dark' || (settings.theme === 'System' && colorScheme.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    syncTheme()

    if (floating) {
      document.documentElement.classList.add('floating-mode')
      document.documentElement.style.backgroundColor = 'transparent'
      document.body.style.backgroundColor = 'transparent'
      const rootEl = document.getElementById('root')
      if (rootEl) rootEl.style.backgroundColor = 'transparent'
    } else {
      document.documentElement.classList.remove('floating-mode')
      document.documentElement.style.backgroundColor = ''
      document.body.style.backgroundColor = ''
      const rootEl = document.getElementById('root')
      if (rootEl) rootEl.style.backgroundColor = ''
    }

    if (settings.theme === 'System') {
      colorScheme.addEventListener('change', syncTheme)
      return () => colorScheme.removeEventListener('change', syncTheme)
    }
  }, [settings.language, settings.theme, floating])

  useEffect(() => {
    let cancelled = false
    const disposers: Array<() => void> = []
    const register = (cleanup: () => void) => {
      if (cancelled) cleanup()
      else disposers.push(cleanup)
    }
    listen<AppSettings['theme']>('app-theme-changed', (event) => {
      useAppStore.getState().setSettings({ theme: event.payload })
    }).then(register)
    loadAppSettings().then((saved) => {
      useAppStore.getState().setSettings({ ...saved, language: saved.language || DEFAULT_LANGUAGE })
    }).catch(() => {})

    if (floating) {
      mountCopilotSessionClient().then((cleanup) => {
        register(cleanup)
      })
      getCopilotWindowStatus().then(setWindowStatus).catch(() => {})
      subscribeCopilotWindowStatus(setWindowStatus).then(register)
      setTimeout(() => floatingRef.current?.focus(), 50)
    } else {
      mountCopilotSessionHost().then((cleanup) => {
        register(cleanup)
      })
      migrateLegacyJsonStoresIfNeeded(encryptSecret)
        .catch((error) => console.warn('Legacy store migration failed', error))
        .finally(() => {
          loadInterviewHistory().then(loadHistory).catch((error) => {
            setHistoryLoadError()
            console.warn('Failed to load interview history', error)
          })
          loadResumeWorkspace().then(hydrateResumeWorkspace).catch((error) => {
            console.warn('Failed to load resume workspace', error)
            hydrateResumeWorkspace(createEmptyResumeWorkspace())
          })
          loadAppSettings().then((saved) => {
            useAppStore.getState().setSettings({ ...saved, language: saved.language || DEFAULT_LANGUAGE })
          }).catch(() => {})
        })
    }
    return () => {
      cancelled = true
      disposers.forEach((cleanup) => cleanup())
    }
  }, [floating, hydrateResumeWorkspace, loadHistory, setHistoryLoadError])

  useEffect(() => {
    if (floating) return
    let timer: number | null = null
    const schedulePersistence = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        const state = useAppStore.getState()
        if (!state.resumeHydrated) return
        persistResumeWorkspace(selectResumeWorkspace(state))
          .then(() => state.setResumePersistenceError(false))
          .catch(() => state.setResumePersistenceError(true))
      }, 300)
    }
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (
        state.resumeHydrated === previous.resumeHydrated
        && state.resumeOriginal === previous.resumeOriginal
        && state.resumeOptimized === previous.resumeOptimized
        && state.jobDescription === previous.jobDescription
        && state.resumeSuggestions === previous.resumeSuggestions
        && state.resumeSourceFileName === previous.resumeSourceFileName
        && state.resumeRequirements === previous.resumeRequirements
        && state.resumeTargetKeywords === previous.resumeTargetKeywords
        && state.resumeAnalysisOriginalFingerprint === previous.resumeAnalysisOriginalFingerprint
        && state.resumeAnalysisJobDescriptionFingerprint === previous.resumeAnalysisJobDescriptionFingerprint
        && state.resumeAnalysisSource === previous.resumeAnalysisSource
        && state.resumeTargetRole === previous.resumeTargetRole
        && state.resumeTargetCompany === previous.resumeTargetCompany
        && state.resumeProfileUpdatedAt === previous.resumeProfileUpdatedAt
      ) return
      schedulePersistence()
    })
    schedulePersistence()
    return () => {
      unsubscribe()
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [floating])

  useEffect(() => {
    if (floating) return
    let disposed = false
    const cleanups: Array<() => void> = []
    Promise.all([
      listen('toggle-copilot', () => {
        void toggleCopilotWindow().catch((error) => console.warn('Unable to toggle Copilot window', error))
      }),
      listen('toggle-capture', () => {
        void sendCopilotCommand({ type: 'toggle' })
      }),
    ]).then((values) => {
      if (disposed) values.forEach((cleanup) => cleanup())
      else cleanups.push(...values)
    })
    return () => {
      disposed = true
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [floating])

  useEffect(() => {
    if (floating) return
    let cancelled = false
    const refresh = async () => {
      try {
        const current = useAppStore.getState().settings
        const [groq, openai, anthropic, gemini, deepgram] = await Promise.all([
          getApiKey('GROQ_API_KEY'),
          getApiKey('OPENAI_API_KEY'),
          getApiKey('ANTHROPIC_API_KEY'),
          getApiKey('GEMINI_API_KEY'),
          getApiKey('DEEPGRAM_API_KEY'),
        ])
        const capabilities = await invoke<AudioCapabilities>('get_audio_capabilities').catch(() => null)
        if (cancelled) return
        const readiness = deriveReadiness({
          settings: { aiModel: current.aiModel, sttProvider: current.sttProvider },
          keys: { groq: !!groq, openai: !!openai, anthropic: !!anthropic, gemini: !!gemini, deepgram: !!deepgram },
          useSystemAudio: current.useSystemAudio ?? true,
          useMicrophone: current.useMicWithSystem ?? false,
          capabilities,
          capabilitiesError: !capabilities,
        })
        setEngineReady(readiness.status === 'ready' || readiness.status === 'degraded')
      } catch {
        if (!cancelled) setEngineReady(false)
      }
    }
    void refresh()
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.settings === previous.settings) return
      void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [floating, settings.aiModel, settings.sttProvider, settings.useSystemAudio, settings.useMicWithSystem])

  if (floating) {
    const hide = async () => {
      const status = await hideCopilotWindow()
      setWindowStatus(status)
    }
    return (
      <div
        ref={floatingRef}
        className="h-[100dvh] w-screen overflow-hidden bg-transparent text-[var(--text-main)] outline-none"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') void hide()
        }}
      >
        <CopilotPanel floating windowStatus={windowStatus} onHide={() => void hide()} />
      </div>
    )
  }

  const renderPage = () => {
    const openSettings = (tab: SettingsTab, returnTo?: Page) => {
      setSettingsIntent({ tab, returnTo })
      setCurrentPage('settings')
    }
    switch (currentPage) {
      case 'copilot': return <StealthCopilot onOpenSettings={(tab) => openSettings(tab, 'copilot')} />
      case 'mock': return <MockInterview />
      case 'resume': return <ResumeOptimizer />
      case 'history': return <History onLaunchCopilot={() => setCurrentPage('copilot')} onNavigateToMock={() => setCurrentPage('mock')} />
      case 'settings': return (
        <Settings
          initialTab={settingsIntent?.tab}
          returnTo={settingsIntent?.returnTo}
          onReturn={(page) => {
            setSettingsIntent(null)
            setCurrentPage(page)
          }}
        />
      )
      default: return (
        <Dashboard
          onLaunchCopilot={() => setCurrentPage('copilot')}
          onNavigateToMock={() => setCurrentPage('mock')}
          onNavigateToResume={() => setCurrentPage('resume')}
          onViewHistory={() => setCurrentPage('history')}
          onNavigateToSettings={(tab) => openSettings(tab || 'ai', 'dashboard')}
        />
      )
    }
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--bg-app)] text-[var(--text-main)]">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        collapsed={sidebarCollapsed}
        engineReady={engineReady}
        onToggleCollapse={() => {
          setUserCollapsed(true)
          setSidebarCollapsed((c) => !c)
        }}
      />
      <main id="main-content" className={`min-w-0 flex-1 bg-[var(--bg-app)] ${currentPage === 'copilot' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {renderPage()}
      </main>
    </div>
  )
}
