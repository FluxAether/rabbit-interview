import { useState, useRef, useEffect } from 'react'
import { Mic, Volume2, Edit3, X, Shield, ExternalLink, Play, Square } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAppStore } from '../stores/useAppStore'
import { generateSuggestions, startDeepgramStream, sendAudioChunk, closeDeepgramStream } from '../lib/llm'
import { useTranslation } from '../i18n'

export default function StealthCopilot() {
  const { copilot, setCopilotActive, addSuggestion, updateAmplitude, applySuggestion, updateCopilotQuestion } = useAppStore()
  const t = useTranslation()
  const [isCapturing, setIsCapturing] = useState(false)
  const [status, setStatus] = useState('Idle')
  const [devices, setDevices] = useState<string[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')

  // New: macOS native capture (ScreenCaptureKit) for system audio + mic
  const [useSystemAudio, setUseSystemAudio] = useState(true) // default on for better interview experience
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
      const ok = await invoke<boolean>('check_screen_recording_permission')
      alert(ok ? 'Permission OK (or already granted)' : 'Please grant Screen Recording permission in System Settings > Privacy & Security')
    } catch (e) {
      alert('Screen recording permission check is only available with macOS system audio support enabled.')
    }
  }

  useEffect(() => {
    loadDevices()
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
  }

  const toggleCapture = async () => {
    // If currently capturing, stop first (do this outside try so UI feels responsive)
    if (isCapturing) {
      // Flip UI state immediately so button and status respond
      setIsCapturing(false)
      isCapturingRef.current = false
      setCopilotActive(false)
      setStatus('Stopping...')

      // 1. Stop emitting new events from backend
      try {
        await invoke('stop_capture')
      } catch (e) {
        console.warn('stop_capture invoke failed:', e)
      }

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

      // Prefer native macOS ScreenCaptureKit when system audio is desired
      // This allows capturing the other person's voice without BlackHole.
      // The command only exists when the crate was compiled with --features macos-system-audio
      if (useSystemAudio) {
        try {
          res = await invoke<string>('start_macos_capture', {
            captureSystemAudio: true,
            captureMicrophone: useMicWithSystem,
            deepgramKey
          })
        } catch (e: any) {
          // Fallback if the native command is not available (feature not enabled or non-mac)
          console.warn('start_macos_capture not available, falling back to mic-only:', e)
          res = await invoke<string>('start_capture', {
            deviceName: selectedDevice || null,
            deepgramKey
          })
          setStatus('Native system audio unavailable — using mic only. ' + (res || ''))
        }
      } else {
        res = await invoke<string>('start_capture', {
          deviceName: selectedDevice || null,
          deepgramKey
        })
      }

      setStatus(res)
      setIsCapturing(true)
      isCapturingRef.current = true
      setCopilotActive(true)

      // Listen for audio-config (sent once at start of capture) to get real sample rate
      const unlistenConfig = await listen<{ sample_rate: number; device: string }>('audio-config', (event) => {
        const rate = event.payload.sample_rate || 16000
        sampleRateRef.current = rate
        console.log('[Copilot] Audio config received:', event.payload)
      })
      unlistenConfigRef.current = unlistenConfig

      // Start Deepgram using the **actual** sample rate from the mic (or default 16k)
      const currentRate = sampleRateRef.current
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
            // This was one source of excessive work.
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
        currentRate
      )
      deepgramWsRef.current = ws

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
  const exportRecording = () => {
    const data = recordedChunks.length > 0 ? recordedChunks : recordedChunksRef.current
    if (data.length === 0) {
      alert(t('copilot.noRecording'))
      return
    }

    // Flatten all chunks into one Float32Array
    const flatLength = data.reduce((sum, arr) => sum + arr.length, 0)
    const flat = new Float32Array(flatLength)
    let offset = 0
    for (const chunk of data) {
      flat.set(chunk, offset)
      offset += chunk.length
    }

    const sampleRate = sampleRateRef.current || 16000
    const numChannels = 1
    const bytesPerSample = 2 // PCM16

    // Build WAV header (standard PCM)
    const blockAlign = numChannels * bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = flat.length * bytesPerSample
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeString(view, 8, 'WAVE')

    // fmt sub-chunk
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true) // PCM chunk size
    view.setUint16(20, 1, true)  // Audio format = 1 (PCM)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, 16, true) // bits per sample

    // data sub-chunk
    writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    // Write PCM16 samples (convert f32 -1..1 to int16)
    let pos = 44
    for (let i = 0; i < flat.length; i++) {
      const s = Math.max(-1, Math.min(1, flat[i]))
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      pos += 2
    }

    const blob = new Blob([buffer], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `interview-recording-${Date.now()}.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

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
                onChange={(e) => setUseSystemAudio(e.target.checked)}
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
                    onChange={(e) => setUseMicWithSystem(e.target.checked)}
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
            disabled={!hasLiveRecording && recordedChunks.length === 0}
            className="text-xs py-1.5 border rounded-xl hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {t('copilot.exportRecording')}
          </button>
        </div>
      </div>
    </div>
  )
}
