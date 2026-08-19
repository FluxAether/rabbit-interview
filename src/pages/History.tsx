import { useEffect, useState, useRef } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Clipboard } from 'lucide-react'
import type { InterviewRecord } from '../stores/useAppStore'
import WaveSurfer from 'wavesurfer.js'
import { loadHistoryCounts, loadHistoryPage } from '../lib/db'
import { exportHistoryRecordsPdf } from '../lib/historyExport'
import { useTranslation } from '../i18n'

type HistoryChatRole = 'interviewer' | 'assistant' | 'me'
type HistoryTab = 'copilot' | 'mock'

interface HistoryChatMessage {
  id: string
  role: HistoryChatRole
  text: string
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

const PAGE_SIZE = 10

export default function History() {
  const t = useTranslation()
  const [search, setSearch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<HistoryTab>('copilot')
  const [selected, setSelected] = useState<InterviewRecord | null>(null)
  const [records, setRecords] = useState<InterviewRecord[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<HistoryTab, number>>({ copilot: 0, mock: 0 })
  const [isExporting, setIsExporting] = useState(false)
  const [showExportToast, setShowExportToast] = useState(false)
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const exportToastTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(search)
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setListStatus('loading')
    void loadHistoryPage({ page, pageSize: PAGE_SIZE, mode: activeTab, search: searchQuery })
      .then((result) => {
        if (cancelled) return
        setRecords(result.records)
        setTotal(result.total)
        setListStatus('ready')
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setListStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, page, searchQuery])

  useEffect(() => {
    void loadHistoryCounts().then(setCounts).catch((error) => { console.error(error); setListStatus((current) => current === 'ready' ? current : 'error') })
  }, [])

  useEffect(() => () => {
    if (exportToastTimeoutRef.current) window.clearTimeout(exportToastTimeoutRef.current)
  }, [])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tabs: Array<{ id: HistoryTab; label: string; count: number }> = [
    { id: 'copilot', label: t('history.tab.copilot'), count: counts.copilot },
    { id: 'mock', label: t('history.tab.mock'), count: counts.mock },
  ]

  const waveformRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<any>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)

  const stopReplayAudio = () => {
    const wavesurfer = wavesurferRef.current
    if (!wavesurfer) return
    try {
      wavesurfer.pause()
    } catch {
      // Ignore already-stopped players while tearing down.
    }
    try {
      wavesurfer.destroy()
    } catch {
      // Ignore double-destroy during modal close / reselect races.
    }
    wavesurferRef.current = null
  }

  useEffect(() => {
    stopReplayAudio()
    setAudioReady(false)
    setAudioError(false)
    setIsPlaying(false)
    if (!selected?.recordingPath || !waveformRef.current) return

    let wavesurfer: ReturnType<typeof WaveSurfer.create> | null = null
    let cancelled = false
    try {
      const styles = getComputedStyle(document.documentElement)
      wavesurfer = WaveSurfer.create({
        container: waveformRef.current,
        backend: 'WebAudio',
        waveColor: styles.getPropertyValue('--text-muted').trim() || '#8a8a8a',
        progressColor: styles.getPropertyValue('--text-main').trim() || '#202020',
        height: 60,
        barWidth: 2,
        barGap: 1,
      })
      // MediaElement volume is capped at 1; WebAudio gain can boost quiet interview recordings.
      wavesurfer.on('ready', () => {
        if (cancelled) return
        wavesurfer?.setVolume(3)
        wavesurfer?.setPlaybackRate(playbackRate)
        setAudioReady(true)
      })
      wavesurfer.on('finish', () => setIsPlaying(false))
      void wavesurfer.load(convertFileSrc(selected.recordingPath)).catch((error) => {
        if (cancelled) return
        setAudioReady(false)
        setAudioError(true)
        console.warn('Unable to load saved interview recording', error)
      })
      wavesurferRef.current = wavesurfer
    } catch (error) {
      console.warn('Unable to load saved interview recording', error)
    }

    return () => {
      cancelled = true
      try {
        wavesurfer?.pause()
      } catch {
        // Ignore teardown races.
      }
      try {
        wavesurfer?.destroy()
      } catch {
        // Ignore double-destroy.
      }
      if (wavesurferRef.current === wavesurfer) wavesurferRef.current = null
    }
  }, [selected?.recordingPath])

  const toggleReplayAudio = () => {
    if (!wavesurferRef.current || !selected?.recordingPath || !audioReady) return
    wavesurferRef.current.playPause()
    setIsPlaying((playing) => !playing)
  }

  const closeReplay = () => {
    stopReplayAudio()
    setSelected(null)
    setIsPlaying(false)
    setAudioReady(false)
  }

  useEffect(() => {
    if (!selected) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }))
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeReplay()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus({ preventScroll: true })
    }
  }, [selected])

  const exportCurrentPage = () => {
    if (records.length === 0 || isExporting) return
    setIsExporting(true)
    try {
      exportHistoryRecordsPdf(records, {
        mode: activeTab,
        page,
        search: searchQuery,
      })
      setShowExportToast(true)
      if (exportToastTimeoutRef.current) window.clearTimeout(exportToastTimeoutRef.current)
      exportToastTimeoutRef.current = window.setTimeout(() => {
        setShowExportToast(false)
      }, 2000)
    } catch (error) {
      console.error('Unable to export interview history', error)
      alert(t('history.exportFailed'))
    } finally {
      setIsExporting(false)
    }
  }

  const selectedMessages = selected ? parseTranscript(selected.transcript || '', selected.mode) : []
  const roleLabels: Record<HistoryChatRole, string> = {
    interviewer: t('copilot.role.interviewer'),
    assistant: t('copilot.role.assistant'),
    me: t('copilot.role.me'),
  }

  return (
    <div className="h-full w-full overflow-auto bg-[var(--bg-app)] p-6 text-[var(--text-main)] sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('history.title')}</h1>
            <div className="mt-1 text-sm text-[var(--text-muted)]">{t('history.subtitle')}</div>
          </div>
          <div className="flex items-center gap-3">
            <div
              role="status"
              className={`flex items-center gap-1.5 text-xs text-[var(--success)] transition-opacity duration-300 ${
                showExportToast ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <span aria-hidden="true">✓</span>
              <span>{t('history.exportSuccess')}</span>
            </div>
            <button
              type="button"
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-1.5 text-sm hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={exportCurrentPage}
              disabled={records.length === 0 || isExporting}
            >
              {isExporting ? `${t('history.exportPage')}…` : t('history.exportPage')}
            </button>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="sr-only">{t('history.search')}</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--text-muted)]"
            placeholder={t('history.search')}
          />
        </label>

        <div className="mb-4 flex gap-5 border-b border-[var(--border-color)]">
          {tabs.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id)
                  setPage(1)
                }}
                role="tab"
                aria-selected={active}
                className={`border-b-2 px-1 py-2 text-sm transition-colors ${
                  active
                    ? 'border-[var(--text-main)] font-medium text-[var(--text-main)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                {tab.label}
                <span className="ml-2 text-xs tabular-nums text-[var(--text-muted)]">
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]">
          {records.map((item) => (
            <div key={item.id ?? `${item.date}-${item.role}`} className="flex items-center justify-between gap-5 px-4 py-3 text-sm hover:bg-[var(--bg-hover)]">
              <div className="grid min-w-0 flex-1 grid-cols-[8rem_minmax(0,1fr)] items-center gap-4">
                <div className="text-xs tabular-nums text-[var(--text-muted)]">{item.date}</div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.role}</div>
                  <div className="truncate text-xs text-[var(--text-muted)]">{item.company}</div>
                </div>
              </div>

            <div className="flex shrink-0 items-center gap-4">
              <div className="w-9 text-right text-base font-semibold tabular-nums">{item.score ?? '-'}</div>

              <button
                  type="button"
                  onClick={() => setSelected(item)}
                  className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-subtle)]"
                >
                  {t('common.viewDetails')} {item.role}
                </button>
              </div>
            </div>
          ))}
          {listStatus === 'loading' && records.length === 0 && (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">{t('history.loading')}</div>
          )}
          {listStatus === 'error' && (
            <div className="p-8 text-center text-sm text-[var(--danger)]">
              <p>{t('history.loadError')}</p>
              <button
                type="button"
                className="mt-3 underline underline-offset-2"
                onClick={() => {
                  setPage(page)
                  setListStatus('loading')
                  void loadHistoryPage({ page, pageSize: PAGE_SIZE, mode: activeTab, search: searchQuery })
                    .then((result) => {
                      setRecords(result.records)
                      setTotal(result.total)
                      setListStatus('ready')
                    })
                    .catch(() => setListStatus('error'))
                }}
              >
                {t('history.retry')}
              </button>
            </div>
          )}
          {listStatus === 'ready' && records.length === 0 && (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">
              {searchQuery.trim()
                ? t('history.noResults')
                : t(activeTab === 'mock' ? 'history.empty.mock' : 'history.empty.copilot')}
            </div>
          )}
        </div>

        {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-[var(--text-muted)]">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
            className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ←
          </button>
          <span>{page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            →
          </button>
        </div>
        )}

      {/* Replay Modal */}
        {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={closeReplay}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-replay-title"
            className="max-h-[90vh] w-full max-w-[620px] overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-6 text-[var(--text-main)] shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div id="history-replay-title" className="mb-1 text-lg font-semibold">
              {t('history.replayModal.title')} - {selected.role} @ {selected.company}
            </div>
            <div className="mb-3 text-sm text-[var(--text-muted)]">
              {t('misc.score')}: <span className="font-semibold text-[var(--text-main)]">{selected.score ?? t('history.notScored')}</span> • {t('history.replayModal.duration')}: {Math.floor(selected.duration/60)}:{String(selected.duration % 60).padStart(2, '0')}
            </div>

            <div className="mb-3 max-h-[320px] min-h-48 overflow-auto rounded-md bg-[var(--bg-subtle)] p-3 text-sm">
              {selectedMessages.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center px-6 text-center text-xs text-[var(--text-muted)]">
                  {t('history.noTranscript')}
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedMessages.map((message) => {
                    const mine = message.role === 'me'
                    const assistant = message.role === 'assistant'
                    return (
                      <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <article className="max-w-[88%]">
                          <div className={`mb-1 px-1 text-[13px] font-medium text-[var(--text-muted)] ${mine ? 'text-right' : ''}`}>
                            {roleLabels[message.role]}
                          </div>
                          <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-[15px] leading-relaxed ${
                            mine
                              ? 'rounded-br-sm bg-[var(--action)] text-[var(--action-text)]'
                              : assistant
                                ? 'rounded-bl-sm border border-[var(--border-color)] bg-[var(--bg-hover)] text-[var(--text-main)]'
                                : 'rounded-bl-sm border border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-main)]'
                          }`}>
                            <div className="min-w-0 flex-1 whitespace-pre-wrap">{message.text}</div>
                            {assistant && (
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(message.text)}
                                className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
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
              <div>
                <div ref={waveformRef} className="mb-3 min-h-[70px] w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-2" />
                <div className="mb-3 flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span>{t('history.speed')}:</span>
                  <div className="flex items-center gap-1">
                    {[1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => {
                          setPlaybackRate(rate)
                          wavesurferRef.current?.setPlaybackRate(rate)
                        }}
                        className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                          playbackRate === rate
                            ? 'bg-[var(--action)] font-bold text-[var(--action-text)]'
                            : 'border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[var(--text-main)]'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
                {audioError && <div className="mb-3 text-xs text-[var(--danger)]">{t('history.recordingLoadError')}</div>}
              </div>
            ) : (
              <div className="mb-3 rounded-md border border-[var(--warning)] px-4 py-3 text-sm text-[var(--warning)]">
                {t('history.recordingUnavailable')}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={toggleReplayAudio}
                disabled={!selected.recordingPath || !audioReady}
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] py-2 text-sm font-medium hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPlaying ? '⏸ ' + t('common.pause') : '▶ ' + t('common.play')}
              </button>
              <button
                ref={closeButtonRef}
                type="button"
                className="flex-1 rounded-md bg-[var(--action)] py-2 text-sm font-medium text-[var(--action-text)] hover:opacity-90"
                onClick={closeReplay}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
