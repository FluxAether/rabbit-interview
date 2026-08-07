import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Clock, FileText, LayoutDashboard, Mic, PanelLeftClose, PanelLeftOpen, Rocket, Settings as SettingsIcon } from 'lucide-react'
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
import { createEmptyResumeWorkspace } from './lib/resumeOptimizer'
import {
  getCopilotWindowStatus,
  hideCopilotWindow,
  subscribeCopilotWindowStatus,
  toggleCopilotWindow,
  type CopilotWindowStatus,
} from './lib/copilotWindow'
import { loadAppSettings, type AppSettings } from './lib/settingsStore'
import { encryptSecret } from './lib/secretCrypto'
import { loadResumeWorkspace, persistResumeWorkspace } from './lib/resumeWorkspaceStore'
import { selectResumeWorkspace, useAppStore } from './stores/useAppStore'

export type Page = 'dashboard' | 'copilot' | 'mock' | 'resume' | 'history' | 'settings'

const navItems = [
  { id: 'dashboard' as Page, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'copilot' as Page, labelKey: 'nav.copilot', icon: Rocket },
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
}: {
  currentPage: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const t = useTranslation()
  return (
    <aside
      className={`flex h-screen flex-col border-r border-[#e2e8f0] bg-[#f8fafc] p-3 transition-all duration-200 dark:border-[#334155] dark:bg-[#0f172a] ${
        collapsed ? 'w-16 items-center' : 'w-60'
      }`}
    >
      {/* Brand Header */}
      {collapsed ? (
        <div className="mb-4 flex flex-col items-center gap-2 py-3">
          <img src="/logo.png" alt="Logo" className="h-9 w-9 shrink-0 rounded-xl object-contain shadow-sm" />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-1 text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a] dark:text-[#94a3b8] dark:hover:bg-[#1e293b] dark:hover:text-[#f8fafc]"
            title="展开侧边栏"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between px-2 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="Logo" className="h-9 w-9 shrink-0 rounded-xl object-contain shadow-sm" />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight text-[#0f172a] dark:text-[#f8fafc]">
                {t('app.name')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="rounded-lg p-1 text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#0f172a] dark:text-[#94a3b8] dark:hover:bg-[#1e293b] dark:hover:text-[#f8fafc]"
            title="折叠侧边栏"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Nav List */}
      <nav className="w-full space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = item.id === currentPage
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              title={collapsed ? t(item.labelKey) : undefined}
              className={`sidebar-item relative flex w-full items-center rounded-xl py-2.5 transition-all ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-3 text-left'
              } ${
                active
                  ? 'bg-[#e0e7ff] font-semibold text-[#4338ca] dark:bg-[#312e81] dark:text-[#a5b4fc]'
                  : 'text-[#475569] hover:bg-[#f1f5f9] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3.5px] -translate-y-1/2 rounded-r bg-[#6366f1]" />
              )}
              <Icon className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && <span className="truncate text-[13.5px]">{t(item.labelKey)}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto w-full border-t border-[#e2e8f0] pt-3 dark:border-[#334155]">
        {!collapsed ? (
          <div className="px-2 text-xs">
            <div className="truncate font-medium text-[#0f172a] dark:text-[#f8fafc]">{t('app.name')}</div>
            <div className="truncate text-[10px] text-[#64748b] dark:text-[#94a3b8]">{t('app.tagline')}</div>
          </div>
        ) : (
          <div className="flex justify-center" title={t('app.name')}>
            <img src="/logo.png" alt="" className="h-8 w-8 rounded-lg object-contain" />
          </div>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [windowStatus, setWindowStatus] = useState<CopilotWindowStatus | null>(null)
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

  if (floating) {
    const hide = async () => {
      const status = await hideCopilotWindow()
      setWindowStatus(status)
    }
    return (
      <div
        ref={floatingRef}
        className="h-screen w-screen overflow-hidden bg-transparent text-[#0f172a] outline-none dark:text-[#f8fafc]"
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
    switch (currentPage) {
      case 'copilot': return <StealthCopilot />
      case 'mock': return <MockInterview />
      case 'resume': return <ResumeOptimizer />
      case 'history': return <History />
      case 'settings': return <Settings />
      default: return <Dashboard onLaunchCopilot={() => setCurrentPage('copilot')} onViewHistory={() => setCurrentPage('history')} onNavigateToSettings={() => setCurrentPage('settings')} />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f1f5f9] text-[#0f172a] dark:bg-[#0f172a] dark:text-[#f8fafc]">
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />
      <main className={`min-w-0 flex-1 ${currentPage === 'copilot' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {renderPage()}
      </main>
    </div>
  )
}
