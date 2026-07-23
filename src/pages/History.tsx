import { useEffect, useState, useRef } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Clipboard } from 'lucide-react'
import { useAppStore, InterviewRecord } from '../stores/useAppStore'
import WaveSurfer from 'wavesurfer.js'
import { loadHistory as loadHistoryDb } from '../lib/db'
import { useTranslation } from '../i18n'

type HistoryChatRole = 'interviewer' | 'assistant' | 'me'
type HistoryTab = 'copilot' | 'mock'

interface HistoryChatMessage {
  id: string
  role: HistoryChatRole
  text: string
}

function isMockInterviewMode(mode?: string | null): boolean {
  return String(mode || '').startsWith('mock')
}

function isCopilotMode(mode?: string | null): boolean {
  return String(mode || '').toLowerCase() === 'copilot'
}

function parseTranscript(transcript: string, mode: string): HistoryChatMessage[] {
  if (!transcript.trim()) return []

  const messages: HistoryChatMessage[] = []
  let current: HistoryChatMessage | null = null

  const resolveRole = (label: string): HistoryChatRole | null => {
    const normalized = label.trim().toLowerCase()
    if (['interviewer', '面试官', '面試官'].includes(normalized)) return 'interviewer'
    if (['assistant', '助手'].includes(normalized)) return 'assistant'
    if (['me', 'user', '我', '用户', '用戶'].includes(normalized)) return 'me'
    if (normalized === 'ai') return mode === 'copilot' ? 'assistant' : 'interviewer'
    return null
  }

  transcript.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^(Interviewer|Assistant|AI|Me|User|面试官|面試官|助手|我|用户|用戶):\s*(.*)$/i)
    const role = match ? resolveRole(match[1]) : null

    if (match && role) {
      if (current) messages.push(current)
      current = {
        id: `${index}-${role}`,
        role,
        text: match[2],
      }
      return
    }

    if (current) {
      current.text += `${current.text ? '\n' : ''}${line}`
    }
  })

  if (current) messages.push(current)

  return messages.length > 0
    ? messages
    : [{ id: 'transcript', role: 'interviewer', text: transcript }]
}

