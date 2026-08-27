import { Star, X } from 'lucide-react'
import type { Copy } from '../locales/content'
import AudioWaveform from './AudioWaveform'

export default function CopilotPanel({
  t,
  compact = false,
}: {
  t: Copy
  compact?: boolean
}) {
  const steps = [t.copilot.s1, t.copilot.s2, t.copilot.s3]

  return (
    <div
      className={`relative overflow-hidden rounded-[18px] border border-white/10 bg-[#111115]/90 shadow-[0_0_80px_rgba(244,244,247,0.12)] backdrop-blur-xl ${
        compact ? 'p-3' : 'p-4 sm:p-5'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[18px] ring-1 ring-white/20" />
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/logo.svg" alt="" className="h-6 w-6 rounded-md" />
          <div className={`truncate font-medium ${compact ? 'text-xs' : 'text-sm'}`}>{t.copilot.title}</div>
        </div>
        <div className="flex items-center gap-1 text-mute">
          <Star className="h-3.5 w-3.5" strokeWidth={1.7} />
          <X className="h-3.5 w-3.5" strokeWidth={1.7} />
        </div>
      </header>

      <div className="mb-3 flex items-center gap-2 text-[11px] text-mute">
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
          <span className="listening-dot h-1.5 w-1.5 rounded-full bg-ink" />
        </span>
        {t.copilot.listening}
      </div>

      <div className={`space-y-2 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-ink/90">
          {t.copilot.question}
        </div>
        {steps.map((step, index) => (
          <div
            key={step}
            className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[10px] text-mute">
              {index + 1}
            </span>
            <span>{step}</span>
          </div>
        ))}
      </div>

      <div className={`mt-4 ${compact ? 'h-10' : 'h-14'}`}>
        <AudioWaveform className="h-full w-full" />
      </div>
    </div>
  )
}

