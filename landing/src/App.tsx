import { useEffect, useState } from 'react'
import { Apple } from 'lucide-react'
import { motion } from 'motion/react'
import AuthPage from './components/AuthPage'
import CopilotPanel from './components/CopilotPanel'
import FeatureCards from './components/FeatureCards'
import GitHubIcon from './components/GitHubIcon'
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

      <header className="sticky top-0 z-40 border-b border-white/5 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="#top" className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">OnCue</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-mute md:flex" aria-label="primary">
            <a href="#features" className="hover:text-ink">{t.nav.features}</a>
            <a href="#workflow" className="hover:text-ink">{t.nav.workflow}</a>
            <a href="#privacy" className="hover:text-ink">{t.nav.privacy}</a>
            <a href="/subscribe" className="hover:text-ink">{t.nav.subscribe}</a>
            <a href="#download" className="hover:text-ink">{t.nav.download}</a>
          </nav>
          <a href="#download" className="text-xs text-mute md:hidden">{t.nav.download}</a>
          <a
            href="/auth/register"
            className="hidden h-8 items-center rounded-lg border border-white/15 px-3 text-xs font-medium text-ink hover:border-white/25 sm:inline-flex"
          >
            {t.nav.register}
          </a>
          <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] px-1 py-0.5 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => switchLang('zh')}
              className={`rounded-full px-2.5 py-1 ${lang === 'zh' ? 'bg-white/10 text-ink' : 'text-mute'}`}
              aria-pressed={lang === 'zh'}
            >
              {t.langZh}
            </button>
            <span className="text-mute/60">/</span>
            <button
              type="button"
              onClick={() => switchLang('en')}
              className={`rounded-full px-2.5 py-1 ${lang === 'en' ? 'bg-white/10 text-ink' : 'text-mute'}`}
              aria-pressed={lang === 'en'}
            >
              {t.langEn}
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <section id="top" className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_38%,rgba(244,244,247,0.10),transparent_36%)]" />
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12 lg:py-24">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            >
              <p className="text-xs tracking-[0.08em] text-mute">{t.eyebrow}</p>
              <h1 className={`mt-5 text-[40px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[58px] ${lang === 'zh' ? 'max-w-[11ch]' : 'max-w-[14ch]'}`}>
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
                  className="inline-flex h-12 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-medium text-canvas"
                >
                  <Apple className="h-4 w-4" />
                  {t.downloadMac}
                </a>
                <a
                  href={DOWNLOAD.win}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-medium text-canvas"
                >
                  <WindowsIcon className="h-4 w-4" />
                  {t.downloadWin}
                </a>
                <a
                  href={DOWNLOAD.repo}
                  className="inline-flex h-12 items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.03] px-5 text-sm text-ink"
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

        <FeatureCards t={t} />

        <section id="download" className="border-t border-white/5 px-5 py-16 md:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.downloadBand.title}</h2>
            <p className="mt-3 text-sm text-mute">{t.downloadBand.subtitle}</p>
            <div id="privacy" className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-mute">
              <span className="rounded-full border border-white/10 px-3 py-1">{t.privacy.local}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{t.privacy.byok}</span>
              <span className="rounded-full border border-white/10 px-3 py-1">{t.privacy.limited}</span>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <a
                href={DOWNLOAD.mac}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 text-left hover:border-white/20"
              >
                <Apple className="h-7 w-7 shrink-0" />
                <span>
                  <span className="block text-base font-medium">{t.downloadMac}</span>
                  <span className="mt-1 block text-xs text-mute">{t.downloadBand.macMeta}</span>
                </span>
              </a>
              <a
                href={DOWNLOAD.win}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 text-left hover:border-white/20"
              >
                <WindowsIcon className="h-7 w-7 shrink-0" />
                <span>
                  <span className="block text-base font-medium">{t.downloadWin}</span>
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

      <footer className="border-t border-white/5 px-5 py-6 text-center text-[11px] text-mute">
        {t.copyright}
      </footer>
    </div>
  )
}
