import { useEffect, useRef, useState } from 'react'
import { Apple, ArrowUpRight, Menu, Moon, Play, Sun, X } from 'lucide-react'
import AuthPage from './components/AuthPage'
import CopilotPanel from './components/CopilotPanel'
import FeatureCards from './components/FeatureCards'
import GitHubIcon from './components/GitHubIcon'
import PricingSection from './components/PricingSection'
import WindowsIcon from './components/WindowsIcon'
import VideoSection from './components/VideoSection'
import { useTheme } from './lib/theme'
import { DOWNLOAD, copy, type Lang } from './locales/content'
import { landingLangFromStore, writeLandingLang } from './locales/lang'
import { gsap, useGSAP } from './lib/gsap'

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '')
  return pathname
}

export default function App() {
  const raw = window.location.pathname
  const path = normalizePath(raw)
  const appContainerRef = useRef<HTMLDivElement>(null)

  if (raw !== path) {
    window.history.replaceState(null, '', path + window.location.search + window.location.hash)
  }

  useGSAP(() => {
    if (appContainerRef.current) {
      gsap.fromTo(
        appContainerRef.current,
        { autoAlpha: 0.4, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'opacity,visibility,transform' }
      )
    }
  }, { scope: appContainerRef, dependencies: [path] })

  const isAuth = path.startsWith('/auth/') || path === '/subscribe' || path === '/admin'

  return (
    <div ref={appContainerRef}>
      {isAuth ? <AuthPage path={path} /> : path !== '/' ? <NotFoundPage /> : <LandingPage />}
    </div>
  )
}

function NotFoundPage() {
  const lang = landingLangFromStore()
  const t = copy[lang]
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-5 text-center text-ink">
      <p className="text-sm text-mute">{t.notFound.body}</p>
      <a href="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-ink px-5 text-sm font-medium text-canvas transition-transform active:scale-95">
        {t.notFound.home}
      </a>
    </div>
  )
}

