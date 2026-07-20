import { useState, type FormEvent } from 'react'
import { Clipboard, EyeOff, Mic, RefreshCw, Shield, Square, Trash2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import { sendCopilotCommand } from '../lib/copilotSession'
import type { CopilotWindowStatus } from '../lib/copilotWindow'
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
  const running = copilot.phase === 'starting' || copilot.phase === 'listening'
  const busy = copilot.phase === 'stopping'
  const amplitude = Math.min(100, Math.round(copilot.amplitude * 140))

  const submitFollowUp = (event: FormEvent) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text) return
    void sendCopilotCommand({ type: 'follow-up', text })
    setFollowUp('')
  }

  const protectionLabel = !windowStatus?.protection_requested
    ? t('copilot.protection.disabled')
    : windowStatus.protection_applied
      ? t('copilot.protection.enabled')
      : t('copilot.protection.failed')

  return (
    <section
      className={`floating-panel flex min-h-0 flex-col border border-[#e2e8f0] p-4 text-sm ${floating ? 'h-screen w-screen rounded-none' : 'mx-auto w-full max-w-[520px] shadow-xl'}`}
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

      <div className="mb-3 min-h-0 shrink basis-[30%] overflow-auto rounded-xl bg-[#f8fafc] p-3">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-[#64748b]">{t('copilot.question')}</div>
        <div className="text-[13px] leading-relaxed">
          {copilot.question || <span className="text-[#64748b]">{t('copilot.question.empty')}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-[#64748b]">{t('copilot.suggestions')}</div>
        {copilot.suggestions.length === 0 ? (
          <div className="text-xs text-[#64748b]">{t('copilot.suggestions.emptyShort')}</div>
        ) : (
          <div className="space-y-1.5">
            {copilot.suggestions.map((suggestion) => (
              <article key={suggestion.id} className="suggestion-bubble flex items-start gap-2">
                <div className="min-w-0 flex-1 whitespace-pre-wrap">{suggestion.text}</div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(suggestion.text)}
                  className="shrink-0 rounded p-1 text-[#6366f1] hover:bg-[#eef2ff]"
                  aria-label={t('copilot.copySuggestion')}
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

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
        <div className={`flex items-center gap-1.5 ${windowStatus?.protection_applied ? 'text-emerald-700' : 'text-amber-700'}`}>
          <Shield className="h-3.5 w-3.5" /> {protectionLabel}
        </div>
        {windowStatus?.error && <div className="mt-1 text-red-600">{windowStatus.error}</div>}
        <div className="mt-1">{t('copilot.protection.caveat')}</div>
      </footer>
    </section>
  )
}
