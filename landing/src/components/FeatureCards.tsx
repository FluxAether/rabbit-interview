import { Check, ChevronDown, Mic } from 'lucide-react'
import type { Copy } from '../locales/content'
import CopilotPanel from './CopilotPanel'

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] text-mute">{label}</div>
      <div className="flex h-9 items-center justify-between rounded-lg border border-white/10 bg-[#0f0f13] px-3 text-xs text-ink">
        <span>{value}</span>
        <ChevronDown className="h-3.5 w-3.5 text-mute" />
      </div>
    </label>
  )
}

function MockCard({ t }: { t: Copy }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-[#111115] p-3">
      <div className="mb-3 text-xs font-medium">{t.mock.title}</div>
      <div className="space-y-2.5">
        <SelectRow label={t.mock.scene} value={t.mock.sceneValue} />
        <SelectRow label={t.mock.difficulty} value={t.mock.difficultyValue} />
        <SelectRow label={t.mock.topic} value={t.mock.topicValue} />
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="mt-4 h-9 w-full rounded-lg bg-ink text-xs font-medium text-canvas"
      >
        {t.mock.start}
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-[11px] text-mute">
          <Mic className="h-3 w-3" />
          {t.mock.voice}
        </div>
        <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-[11px] text-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-[#f87171]" />
          {t.mock.record}
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
    <div className="rounded-[16px] border border-white/10 bg-[#111115] p-3">
      <div className="mb-3 text-xs font-medium">{t.resume.title}</div>
      <div className="mb-4 flex items-center gap-4 px-1">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
            <circle cx="44" cy="44" r={radius} fill="none" stroke="#2e2e38" strokeWidth="6" />
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
          <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold">{t.resume.score}</div>
        </div>
        <div>
          <div className="text-xs text-mute">{t.resume.match}</div>
          <div className="text-sm font-medium">{t.resume.matchLevel}</div>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[11px]">
            <span className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-mute" />
              {item}
            </span>
            <span className="text-mute">{t.resume.suggest}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="mt-4 h-9 w-full rounded-lg bg-ink text-xs font-medium text-canvas"
      >
        {t.resume.export}
      </button>
    </div>
  )
}

export default function FeatureCards({ t }: { t: Copy }) {
  const items = [
    {
      title: t.features.copilotTitle,
      body: t.features.copilotBody,
      node: <CopilotPanel t={t} compact />,
    },
    {
      title: t.features.mockTitle,
      body: t.features.mockBody,
      node: <MockCard t={t} />,
    },
    {
      title: t.features.resumeTitle,
      body: t.features.resumeBody,
      node: <ResumeCard t={t} />,
    },
  ]

  return (
    <section id="features" className="border-t border-white/5">
      <div id="workflow" className="h-0 w-0 overflow-hidden" />
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-3 md:gap-6 md:py-20">
        {items.map((item) => (
          <article key={item.title} className="flex min-w-0 flex-col">
            <h2 className="text-lg font-semibold tracking-tight">{item.title}</h2>
            <p className="mt-2 min-h-12 text-sm leading-relaxed text-mute">{item.body}</p>
            <div className="mt-6 flex-1">{item.node}</div>
          </article>
        ))}
      </div>
    </section>
  )
}
