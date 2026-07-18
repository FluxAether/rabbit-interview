import { useState, useRef, useEffect } from 'react'
import { Mic, Volume2, Edit3, X, Shield, ExternalLink, Play, Square } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAppStore } from '../stores/useAppStore'
import { generateSuggestions, startDeepgramStream, sendAudioChunk, closeDeepgramStream } from '../lib/llm'
import { useTranslation } from '../i18n'
import { buildExportWav } from '../lib/recording'

// Testable pure implementation of the export logic (computation via buildExportWav + side effects).
// The component's exportRecording delegates to this so that node verification can literally invoke
// the shipped behavior with controlled fixtures for master state, refs, etc.
export function performExportRecording(deps: {
  t: (k: string) => string;
  recordedChunks: number[][];
  recordedChunksRef: { current: number[][] };
  sampleRateRef: { current: number };
  buildExportWav: (recordedChunks: number[][], recordedChunksRef: { current: number[][] }, sampleRateRef: { current: number }, master: any) => { buffer: ArrayBuffer | null; sampleRate: number };
  alert?: (msg: string) => void;
  Blob?: any;
  URL?: any;
  document?: any;
}) {
  const {
    t,
    recordedChunks,
    recordedChunksRef,
    sampleRateRef,
    buildExportWav,
    alert: alertFn = (typeof alert !== 'undefined' ? alert : (m: string) => console.log('[test-alert]', m)),
    Blob: BlobCtor = (typeof Blob !== 'undefined' ? Blob : class { constructor(_: any, __: any){} }),
    URL: URLObj = (typeof URL !== 'undefined' ? URL : { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} }),
    document: doc = (typeof document !== 'undefined' ? document : { createElement: (_tag: string) => ({ href: '', download: '', click: () => {} }) }),
  } = deps;

  const w = (typeof window !== 'undefined' ? window : globalThis);
  const master = (w as any).__stealthMasterRecording;
  const result = buildExportWav(recordedChunks, recordedChunksRef, sampleRateRef, master);
  if (!result || !result.buffer) {
    alertFn(t('copilot.noRecording'));
    return { exported: false, buffer: null, sampleRate: result ? result.sampleRate : 16000 };
  }
  const blob = new BlobCtor([result.buffer], { type: 'audio/wav' });
  const url = URLObj.createObjectURL(blob);
  const a = doc.createElement('a') as any;
  a.href = url;
  a.download = `interview-recording-${Date.now()}.wav`;
  a.click();
  URLObj.revokeObjectURL(url);
  return { exported: true, sampleRate: result.sampleRate, buffer: result.buffer };
}

