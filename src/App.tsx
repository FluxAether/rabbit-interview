import { useState, useEffect, useRef } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { 
  LayoutDashboard, 
  Rocket, 
  Mic, 
  FileText, 
  Clock, 
  Settings as SettingsIcon,
  Shield
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

import Dashboard from './pages/Dashboard'
import StealthCopilot from './pages/StealthCopilot'
import MockInterview from './pages/MockInterview'
import ResumeOptimizer from './pages/ResumeOptimizer'
import History from './pages/History'
import Settings from './pages/Settings'
import { useAppStore } from './stores/useAppStore'
import { useTranslation } from './i18n'
import { DEFAULT_LANGUAGE } from './i18n/types'
import { startDeepgramStream, sendAudioChunk, closeDeepgramStream, generateSuggestions } from './lib/llm'

export type Page = 
  | 'dashboard' 
  | 'copilot' 
  | 'mock' 
  | 'resume' 
  | 'history' 
  | 'settings'

const navItems = [
  { id: 'dashboard' as Page, labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'copilot' as Page, labelKey: 'nav.copilot', icon: Rocket },
  { id: 'mock' as Page, labelKey: 'nav.mock', icon: Mic },
  { id: 'resume' as Page, labelKey: 'nav.resume', icon: FileText },
  { id: 'history' as Page, labelKey: 'nav.history', icon: Clock },
  { id: 'settings' as Page, labelKey: 'nav.settings', icon: SettingsIcon },
]

function Sidebar({ currentPage, onNavigate }: { 
  currentPage: Page; 
  onNavigate: (page: Page) => void 
}) {
  const t = useTranslation()

  return (
    <div className="w-60 bg-[#f8fafc] border-r border-[#e2e8f0] h-screen flex flex-col p-4">
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-4 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[#6366f1] flex items-center justify-center">
          <Shield className="w-4.5 h-4.5 text-white" />
        </div>
        <div>
          <div className="font-semibold text-lg tracking-tight">{t('app.name')}</div>
          <div className="text-[10px] text-[#64748b] -mt-1">{t('app.tagline')}</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <div
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`sidebar-item relative flex items-center gap-3 px-3 py-[9px] rounded-xl text-[13.5px] cursor-pointer select-none transition-all
                ${isActive 
                  ? 'bg-[#e0e7ff] text-[#4338ca] font-medium' 
                  : 'text-[#475569] hover:bg-[#f1f5f9]'
                }`}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#6366f1] rounded-r" />
              )}
              <Icon className="w-4 h-4" />
              <span>{t(item.labelKey)}</span>
            </div>
          )
        })}
      </nav>

      <div className="mt-auto px-3 pt-4">
        <div className="flex items-center gap-2 text-xs text-[#64748b]">
          <div className="w-6 h-6 rounded-full bg-[#6366f1] text-white flex items-center justify-center text-[10px] font-medium">AK</div>
          <div>
            <div className="text-[#0f172a] text-sm font-medium">{t('app.userName')}</div>
            <div className="text-[10px]">{t('app.userPlan')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const isFloating = window.location.hash === '#copilot-floating'
  const { loadHistory, settings } = useAppStore()
  const currentLang = (settings?.language as string) || DEFAULT_LANGUAGE
  const t = useTranslation()

  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const floatingPanelRef = useRef<HTMLDivElement>(null)

  // Live data for floating window (so it can show real capture info)
  const [floatingQuestion, setFloatingQuestion] = useState('请介绍一下你自己。')
  const [floatingSuggestions, setFloatingSuggestions] = useState<string[]>([])
  const [floatingAmp, setFloatingAmp] = useState(0)
  const [floatingCapturing, setFloatingCapturing] = useState(false)

  // For floating window self-contained capture support
  const floatingDeepgramRef = useRef<any>(null)
  const floatingUnlistenChunkRef = useRef<any>(null)

  const startFloatingCaptureSupport = async () => {
    try {
      // Start Deepgram for this floating view (allows standalone use)
      const ws = await startDeepgramStream(
        (text, isFinal) => {
          if (text) {
            if (isFinal) setFloatingQuestion(text)
            emit('copilot-question', text).catch(() => {})
            if (isFinal) {
              generateSuggestions(text).then((sugs) => {
                sugs.forEach((s: string) => {
                  const sugText = s.startsWith('•') ? s : `• ${s}`
                  setFloatingSuggestions(prev => {
                    const next = [...prev, sugText]
                    return next.length > 6 ? next.slice(-6) : next
                  })
                  emit('copilot-suggestion', { text: sugText }).catch(() => {})
                })
              })
            }
          }
        },
        (err) => console.error('Floating Deepgram err', err)
      )
      floatingDeepgramRef.current = ws

      const un = await listen<number[]>('audio-chunk', (event) => {
        if (floatingDeepgramRef.current) {
          const chunk = new Float32Array(event.payload)
          sendAudioChunk(floatingDeepgramRef.current, chunk)
        }
      })
      floatingUnlistenChunkRef.current = un
    } catch (e) {
      console.warn('Floating capture support start failed', e)
    }
  }

  const stopFloatingCaptureSupport = () => {
    if (floatingDeepgramRef.current) {
      closeDeepgramStream(floatingDeepgramRef.current)
      floatingDeepgramRef.current = null
    }
    if (floatingUnlistenChunkRef.current) {
      floatingUnlistenChunkRef.current().catch(() => {})
      floatingUnlistenChunkRef.current = null
    }
  }

  // Keep <html lang> in sync with selected language
  useEffect(() => {
    document.documentElement.lang = currentLang
  }, [currentLang])

  useEffect(() => {
    // Load history once
    invoke<any[]>('get_history').then((data) => {
      if (data && data.length) loadHistory(data)
    }).catch(() => {})

    // Load settings and apply language
    invoke<any>('get_settings').then((settings) => {
      if (settings?.language) {
        // Trigger store update if needed (Settings page also handles this)
        // We can extend the store later to have an initSettings action
      }
    }).catch(() => {})

    // Listen for global shortcut events from Rust
    const unlistenCopilot = listen('toggle-copilot', () => {
      setCurrentPage('copilot')
      invoke('launch_copilot_window').catch(() => {})
    })

    // ⌘⇧C - navigate to copilot page so capture toggle can work
    const unlistenCapture = listen('toggle-capture', () => {
      setCurrentPage('copilot')
    })

    // Live data listeners for floating window (and any other)
    const unlistenAmp = listen<number>('audio-amplitude', (e) => {
      setFloatingAmp(e.payload)
    })
    const unlistenQ = listen<string>('copilot-question', (e) => {
      setFloatingQuestion(e.payload)
    })
    const unlistenSug = listen<{text: string}>('copilot-suggestion', (e) => {
      setFloatingSuggestions(prev => {
        const next = [...prev, e.payload.text]
        return next.length > 6 ? next.slice(-6) : next
      })
    })

    return () => {
      unlistenCopilot.then(f => f())
      unlistenCapture.then(f => f())
      unlistenAmp.then(f => f()).catch(()=>{})
      unlistenQ.then(f => f()).catch(()=>{})
      unlistenSug.then(f => f()).catch(()=>{})
    }
  }, [])

  // Auto-focus the floating panel so Escape key works immediately
  useEffect(() => {
    if (isFloating && floatingPanelRef.current) {
      // Delay slightly to ensure the webview is ready
      const t = setTimeout(() => {
        floatingPanelRef.current?.focus()
      }, 50)
      return () => clearTimeout(t)
    }
  }, [isFloating])

  // Cleanup floating capture support when leaving floating view
  useEffect(() => {
    return () => {
      stopFloatingCaptureSupport()
    }
  }, [])

  // Minimal floating copilot-only UI (matches the exact reference image)
  if (isFloating) {
    return (
      <div 
        ref={floatingPanelRef}
        className="floating-panel w-[400px] h-[360px] m-2 p-4 text-sm select-none overflow-hidden border border-[#e2e8f0]"
        tabIndex={-1}
        onKeyDown={async (e) => {
          if (e.key === 'Escape') {
            console.log('[Copilot] Escape pressed')
            try { await getCurrentWindow().close() } catch {}
            try { await invoke('close_copilot_window') } catch {}
            window.close()
          }
        }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          {/* Drag region only on the title area */}
          <div className="flex items-center gap-2" data-tauri-drag-region style={{ cursor: 'move' }}>
            <div className="w-7 h-7 rounded-lg bg-[#6366f1] flex items-center justify-center">
              <span className="text-white text-xs">🎤</span>
            </div>
            <span className="font-semibold tracking-tight">{t('copilot.floating.title')}</span>
          </div>
          {/* Controls are explicitly non-draggable and have dedicated click handlers */}
          <div className="flex items-center gap-3 text-[#64748b]">
            <span className="cursor-pointer select-none" data-tauri-drag-region="false">📈</span>
            <span className="cursor-pointer select-none" data-tauri-drag-region="false">✎</span>
            <button 
              type="button"
              className="cursor-pointer hover:text-[#334155] px-1.5 py-0.5 rounded hover:bg-[#f1f5f9] select-none text-base leading-none" 
              data-tauri-drag-region="false"
              onClick={async (e) => {
                e.stopPropagation()
                e.preventDefault()
                console.log('[Copilot] Close button clicked')
                const win = getCurrentWindow()
                try {
                  // 1. Preferred: Tauri Window API
                  await win.close()
                  console.log('[Copilot] win.close() succeeded')
                  return
                } catch (err1) {
                  console.warn('[Copilot] win.close() failed:', err1)
                }
                try {
                  // 2. Force destroy
                  await (win as any).destroy?.()
                  console.log('[Copilot] win.destroy() succeeded')
                  return
                } catch (err2) {
                  console.warn('[Copilot] destroy() failed:', err2)
                }
                stopFloatingCaptureSupport()
                try {
                  // 3. Ask Rust backend to close it (most reliable for some setups)
                  await invoke('close_copilot_window')
                  console.log('[Copilot] close_copilot_window invoke succeeded')
                  return
                } catch (err3) {
                  console.warn('[Copilot] Rust close command failed:', err3)
                }
                // 4. Last resort
                console.log('[Copilot] falling back to window.close()')
                window.close()
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Amplitude bar */}
        <div className="h-1 bg-[#e2e8f0] rounded mb-3 overflow-hidden">
          <div className="h-1 bg-[#6366f1] transition-all" style={{ width: `${Math.min(100, Math.round(floatingAmp * 140))}%` }} />
        </div>

        <div className="mb-3">
          <div className="text-[10px] tracking-widest text-[#64748b] mb-1">{t('copilot.question')}</div>
          <div className="text-[13px] leading-tight min-h-[36px]">{floatingQuestion}</div>
        </div>

        <div>
          <div className="text-[10px] tracking-widest text-[#64748b] mb-1.5">{t('copilot.suggestions')}</div>
          <div className="space-y-[3px] text-[12.5px] max-h-[110px] overflow-auto">
            {floatingSuggestions.length === 0 && (
              <div className="text-[#64748b] text-[11px]">Start capture for live suggestions...</div>
            )}
            {floatingSuggestions.map((s, i) => (
              <div key={i} className="bg-[#f8fafc] border border-[#e2e8f0] rounded-lg px-2.5 py-1">{s}</div>
            ))}
          </div>
        </div>

        {/* Capture controls in floating */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={async () => {
              try {
                if (!floatingCapturing) {
                  await invoke('start_capture', { deviceName: null, deepgramKey: null })
                  setFloatingCapturing(true)
                  startFloatingCaptureSupport()
                } else {
                  await invoke('stop_capture')
                  setFloatingCapturing(false)
                  stopFloatingCaptureSupport()
                  setFloatingSuggestions([])
                }
              } catch (e) {
                console.warn('Floating capture toggle error', e)
              }
            }}
            className={`text-xs px-3 py-1 rounded ${floatingCapturing ? 'bg-red-500 text-white' : 'bg-[#6366f1] text-white'}`}
          >
            {floatingCapturing ? 'Stop' : 'Start Capture'}
          </button>
          <button onClick={() => { setFloatingSuggestions([]); setFloatingQuestion('Tell me about yourself.') }} className="text-xs px-2 py-1 border rounded">Clear</button>
        </div>

        <div className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-[#6366f1] flex items-center justify-center gap-1">
          <Shield className="w-3 h-3" /> {t('copilot.stealthActive')}
        </div>
      </div>
    )
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onLaunchCopilot={() => setCurrentPage('copilot')} />
      case 'copilot':
        return <StealthCopilot />
      case 'mock':
        return <MockInterview />
      case 'resume':
        return <ResumeOptimizer />
      case 'history':
        return <History />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard onLaunchCopilot={() => setCurrentPage('copilot')} />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f1f5f9] text-[#0f172a]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      
      <main className="flex-1 overflow-auto">
        {renderPage()}
      </main>
    </div>
  )
}
