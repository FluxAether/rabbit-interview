import { useEffect, useState } from 'react'
import { Check, Zap } from 'lucide-react'
import { FALLBACK_PRODUCTS, fetchCatalog, formatCredits, formatYuan, type PaymentProduct } from '../lib/catalog'
import type { Copy } from '../locales/content'

export default function PricingSection({ t }: { t: Copy }) {
  const p = t.pricingSection
  const [products, setProducts] = useState<PaymentProduct[]>(FALLBACK_PRODUCTS)

  useEffect(() => {
    let active = true
    fetchCatalog()
      .then((catalog) => { if (active) setProducts(catalog.products) })
      .catch(() => { if (active) setProducts(FALLBACK_PRODUCTS) })
    return () => { active = false }
  }, [])

  const entry = products.find((item) => item.code === 'CREDITS_700') || FALLBACK_PRODUCTS[0]
  const standard = products.find((item) => item.code === 'CREDITS_3000' || item.code === 'CREDITS_2900') || FALLBACK_PRODUCTS[1]
  const volume = products.find((item) => item.code === 'CREDITS_11000') || FALLBACK_PRODUCTS[2]
  const byok = products.find((item) => item.code === 'BYOK_LIFETIME') || FALLBACK_PRODUCTS[4]

  return (
    <section id="pricing" className="border-t border-line/60 px-5 py-20 lg:py-28 dark:border-white/5">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1 text-xs text-mute dark:border-white/10 dark:bg-white/[0.03]">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
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
          <div className="flex flex-col justify-between rounded-3xl border border-line bg-surface p-7 shadow-sm sm:p-8 dark:border-white/10 dark:bg-white/[0.02] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-mute">{p.byokKicker}</span>
                <span className="rounded-full border border-line bg-subtle px-2.5 py-0.5 text-[11px] text-mute dark:border-white/10 dark:bg-white/[0.04]">
                  {p.byokBadge}
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">{p.byokTitle}</h3>
              <div className="mt-4 font-mono text-3xl font-semibold tracking-tight text-ink">
                {formatYuan(byok.price_minor)}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mute">{p.byokDesc}</p>
              <div className="my-6 border-t border-line/60 dark:border-white/5" />
              <ul className="space-y-3 text-sm text-ink/90">
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span>{p.byokFeature1}</span></li>
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span>{p.byokFeature2}</span></li>
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-400" /><span>{p.byokFeature3}</span></li>
              </ul>
            </div>
            <a href="/subscribe?plan=BYOK_LIFETIME" className="mt-8 inline-flex h-11 items-center justify-center rounded-xl border border-line bg-subtle text-sm font-medium text-ink transition-colors hover:border-ink/20 dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-white/25 dark:hover:bg-white/[0.06]">
              {p.byokCta}
            </a>
          </div>

          <div className="relative flex flex-col justify-between rounded-3xl border-2 border-emerald-500/40 bg-surface p-7 shadow-lg sm:p-8 dark:border-white/20 dark:bg-gradient-to-b dark:from-white/[0.05] dark:to-white/[0.01] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]">
            <div className="pointer-events-none absolute -top-3 right-6 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
              {p.hostedBadge}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-mute">{p.hostedKicker}</span>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-600 dark:border-emerald-400/20 dark:text-emerald-300">
                  {p.hostedTag}
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">{p.hostedTitle}</h3>
              <div className="mt-4 space-y-2 font-mono text-ink">
                <div className="text-3xl font-semibold tracking-tight">{formatYuan(standard.price_minor)}</div>
                <p className="text-sm text-mute">{formatCredits(standard.credit_units, standard.credit_unit_scale, t.htmlLang)} {p.credits}</p>
                <p className="text-xs text-mute sm:text-sm">
                  {formatYuan(entry.price_minor)} · {formatCredits(entry.credit_units, entry.credit_unit_scale, t.htmlLang)} {p.credits} | {formatYuan(volume.price_minor)} · {formatCredits(volume.credit_units, volume.credit_unit_scale, t.htmlLang)} {p.credits}
                </p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-mute">{p.hostedDesc}</p>
              <div className="my-6 border-t border-line/60 dark:border-white/5" />
              <ul className="space-y-3 text-sm text-ink/90">
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span>{p.hostedFeature1}</span></li>
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span>{p.hostedFeature2}</span></li>
                <li className="flex items-start gap-2.5"><Check className="h-4 w-4 shrink-0 text-emerald-500" /><span>{p.hostedFeature3}</span></li>
              </ul>
            </div>
            <a href="/subscribe?plan=CREDITS_3000" className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-ink text-sm font-medium text-canvas transition-opacity hover:opacity-90">
              {p.hostedCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