function LandingPage() {
  const [lang, setLang] = useState<Lang>(landingLangFromStore)
  const [menuOpen, setMenuOpen] = useState(false)
  const { resolvedTheme, toggleTheme } = useTheme()
  const t = copy[lang]

  const pageContainerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const mobileNavRef = useRef<HTMLElement>(null)
  const heroSectionRef = useRef<HTMLElement>(null)
  const heroLeftRef = useRef<HTMLDivElement>(null)
  const heroRightRef = useRef<HTMLDivElement>(null)
  const heroGlowRef = useRef<HTMLDivElement>(null)
  const downloadSectionRef = useRef<HTMLElement>(null)
  const downloadCardsRef = useRef<HTMLDivElement>(null)
  const privacyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLang(landingLangFromStore())
  }, [])

  useEffect(() => {
    document.documentElement.lang = t.htmlLang
    document.title = t.title
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', t.description)
  }, [t])

  // Master Hero & Header entrance timeline with GSAP (runs once on mount)
  useGSAP(() => {
    const mm = gsap.matchMedia()

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      // Header entrance
      if (headerRef.current) {
        heroTl.fromTo(
          headerRef.current,
          { y: -12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.5, clearProps: 'opacity,visibility,transform' }
        )
      }

      // Hero left elements entrance
      if (heroLeftRef.current) {
        const eyebrow = heroLeftRef.current.querySelector('.hero-eyebrow')
        const heading = heroLeftRef.current.querySelector('.hero-heading')
        const lede = heroLeftRef.current.querySelector('.hero-lede')
        const ctaButtons = heroLeftRef.current.querySelectorAll('.hero-cta-btn')
        const fine = heroLeftRef.current.querySelector('.hero-fine')

        if (eyebrow) {
          heroTl.fromTo(
            eyebrow,
            { y: 16, autoAlpha: 0, scale: 0.95 },
            { y: 0, autoAlpha: 1, scale: 1, duration: 0.5, clearProps: 'opacity,visibility,transform' },
            '-=0.25'
          )
        }

        if (heading) {
          heroTl.fromTo(
            heading,
            { y: 28, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.7, clearProps: 'opacity,visibility,transform' },
            '-=0.35'
          )
        }

        if (lede) {
          heroTl.fromTo(
            lede,
            { y: 18, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.6, clearProps: 'opacity,visibility,transform' },
            '-=0.4'
          )
        }

        if (ctaButtons.length > 0) {
          heroTl.fromTo(
            ctaButtons,
            { y: 20, autoAlpha: 0, scale: 0.95 },
            {
              y: 0,
              autoAlpha: 1,
              scale: 1,
              stagger: 0.08,
              duration: 0.55,
              ease: 'back.out(1.5)',
              clearProps: 'opacity,visibility,transform',
            },
            '-=0.35'
          )
        }

        if (fine) {
          heroTl.fromTo(
            fine,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.4, clearProps: 'opacity,visibility' },
            '-=0.2'
          )
        }
      }

      // Hero right preview panel entrance
      if (heroRightRef.current) {
        heroTl.fromTo(
          heroRightRef.current,
          { y: 35, autoAlpha: 0, scale: 0.96 },
          { y: 0, autoAlpha: 1, scale: 1, duration: 0.85, ease: 'power2.out', clearProps: 'opacity,visibility' },
          '-=0.6'
        )
      }

      // Ambient hero glow continuous breathing pulse
      if (heroGlowRef.current) {
        gsap.to(heroGlowRef.current, {
          scale: 1.08,
          opacity: 0.85,
          duration: 4,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
        })
      }

      // Hero interactive 3D perspective tilt on desktop
      const heroSec = heroSectionRef.current
      const preview = heroRightRef.current
      if (heroSec && preview) {
        const onMouseMove = (e: MouseEvent) => {
          const rect = heroSec.getBoundingClientRect()
          const x = (e.clientX - rect.left) / rect.width - 0.5
          const y = (e.clientY - rect.top) / rect.height - 0.5

          gsap.to(preview, {
            rotationY: x * 6,
            rotationX: -y * 6,
            transformPerspective: 1000,
            duration: 0.4,
            ease: 'power1.out',
          })
        }

        const onMouseLeave = () => {
          gsap.to(preview, {
            rotationY: 0,
            rotationX: 0,
            duration: 0.8,
            ease: 'power2.out',
          })
        }

        heroSec.addEventListener('mousemove', onMouseMove)
        heroSec.addEventListener('mouseleave', onMouseLeave)
      }

      // Download section ScrollTrigger
      if (downloadSectionRef.current) {
        const downloadTitle = downloadSectionRef.current.querySelector('.download-title')
        const downloadSubtitle = downloadSectionRef.current.querySelector('.download-subtitle')

        if (downloadTitle && downloadSubtitle) {
          gsap.fromTo(
            [downloadTitle, downloadSubtitle],
            { y: 25, autoAlpha: 0 },
            {
              y: 0,
              autoAlpha: 1,
              stagger: 0.12,
              duration: 0.7,
              ease: 'power3.out',
              clearProps: 'opacity,visibility,transform',
              scrollTrigger: {
                trigger: downloadSectionRef.current,
                start: 'top 85%',
                toggleActions: 'play none none none',
              },
            }
          )
        }

        if (privacyRef.current) {
          gsap.fromTo(
            privacyRef.current.children,
            { x: -12, autoAlpha: 0 },
            {
              x: 0,
              autoAlpha: 1,
              stagger: 0.08,
              duration: 0.6,
              ease: 'power2.out',
              clearProps: 'opacity,visibility,transform',
              scrollTrigger: {
                trigger: privacyRef.current,
                start: 'top 88%',
                toggleActions: 'play none none none',
              },
            }
          )
        }

        if (downloadCardsRef.current) {
          gsap.fromTo(
            downloadCardsRef.current.children,
            { y: 32, autoAlpha: 0, scale: 0.96 },
            {
              y: 0,
              autoAlpha: 1,
              scale: 1,
              stagger: 0.12,
              duration: 0.65,
              ease: 'back.out(1.4)',
              clearProps: 'opacity,visibility,transform',
              scrollTrigger: {
                trigger: downloadCardsRef.current,
                start: 'top 88%',
                toggleActions: 'play none none none',
              },
            }
          )
        }
      }
    })
  }, { scope: pageContainerRef })

  // Smooth mobile nav menu expand/collapse animation
  useGSAP(() => {
    if (!mobileNavRef.current) return
    if (menuOpen) {
      gsap.fromTo(
        mobileNavRef.current,
        { autoAlpha: 0, y: -8, height: 0 },
        { autoAlpha: 1, y: 0, height: 'auto', duration: 0.28, ease: 'power2.out' }
      )
    }
  }, { dependencies: [menuOpen] })

  // Smooth Language switch transition
  const switchLang = (next: Lang) => {
    if (next === lang) return
    writeLandingLang(next)
    if (pageContainerRef.current) {
      gsap.to(pageContainerRef.current, {
        autoAlpha: 0.35,
        y: -4,
        duration: 0.12,
        ease: 'power2.in',
        onComplete: () => {
          setLang(next)
          gsap.to(pageContainerRef.current, {
            autoAlpha: 1,
            y: 0,
            duration: 0.25,
            ease: 'power2.out',
            clearProps: 'opacity,visibility,transform',
          })
        },
      })
    } else {
      setLang(next)
    }
  }

  return (
    <div ref={pageContainerRef} className="min-h-dvh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-canvas"
      >
        {t.skip}
      </a>

      <header ref={headerRef} className="sticky top-0 z-40 border-b border-line/60 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="#top" className="flex items-center gap-2.5 transition-opacity hover:opacity-80" aria-label={t.homeAria}>
            <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">OnCue</span>
              <span className="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[9px] text-mute dark:border-transparent dark:bg-white/10">v0.15</span>
            </div>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-mute md:flex" aria-label="primary">
            <a href="#video" className="transition-colors hover:text-ink">{t.nav.video}</a>
            <a href="#features" className="transition-colors hover:text-ink">{t.nav.features}</a>
            <a href="#pricing" className="transition-colors hover:text-ink">{t.nav.pricing}</a>
            <a href="#privacy" className="transition-colors hover:text-ink">{t.nav.privacy}</a>
            <a href="/subscribe" className="flex items-center gap-1 transition-colors hover:text-ink">
              {t.nav.subscribe}
              <ArrowUpRight className="h-3 w-3 opacity-60" />
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="#pricing"
              className="inline-flex h-11 items-center rounded-lg border border-line bg-subtle px-3 text-xs font-medium text-ink transition-colors hover:border-ink/20 active:scale-95 md:hidden"
            >
              {t.nav.pricing}
            </a>
            <a
              href="#download"
              className="inline-flex h-11 items-center rounded-lg border border-line bg-subtle px-3 text-xs font-medium text-ink transition-colors hover:border-ink/20 active:scale-95"
            >
              {t.nav.download}
            </a>
            <div className="flex h-11 items-center rounded-full border border-line bg-subtle p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => switchLang('zh')}
                className={`rounded-full px-3 py-2 transition-all ${lang === 'zh' ? 'border border-line/60 bg-surface font-semibold text-ink shadow-xs dark:border-transparent dark:bg-white/15' : 'text-mute hover:text-ink'}`}
                aria-pressed={lang === 'zh'}
              >
                {t.langZh}
              </button>
              <button
                type="button"
                onClick={() => switchLang('en')}
                className={`rounded-full px-3 py-2 transition-all ${lang === 'en' ? 'border border-line/60 bg-surface font-semibold text-ink shadow-xs dark:border-transparent dark:bg-white/15' : 'text-mute hover:text-ink'}`}
                aria-pressed={lang === 'en'}
              >
                {t.langEn}
              </button>
            </div>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-subtle text-ink transition-colors hover:border-ink/20 focus-visible:outline-2 active:scale-95"
              aria-label={t.themeToggle}
              title={resolvedTheme === 'dark' ? t.themeLight : t.themeDark}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-subtle text-ink active:scale-95 md:hidden"
              aria-expanded={menuOpen}
              aria-label={t.nav.menu}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav ref={mobileNavRef} className="border-t border-line bg-canvas px-5 py-3 md:hidden overflow-hidden" aria-label="mobile">
            <div className="flex flex-col gap-3 text-sm">
              <a href="#video" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.video}</a>
              <a href="#features" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.features}</a>
              <a href="#pricing" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.pricing}</a>
              <a href="#privacy" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.privacy}</a>
              <a href="/subscribe" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.subscribe}</a>
              <a href="#download" onClick={() => setMenuOpen(false)} className="transition-colors hover:text-ink">{t.nav.download}</a>
            </div>
          </nav>
        ) : null}
      </header>

      <main id="main">
        <section ref={heroSectionRef} id="top" className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[var(--hero-radial)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:py-24">
            <div ref={heroLeftRef}>
              <div className="hero-eyebrow inline-flex items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1 text-xs text-mute">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>{t.eyebrow}</span>
              </div>

              <h1 className={`hero-heading mt-5 text-[40px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[58px] ${lang === 'zh' ? 'max-w-[12ch]' : 'max-w-[15ch]'}`}>
                {t.h1.map((line, index) => (
                  <span key={line}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </h1>

              <p className="hero-lede mt-5 max-w-[34rem] text-[15px] leading-7 text-mute">{t.lede}</p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={DOWNLOAD.mac}
                  className="hero-cta-btn inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl bg-ink px-5 text-sm font-medium text-canvas transition-all hover:opacity-90 active:scale-[0.98]"
                >
                  <Apple className="h-4 w-4" />
                  {t.downloadMac}
                </a>
                <a
                  href={DOWNLOAD.win}
                  className="hero-cta-btn inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl border border-line bg-subtle px-5 text-sm font-medium text-ink transition-all hover:border-ink/20 active:scale-[0.98]"
                >
                  <WindowsIcon className="h-4 w-4" />
                  {t.downloadWin}
                </a>
                <a
                  href={DOWNLOAD.repo}
                  className="hero-cta-btn inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl border border-line bg-subtle px-5 text-sm text-ink transition-all hover:border-ink/20 active:scale-[0.98]"
                >
                  <GitHubIcon className="h-4 w-4" />
                  {t.viewGithub}
                </a>
                <a
                  href="#video"
                  className="hero-cta-btn inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-2xl border border-line bg-subtle px-5 text-sm font-medium text-ink transition-all hover:border-ink/20 active:scale-[0.98]"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {t.watchVideo}
                </a>
              </div>
              <p className="hero-fine mt-4 max-w-md text-[12px] leading-5 text-mute/80">{t.heroFine}</p>
            </div>

            <div
              ref={heroRightRef}
              className="relative [perspective:1000px] will-change-transform"
            >
              <div ref={heroGlowRef} className="hero-glow pointer-events-none absolute -inset-8 rounded-[36px] will-change-transform" />
              <CopilotPanel t={t} />
            </div>
          </div>
        </section>

        <VideoSection t={t} />
        <FeatureCards t={t} />
        <PricingSection t={t} />

        <section ref={downloadSectionRef} id="download" className="border-t border-line/60 px-5 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="download-title text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
              {t.downloadBand.title}
            </h2>
            <p className="download-subtitle mt-3 text-sm text-mute sm:text-base">{t.downloadBand.subtitle}</p>

            <div ref={privacyRef} id="privacy" className="mt-6 space-y-4 text-left text-sm leading-6 text-mute">
              <p>{t.privacy.local}</p>
              <p>{t.privacy.byok}</p>
              <p>{t.privacy.hosted}</p>
            </div>

            <div ref={downloadCardsRef} className="mt-10 grid gap-4 sm:grid-cols-2">
              <a
                href={DOWNLOAD.mac}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-6 text-left shadow-sm transition-all hover:border-ink/20 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.05] dark:shadow-none"
              >
                <Apple className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:scale-110" />
                <span>
                  <span className="block text-base font-medium text-ink">{t.downloadMac}</span>
                  <span className="mt-1 block text-xs text-mute">{t.downloadBand.macMeta}</span>
                </span>
              </a>
              <a
                href={DOWNLOAD.win}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-surface px-6 py-6 text-left shadow-sm transition-all hover:border-ink/20 hover:shadow-md dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.05] dark:shadow-none"
              >
                <WindowsIcon className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:scale-110" />
                <span>
                  <span className="block text-base font-medium text-ink">{t.downloadWin}</span>
                  <span className="mt-1 block text-xs text-mute">{t.downloadBand.winMeta}</span>
                </span>
              </a>
            </div>

            <p className="mt-6 text-xs leading-5 text-mute">{t.downloadBand.help}</p>
            <p className="mt-3 text-xs text-mute">
              {t.footerNote}{' '}
              <a href={DOWNLOAD.sums} className="underline decoration-line hover:text-ink">
                {t.downloadBand.checksum}
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60 px-5 py-6 text-center text-xs text-mute">
        {t.copyright}
      </footer>
    </div>
  )
}
