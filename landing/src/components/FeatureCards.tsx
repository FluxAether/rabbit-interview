import { Check, ChevronDown, Mic, Sparkles } from 'lucide-react'
import type { Copy } from '../locales/content'
import CopilotPanel from './CopilotPanel'

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="block">
      <div className="mb-1 text-[11px] text-mute">{label}</div>
      <div className="flex h-9 items-center justify-between rounded-lg border border-white/10 bg-[#0f0f13] px-3 text-xs text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <span>{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-mute" aria-hidden="true" />
      </div>
    </div>
  )
}

function MockCard({ t }: { t: Copy }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] border border-white/10 bg-[#111115]/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-medium text-ink">{t.mock.title}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-mute">{t.previewBadge}</span>
        </div>
        <div className="space-y-2.5">
          <SelectRow label={t.mock.scene} value={t.mock.sceneValue} />
          <SelectRow label={t.mock.difficulty} value={t.mock.difficultyValue} />
          <SelectRow label={t.mock.topic} value={t.mock.topicValue} />
        </div>
      </div>
      <div className="mt-4">
        <div className="flex h-9 w-full items-center justify-center rounded-lg bg-white/10 text-xs font-medium text-ink/80">
          {t.mock.start}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-[11px] text-mute">
            <Mic className="h-3 w-3 text-emerald-400" />
            {t.mock.voice}
          </div>
          <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-[11px] text-mute">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
            {t.mock.record}
          </div>
        </div>
      </div>
    </div>
  )
}

function ResumeCard({ t }: { t: Copy }) {
  const items = [t.resume.item1, t.resume.item2, t.resume.item3]
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - 0.82)

  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] border border-white/10 bg-[#111115]/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-medium text-ink">{t.resume.title}</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-mute">{t.previewBadge}</span>
        </div>
        <div className="mb-4 flex items-center gap-4 px-1">
          <div className="relative h-[84px] w-[84px] shrink-0">
            <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
              <circle cx="44" cy="44" r={radius} fill="none" stroke="#23232b" strokeWidth="6" />
              <circle
                cx="44"
                cy="44"
                r={radius}
                fill="none"
                stroke="#f4f4f7"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold tracking-tight">
              {t.resume.score}
            </div>
          </div>
          <div>
            <div className="text-xs text-mute">{t.resume.match}</div>
            <div className="text-sm font-medium text-ink">{t.resume.matchLevel}</div>
          </div>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[11px]">
              <span className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                {item}
              </span>
              <span className="text-mute">{t.resume.suggest}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-9 w-full items-center justify-center rounded-lg bg-white/10 text-xs font-medium text-ink/80">
        {t.resume.export}
      </div>
    </div>
  )
}

export default function FeatureCards({ t }: { t: Copy }) {
  const pipeline = [
    { step: t.features.step1, title: t.features.resumeTitle, body: t.features.resumeBody, node: <ResumeCard t={t} /> },
    { step: t.features.step2, title: t.features.mockTitle, body: t.features.mockBody, node: <MockCard t={t} /> },
    { step: t.features.step3, title: t.features.copilotTitle, body: t.features.copilotBody, node: <CopilotPanel t={t} compact /> },
  ]

  return (
    <section id="features" className="border-t border-white/5 bg-gradient-to-b from-transparent to-white/[0.01]">
      <div id="workflow" className="h-0 w-0 overflow-hidden" />
      <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-mute">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            <span>{t.features.badge}</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            {t.features.headline}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mute sm:text-base">
            {t.features.subhead}
          </p>
        </div>
        <div className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-8">
          {pipeline.map((item) => (
            <article key={item.title} className="group flex min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-white/20 sm:p-5">
              <div className="mb-2 font-mono text-[11px] font-medium tracking-wider text-mute">{item.step}</div>
              <h3 className="text-base font-semibold tracking-tight text-ink sm:text-lg">{item.title}</h3>
              <p className="mt-2 min-h-12 text-sm leading-relaxed text-mute">{item.body}</p>
              <div className="mt-6 min-w-0 flex-1 overflow-hidden">{item.node}</div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
