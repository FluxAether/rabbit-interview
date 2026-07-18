import { useState, useRef, useEffect } from 'react'
import { Mic, Volume2, Edit3, X, Shield, ExternalLink, Play, Square } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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

  const deepgramWsRef = useRef<WebSocket | null>(null)

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

  useEffect(() => {
    loadDevices()
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

  const toggleCapture = async () => {
    try {
      if (!isCapturing) {
        // Start real audio with selected device
        const res = await invoke<string>('start_capture', { 
          deviceName: selectedDevice || null 
        })
        setStatus(res)
        setIsCapturing(true)
        setCopilotActive(true)
        setRecordedChunks([])

        // Start Deepgram real-time transcription (if key present)
        const ws = await startDeepgramStream(
          (text, isFinal) => {
            if (text) {
              // Use transcript as the "question" the interviewer asked
              // This is the key integration: real STT feeds the LLM
              if (isFinal) {
                updateCopilotQuestion?.(text)  // update question from real speech
              }
              // Generate AI suggestions based on real transcript
              generateSuggestions(text).then((sugs) => {
                sugs.forEach((s: string) => {
                  addSuggestion({ text: s.startsWith('•') ? s : `• ${s}`, category: 'Deepgram + Groq' })
                })
              })
            }
          },
          (err) => console.error('Deepgram error', err)
        )
        deepgramWsRef.current = ws

        await listen<number>('audio-amplitude', (event) => {
          updateAmplitude(event.payload)
        })

        await listen<number[]>('audio-chunk', async (event) => {
          const chunk = new Float32Array(event.payload)
          setRecordedChunks(prev => [...prev, Array.from(chunk)])

          // Send to Deepgram (real STT)
          if (deepgramWsRef.current) {
            sendAudioChunk(deepgramWsRef.current, chunk)
          }

          // Also generate suggestions from LLM (can run in parallel with STT)
          if (Math.random() > 0.75) {
            const suggestions = await generateSuggestions(copilot.currentQuestion || "Tell me about a recent project.");
            suggestions.forEach((s: string) => {
              addSuggestion({ text: s.startsWith('•') ? s : `• ${s}`, category: "AI" })
            });
          }
        })
      } else {
        await invoke('stop_capture')
        closeDeepgramStream(deepgramWsRef.current)
        deepgramWsRef.current = null
        setStatus('Stopped')
        setIsCapturing(false)
        setCopilotActive(false)
      }
    } catch (err: any) {
      setStatus('Error: ' + (err?.message || err))
      setIsCapturing(!isCapturing)
      closeDeepgramStream(deepgramWsRef.current)
      deepgramWsRef.current = null
      if (!isCapturing) {
        setCopilotActive(true)
        setRecordedChunks([])
        const interval = setInterval(() => {
          updateAmplitude(Math.random() * 0.8)
          if (Math.random() > 0.7) {
            addSuggestion({ text: "• Keep answers under 90 seconds.", category: "Clarity" })
          }
        }, 1200)
        setTimeout(() => clearInterval(interval), 25000)
      }
    }
  }

  const exportRecording = () => {
    if (recordedChunks.length === 0) {
      alert(t('copilot.noRecording'))
      return
    }
    const blob = new Blob([JSON.stringify(recordedChunks)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `interview-recording-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const ampBarWidth = Math.min(100, Math.round(copilot.amplitude * 140))

  const getDisplayStatus = (s: string, tt: (k: string) => string) => {
    if (s === 'Idle' || s === '空闲') return tt('misc.idle')
    if (s.includes('started') || s.includes('capture')) return tt('copilot.start')
    if (s.includes('Stopped') || s.includes('stop')) return tt('copilot.stop')
    return s
  }

  return (
    <div className="p-8">
      <div className="max-w-[820px] mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t('copilot.title')}</h1>
            <p className="text-[#475569]">{t('copilot.subtitle')}</p>
            <div className="text-xs mt-1 text-[#64748b]">{t('copilot.status')}: {getDisplayStatus(status, t)} {isCapturing ? '●' : ''}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Device selector */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#64748b]">{t('copilot.device')}:</span>
              <select 
                value={selectedDevice} 
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="bg-white border border-[#e2e8f0] rounded px-2 py-0.5 text-xs max-w-[180px]"
                disabled={isCapturing}
              >
                {devices.length === 0 && <option value="">{t('copilot.defaultDevice')}</option>}
                {devices.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <button onClick={loadDevices} className="text-[#6366f1] hover:underline" disabled={isCapturing}>↻</button>
            </div>

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
            disabled={recordedChunks.length === 0}
            className="text-xs py-1.5 border rounded-xl hover:bg-[#f8fafc] disabled:opacity-50"
          >
            {t('copilot.exportRecording')}
          </button>
        </div>
      </div>
    </div>
  )
}
