import { useState } from 'react'
import { LayoutTemplate, Sliders, Sparkles, Star, Volume2, X } from 'lucide-react'
import type { Copy } from '../locales/content'
import AudioWaveform from './AudioWaveform'

export default function CopilotPanel({
  t,
  compact = false,
}: {
  t: Copy
  compact?: boolean
}) {
  const [viewMode, setViewMode] = useState<'normal' | 'hud'>('normal')
  const [opacityLevel, setOpacityLevel] = useState<number>(90)
  const steps = [t.copilot.s1, t.copilot.s2, t.copilot.s3]

  return (
    <div className="flex flex-col gap-3">
      {/* Interactive Mode Control Bar (for Showcase) */}
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-mute">{t.copilot.hudBadge} · {t.previewBadge}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg border border-white/10 bg-black/40 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('normal')}
                aria-pressed={viewMode === 'normal'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-all ${
                  viewMode === 'normal'
                    ? 'bg-white/15 font-medium text-ink shadow-sm'
                    : 'text-mute hover:text-ink'
                }`}
              >
                <LayoutTemplate className="h-3 w-3" />
                {t.copilot.modeNormal}
              </button>
              <button
                type="button"
                onClick={() => setViewMode('hud')}
                aria-pressed={viewMode === 'hud'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-all ${
                  viewMode === 'hud'
                    ? 'bg-white/15 font-medium text-ink shadow-sm'
                    : 'text-mute hover:text-ink'
                }`}
              >
                <Sparkles className="h-3 w-3" />
                {t.copilot.modeHud}
              </button>
            </div>

            {/* Opacity preview slider */}
            <div className="hidden items-center gap-2 sm:flex">
              <Sliders className="h-3 w-3 text-mute" />
              <input
                type="range"
                min={40}
                max={100}
                value={opacityLevel}
                onChange={(e) => setOpacityLevel(Number(e.target.value))}
                className="h-1 w-16 cursor-pointer accent-white"
                title={t.copilot.opacity}
              />
              <span className="font-mono text-[10px] text-mute">{opacityLevel}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Copilot Window Container */}
      <div
        style={{ opacity: opacityLevel / 100 }}
        className={`relative overflow-hidden transition-all duration-300 ${
          viewMode === 'hud'
            ? 'rounded-2xl border border-white/20 bg-[#0c0c0e]/80 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-2xl'
            : 'rounded-[18px] border border-white/10 bg-[#111115]/95 shadow-[0_0_80px_rgba(244,244,247,0.12)] backdrop-blur-xl'
        } ${compact ? 'p-3' : 'p-4 sm:p-5'}`}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />

        {/* Window Title Bar */}
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/logo.svg" alt="" className="h-5 w-5 rounded-md" />
            <div className={`truncate font-medium tracking-tight ${compact ? 'text-xs' : 'text-sm'}`}>
              {t.copilot.title}
            </div>
            {viewMode === 'hud' && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-ink/80">
                HUD
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-mute">
            {!compact && (
              <span className="hidden font-mono text-[10px] text-mute/80 md:inline">
                {t.copilot.hotkeyHint}
              </span>
            )}
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5" strokeWidth={1.7} />
              <X className="h-3.5 w-3.5" strokeWidth={1.7} />
            </div>
          </div>
        </header>

        {/* Audio Channel Separation Indicator */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5 text-[11px]">
          <div className="flex items-center gap-1.5 text-mute">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
              <span className="listening-dot h-1.5 w-1.5 rounded-full bg-ink" />
            </span>
            <span className="font-medium text-ink/90">{t.copilot.listening}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-mute">
            <span className="flex items-center gap-1">
              <Volume2 className="h-3 w-3 text-emerald-400" />
              {t.copilot.speakerInterviewer}
            </span>
          </div>
        </div>

        {/* Question & Outline Bubbles */}
        <div className={`space-y-2 ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
          <div className="rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
            <span className="mr-2 text-[10px] font-mono text-mute">Q:</span>
            {t.copilot.question}
          </div>

          {/* If in HUD mode, render super-compact bullet points */}
          {viewMode === 'hud' ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                {steps.map((step, index) => (
                  <div key={step} className="rounded-lg bg-white/[0.04] px-2 py-2 border border-white/5">
                    <div className="font-mono text-[10px] text-mute">Point 0{index + 1}</div>
                    <div className="mt-0.5 font-medium text-ink">{step}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            steps.map((step, index) => (
              <div
                key={step}
                className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/15"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 font-mono text-[10px] text-mute">
                  {index + 1}
                </span>
                <span className="text-ink/90">{step}</span>
              </div>
            ))
          )}
        </div>

        {/* Real-time DPR-aware Audio Waveform */}
        <div className={`mt-4 min-w-0 ${compact ? 'h-10' : 'h-12'}`}>
          <AudioWaveform className="h-full w-full" />
        </div>
      </div>
    </div>
  )
}
