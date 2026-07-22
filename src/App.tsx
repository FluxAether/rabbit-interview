import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Clock, FileText, LayoutDashboard, Mic, Rocket, Settings as SettingsIcon, Shield } from 'lucide-react'
import CopilotPanel from './components/CopilotPanel'
import Dashboard from './pages/Dashboard'
import History from './pages/History'
import MockInterview from './pages/MockInterview'
import ResumeOptimizer from './pages/ResumeOptimizer'
import Settings from './pages/Settings'
import StealthCopilot from './pages/StealthCopilot'
import { useTranslation } from './i18n'
import { DEFAULT_LANGUAGE } from './i18n/types'
import { loadHistory as loadInterviewHistory } from './lib/db'
import {
  mountCopilotSessionClient,
  mountCopilotSessionHost,
  sendCopilotCommand,
} from './lib/copilotSession'
import {
  getCopilotWindowStatus,
  hideCopilotWindow,
  subscribeCopilotWindowStatus,
  toggleCopilotWindow,
  type CopilotWindowStatus,
} from './lib/copilotWindow'
import { loadAppSettings } from './lib/settingsStore'
import { loadResumeWorkspace } from './lib/resumeWorkspaceStore'
import { useAppStore } from './stores/useAppStore'

export type Page = 'dashboard' | 'copilot' | 'mock' | 'resume' | 'history' | 'settings'

const navItems = [
  { id: 'dashboard' as Page, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'copilot' as Page, labelKey: 'nav.copilot', icon: Rocket },
  { id: 'mock' as Page, labelKey: 'nav.mock', icon: Mic },
  { id: 'resume' as Page, labelKey: 'nav.resume', icon: FileText },
  { id: 'history' as Page, labelKey: 'nav.history', icon: Clock },
  { id: 'settings' as Page, labelKey: 'nav.settings', icon: SettingsIcon },
]

function Sidebar({ currentPage, onNavigate }: { currentPage: Page; onNavigate: (page: Page) => void }) {
  const t = useTranslation()
  return (
    <aside className="flex h-screen w-60 flex-col border-r border-[#e2e8f0] bg-[#f8fafc] p-4">
      <div className="mb-4 flex items-center gap-3 px-3 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#6366f1]">
          <Shield className="h-4.5 w-4.5 text-white" />
        </div>
        <div>
          <div className="text-lg font-semibold tracking-tight">{t('app.name')}</div>
          <div className="-mt-1 text-[10px] text-[#64748b]">{t('app.tagline')}</div>
        </div>
      </div>
      <nav className="space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = item.id === currentPage
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`sidebar-item relative flex w-full items-center gap-3 rounded-xl px-3 py-[9px] text-left text-[13.5px] transition-all ${active ? 'bg-[#e0e7ff] font-medium text-[#4338ca]' : 'text-[#475569] hover:bg-[#f1f5f9]'}`}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-[#6366f1]" />}
              <Icon className="h-4 w-4" />
              <span>{t(item.labelKey)}</span>
            </button>
          )
        })}
      </nav>
      <div className="mt-auto px-3 pt-4 text-xs text-[#64748b]">
        <div className="text-sm font-medium text-[#0f172a]">{t('app.userName')}</div>
        <div className="text-[10px]">{t('app.userPlan')}</div>
      </div>
    </aside>
  )
}

export default function App() {
  const floating = window.location.hash === '#copilot-floating'
  const settings = useAppStore((state) => state.settings)
  const loadHistory = useAppStore((state) => state.loadHistory)
  const hydrateResumeWorkspace = useAppStore((state) => state.hydrateResumeWorkspace)
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [windowStatus, setWindowStatus] = useState<CopilotWindowStatus | null>(null)
  const floatingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.lang = String(settings.language || DEFAULT_LANGUAGE)
  }, [settings.language])

  useEffect(() => {
    let cancelled = false
    const disposers: Array<() => void> = []
    const register = (cleanup: () => void) => {
      if (cancelled) cleanup()
      else disposers.push(cleanup)
    }
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
      loadInterviewHistory().then(loadHistory).catch((error) => {
        console.warn('Failed to load interview history', error)
      })
      loadResumeWorkspace().then(hydrateResumeWorkspace).catch((error) => {
        console.warn('Failed to load resume workspace', error)
        hydrateResumeWorkspace({
          original: '', optimized: '', jobDescription: '', suggestions: [], sourceFileName: '',
          matchedKeywords: [], missingKeywords: [],
        })
      })
    }
    return () => {
      cancelled = true
      disposers.forEach((cleanup) => cleanup())
    }
  }, [floating, hydrateResumeWorkspace, loadHistory])

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
        className="h-screen w-screen overflow-hidden bg-[#f8fafc] text-[#0f172a] outline-none"
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
      default: return <Dashboard onLaunchCopilot={() => setCurrentPage('copilot')} onViewHistory={() => setCurrentPage('history')} />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f1f5f9] text-[#0f172a]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <main className={`min-w-0 flex-1 ${currentPage === 'copilot' ? 'overflow-hidden' : 'overflow-auto'}`}>
        {renderPage()}
      </main>
    </div>
  )
}
