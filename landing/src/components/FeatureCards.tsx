import { useRef } from 'react'
import { Check, ChevronDown, Mic, Sparkles } from 'lucide-react'
import type { Copy } from '../locales/content'
import CopilotPanel from './CopilotPanel'
import { gsap, useGSAP } from '../lib/gsap'

function SelectRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="block">
      <div className="mb-1 text-[11px] text-mute">{label}</div>
      <div className="flex h-9 items-center justify-between rounded-lg border border-line bg-subtle px-3 text-xs text-ink shadow-xs dark:border-white/10 dark:bg-[#0f0f13] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <span>{value}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
      </div>
    </div>
  )
}

function MockCard({ t }: { t: Copy }) {
  return (
    <div className="flex h-full flex-col justify-between rounded-[18px] border border-line bg-surface p-4 shadow-sm dark:border-white/10 dark:bg-[#111115]/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-medium text-ink">{t.mock.title}</span>
          <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-mute dark:border-transparent dark:bg-white/10">{t.previewBadge}</span>
        </div>
        <div className="space-y-2.5">
          <SelectRow label={t.mock.scene} value={t.mock.sceneValue} />
          <SelectRow label={t.mock.difficulty} value={t.mock.difficultyValue} />
          <SelectRow label={t.mock.topic} value={t.mock.topicValue} />
        </div>
      </div>
      <div className="mt-4">
        <div className="flex h-9 w-full items-center justify-center rounded-lg border border-line bg-subtle text-xs font-medium text-ink transition-colors hover:border-ink/20 dark:border-transparent dark:bg-white/10 dark:text-ink/80">
          {t.mock.start}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-subtle/60 text-[11px] text-mute dark:border-white/10 dark:bg-white/[0.02]">
            <Mic className="h-3 w-3 text-emerald-500" />
            {t.mock.voice}
          </div>
          <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-subtle/60 text-[11px] text-mute dark:border-white/10 dark:bg-white/[0.02]">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
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
  const targetOffset = circumference * (1 - 0.82)

  const circleRef = useRef<SVGCircleElement>(null)
  const scoreRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const el = cardRef.current
      if (!el || !circleRef.current || !scoreRef.current) return

      // Progress stroke animation on scroll
      gsap.fromTo(
        circleRef.current,
        { strokeDashoffset: circumference },
        {
          strokeDashoffset: targetOffset,
          duration: 1.4,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            toggleActions: 'play none none none',
          },
        }
      )

      // Score count-up
      const counter = { val: 0 }
      gsap.to(counter, {
        val: 82,
        duration: 1.4,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
        onUpdate: () => {
          if (scoreRef.current) {
            scoreRef.current.textContent = `${Math.round(counter.val)}%`
          }
        },
      })
    })

    mm.add('(prefers-reduced-motion: reduce)', () => {
      if (circleRef.current) {
        circleRef.current.style.strokeDashoffset = `${targetOffset}`
      }
      if (scoreRef.current) {
        scoreRef.current.textContent = t.resume.score
      }
    })
  }, { scope: cardRef })

  return (
    <div ref={cardRef} className="flex h-full flex-col justify-between rounded-[18px] border border-line bg-surface p-4 shadow-sm dark:border-white/10 dark:bg-[#111115]/95 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div>
        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="font-medium text-ink">{t.resume.title}</span>
          <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] text-mute dark:border-transparent dark:bg-white/10">{t.previewBadge}</span>
        </div>
        <div className="mb-4 flex items-center gap-4 px-1">
          <div className="relative h-[84px] w-[84px] shrink-0">
            <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90">
              <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="6" />
              <circle
                ref={circleRef}
                cx="44"
                cy="44"
                r={radius}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference}
              />
            </svg>
            <div ref={scoreRef} className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold tracking-tight">
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
            <div key={item} className="flex items-center justify-between rounded-lg border border-line bg-subtle/60 px-2.5 py-2 text-[11px] dark:border-white/8 dark:bg-white/[0.03]">
              <span className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                {item}
              </span>
              <span className="text-mute">{t.resume.suggest}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-9 w-full items-center justify-center rounded-lg border border-line bg-subtle text-xs font-medium text-ink transition-colors hover:border-ink/20 dark:border-transparent dark:bg-white/10 dark:text-ink/80">
        {t.resume.export}
      </div>
    </div>
  )
}

export default function FeatureCards({ t }: { t: Copy }) {
  const sectionRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)

  const pipeline = [
    { step: t.features.step1, title: t.features.resumeTitle, body: t.features.resumeBody, node: <ResumeCard t={t} /> },
    { step: t.features.step2, title: t.features.mockTitle, body: t.features.mockBody, node: <MockCard t={t} /> },
    { step: t.features.step3, title: t.features.copilotTitle, body: t.features.copilotBody, node: <CopilotPanel t={t} compact /> },
  ]

  useGSAP(() => {
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      // Header entrance
      if (headerRef.current) {
        gsap.fromTo(
          headerRef.current.children,
          { y: 30, autoAlpha: 0 },
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

      // Feature cards staggered entrance
      if (cardsRef.current) {
        const cardElements = gsap.utils.toArray<HTMLElement>(cardsRef.current.children)
        gsap.fromTo(
          cardElements,
          { y: 45, autoAlpha: 0, scale: 0.97 },
          {
            y: 0,
            autoAlpha: 1,
            scale: 1,
            stagger: 0.15,
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

        // Subtle 3D tilt interaction on hover for desktop
        const hasFinePointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
        if (hasFinePointer) {
          cardElements.forEach((card) => {
            const onMouseMove = (e: MouseEvent) => {
              const rect = card.getBoundingClientRect()
              const x = e.clientX - rect.left - rect.width / 2
              const y = e.clientY - rect.top - rect.height / 2
              const rotX = -(y / (rect.height / 2)) * 3.5
              const rotY = (x / (rect.width / 2)) * 3.5

              gsap.to(card, {
                rotationX: rotX,
                rotationY: rotY,
                y: -4,
                transformPerspective: 1000,
                duration: 0.25,
                ease: 'power1.out',
              })
            }

            const onMouseLeave = () => {
              gsap.to(card, {
                rotationX: 0,
                rotationY: 0,
                y: 0,
                duration: 0.5,
                ease: 'power2.out',
              })
            }

            card.addEventListener('mousemove', onMouseMove)
            card.addEventListener('mouseleave', onMouseLeave)
          })
        }
      }
    })
  }, { scope: sectionRef })

  return (
    <section ref={sectionRef} id="features" className="border-t border-line/60 bg-gradient-to-b from-transparent to-subtle/30 dark:border-white/5 dark:to-white/[0.01]">
      <div id="workflow" className="h-0 w-0 overflow-hidden" />
      <div className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <div ref={headerRef} className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1 text-xs text-mute dark:border-white/10 dark:bg-white/[0.03]">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
            <span>{t.features.badge}</span>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
            {t.features.headline}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mute sm:text-base">
            {t.features.subhead}
          </p>
        </div>
        <div ref={cardsRef} className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-8 [perspective:1000px]">
          {pipeline.map((item) => (
            <article
              key={item.title}
              className="group flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-ink/20 sm:p-5 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-white/20 dark:shadow-none will-change-transform"
            >
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
