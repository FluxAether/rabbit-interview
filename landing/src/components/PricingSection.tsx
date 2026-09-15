import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, Zap } from 'lucide-react'
import { FALLBACK_PRODUCTS, fetchCatalog, formatCredits, formatYuan, type PaymentProduct } from '../lib/catalog'
import type { Copy } from '../locales/content'
import { gsap, useGSAP } from '../lib/gsap'

export default function PricingSection({ t }: { t: Copy }) {
  const p = t.pricingSection
  const [products, setProducts] = useState<PaymentProduct[]>(FALLBACK_PRODUCTS)
  const [selectedPackIndex, setSelectedPackIndex] = useState(1) // default to standard 3000

  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const priceDisplayRef = useRef<HTMLDivElement>(null)
  const highlightCardRef = useRef<HTMLDivElement>(null)

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

  const creditPacks = [entry, standard, volume]
  const activePack = creditPacks[selectedPackIndex] || standard

  useGSAP(() => {
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // Header entrance
      if (headerRef.current) {
        gsap.fromTo(
          headerRef.current.children,
          { y: 28, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            stagger: 0.12,
            duration: 0.7,
            ease: 'power3.out',
            clearProps: 'opacity,visibility,transform',
            scrollTrigger: {
              trigger: headerRef.current,
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          }
        )
      }

      // Pricing cards staggered entrance
      if (cardsRef.current) {
        gsap.fromTo(
          cardsRef.current.children,
          { y: 40, autoAlpha: 0 },
          {
            y: 0,
            autoAlpha: 1,
            stagger: 0.16,
            duration: 0.75,
            ease: 'power2.out',
            clearProps: 'opacity,visibility,transform',
            scrollTrigger: {
              trigger: cardsRef.current,
              start: 'top 80%',
              toggleActions: 'play none none none',
            },
          }
        )
      }

      // Popular card subtle ambient border glow
      if (highlightCardRef.current) {
        gsap.to(highlightCardRef.current, {
          borderColor: 'rgba(16, 185, 129, 0.65)',
          duration: 2.5,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        })
      }
    })
  }, { scope: sectionRef })

  const handleSelectPack = (index: number) => {
    if (index === selectedPackIndex) return
    setSelectedPackIndex(index)
    if (priceDisplayRef.current) {
      gsap.fromTo(
        priceDisplayRef.current,
        { autoAlpha: 0.3, y: -4 },
        { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out', clearProps: 'opacity,visibility,transform' }
      )
    }
  }

  return (
    <section ref={sectionRef} id="pricing" className="border-t border-line/60 px-5 py-20 lg:py-28 dark:border-white/5">
      <div className="mx-auto max-w-5xl">
        <div ref={headerRef} className="mx-auto max-w-2xl text-center">
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

        <div ref={cardsRef} className="mt-12 grid gap-6 md:grid-cols-2 lg:gap-8">
          {/* BYOK Plan Card */}
          <div className="flex flex-col justify-between rounded-3xl border border-line bg-surface p-7 shadow-sm transition-all hover:border-ink/20 sm:p-8 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
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

          {/* Hosted Credits Plan Card */}
          <div
            ref={highlightCardRef}
            className="relative flex flex-col justify-between rounded-3xl border-2 border-emerald-500/40 bg-surface p-7 shadow-lg sm:p-8 dark:bg-gradient-to-b dark:from-white/[0.05] dark:to-white/[0.01] dark:shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-mute">{p.hostedKicker}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:border-emerald-400/20 dark:text-emerald-300">
                    <Sparkles className="h-3 w-3" />
                    <span>{p.hostedBadge}</span>
                  </span>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-600 dark:border-emerald-400/20 dark:text-emerald-300">
                  {p.hostedTag}
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold text-ink">{p.hostedTitle}</h3>

              {/* Interactive Pack Selector Tabs */}
              <div className="mt-4 flex rounded-xl border border-line bg-subtle/80 p-1 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                {creditPacks.map((pack, idx) => {
                  const isSelected = idx === selectedPackIndex
                  return (
                    <button
                      key={pack.code}
                      type="button"
                      onClick={() => handleSelectPack(idx)}
                      className={`flex-1 rounded-lg py-1.5 font-medium transition-all ${
                        isSelected
                          ? 'bg-surface font-semibold text-ink shadow-xs dark:bg-white/15'
                          : 'text-mute hover:text-ink'
                      }`}
                    >
                      {formatCredits(pack.credit_units, pack.credit_unit_scale, t.htmlLang)}
                    </button>
                  )
                })}
              </div>

              {/* Price & Credit Info with Animated Transition */}
              <div ref={priceDisplayRef} className="mt-4 space-y-1.5 font-mono text-ink">
                <div className="text-3xl font-semibold tracking-tight">
                  {formatYuan(activePack.price_minor)}
                </div>
                <p className="text-sm text-mute">
                  {formatCredits(activePack.credit_units, activePack.credit_unit_scale, t.htmlLang)} {p.credits}
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
            <a
              href={`/subscribe?plan=${activePack.code}`}
              className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-ink text-sm font-medium text-canvas transition-all hover:opacity-90 active:scale-[0.98]"
            >
              {p.hostedCta}
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
