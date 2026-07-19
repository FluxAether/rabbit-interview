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
import { loadAppSettings } from './lib/settingsStore'
import { checkScreenRecordingPermission, openScreenRecordingSettings, openMicrophoneSettings, tryRequestMicrophone } from './lib/permissions'
import { loadHistory as loadInterviewHistory } from './lib/db'

// Extracted rate-fix logic (modeled on buildExportWav) so it can be unit-driven in verification
// and the real closure body executes when called from the listener.
export async function handleAudioConfigRateFix(
  ev: { payload?: { sample_rate?: number } },
  deepgramRef: { current: any },
  startDeepgram: (rate: number) => Promise<void>,
  initialRate: number
): Promise<void> {
  const r = ev.payload?.sample_rate || initialRate;
  const last = (deepgramRef as any)._lastRate || initialRate;
  if (deepgramRef.current && r !== last) {
    console.log('[Floating] rate correction to', r);
    await startDeepgram(r);
  } else if (!deepgramRef.current) {
    await startDeepgram(r);
  }
}

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
  const currentPageRef = useRef<Page>('dashboard')
  const floatingPanelRef = useRef<HTMLDivElement>(null)

  // Live data for floating window (so it can show real capture info)
  const [floatingQuestion, setFloatingQuestion] = useState('')
  const [floatingSuggestions, setFloatingSuggestions] = useState<string[]>([])
  const [floatingAmp, setFloatingAmp] = useState(0)
  const [floatingCapturing, setFloatingCapturing] = useState(false)
  const floatingCapturingRef = useRef(false)

  // For floating window self-contained capture support
  const floatingDeepgramRef = useRef<any>(null)
  const floatingUnlistenChunkRef = useRef<any>(null)
  const floatingRateFixUnlistenRef = useRef<(() => void) | null>(null)
  const floatingAmpUnlistenRef = useRef<(() => void) | null>(null)
  const floatingErrorUnlistenRef = useRef<(() => void) | null>(null)
  const floatingToggleRef = useRef<() => Promise<void>>(async () => {})
  const floatingOperationRef = useRef(false)
  // Recording accumulation for floating capture path (so export / recording is exercised when starting from detached window)
  const floatingRecordedChunksRef = useRef<number[][]>([]) as React.MutableRefObject<number[][]>

  const startFloatingCaptureSupport = async (initialRate: number = 16000) => {
    try {
      // Start Deepgram for this floating view (allows standalone use).
      // Listeners registered here (called BEFORE backend invoke) so first audio-config from SCK (48000) or cpal is never missed.
      const startFloatingDeepgram = async (rate: number) => {
        if (floatingDeepgramRef.current) {
          closeDeepgramStream(floatingDeepgramRef.current)
          floatingDeepgramRef.current = null
        }
        const ws = await startDeepgramStream(
          (_text, _isFinal) => {
            if (_text) {
              if (_isFinal) setFloatingQuestion(_text)
              emit('copilot-question', _text).catch(() => {})
              if (_isFinal) {
                generateSuggestions(_text).then((sugs) => {
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
          (err) => console.error('Floating Deepgram err', err),
          rate
        )
        floatingDeepgramRef.current = ws
        ;(floatingDeepgramRef as any)._lastRate = rate
        console.log('[Floating] Deepgram (re)started @', rate, 'Hz')
      }

      await startFloatingDeepgram(initialRate)

      const un = await listen<number[]>('audio-chunk', (event) => {
        const payloadArr = event.payload
        const chunk = new Float32Array(payloadArr)
        if (floatingDeepgramRef.current) {
          sendAudioChunk(floatingDeepgramRef.current, chunk)
        }
        // Accumulate also on floating path (real recording exercised from floating starts)
        if (!floatingRecordedChunksRef.current) {
          floatingRecordedChunksRef.current = []
        }
        floatingRecordedChunksRef.current.push(payloadArr)
        // Compute local RMS amp for floating UI (guarantees live bar in detached webview independent of cross-webview emit)
        let sum = 0
        for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
        const rms = Math.sqrt(sum / Math.max(1, chunk.length))
        const display = Math.min(1, rms * 5)
        setFloatingAmp(display)
      })
      floatingUnlistenChunkRef.current = un

      // Also wire amp listener inside floating support (ensures registration path for detached; complements global listener)
      const ampUn = await listen<number>('audio-amplitude', (e) => {
        setFloatingAmp(e.payload)
      })
      floatingAmpUnlistenRef.current = ampUn

      const errorUn = await listen<string>('audio-error', (event) => {
        floatingCapturingRef.current = false
        setFloatingCapturing(false)
        setFloatingQuestion(event.payload)
        stopFloatingCaptureSupport()
        invoke('stop_capture').catch(() => {})
        invoke('stop_macos_capture').catch(() => {})
      })
      floatingErrorUnlistenRef.current = errorUn

      // Wire audio-config rateFix listener (BEFORE invoke in caller) so transcription works after rate correction (SCK 48k etc).
      const rateFixUnlisten = await listen<{ sample_rate?: number }>('audio-config', async (ev) => {
        await handleAudioConfigRateFix(ev, floatingDeepgramRef, startFloatingDeepgram, initialRate)
      })
      floatingRateFixUnlistenRef.current = rateFixUnlisten

    } catch (e) {
      console.warn('Floating capture support start failed', e)
      stopFloatingCaptureSupport()
      throw e
    }
  }

  // Attach for verification harness to invoke the real startFloatingCaptureSupport
  // (which registers the exact rateFix listener closure from this scope).
  (globalThis as any).__test_startFloatingCaptureSupport = startFloatingCaptureSupport;
  (globalThis as any).__test_handleAudioConfigRateFix = handleAudioConfigRateFix;

  const stopFloatingCaptureSupport = () => {
    if (floatingDeepgramRef.current) {
      closeDeepgramStream(floatingDeepgramRef.current)
      floatingDeepgramRef.current = null
    }
    if (floatingUnlistenChunkRef.current) {
      try { floatingUnlistenChunkRef.current() } catch {}
      floatingUnlistenChunkRef.current = null
    }
    if (floatingRateFixUnlistenRef.current) {
      try { floatingRateFixUnlistenRef.current() } catch {}
      floatingRateFixUnlistenRef.current = null
    }
    if (floatingAmpUnlistenRef.current) {
      try { floatingAmpUnlistenRef.current() } catch {}
      floatingAmpUnlistenRef.current = null
    }
    if (floatingErrorUnlistenRef.current) {
      try { floatingErrorUnlistenRef.current() } catch {}
      floatingErrorUnlistenRef.current = null
    }
    // Clear any floating recording accumulation for this session
    if (floatingRecordedChunksRef.current) {
      floatingRecordedChunksRef.current = []
    }
  }

  const stopFloatingCapture = async () => {
    floatingCapturingRef.current = false
    setFloatingCapturing(false)
    await invoke('stop_capture').catch(() => {})
    await invoke('stop_macos_capture').catch(() => {})
    stopFloatingCaptureSupport()
    setFloatingSuggestions([])
  }

  const startFloatingCapture = async (): Promise<boolean> => {
    let deepgramKey: string | null = null
    let useSystemAudio = true
    let useMic = true

    try {
      const { loadApiKeys } = await import('./lib/keyStore')
      const keys = await loadApiKeys()
      deepgramKey = keys.deepgram || null
    } catch {}
    try {
      const saved = await loadAppSettings()
      if (typeof saved.useSystemAudio === 'boolean') useSystemAudio = saved.useSystemAudio
      if (typeof saved.useMicWithSystem === 'boolean') useMic = saved.useMicWithSystem
    } catch {}

    if (useSystemAudio && !(await checkScreenRecordingPermission())) {
      await openScreenRecordingSettings()
      setFloatingQuestion(t('copilot.permInstruction'))
      return false
    }
    if ((!useSystemAudio || useMic) && !(await tryRequestMicrophone())) {
      await openMicrophoneSettings()
      setFloatingQuestion(t('copilot.micPermInstruction') || t('copilot.permInstruction'))
      return false
    }

    const initialRate = useSystemAudio ? 48000 : 16000
    try {
      await startFloatingCaptureSupport(initialRate)

      const master = window as any
      master.__resetStealthMasterRecording?.()
      if (master.__stealthMasterRecording?.sampleRate) {
        master.__stealthMasterRecording.sampleRate.current = initialRate
      }

      let started = false
      if (useSystemAudio) {
        try {
          await invoke<string>('start_macos_capture', {
            captureSystemAudio: true,
            captureMicrophone: useMic,
          })
          started = true
        } catch (e) {
          const message = String(e || '').toLowerCase()
          if (/permission|screen|denied|access/.test(message)) {
            await openScreenRecordingSettings()
            throw new Error(t('copilot.permInstruction'))
          }
          console.warn('[Floating] start_macos_capture unavailable, fallback to microphone:', e)
        }
      }
      if (!started) {
        await invoke<string>('start_capture', { deviceName: null, deepgramKey })
      }

      floatingCapturingRef.current = true
      setFloatingCapturing(true)
      return true
    } catch (e) {
      await stopFloatingCapture()
      setFloatingQuestion(String((e as any)?.message || e))
      throw e
    }
  }

  const toggleFloatingCapture = async () => {
    if (floatingOperationRef.current) return
    floatingOperationRef.current = true
    try {
      if (floatingCapturingRef.current) await stopFloatingCapture()
      else await startFloatingCapture()
    } finally {
      floatingOperationRef.current = false
    }
  }
  floatingToggleRef.current = toggleFloatingCapture

  // Keep <html lang> in sync with selected language
  useEffect(() => {
    document.documentElement.lang = currentLang
  }, [currentLang])

  // Keep ref in sync for listeners that must not close over stale state (e.g. toggle-capture)
  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  useEffect(() => {
    floatingCapturingRef.current = floatingCapturing
  }, [floatingCapturing])

  // Master recording accumulator at App level (receives events in this webview even if capture started from floating).
  // Per-session: reset on new capture (via audio-config signal + explicit at start sites).
  const masterRecordedChunksRef = useRef<number[][]>([])
  const masterSampleRateRef = useRef<number>(16000)

  // Reset master for new session (prevents cross-session accumulation in export fallback)
  const resetMasterRecording = () => {
    masterRecordedChunksRef.current = []
    // rate will be set by next audio-config or explicit initial guess
  }

  // Always listen for audio-config to update rate for current session (and reset for new capture)
  useEffect(() => {
    let unCfg: any = null
    ;(async () => {
      unCfg = await listen<{ sample_rate?: number }>('audio-config', (ev) => {
        const r = ev.payload?.sample_rate
        if (r) {
          // New capture session signalled by backend
          resetMasterRecording()
          masterSampleRateRef.current = r
          console.log('[Master] session reset + rate set from audio-config:', r)
        }
      })
    })()
    return () => { if (unCfg) unCfg.then((f: any) => f?.()).catch(()=>{}) }
  }, [])

  useEffect(() => {
    let unlisten: any = null
    ;(async () => {
      unlisten = await listen<number[]>('audio-chunk', (event) => {
        const payload = event.payload
        masterRecordedChunksRef.current.push(payload)
        // Bounded (conservative; real rate set above)
        const rate = masterSampleRateRef.current || 16000
        const MAX = rate * 15 * 60
        let total = masterRecordedChunksRef.current.reduce((s, c) => s + c.length, 0)
        while (total > MAX && masterRecordedChunksRef.current.length > 0) {
          const removed = masterRecordedChunksRef.current.shift()!
          total -= removed.length
        }
      })
    })()
    return () => { if (unlisten) unlisten.then((f: any) => f && f()).catch(()=>{}) }
  }, [])

  // Expose chunks + rate + reset for export fallback and cross-UI (same webview receives events)
  ;(window as any).__stealthMasterRecording = {
    chunks: masterRecordedChunksRef,
    sampleRate: masterSampleRateRef,
  }
  ;(window as any).__resetStealthMasterRecording = resetMasterRecording

  useEffect(() => {
    loadInterviewHistory().then(loadHistory).catch((e) => {
      console.warn('Failed to load interview history', e)
    })

    // Load persisted app settings (theme, aiModel, sttModel, language, etc.)
    loadAppSettings().then((saved) => {
      const { setSettings } = useAppStore.getState()
      setSettings({
        ...saved,
        language: saved.language || DEFAULT_LANGUAGE,
        aiModel: saved.aiModel,
        sttProvider: saved.sttProvider,
        sttModel: saved.sttModel,
      })
    }).catch(() => {})

    // Listen for global shortcut events from Rust
    const unlistenCopilot = listen('toggle-copilot', () => {
      setCurrentPage('copilot')
      invoke('launch_copilot_window').catch(() => {})
    })

    // ⌘⇧C - navigate to copilot page so capture toggle can work.
    // Use ref to avoid stale closure. When already on copilot the StealthCopilot listener does the real toggle.
    const unlistenCapture = listen('toggle-capture', () => {
      const hash = window.location.hash
      if (hash === '#copilot-floating') {
        floatingToggleRef.current().catch((e) => console.warn('floating hotkey toggle error', e))
      } else if (currentPageRef.current === 'copilot') {
        // main copilot page listener (StealthCopilot) will toggle
      } else {
        useAppStore.setState({ captureHotkeyPending: true })
        setCurrentPage('copilot')
      }
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
      invoke('stop_capture').catch(() => {})
      invoke('stop_macos_capture').catch(() => {})
    }
  }, [])

  // Dedicated early amp listener for floating webview to ensure bar updates reliably from first events (complements the one inside capture support + chunk rms)
  useEffect(() => {
    if (!isFloating) return
    let un: any = null
    ;(async () => {
      un = await listen<number>('audio-amplitude', (e) => {
        setFloatingAmp(e.payload)
      })
    })()
    return () => { if (un) un.then((f: any) => f && f()).catch(()=>{}) }
  }, [isFloating])

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
            await stopFloatingCapture()
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
          {/* Close is explicitly non-draggable and stops capture before closing. */}
          <div className="flex items-center gap-3 text-[#64748b]">
            <button 
              type="button"
              className="cursor-pointer hover:text-[#334155] px-1.5 py-0.5 rounded hover:bg-[#f1f5f9] select-none text-base leading-none" 
              data-tauri-drag-region="false"
              onClick={async (e) => {
                e.stopPropagation()
                e.preventDefault()
                console.log('[Copilot] Close button clicked')
                await stopFloatingCapture()
                const win = getCurrentWindow()
                try {
                  await win.close()
                  console.log('[Copilot] win.close() succeeded')
                } catch (err1) {
                  console.warn('[Copilot] win.close() failed:', err1)
                }
                try {
                  await (win as any).destroy?.()
                  console.log('[Copilot] win.destroy() succeeded')
                } catch (err2) {
                  console.warn('[Copilot] destroy() failed:', err2)
                }
                try {
                  await invoke('close_copilot_window')
                  console.log('[Copilot] close_copilot_window invoke succeeded')
                } catch (err3) {
                  console.warn('[Copilot] Rust close command failed:', err3)
                }
                try { window.close() } catch {}
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
          <div className="text-[13px] leading-tight min-h-[36px]">
            {floatingQuestion || <span className="text-[#64748b] text-[11px]">{t('copilot.question.empty')}</span>}
          </div>
        </div>

        <div>
          <div className="text-[10px] tracking-widest text-[#64748b] mb-1.5">{t('copilot.suggestions')}</div>
          <div className="space-y-[3px] text-[12.5px] max-h-[110px] overflow-auto">
            {floatingSuggestions.length === 0 && (
              <div className="text-[#64748b] text-[11px]">{t('copilot.suggestions.emptyShort')}</div>
            )}
            {floatingSuggestions.map((s, i) => (
              <div key={i} className="bg-[#f8fafc] border border-[#e2e8f0] rounded-lg px-2.5 py-1">{s}</div>
            ))}
          </div>
        </div>

        {/* Capture controls in floating */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => floatingToggleRef.current().catch((e) => console.warn('Floating capture toggle error', e))}
            className={`text-xs px-3 py-1 rounded ${floatingCapturing ? 'bg-red-500 text-white' : 'bg-[#6366f1] text-white'}`}
          >
            {floatingCapturing ? t('copilot.stopCapture') : t('copilot.startCapture')}
          </button>
          <button onClick={() => { setFloatingSuggestions([]); setFloatingQuestion('') }} className="text-xs px-2 py-1 border rounded">{t('copilot.clear')}</button>
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