export default function StealthCopilot() {
  const { copilot, setCopilotActive, addSuggestion, updateAmplitude, applySuggestion, updateCopilotQuestion } = useAppStore()
  const t = useTranslation()
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState('Idle')
  const [devices, setDevices] = useState<string[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')

  // New: macOS native capture (ScreenCaptureKit) for system audio + mic
  // Defaults + loaded from persisted settings so choice survives detach / reload
  const [useSystemAudio, setUseSystemAudio] = useState(true)
  const [useMicWithSystem, setUseMicWithSystem] = useState(true)
  const [macosSources, setMacosSources] = useState<any>(null)

  const deepgramWsRef = useRef<WebSocket | null>(null)
  // Store unlisten functions so we can properly remove listeners on stop
  const unlistenAmpRef = useRef<(() => void) | null>(null)
  const unlistenChunkRef = useRef<(() => void) | null>(null)
  const unlistenConfigRef = useRef<(() => void) | null>(null)
  // Accumulate recorded audio in a ref to avoid flooding React state on every audio buffer
  const recordedChunksRef = useRef<number[][]>([])
  // Used to guard async callbacks (transcription etc.) after we've stopped
  const isCapturingRef = useRef(false)
  // Actual sample rate reported by the audio backend (critical for correct STT + WAV export)
  const sampleRateRef = useRef<number>(16000)
  // Ref to current toggle function so shortcuts can safely call it
  const toggleCaptureRef = useRef<() => Promise<void>>(async () => {})

  const cleanupListeners = () => {
    if (unlistenAmpRef.current) {
      try { unlistenAmpRef.current() } catch {}
      unlistenAmpRef.current = null
    }
    if (unlistenChunkRef.current) {
      try { unlistenChunkRef.current() } catch {}
      unlistenChunkRef.current = null
    }
    if (unlistenConfigRef.current) {
      try { unlistenConfigRef.current() } catch {}
      unlistenConfigRef.current = null
    }
  }

  const loadDevices = async () => {
    try {
      const list = await invoke<string[]>('list_audio_devices')
      setDevices(list)
      if (list.length > 0 && !selectedDevice) {
        setSelectedDevice(list[0])
      }
    } catch (e) {
      console.warn('Failed to list devices', e)
    }
  }

  const loadMacosSources = async () => {
    try {
      const sources = await invoke<any>('list_macos_sources')
      setMacosSources(sources)
    } catch (e) {
      console.warn('list_macos_sources not available (feature macos-system-audio not enabled or non-mac)', e)
      setMacosSources(null)
    }
  }

  const openNativePicker = async () => {
    try {
      await invoke('present_macos_content_picker')
      setTimeout(loadMacosSources, 1200)
    } catch (e) {
      console.warn('present_macos_content_picker not available', e)
      alert('Native content picker is only available when the app was built with macOS system audio support.')
    }
  }

  const requestScreenPermission = async () => {
    try {
      // Dynamically import to avoid hard dependency at module load time.
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      // Open the operating system's Screen Recording permission settings page directly.
      // This works on macOS (Ventura / Sonoma / Sequoia+). The user can toggle the app there.
      await openUrl('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')

      // Also attempt to surface the native permission prompt (best effort, non-blocking).
      // This helps first-time users while the Settings page is open for manual toggle.
      invoke<boolean>('check_screen_recording_permission').catch(() => {})
    } catch (e) {
      // Fallback: try to trigger the permission prompt via ScreenCaptureKit check,
      // and show instructions if that also isn't available.
      try {
        const ok = await invoke<boolean>('check_screen_recording_permission')
        if (!ok) {
          alert(t('copilot.permInstruction'))
        } else {
          alert(t('copilot.permGranted'))
        }
      } catch {
        alert(t('copilot.permMacOnly'))
      }
    }
  }

  // Persist copilot audio mode toggles so they survive floating detach / reload
  const persistAudioPrefs = async (sys: boolean, mic: boolean) => {
    try {
      const { saveAppSettings } = await import('../lib/settingsStore')
      await saveAppSettings({ useSystemAudio: sys, useMicWithSystem: mic })
    } catch {}
  }

  useEffect(() => {
    loadDevices()
    // Load persisted audio capture prefs (so useSystemAudio etc survive detach to floating or app restart)
    ;(async () => {
      try {
        const { loadAppSettings } = await import('../lib/settingsStore')
        const saved = await loadAppSettings()
        if (typeof saved.useSystemAudio === 'boolean') setUseSystemAudio(saved.useSystemAudio)
        if (typeof saved.useMicWithSystem === 'boolean') setUseMicWithSystem(saved.useMicWithSystem)
      } catch {}
    })()
    return () => {
      // Ensure we clean up everything if component unmounts while capturing
      cleanupListeners()
      if (deepgramWsRef.current) {
        closeDeepgramStream(deepgramWsRef.current)
        deepgramWsRef.current = null
      }
      // Best effort stop on backend too (use ref because state may be stale in cleanup)
      if (isCapturingRef.current) {
        invoke('stop_capture').catch(() => {})
        invoke('stop_macos_capture').catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Global shortcut support: ⌘⇧C etc. will emit this from Rust
  useEffect(() => {
    const unlisten = listen('toggle-capture', () => {
      // Use ref so we always call the current implementation
      toggleCaptureRef.current().catch((e) => console.warn('toggle-capture via shortcut failed', e))
    })
    return () => {
      unlisten.then((f) => f()).catch(() => {})
    }
  }, [])

  // Consume hotkey pending from App (so ⌘⇧C from other pages navigates + starts capture)
  useEffect(() => {
    const { captureHotkeyPending, consumeCaptureHotkeyPending } = useAppStore.getState()
    if (captureHotkeyPending && !isCapturingRef.current) {
      const did = consumeCaptureHotkeyPending()
      if (did) {
        // trigger toggle (which will start)
        setTimeout(() => {
          toggleCaptureRef.current().catch((e) => console.warn('hotkey pending start failed', e))
        }, 80)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount of copilot panel

  const launchFloatingWindow = async () => {
    try {
      await invoke('launch_copilot_window')
    } catch (e) {
      new WebviewWindow('copilot', {
        url: 'index.html#copilot-floating',
        title: 'AI Interview Assistant',
        width: 420,
        height: 380,
        resizable: false,
        alwaysOnTop: true,
        decorations: false,
        closable: true,
        // transparent omitted to match Rust path and CSS-based card look
      })
    }
  }

  const [recordedChunks, setRecordedChunks] = useState<number[][]>([])
  const [hasLiveRecording, setHasLiveRecording] = useState(false)

  // Snapshot the ref into state so Export button works after stopping
  const snapshotRecording = () => {
    setRecordedChunks(recordedChunksRef.current.slice())
    setHasLiveRecording(recordedChunksRef.current.length > 0)
  }

  const resetRecording = () => {
    recordedChunksRef.current = []
    setRecordedChunks([])
    setHasLiveRecording(false)
    // Also reset master (in case previous session was floating-started or cross-session data)
    const w = window as any
    if (w.__resetStealthMasterRecording) w.__resetStealthMasterRecording()
    if (w.__stealthMasterRecording?.sampleRate) w.__stealthMasterRecording.sampleRate.current = 16000
  }

  const toggleCapture = async () => {
    // If currently capturing, stop first (do this outside try so UI feels responsive)
    if (isCapturing) {
      // Flip UI state immediately so button and status respond
      setIsCapturing(false)
      isCapturingRef.current = false
      setCopilotActive(false)
      setStatus('Stopping...')

      // 1. Stop emitting new events from backend — always call both to cover cpal + SCK
      try {
        await invoke('stop_capture')
      } catch (e) {
        console.warn('stop_capture invoke failed:', e)
      }
      try { await invoke('stop_macos_capture').catch(() => {}) } catch {}

      // 2. Close Deepgram WS
      closeDeepgramStream(deepgramWsRef.current)
      deepgramWsRef.current = null

      // 3. Remove the heavy audio listeners (this was the main cause of continued work + freezes)
      cleanupListeners()

      // 4. Snapshot whatever we recorded so export works
      snapshotRecording()

      setStatus('Stopped')
      return
    }

    // === START CAPTURE ===
    try {
      // Clean any stale listeners from previous (interrupted) session
      cleanupListeners()
      resetRecording()
      sampleRateRef.current = 16000 // will be overwritten by audio-config event shortly

      // Pass deepgram key to allow optional Rust-side forwarding (future enhancement / direct connection)
      let deepgramKey: string | null = null
      try {
        const { loadApiKeys } = await import('../lib/keyStore')
        const keys = await loadApiKeys()
        deepgramKey = keys.deepgram || null
      } catch {}
      let res: string

      // Smart initial guess for sample rate. SCK always uses 48k. cpal often 16k or device default.
      const initialRateGuess = useSystemAudio ? 48000 : 16000
      sampleRateRef.current = initialRateGuess

      // Reusable starter for Deepgram so we can (re)create with correct rate when we learn it.
      // Defined early so config listener (registered before backend start) can call it.
      const startOrRestartDeepgram = async (rate: number) => {
        // Close previous if any (e.g. rate changed)
        if (deepgramWsRef.current) {
          closeDeepgramStream(deepgramWsRef.current)
          deepgramWsRef.current = null
        }
        const ws = await startDeepgramStream(
          (text, isFinal) => {
            // Guard: ignore late callbacks after user clicked stop
            if (!isCapturingRef.current) return
            if (text) {
              if (isFinal) {
                updateCopilotQuestion?.(text)
                emit('copilot-question', text).catch(() => {})
              }
              // IMPORTANT: Only call LLM on FINAL results to avoid spamming the model on every interim.
              if (isFinal) {
                generateSuggestions(text).then((sugs) => {
                  if (!isCapturingRef.current) return
                  const { settings } = useAppStore.getState()
                  const modelLabel = (settings?.aiModel || 'groq').replace(/-/g, ' ')
                  sugs.forEach((s: string) => {
                    const sugText = s.startsWith('•') ? s : `• ${s}`
                    addSuggestion({ text: sugText, category: `Deepgram + ${modelLabel}` })
                    emit('copilot-suggestion', { text: sugText }).catch(() => {})
                  })
                })
              }
            }
          },
          (err) => console.error('Deepgram error', err),
          rate
        )
        deepgramWsRef.current = ws
        console.log('[Copilot] Deepgram stream (re)started @', rate, 'Hz')
      }

      // FIX: register audio-config listener BEFORE invoking start_* (Rust may emit synchronously on start_macos_capture / start_capture).
      // This mirrors the floating path fix so first rate event is never missed.
      const unlistenConfig = await listen<{ sample_rate: number; device: string }>('audio-config', async (event) => {
        const rate = event.payload.sample_rate || initialRateGuess
        if (rate !== sampleRateRef.current) {
          sampleRateRef.current = rate
          console.log('[Copilot] Audio config received (rate updated):', event.payload)
          // Recreate Deepgram stream with correct rate (important for accurate transcription)
          if (isCapturingRef.current) {
            await startOrRestartDeepgram(rate)
          }
        } else {
          sampleRateRef.current = rate
          console.log('[Copilot] Audio config received:', event.payload)
        }
      })
      unlistenConfigRef.current = unlistenConfig

      // Start Deepgram immediately with best guess (listeners already wired).
      await startOrRestartDeepgram(sampleRateRef.current)

      // FIX: also pre-register amp + chunk listeners BEFORE backend start (so first events/amps are not dropped).
      // Amplitude listener — very cheap, OK to keep
      const unlistenAmp = await listen<number>('audio-amplitude', (event) => {
        if (!isCapturingRef.current) return
        updateAmplitude(event.payload)
      })
      unlistenAmpRef.current = unlistenAmp

      // Chunk listener — lightweight: full buffers, ref only, forward to STT.
      const unlistenChunk = await listen<number[]>('audio-chunk', (event) => {
        if (!isCapturingRef.current) return
        const chunk = new Float32Array(event.payload)

        // Accumulate in ref only (no re-renders, prevents UI freeze)
        const wasEmpty = recordedChunksRef.current.length === 0
        recordedChunksRef.current.push(Array.from(chunk))

        // BOUND MEMORY: keep only last ~15 minutes of audio (important fix for long sessions)
        const MAX_DURATION_SEC = 15 * 60;
        const rate = sampleRateRef.current || 16000;
        const maxSamples = rate * MAX_DURATION_SEC;
        let totalSamples = recordedChunksRef.current.reduce((sum, c) => sum + c.length, 0);
        while (totalSamples > maxSamples && recordedChunksRef.current.length > 0) {
          const removed = recordedChunksRef.current.shift()!;
          totalSamples -= removed.length;
        }

        if (wasEmpty) {
          // Light state update so Export button enables promptly during capture
          setHasLiveRecording(true)
        }

        // Forward to STT engine (now with correct sample rate)
        if (deepgramWsRef.current) {
          sendAudioChunk(deepgramWsRef.current, chunk)
        }
      })
      unlistenChunkRef.current = unlistenChunk

      // Mark capturing ref early so pre-registered listeners accept first events
      isCapturingRef.current = true

      // Prefer native macOS ScreenCaptureKit when system audio is desired
      // This allows capturing the other person's voice without BlackHole.
      // The command only exists when the crate was compiled with --features macos-system-audio
      if (useSystemAudio) {
        try {
          res = await invoke<string>('start_macos_capture', {
            // Must match exact Rust parameter names (snake_case) defined in screencapturekit.rs
            capture_system_audio: true,
            capture_microphone: useMicWithSystem,
            deepgram_key: deepgramKey
          })
        } catch (e: any) {
          // Fallback if the native command is not available (feature not enabled or non-mac)
          console.warn('start_macos_capture not available, falling back to mic-only:', e)
          res = await invoke<string>('start_capture', {
            deviceName: selectedDevice || null,
            deepgramKey
          })
          setStatus('Using microphone only (no system audio). Install/build with macos-system-audio feature for interviewer voice capture. ' + (res || ''))
        }
      } else {
        res = await invoke<string>('start_capture', {
          deviceName: selectedDevice || null,
          deepgramKey
        })
      }

      setStatus(res)
      setIsCapturing(true)
      setCopilotActive(true)

      // The config listener above will correct rate if backend reports different from guess.

      // If no key was present at start time, Deepgram stream returns null and we fall back to no live transcription.
      if (!deepgramWsRef.current) {
        setStatus((prev) => (prev || '') + ' | (No Deepgram key at start — live transcription disabled)')
      }
    } catch (err: any) {
      setStatus('Error: ' + (err?.message || err))
      // Cleanup on failure
      cleanupListeners()
      closeDeepgramStream(deepgramWsRef.current)
      deepgramWsRef.current = null
      setIsCapturing(false)
      isCapturingRef.current = false
      setCopilotActive(false)
    }
  }

  // Keep a live reference to the toggle function so shortcuts can call the latest version
  toggleCaptureRef.current = toggleCapture

  // Convert collected f32 chunks + known sample rate into a playable mono WAV (PCM16)
  const exportRecording = () => performExportRecording({
    t,
    recordedChunks,
    recordedChunksRef,
    sampleRateRef,
    buildExportWav,
  })

  const ampBarWidth = Math.min(100, Math.round(copilot.amplitude * 140))

  const getDisplayStatus = (s: string, tt: (k: string) => string) => {
    if (s === 'Idle' || s === '空闲') return tt('misc.idle')
    if (s.includes('started') || s.includes('capture')) return tt('copilot.start')
    if (s.includes('Stopped') || s.includes('stop') || s === 'Stopping...') return tt('copilot.stop')
    return s
  }

  return (
    <div className="p-8">
      <div className="max-w-[820px] mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('copilot.title')}</h1>
            <p className="text-[#475569]">{t('copilot.subtitle')}</p>
            <div className="text-xs mt-1 text-[#64748b]">
              {t('copilot.status')}: {getDisplayStatus(status, t)} {isCapturing ? '●' : ''}
              {isCapturing && <span className="ml-2 opacity-60">@{sampleRateRef.current}Hz</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Device selector + new macOS native option */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#64748b]">{t('copilot.device')}:</span>
              <select 
                value={selectedDevice} 
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="bg-white border border-[#e2e8f0] rounded px-2 py-0.5 text-xs max-w-[180px]"
                disabled={isCapturing || useSystemAudio}
              >
                {devices.length === 0 && <option value="">{t('copilot.defaultDevice')}</option>}
                {devices.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <button onClick={loadDevices} className="text-[#6366f1] hover:underline" disabled={isCapturing || useSystemAudio}>↻</button>
            </div>

            {/* macOS ScreenCaptureKit toggle - the key improvement */}
            <label className="flex items-center gap-1.5 text-[11px] text-[#475569] mt-0.5">
              <input
                type="checkbox"
                checked={useSystemAudio}
                onChange={(e) => { const v = e.target.checked; setUseSystemAudio(v); persistAudioPrefs(v, useMicWithSystem) }}
                disabled={isCapturing}
                className="accent-[#6366f1]"
              />
              <span>{t('copilot.useSystemAudio')}</span>
            </label>
            {useSystemAudio && (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-[#475569] -mt-0.5 ml-4">
                  <input
                    type="checkbox"
                    checked={useMicWithSystem}
                    onChange={(e) => { const v = e.target.checked; setUseMicWithSystem(v); persistAudioPrefs(useSystemAudio, v) }}
                    disabled={isCapturing}
                    className="accent-[#6366f1]"
                  />
                  <span>{t('copilot.alsoCaptureMic')}</span>
                </label>
                <div className="flex gap-2 text-[11px] ml-4">
                  <button onClick={loadMacosSources} className="text-[#6366f1] hover:underline" disabled={isCapturing}>{t('copilot.listSources')}</button>
                  <button onClick={openNativePicker} className="text-[#6366f1] hover:underline" disabled={isCapturing}>{t('copilot.openPicker')}</button>
                  <button onClick={requestScreenPermission} className="text-[#6366f1] hover:underline" disabled={isCapturing}>{t('copilot.requestPerm')}</button>
                </div>
                {macosSources && (
                  <div className="text-[10px] text-[#64748b] ml-4 max-w-[220px]">
                    Sources loaded: {macosSources.displays?.length || 0} displays, {macosSources.windows?.length || 0} windows.
                    (Picker recommended for precise selection)
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2">
              <button
                onClick={launchFloatingWindow}
                className="flex items-center gap-2 px-4 py-2 bg-white border rounded-2xl text-sm hover:bg-[#f8fafc]"
              >
                <ExternalLink className="w-4 h-4" /> {t('copilot.detach')}
              </button>
              <button
                onClick={toggleCapture}
                className={`flex items-center gap-2 px-5 py-2 rounded-2xl text-sm font-medium text-white ${isCapturing ? 'bg-red-500' : 'bg-[#6366f1] hover:bg-[#4f46e5]'}`}
              >
                {isCapturing ? <><Square className="w-4 h-4" /> {t('copilot.stop')}</> : <><Play className="w-4 h-4" /> {t('copilot.start')}</>}
              </button>
            </div>
          </div>
        </div>

        <div className="floating-panel w-full max-w-[460px] p-4 text-sm shadow-xl mx-auto border border-[#e2e8f0]">
          <div className="flex items-center justify-between mb-3 px-1">
            {/* Only title area is draggable */}
            <div className="flex items-center gap-2" data-tauri-drag-region style={{ cursor: 'move' }}>
              <div className="w-7 h-7 rounded-lg bg-[#6366f1] flex items-center justify-center">
                <Mic className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-semibold tracking-tight">{t('copilot.floating.title')}</span>
            </div>
            <div className="flex items-center gap-3 text-[#64748b]">
              <Volume2 className="w-4 h-4 cursor-pointer" data-tauri-drag-region="false" />
              <Edit3 className="w-4 h-4 cursor-pointer" data-tauri-drag-region="false" />
              <X 
                className="w-4 h-4 cursor-pointer hover:text-[#334155] px-1 py-0.5 rounded hover:bg-[#f1f5f9]" 
                data-tauri-drag-region="false"
                onClick={(e) => {
                  e.stopPropagation()
                  setCopilotActive(false)
                }} 
              />
            </div>
          </div>

          <div className="h-1 bg-[#e2e8f0] rounded mb-3 overflow-hidden">
            <div className="h-1 bg-[#6366f1] transition-all" style={{ width: `${ampBarWidth}%` }} />
          </div>

          <div className="mb-4">
            <div className="uppercase text-[10px] tracking-widest text-[#64748b] mb-1 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full border flex items-center justify-center text-[9px]">Q</div>
              {t('copilot.question')}
            </div>
            <div className="text-[13.5px] leading-snug min-h-[42px]">
              {copilot.currentQuestion}
            </div>
          </div>

          <div>
            <div className="uppercase text-[10px] tracking-widest text-[#64748b] mb-1.5 flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full border flex items-center justify-center">✦</div>
              {t('copilot.suggestions')}
            </div>

            <div className="space-y-1.5 max-h-[170px] overflow-auto pr-1">
              {copilot.suggestions.length === 0 && (
                <div className="text-[#64748b] text-xs">{t('copilot.suggestions.empty')}</div>
              )}
              {copilot.suggestions.map((sug, idx) => (
                <div
                  key={idx}
                  onClick={() => applySuggestion(sug.id)}
                  className={`suggestion-bubble cursor-pointer hover:border-[#6366f1] flex justify-between items-center ${sug.applied ? 'opacity-60 line-through' : ''}`}
                >
                  <span>{sug.text}</span>
                  {!sug.applied && <span className="text-[10px] text-[#6366f1]">Apply</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t flex items-center text-[11px] text-[#6366f1]">
            <Shield className="w-3.5 h-3.5 mr-1.5" /> {t('copilot.stealthActive')}
          </div>
        </div>

        <div className="mt-4 text-xs text-center text-[#64748b]">
          {t('copilot.tip')}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              const { copilot, addHistory } = useAppStore.getState()
              if (copilot.currentQuestion) {
                addHistory({
                  date: new Date().toISOString().slice(0,16).replace('T',' '),
                  role: 'Live Interview',
                  company: 'Real-time',
                  score: 80 + Math.floor(Math.random() * 15),
                  transcript: `Q: ${copilot.currentQuestion}\nSuggestions: ${copilot.suggestions.map(s => s.text).join('; ')}`,
                  duration: 420,
                  mode: 'copilot'
                })
                alert(t('copilot.sessionSaved'))
              }
            }}
            className="text-xs py-1.5 border rounded-xl hover:bg-[#f8fafc]"
          >
            {t('copilot.saveSession')}
          </button>

          <button
            onClick={exportRecording}
            disabled={!hasLiveRecording && recordedChunks.length === 0 && !((window as any).__stealthMasterRecording?.chunks?.current?.length > 0)}
            className="text-xs py-1.5 border rounded-xl hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {t('copilot.exportRecording')}
          </button>
        </div>
      </div>
    </div>
  )
}
