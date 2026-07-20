import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Clipboard, EyeOff, Mic, RefreshCw, Shield, Square, Trash2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import { sendCopilotCommand } from '../lib/copilotSession'
import type { CopilotWindowStatus } from '../lib/copilotWindow'
import { protectionMessageKey } from '../lib/copilotWindowState'
import { useAppStore } from '../stores/useAppStore'

interface CopilotPanelProps {
  floating?: boolean
  windowStatus?: CopilotWindowStatus | null
  onHide?: () => void
}

export default function CopilotPanel({
  floating = false,
  windowStatus = null,
  onHide,
}: CopilotPanelProps) {
  const t = useTranslation()
  const copilot = useAppStore((state) => state.copilot)
  const [followUp, setFollowUp] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const running = copilot.phase === 'starting' || copilot.phase === 'listening'
  const busy = copilot.phase === 'stopping'
  const amplitude = Math.min(100, Math.round(copilot.amplitude * 140))
  const roleLabels = {
    interviewer: t('copilot.role.interviewer'),
    assistant: t('copilot.role.assistant'),
    me: t('copilot.role.me'),
  }

  const submitFollowUp = (event: FormEvent) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text) return
    void sendCopilotCommand({ type: 'follow-up', text })
    setFollowUp('')
  }

  const protectionLabel = t(protectionMessageKey(windowStatus))

  useEffect(() => {
    const container = messagesRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [copilot.messages])

  return (
    <section
      className={`floating-panel flex min-h-0 w-full flex-col border border-[#e2e8f0] p-4 text-sm ${floating ? 'h-[100dvh] rounded-none' : 'shadow-xl'}`}
      aria-label={t('copilot.floating.title')}
    >
      <header className="mb-3 flex items-center justify-between gap-3 px-1" data-tauri-drag-region={floating ? true : undefined}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#6366f1]">
            <Mic className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold tracking-tight">{t('copilot.floating.title')}</div>
            <div className="text-[10px] text-[#64748b]" role="status">{t(`copilot.phase.${copilot.phase}`)}</div>
          </div>
        </div>
        {floating && onHide && (
          <button
            type="button"
            onClick={onHide}
            className="rounded-lg p-1.5 text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#334155]"
            aria-label={t('copilot.hide')}
            data-tauri-drag-region="false"
          >
            <EyeOff className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="mb-3 h-1 overflow-hidden rounded bg-[#e2e8f0]" aria-hidden="true">
        <div className="h-full bg-[#6366f1] transition-[width]" style={{ width: `${amplitude}%` }} />
      </div>

      <div ref={messagesRef} className="min-h-64 flex-1 overflow-auto rounded-xl bg-[#f8fafc] p-3" aria-live="polite">
        {copilot.messages.length === 0 ? (
          <div className="flex h-full min-h-56 items-center justify-center px-6 text-center text-xs text-[#64748b]">
            {t('copilot.chat.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {copilot.messages.map((message) => {
              const mine = message.role === 'me'
              const assistant = message.role === 'assistant'
              return (
                <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <article className="max-w-[88%]">
                    <div className={`mb-1 px-1 text-[10px] font-medium text-[#64748b] ${mine ? 'text-right' : ''}`}>
                      {roleLabels[message.role]}
                    </div>
                    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                      mine
                        ? 'rounded-br-sm bg-[#4f46e5] text-white'
                        : assistant
                          ? 'rounded-bl-sm border border-[#c7d2fe] bg-[#eef2ff] text-[#312e81]'
                          : 'rounded-bl-sm border border-[#e2e8f0] bg-white text-[#1e293b]'
                    }`}>
                      <div className="min-w-0 flex-1 whitespace-pre-wrap">{message.text}</div>
                      {assistant && (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(message.text)}
                          className="shrink-0 rounded p-1 text-[#4f46e5] hover:bg-[#e0e7ff]"
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

      {copilot.answerStatus !== 'idle' && (
        <div
          className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${
            copilot.answerStatus === 'incomplete'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-indigo-50 text-indigo-700'
          }`}
          role={copilot.answerStatus === 'incomplete' ? 'alert' : 'status'}
        >
          <div>{t(`copilot.answer.${copilot.answerStatus}`)}</div>
          {copilot.answerNotice && <div className="mt-1">{t(copilot.answerNotice)}</div>}
        </div>
      )}

      {copilot.error && (
        <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">{copilot.error}</div>
      )}

      <form className="mt-3 flex gap-2" onSubmit={submitFollowUp}>
        <input
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={t('copilot.followUp')}
          className="min-w-0 flex-1 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[#6366f1]"
          disabled={!running}
          aria-label={t('copilot.followUp')}
        />
        <button type="submit" className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-40" disabled={!running || !followUp.trim()}>
          {t('copilot.ask')}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: 'toggle' })}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 ${running ? 'bg-red-500' : 'bg-[#6366f1]'}`}
        >
          {running ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {running ? t('copilot.stopCapture') : t('copilot.startCapture')}
        </button>
        <button type="button" onClick={() => void sendCopilotCommand({ type: 'retry' })} disabled={!running || !copilot.question} className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs disabled:opacity-40">
          <RefreshCw className="h-3.5 w-3.5" /> {t('copilot.retry')}
        </button>
        <button type="button" onClick={() => void sendCopilotCommand({ type: 'clear' })} className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs">
          <Trash2 className="h-3.5 w-3.5" /> {t('copilot.clear')}
        </button>
      </div>

      <footer className="mt-3 border-t pt-2 text-[10px] text-[#64748b]">
        <div>{t('copilot.audioMode')}: {t(`copilot.audioMode.${copilot.audioMode}`)}</div>
        {copilot.capabilityNotice && <div className="mt-1 text-amber-700">{copilot.capabilityNotice}</div>}
        <div className={`flex items-center gap-1.5 ${windowStatus?.protection_applied ? 'text-emerald-700' : 'text-amber-700'}`}>
          <Shield className="h-3.5 w-3.5" /> {protectionLabel}
        </div>
        {windowStatus?.error && <div className="mt-1 text-red-600">{windowStatus.error}</div>}
        <div className="mt-1">{t('copilot.protection.caveat')}</div>
      </footer>
    </section>
  )
}