export default function History() {
  const { history, loadHistory } = useAppStore()
  const t = useTranslation()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<HistoryTab>('copilot')
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

  const tabbed = history.filter((item) =>
    activeTab === 'mock' ? isMockInterviewMode(item.mode) : isCopilotMode(item.mode)
  )
  const filtered = tabbed.filter((item) =>
    `${item.role}${item.company}`.toLowerCase().includes(search.toLowerCase())
  )
  const tabs: Array<{ id: HistoryTab; label: string; count: number }> = [
    { id: 'copilot', label: t('history.tab.copilot'), count: history.filter((item) => isCopilotMode(item.mode)).length },
    { id: 'mock', label: t('history.tab.mock'), count: history.filter((item) => isMockInterviewMode(item.mode)).length },
  ]

  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<any>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioReady, setAudioReady] = useState(false)

  useEffect(() => {
    wavesurferRef.current?.destroy()
    wavesurferRef.current = null
    setAudioReady(false)
    setIsPlaying(false)
    if (!selected?.recordingPath || !waveformRef.current) return

    let wavesurfer: ReturnType<typeof WaveSurfer.create> | null = null
    try {
      wavesurfer = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#6366f1',
        progressColor: '#4f46e5',
        height: 60,
        barWidth: 2,
        barGap: 1,
      })
      wavesurfer.on('ready', () => setAudioReady(true))
      wavesurfer.on('finish', () => setIsPlaying(false))
      void wavesurfer.load(convertFileSrc(selected.recordingPath)).catch((error) => {
        setAudioReady(false)
        console.warn('Unable to load saved interview recording', error)
      })
      wavesurferRef.current = wavesurfer
    } catch (error) {
      console.warn('Unable to load saved interview recording', error)
    }

    return () => {
      wavesurfer?.destroy()
      if (wavesurferRef.current === wavesurfer) wavesurferRef.current = null
    }
  }, [selected?.recordingPath])

  const toggleReplayAudio = () => {
    if (!wavesurferRef.current || !selected?.recordingPath || !audioReady) return
    wavesurferRef.current.playPause()
    setIsPlaying((playing) => !playing)
  }

  const closeReplay = () => {
    setSelected(null)
    setIsPlaying(false)
    setAudioReady(false)
  }

  const selectedMessages = selected ? parseTranscript(selected.transcript || '', selected.mode) : []
  const roleLabels: Record<HistoryChatRole, string> = {
    interviewer: t('copilot.role.interviewer'),
    assistant: t('copilot.role.assistant'),
    me: t('copilot.role.me'),
  }

  return (
    <div className="w-full p-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f172a] dark:text-[#f8fafc]">{t('history.title')}</h1>
          <div className="text-sm text-[#475569] dark:text-[#94a3b8]">{t('history.subtitle')}</div>
        </div>
        <button
          className="px-4 py-1.5 text-sm border border-[#e2e8f0] dark:border-[#334155] rounded-xl text-[#0f172a] dark:text-[#f8fafc] hover:bg-white dark:hover:bg-[#1e293b]"
          onClick={() => alert(t('history.exportDemo'))}
        >
          {t('common.export')}
        </button>
      </div>

      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full mb-4 bg-white dark:bg-[#1e293b] border border-[#e2e8f0] dark:border-[#334155] text-[#0f172a] dark:text-[#f8fafc] rounded-2xl px-4 py-2 text-sm placeholder:text-[#94a3b8] outline-none focus:ring-2 focus:ring-[#6366f1]"
        placeholder={t('history.search')}
      />

      <div className="mb-4 flex gap-2 rounded-2xl border border-[#e2e8f0] dark:border-[#334155] bg-white dark:bg-[#1e293b] p-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 rounded-xl px-3 py-2 text-sm transition-all ${
                active
                  ? 'bg-[#e0e7ff] dark:bg-[#312e81] font-semibold text-[#4338ca] dark:text-[#a5b4fc]'
                  : 'text-[#64748b] dark:text-[#94a3b8] hover:bg-[#f8fafc] dark:hover:bg-[#0f172a]'
              }`}
            >
              {tab.label}
              <span className={`ml-2 text-xs ${active ? 'text-[#6366f1]' : 'text-[#94a3b8]'}`}>
                {tab.count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="space-y-2">
        {filtered.map((item, index) => (
          <div key={index} className="card flex items-center justify-between px-5 py-3.5 text-sm">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-xs text-[#94a3b8]">{item.date}</div>
                <div className="font-medium text-[#0f172a] dark:text-[#f8fafc]">{item.role}</div>
                <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{item.company}</div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="score-circle">
                <svg width="52" height="52">
                  <circle cx="26" cy="26" r="22" fill="none" className="stroke-[#e2e8f0] dark:stroke-[#334155]" strokeWidth="5" />
                  <circle
                    cx="26"
                    cy="26"
                    r="22"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="5"
                    strokeDasharray={138}
                    strokeDashoffset={item.score == null ? 138 : 138 - (item.score / 100 * 138)}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold leading-none text-[#0f172a] dark:text-[#f8fafc]">
                  {item.score ?? '—'}
                </div>
              </div>

              <button
                onClick={() => setSelected(item)}
                className="px-4 py-1.5 border border-[#e2e8f0] dark:border-[#334155] text-xs font-medium text-[#0f172a] dark:text-[#f8fafc] hover:bg-[#f8fafc] dark:hover:bg-[#0f172a] rounded-xl"
              >
                {t('common.viewDetails')}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-[#64748b] dark:text-[#94a3b8] p-4">
            {t(activeTab === 'mock' ? 'history.empty.mock' : 'history.empty.copilot')}
          </div>
        )}
      </div>

      {/* Replay Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={closeReplay}>
          <div className="card w-full max-w-[620px] p-6 shadow-2xl bg-white dark:bg-[#1e293b]" onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-lg text-[#0f172a] dark:text-[#f8fafc] mb-1">
              {t('history.replayModal.title')} — {selected.role} @ {selected.company}
            </div>
            <div className="text-sm text-[#64748b] dark:text-[#94a3b8] mb-3">
              {t('misc.score')}: <span className="font-semibold text-[#6366f1]">{selected.score ?? t('history.notScored')}</span> • {t('history.replayModal.duration')}: {Math.floor(selected.duration/60)}m
            </div>

            <div className="mb-3 max-h-[320px] min-h-48 overflow-auto rounded-xl bg-[#f8fafc] dark:bg-[#0f172a] p-3 text-sm">
              {selectedMessages.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center px-6 text-center text-xs text-[#64748b] dark:text-[#94a3b8]">
                  {t('history.transcriptPlaceholder')}
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedMessages.map((message) => {
                    const mine = message.role === 'me'
                    const assistant = message.role === 'assistant'
                    return (
                      <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <article className="max-w-[88%]">
                          <div className={`mb-1 px-1 text-[13px] font-medium text-[#64748b] dark:text-[#94a3b8] ${mine ? 'text-right' : ''}`}>
                            {roleLabels[message.role]}
                          </div>
                          <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[15px] leading-relaxed ${
                            mine
                              ? 'rounded-br-sm bg-[#4f46e5] text-white'
                              : assistant
                                ? 'rounded-bl-sm border border-[#c7d2fe] dark:border-[#3730a3] bg-[#eef2ff] dark:bg-[#312e81] text-[#312e81] dark:text-[#e0e7ff]'
                                : 'rounded-bl-sm border border-[#e2e8f0] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-[#1e293b] dark:text-[#f8fafc]'
                          }`}>
                            <div className="min-w-0 flex-1 whitespace-pre-wrap">{message.text}</div>
                            {assistant && (
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(message.text)}
                                className="shrink-0 rounded p-1 text-[#4f46e5] dark:text-[#a5b4fc] hover:bg-[#e0e7ff] dark:hover:bg-[#3730a3]"
                                aria-label={t('copilot.copySuggestion')}
                              >
                                <Clipboard className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </article>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {selected.recordingPath ? (
              <div ref={waveformRef} className="w-full bg-[#f8fafc] dark:bg-[#0f172a] rounded-xl p-2 mb-3 min-h-[70px]" />
            ) : (
              <div className="mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                {t('history.recordingUnavailable')}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={toggleReplayAudio}
                disabled={!selected.recordingPath || !audioReady}
                className="flex-1 py-2 border border-[#e2e8f0] dark:border-[#334155] rounded-xl flex items-center justify-center gap-2 text-sm font-medium text-[#0f172a] dark:text-[#f8fafc] hover:bg-[#f8fafc] dark:hover:bg-[#0f172a] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPlaying ? '⏸ ' + t('common.pause') : '▶ ' + t('common.play')}
              </button>
              <button
                className="flex-1 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-medium"
                onClick={closeReplay}
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
