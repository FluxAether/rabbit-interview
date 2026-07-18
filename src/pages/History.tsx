import { useEffect, useState, useRef } from 'react'
import { useAppStore, InterviewRecord } from '../stores/useAppStore'
import WaveSurfer from 'wavesurfer.js'
import { loadHistory as loadHistoryDb } from '../lib/db'
import { useTranslation } from '../i18n'

export default function History() {
  const { history, loadHistory } = useAppStore()
  const t = useTranslation()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<InterviewRecord | null>(null)

  useEffect(() => {
    // Load from SQLite via plugin
    loadHistoryDb().then((records: any[]) => {
      if (records && records.length) {
        loadHistory(records.map(r => ({
          ...r,
          id: r.id,
        })))
      }
    }).catch(console.error)
  }, [])

  const filtered = history.filter(h =>
    (h.role + h.company).toLowerCase().includes(search.toLowerCase())
  )

  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const replay = (record: InterviewRecord) => {
    setSelected(record)
    setIsPlaying(false)
    
    // Initialize wavesurfer after render
    setTimeout(() => {
      if (waveformRef.current && !wavesurferRef.current) {
        try {
          wavesurferRef.current = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: '#6366f1',
            progressColor: '#4f46e5',
            height: 60,
            barWidth: 2,
            barGap: 1,
          })
          // Use a silent oscillator or just the visual for demo
          // For real: load a blob URL from recorded audio
          wavesurferRef.current.load('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=') // tiny silent wav
        } catch (e) {
          console.warn('WaveSurfer init (demo mode)')
        }
      }
    }, 80)
  }

  const toggleReplayAudio = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause()
      setIsPlaying(!isPlaying)
    } else {
      // Fallback animation
      setIsPlaying(!isPlaying)
    }
  }

  return (
    <div className="p-8 max-w-[1000px]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold">{t('history.title')}</h1>
          <div className="text-sm text-[#475569]">{t('history.subtitle')}</div>
        </div>
        <button className="px-4 py-1.5 text-sm border rounded-xl" onClick={() => alert(t('history.exportDemo'))}>{t('common.export')}</button>
      </div>

      <input 
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full mb-4 bg-white border border-[#e2e8f0] rounded-2xl px-4 py-2 text-sm placeholder:text-[#94a3b8]" 
        placeholder={t('history.search')} 
      />

      <div className="flex gap-2 mb-3 text-xs">
        <div className="px-3 py-1 bg-white border rounded-full">{t('common.allInterviews')}</div>
        <div className="px-3 py-1 bg-white border rounded-full">{t('common.allScores')}</div>
        <div className="px-3 py-1 bg-white border rounded-full">{t('common.filters')}</div>
      </div>

      <div className="space-y-2">
        {filtered.map((item, index) => (
          <div key={index} className="card flex items-center justify-between px-5 py-3.5 text-sm">
            <div className="flex items-center gap-4">
              <div>
                <div>{item.date} <span className="text-[#64748b]">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span></div>
                <div className="font-medium">{item.role}</div>
                <div className="text-xs text-[#64748b]">{item.company}</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="score-circle">
                  <svg width="52" height="52" className="score-circle">
                    <circle cx="26" cy="26" r="22" fill="none" stroke="#e2e8f0" strokeWidth="5" />
                    <circle 
                      cx="26" cy="26" r="22" fill="none" 
                      stroke="#6366f1" strokeWidth="5" 
                      strokeDasharray={138} 
                      strokeDashoffset={138 - (item.score / 100 * 138)} 
                    />
                  </svg>
                </div>
                <div>
                  <div className="text-xl font-semibold leading-none">{item.score}</div>
                  <div className="text-[10px] text-[#64748b]">{t('history.overall')}</div>
                </div>
              </div>

              <button onClick={() => setSelected(item)} className="px-4 py-1.5 border text-xs rounded-xl">{t('common.viewDetails')}</button>
              <button onClick={() => replay(item)} className="px-4 py-1.5 bg-[#6366f1] text-white text-xs rounded-2xl flex items-center gap-1">▶ {t('common.replay')}</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-[#64748b] p-4">{t('history.empty')}</div>}
      </div>

      {/* Replay Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="card w-[620px] p-6" onClick={e => e.stopPropagation()}>
            <div className="font-semibold mb-2">{t('history.replayModal.title')} — {selected.role} @ {selected.company}</div>
            <div className="text-sm mb-3">{t('misc.score')}: <span className="font-semibold text-[#6366f1]">{selected.score}</span> • {t('history.replayModal.duration')}: {Math.floor(selected.duration/60)}m</div>
            
            <div className="bg-[#f8fafc] p-4 rounded-xl h-48 overflow-auto text-sm mb-3 whitespace-pre-wrap font-mono">
              {selected.transcript || t('history.transcriptPlaceholder')}
            </div>

            {/* Real WaveSurfer container */}
            <div ref={waveformRef} className="w-full bg-[#f8fafc] rounded-xl p-2 mb-3 min-h-[70px]" />

            <div className="flex gap-2">
              <button 
                onClick={toggleReplayAudio} 
                className="flex-1 py-2 border rounded-xl flex items-center justify-center gap-2"
              >
                {isPlaying ? '⏸ ' + t('common.pause') : '▶ ' + t('common.play')}
              </button>
              <button 
                className="flex-1 py-2 bg-[#6366f1] text-white rounded-xl" 
                onClick={() => {
                  setSelected(null)
                  setIsPlaying(false)
                  if (wavesurferRef.current) {
                    wavesurferRef.current.destroy()
                    wavesurferRef.current = null
                  }
                }}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
