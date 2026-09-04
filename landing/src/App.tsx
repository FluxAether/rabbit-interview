import { useEffect, useState } from 'react'
import { Apple, ArrowUpRight } from 'lucide-react'
import { motion } from 'motion/react'
import AuthPage from './components/AuthPage'
import CopilotPanel from './components/CopilotPanel'
import FeatureCards from './components/FeatureCards'
import GitHubIcon from './components/GitHubIcon'
import PricingSection from './components/PricingSection'
import WindowsIcon from './components/WindowsIcon'
import { DOWNLOAD, copy, type Lang } from './locales/content'

const LANG_KEY = 'rabbit-landing-lang'

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // ignore
  }
  return 'zh'
}

export default function App() {
  const path = window.location.pathname
  return path.startsWith('/auth/') || path === '/subscribe' || path === '/admin'
    ? <AuthPage />
    : <LandingPage />
}

function LandingPage() {
  const [lang, setLang] = useState<Lang>('zh')
  const t = copy[lang]

  useEffect(() => {
    setLang(readLang())
  }, [])

  useEffect(() => {
    document.documentElement.lang = t.htmlLang
    document.title = t.title
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', t.description)
  }, [t])

  const switchLang = (next: Lang) => {
    setLang(next)
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-canvas"
      >
        {t.skip}
      </a>

      {/* Modern Sticky Navigation */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="#top" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">OnCue</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] text-mute">v0.15</span>
            </div>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-mute md:flex" aria-label="primary">
            <a href="#features" className="transition-colors hover:text-ink">{t.nav.features}</a>
            <a href="#pricing" className="transition-colors hover:text-ink">{t.nav.pricing}</a>
            <a href="#privacy" className="transition-colors hover:text-ink">{t.nav.privacy}</a>
            <a href="/subscribe" className="flex items-center gap-1 transition-colors hover:text-ink">
              {t.nav.subscribe}
              <ArrowUpRight className="h-3 w-3 opacity-60" />
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="#download"
              className="inline-flex h-8 items-center rounded-lg border border-white/15 bg-white/[0.04] px-3 text-xs font-medium text-ink transition-colors hover:border-white/25 hover:bg-white/[0.08]"
            >
              {t.nav.download}
            </a>

            {/* Segmented Language Switcher */}
            <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => switchLang('zh')}
                className={`rounded-full px-2 py-0.5 transition-all ${
                  lang === 'zh' ? 'bg-white/15 text-ink font-semibold' : 'text-mute hover:text-ink'
                }`}
                aria-pressed={lang === 'zh'}
              >
                {t.langZh}
              </button>
              <button
                type="button"
                onClick={() => switchLang('en')}
                className={`rounded-full px-2 py-0.5 transition-all ${
                  lang === 'en' ? 'bg-white/15 text-ink font-semibold' : 'text-mute hover:text-ink'
                }`}
                aria-pressed={lang === 'en'}
              >
                {t.langEn}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero Section */}
        <section id="top" className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_38%,rgba(244,244,247,0.08),transparent_40%)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:py-24">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-mute">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{t.eyebrow}</span>
              </div>

              <h1 className={`mt-5 text-[40px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[58px] ${
                lang === 'zh' ? 'max-w-[12ch]' : 'max-w-[15ch]'
              }`}>
                {t.h1.map((line, index) => (
                  <span key={line}>
                    {index > 0 ? <br /> : null}
                    {line}
                  </span>
                ))}
              </h1>

              <p className="mt-5 max-w-[34rem] text-[15px] leading-7 text-mute">{t.lede}</p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href={DOWNLOAD.mac}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-medium text-canvas transition-opacity hover:opacity-90"
                >
                  <Apple className="h-4 w-4" />
                  {t.downloadMac}
                </a>
                <a
                  href={DOWNLOAD.win}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-medium text-canvas transition-opacity hover:opacity-90"
                >
                  <WindowsIcon className="h-4 w-4" />
                  {t.downloadWin}
                </a>
                <a
                  href={DOWNLOAD.repo}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.03] px-5 text-sm text-ink transition-colors hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <GitHubIcon className="h-4 w-4" />
                  {t.viewGithub}
                </a>
              </div>
              <p className="mt-4 max-w-md text-[12px] leading-5 text-mute/80">{t.heroFine}</p>
            </motion.div>

            <motion.div
              className="relative"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: 'easeOut' }}
            >
              <div className="hero-glow pointer-events-none absolute -inset-8 rounded-[36px]" />
              <CopilotPanel t={t} />
            </motion.div>
          </div>
        </section>

        {/* Feature Pipeline Section */}
        <FeatureCards t={t} />

        {/* Pricing & Dual-Core Section */}
        <PricingSection t={t} />

        {/* Download & Trust Section */}
        <section id="download" className="border-t border-white/5 px-5 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-4xl">
              {t.downloadBand.title}
            </h2>
            <p className="mt-3 text-sm text-mute sm:text-base">{t.downloadBand.subtitle}</p>

            <div id="privacy" className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-mute">
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3.5 py-1">
                {t.privacy.local}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3.5 py-1">
                {t.privacy.byok}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.02] px-3.5 py-1">
                {t.privacy.limited}
              </span>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <a
                href={DOWNLOAD.mac}
                className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-6 text-left transition-all hover:border-white/20 hover:bg-white/[0.05]"
              >
                <Apple className="h-8 w-8 shrink-0 transition-transform group-hover:scale-105" />
                <span>
                  <span className="block text-base font-medium text-ink">{t.downloadMac}</span>
                  <span className="mt-1 block text-xs text-mute">{t.downloadBand.macMeta}</span>
                </span>
              </a>
              <a
                href={DOWNLOAD.win}
                className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-6 text-left transition-all hover:border-white/20 hover:bg-white/[0.05]"
              >
                <WindowsIcon className="h-8 w-8 shrink-0 transition-transform group-hover:scale-105" />
                <span>
                  <span className="block text-base font-medium text-ink">{t.downloadWin}</span>
                  <span className="mt-1 block text-xs text-mute">{t.downloadBand.winMeta}</span>
                </span>
              </a>
            </div>

            <p className="mt-6 text-xs text-mute">
              {t.footerNote}{' '}
              <a href={DOWNLOAD.sums} className="underline decoration-white/20 underline-offset-4 hover:text-ink">
                {t.downloadBand.checksum}
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 px-5 py-6 text-center text-xs text-mute">
        {t.copyright}
      </footer>
    </div>
  )
}
