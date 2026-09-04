import { Check, Zap } from 'lucide-react'
import type { Copy } from '../locales/content'

export default function PricingSection({ t }: { t: Copy }) {
  const p = t.pricingSection
  return (
    <section id="pricing" className="border-t border-white/5 px-5 py-20 lg:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-mute">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span>{p.badge}</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            {p.title}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mute sm:text-base">
            {p.subtitle}
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:gap-8">
          {/* Card 1: BYOK Open Core */}
          <div className="flex flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.02] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-8">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-mute">OPEN-CORE / LOCAL</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-mute">
                  Local-first
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">{p.byokTitle}</h3>
              <div className="mt-4 font-mono text-3xl font-semibold tracking-tight text-ink">
                {p.byokPrice}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-mute sm:text-sm">{p.byokDesc}</p>

              <div className="my-6 border-t border-white/5" />

              <ul className="space-y-3 text-xs text-ink/90 sm:text-sm">
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.byokFeature1}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.byokFeature2}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.byokFeature3}</span>
                </li>
              </ul>
            </div>

            <a
              href="#download"
              className="mt-8 inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.03] text-xs font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.06]"
            >
              {p.byokCta}
            </a>
          </div>

          {/* Card 2: Hosted Job-Seeker Pass */}
          <div className="relative flex flex-col justify-between rounded-3xl border border-white/20 bg-gradient-to-b from-white/[0.05] to-white/[0.01] p-7 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)] sm:p-8">
            <div className="pointer-events-none absolute -top-3 right-6 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-[10px] font-medium text-emerald-300">
              TURNKEY CLOUD
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-mute">OFFICIAL HOSTED</span>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
                  扫码即用
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">{p.hostedTitle}</h3>
              <div className="mt-4 font-mono text-3xl font-semibold tracking-tight text-ink">
                {p.hostedPrice}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-mute sm:text-sm">{p.hostedDesc}</p>

              <div className="my-6 border-t border-white/5" />

              <ul className="space-y-3 text-xs text-ink/90 sm:text-sm">
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.hostedFeature1}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.hostedFeature2}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{p.hostedFeature3}</span>
                </li>
              </ul>
            </div>

            <a
              href="/subscribe"
              className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-ink text-xs font-medium text-canvas transition-opacity hover:opacity-90"
            >
              {p.hostedCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
