import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, Check, KeyRound, ShieldCheck } from 'lucide-react'
import { authCopy, type AuthLang } from '../locales/authContent'

type Interaction =
  | { step: 'login'; csrf: string }
  | { step: 'mfa'; csrf: string }
  | { step: 'consent'; csrf: string; scopes: string[] }
  | { step: 'complete'; redirect_to: string }

type PublicContext = { binding: string; csrf: string }
type TokenContext = { csrf: string }
type SecurityContext = { email: string; totp_enabled: boolean; csrf: string }
type TotpSetup = { qr_base64: string; secret: string; csrf: string }
type T = (typeof authCopy)[AuthLang]

const inputClass = 'mt-2 h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3.5 text-sm text-ink placeholder:text-mute/60 focus:border-white/35 focus:outline-none'
const primaryButton = 'inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-canvas disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50'

const env = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_HOSTED_GATEWAY_URL?: string }
}).env
const gateway = (env?.VITE_HOSTED_GATEWAY_URL?.trim() || window.location.origin).replace(/\/$/, '')

let cachedFragment: URLSearchParams | undefined

function fragment(): URLSearchParams {
  if (!cachedFragment) {
    cachedFragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
  }
  return cachedFragment
}

function initialLang(): AuthLang {
  const requested = fragment().get('lang')
  if (requested === 'zh-TW' || requested?.toLowerCase().startsWith('zh-tw')) return 'zh-TW'
  if (requested === 'zh-CN' || requested === 'zh' || requested?.toLowerCase().startsWith('zh-cn')) return 'zh-CN'
  if (requested?.toLowerCase().startsWith('en')) return 'en'
  try {
    const stored = localStorage.getItem('rabbit-auth-lang')
    if (stored === 'en' || stored === 'zh-CN' || stored === 'zh-TW') return stored
  } catch {
    // Language preference is optional.
  }
  const browser = navigator.language.toLowerCase()
  if (browser.startsWith('zh-tw') || browser.startsWith('zh-hk') || browser.startsWith('zh-hant')) return 'zh-TW'
  return browser.startsWith('zh') ? 'zh-CN' : 'en'
}

async function api<TResponse>(path: string, values?: Record<string, string>): Promise<TResponse> {
  let response: Response
  try {
    response = await fetch(`${gateway}${path}`, {
      method: values ? 'POST' : 'GET',
      credentials: 'include',
      headers: values ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body: values ? new URLSearchParams(values) : undefined,
    })
  } catch {
    throw new Error('NETWORK_ERROR')
  }
  const body = await response.json().catch(() => null) as null | {
    code?: string
    error?: string
  }
  if (!response.ok || body === null) {
    throw new Error(body?.code || body?.error || (response.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR'))
  }
  return body as TResponse
}

function errorText(t: T, error: unknown): string {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
  return t.errors[code] || t.errors.INTERNAL_ERROR
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) || '')
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-5 rounded-xl border border-red-300/15 bg-red-300/[0.06] px-3.5 py-3 text-sm leading-6 text-red-100">
      {children}
    </p>
  )
}

function Intro({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-mute">{body}</p>
    </div>
  )
}

function Loading({ t }: { t: T }) {
  return <p className="py-10 text-center text-sm text-mute" aria-live="polite">{t.loading}</p>
}

function LoginPage({ t }: { t: T }) {
  const request = fragment().get('request') || ''
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    if (!request) {
      setError('MISSING_REQUEST')
      return
    }
    api<Interaction>('/oauth2/interaction', { request })
      .then((next) => {
        if (active) setInteraction(next)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
      })
    return () => { active = false }
  }, [request])

  const accept = (next: Interaction) => {
    if (next.step === 'complete') {
      window.location.assign(next.redirect_to)
    } else {
      setInteraction(next)
    }
  }

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!interaction || interaction.step !== 'login') return
    setBusy(true)
    setError('')
    try {
      accept(await api<Interaction>('/oauth2/login', {
        request,
        csrf: interaction.csrf,
        email: formValue(event.currentTarget, 'email'),
        password: formValue(event.currentTarget, 'password'),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const submitMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!interaction || interaction.step !== 'mfa') return
    setBusy(true)
    setError('')
    try {
      accept(await api<Interaction>('/oauth2/mfa', {
        request,
        csrf: interaction.csrf,
        code: formValue(event.currentTarget, 'code'),
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const submitConsent = async (decision: 'allow' | 'deny') => {
    if (!interaction || interaction.step !== 'consent') return
    setBusy(true)
    setError('')
    try {
      accept(await api<Interaction>('/oauth2/consent', {
        request,
        csrf: interaction.csrf,
        decision,
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  if (!interaction && !error) return <Loading t={t} />
  if (!interaction) {
    return (
      <>
        <Intro title={t.errorTitle} body={errorText(t, new Error(error))} />
        <a href="/" className={`${secondaryButton} mt-7 w-full`}>{t.backHome}</a>
      </>
    )
  }

  if (interaction.step === 'login') {
    return (
      <>
        <Intro title={t.login.title} body={t.login.subtitle} />
        {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
        <form className="mt-7 space-y-5" onSubmit={submitLogin} aria-busy={busy}>
          <label className="block text-sm font-medium">
            {t.login.email}
            <input className={inputClass} name="email" type="email" autoComplete="username" maxLength={320} required autoFocus />
          </label>
          <label className="block text-sm font-medium">
            {t.login.password}
            <input className={inputClass} name="password" type="password" autoComplete="current-password" maxLength={512} required />
          </label>
          <button className={`${primaryButton} w-full`} disabled={busy}>{t.login.submit}</button>
        </form>
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm text-mute">
          <a className="hover:text-ink" href="/auth/forgot-password">{t.login.forgot}</a>
          <a className="hover:text-ink" href="/auth/register">{t.login.register}</a>
        </div>
      </>
    )
  }

  if (interaction.step === 'mfa') {
    return (
      <>
        <Intro title={t.login.mfaTitle} body={t.login.mfaHelp} />
        {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
        <form className="mt-7 space-y-5" onSubmit={submitMfa} aria-busy={busy}>
          <label className="block text-sm font-medium">
            {t.login.code}
            <input className={inputClass} name="code" autoComplete="one-time-code" maxLength={32} required autoFocus />
          </label>
          <button className={`${primaryButton} w-full`} disabled={busy}>{t.login.submit}</button>
        </form>
      </>
    )
  }

  if (interaction.step === 'consent') {
    return (
      <>
        <Intro title={t.login.consentTitle} body={t.login.consentHelp} />
        {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
        <ul className="mt-6 space-y-3">
          {interaction.scopes.map((scope) => (
            <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-3.5 py-3 text-sm" key={scope}>
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-mute" aria-hidden="true" />
              {t.scopes[scope] || scope}
            </li>
          ))}
        </ul>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <button className={primaryButton} disabled={busy} onClick={() => void submitConsent('allow')}>{t.login.allow}</button>
          <button className={secondaryButton} disabled={busy} onClick={() => void submitConsent('deny')}>{t.login.deny}</button>
        </div>
      </>
    )
  }

  return <Loading t={t} />
}

function RegisterPage({ t }: { t: T }) {
  const [context, setContext] = useState<PublicContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    let active = true
    api<PublicContext>('/account/register/context')
      .then((value) => { if (active) setContext(value) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR') })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context) return
    setBusy(true)
    setError('')
    try {
      await api('/account/register', {
        binding: context.binding,
        csrf: context.csrf,
        display_name: formValue(event.currentTarget, 'display_name'),
        email: formValue(event.currentTarget, 'email'),
      })
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  if (sent) return <Intro title={t.register.sentTitle} body={t.register.sentBody} />
  return (
    <>
      <Intro title={t.register.title} body={t.register.subtitle} />
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {!context && !error ? <Loading t={t} /> : null}
      {context ? (
        <form className="mt-7 space-y-5" onSubmit={submit} aria-busy={busy}>
          <label className="block text-sm font-medium">
            {t.register.name}
            <input className={inputClass} name="display_name" autoComplete="name" maxLength={128} required autoFocus />
          </label>
          <label className="block text-sm font-medium">
            {t.register.email}
            <input className={inputClass} name="email" type="email" autoComplete="email" maxLength={320} required />
          </label>
          <button className={`${primaryButton} w-full`} disabled={busy}>{t.register.submit}</button>
        </form>
      ) : null}
      <p className="mt-5 text-center text-xs leading-5 text-mute">{t.register.existing}</p>
    </>
  )
}

function ForgotPage({ t }: { t: T }) {
  const [context, setContext] = useState<PublicContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    let active = true
    api<PublicContext>('/account/forgot-password/context')
      .then((value) => { if (active) setContext(value) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR') })
    return () => { active = false }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context) return
    setBusy(true)
    setError('')
    try {
      await api('/account/forgot-password', {
        binding: context.binding,
        csrf: context.csrf,
        email: formValue(event.currentTarget, 'email'),
      })
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  if (sent) return <Intro title={t.forgot.sentTitle} body={t.forgot.sentBody} />
  return (
    <>
      <Intro title={t.forgot.title} body={t.forgot.subtitle} />
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {!context && !error ? <Loading t={t} /> : null}
      {context ? (
        <form className="mt-7 space-y-5" onSubmit={submit} aria-busy={busy}>
          <label className="block text-sm font-medium">
            {t.forgot.email}
            <input className={inputClass} name="email" type="email" autoComplete="email" maxLength={320} required autoFocus />
          </label>
          <button className={`${primaryButton} w-full`} disabled={busy}>{t.forgot.submit}</button>
        </form>
      ) : null}
    </>
  )
}

function PasswordPage({ t, kind }: { t: T; kind: 'setup' | 'reset' }) {
  const token = fragment().get('token') || ''
  const [context, setContext] = useState<TokenContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    if (!token) {
      setError('INVALID_OR_EXPIRED_LINK')
      return
    }
    api<TokenContext>(`/account/${kind === 'setup' ? 'setup' : 'reset-password'}/context`, { token })
      .then((value) => { if (active) setContext(value) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR') })
    return () => { active = false }
  }, [kind, token])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!context) return
    setBusy(true)
    setError('')
    try {
      await api(`/account/${kind === 'setup' ? 'setup' : 'reset-password'}`, {
        token,
        csrf: context.csrf,
        password: formValue(event.currentTarget, 'password'),
        confirm_password: formValue(event.currentTarget, 'confirm_password'),
      })
      setSaved(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  if (saved) return <Intro title={t.password.savedTitle} body={t.password.savedBody} />
  return (
    <>
      <Intro title={kind === 'setup' ? t.password.setupTitle : t.password.resetTitle} body={t.password.subtitle} />
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {!context && !error ? <Loading t={t} /> : null}
      {context ? (
        <form className="mt-7 space-y-5" onSubmit={submit} aria-busy={busy}>
          <label className="block text-sm font-medium">
            {t.password.value}
            <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required autoFocus />
          </label>
          <label className="block text-sm font-medium">
            {t.password.confirm}
            <input className={inputClass} name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          </label>
          <button className={`${primaryButton} w-full`} disabled={busy}>{t.password.submit}</button>
        </form>
      ) : null}
    </>
  )
}

function SecurityPage({ t }: { t: T }) {
  const [context, setContext] = useState<SecurityContext | null>(null)
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    api<SecurityContext>('/account/security/context')
      .then((value) => { if (active) setContext(value) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR') })
    return () => { active = false }
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const start = () => run(async () => {
    if (!context) return
    setSetup(await api<TotpSetup>('/account/security/totp/start', { csrf: context.csrf }))
  })

  const confirm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    void run(async () => {
      if (!setup || !context) return
      const result = await api<{ recovery_codes: string[] }>('/account/security/totp/confirm', {
        csrf: setup.csrf,
        code: formValue(form, 'code'),
      })
      setRecoveryCodes(result.recovery_codes)
      setSetup(null)
      setContext({ ...context, totp_enabled: true })
    })
  }

  const disable = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    void run(async () => {
      if (!context) return
      await api('/account/security/totp/disable', {
        csrf: context.csrf,
        password: formValue(form, 'password'),
        code: formValue(form, 'code'),
      })
      form.reset()
      setContext({ ...context, totp_enabled: false })
      setNotice(t.security.disabledDone)
    })
  }

  const revoke = () => run(async () => {
    if (!context) return
    await api('/account/security/revoke-others', { csrf: context.csrf })
    setNotice(t.security.revokedDone)
  })

  if (!context && !error) return <Loading t={t} />
  if (!context) {
    return (
      <>
        <Intro title={t.errorTitle} body={errorText(t, new Error(error))} />
        <a href="/" className={`${secondaryButton} mt-7 w-full`}>{t.backHome}</a>
      </>
    )
  }

  return (
    <>
      <Intro title={t.security.title} body={t.security.subtitle} />
      <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3.5">
        <p className="text-xs text-mute">{t.security.account}</p>
        <p className="mt-1 break-all text-sm font-medium">{context.email}</p>
      </div>
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {notice ? <p role="status" className="mt-5 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.05] px-3.5 py-3 text-sm text-emerald-100">{notice}</p> : null}
      {recoveryCodes.length ? (
        <section className="mt-7">
          <h2 className="text-lg font-semibold">{t.security.recoveryTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-mute">{t.security.recoveryHelp}</p>
          <div className="mt-4 grid grid-cols-2 gap-2" aria-label={t.security.recoveryTitle}>
            {recoveryCodes.map((code) => <code className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center text-xs" key={code}>{code}</code>)}
          </div>
        </section>
      ) : setup ? (
        <section className="mt-7">
          <h2 className="text-lg font-semibold">{t.security.setupTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-mute">{t.security.setupHelp}</p>
          <img className="mx-auto mt-5 h-52 w-52 rounded-xl bg-white p-2" src={setup.qr_base64.startsWith('data:') ? setup.qr_base64 : `data:image/png;base64,${setup.qr_base64}`} alt={t.security.setupTitle} />
          <p className="mt-4 text-xs text-mute">{t.security.secret}</p>
          <code className="mt-2 block break-all rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">{setup.secret}</code>
          <form className="mt-5" onSubmit={confirm} aria-busy={busy}>
            <label className="block text-sm font-medium">
              {t.security.code}
              <input className={inputClass} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
            </label>
            <button className={`${primaryButton} mt-5 w-full`} disabled={busy}>{t.security.confirm}</button>
          </form>
        </section>
      ) : (
        <section className="mt-7">
          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-mute" aria-hidden="true" />
            <p className="text-sm leading-6">{context.totp_enabled ? t.security.enabled : t.security.disabled}</p>
          </div>
          {!context.totp_enabled ? (
            <button className={`${primaryButton} mt-5 w-full`} disabled={busy} onClick={() => void start()}>{t.security.start}</button>
          ) : (
            <form className="mt-5 space-y-5" onSubmit={disable} aria-busy={busy}>
              <label className="block text-sm font-medium">
                {t.security.password}
                <input className={inputClass} name="password" type="password" autoComplete="current-password" maxLength={128} required />
              </label>
              <label className="block text-sm font-medium">
                {t.security.factor}
                <input className={inputClass} name="code" autoComplete="one-time-code" maxLength={32} required />
              </label>
              <button className={`${secondaryButton} w-full`} disabled={busy}>{t.security.disable}</button>
            </form>
          )}
        </section>
      )}
      <hr className="my-7 border-white/10" />
      <button className={`${secondaryButton} w-full`} disabled={busy} onClick={() => void revoke()}>{t.security.revoke}</button>
    </>
  )
}

function StaticPage({ title, body, t }: { title: string; body: string; t: T }) {
  return (
    <>
      <Intro title={title} body={body} />
      <a href="/" className={`${secondaryButton} mt-7 w-full`}><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t.backHome}</a>
    </>
  )
}

function AuthShell({ children, lang, setLang }: { children: ReactNode; lang: AuthLang; setLang: (lang: AuthLang) => void }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(244,244,247,0.13),transparent_43%)]" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <a href="/" className="flex items-center gap-2.5 text-sm font-semibold">
          <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="hidden sm:inline">Rabbit Interview</span>
        </a>
        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1 text-[11px] font-medium" aria-label="Language">
          {(['zh-CN', 'zh-TW', 'en'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setLang(value)}
              className={`rounded-full px-2.5 py-1.5 ${lang === value ? 'bg-white/10 text-ink' : 'text-mute'}`}
              aria-pressed={lang === value}
            >
              {value === 'zh-CN' ? '简' : value === 'zh-TW' ? '繁' : 'EN'}
            </button>
          ))}
        </div>
      </header>
      <main className="relative mx-auto flex w-full max-w-xl items-center px-5 pb-16 pt-8 sm:min-h-[calc(100dvh-152px)] sm:pt-4">
        <div className="w-full rounded-2xl border border-white/10 bg-surface/90 p-6 shadow-glow backdrop-blur-xl sm:p-9">
          <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <KeyRound className="h-5 w-5 text-mute" aria-hidden="true" />
          </div>
          {children}
        </div>
      </main>
      <footer className="relative px-5 pb-6 text-center text-[11px] text-mute">© 2026 Rabbit Interview</footer>
    </div>
  )
}

export default function AuthPage() {
  const [lang, setLangState] = useState<AuthLang>(initialLang)
  const t = authCopy[lang]
  const path = window.location.pathname

  useEffect(() => {
    document.documentElement.lang = t.htmlLang
    document.title = t.title
  }, [t])

  const setLang = (next: AuthLang) => {
    setLangState(next)
    try {
      localStorage.setItem('rabbit-auth-lang', next)
    } catch {
      // Language preference is optional.
    }
  }

  let content: ReactNode
  if (path === '/auth/login') content = <LoginPage t={t} />
  else if (path === '/auth/register') content = <RegisterPage t={t} />
  else if (path === '/auth/forgot-password') content = <ForgotPage t={t} />
  else if (path === '/auth/reset-password') content = <PasswordPage t={t} kind="reset" />
  else if (path === '/auth/setup') content = <PasswordPage t={t} kind="setup" />
  else if (path === '/auth/security') content = <SecurityPage t={t} />
  else if (path === '/auth/signed-out') content = <StaticPage t={t} title={t.signedOut.title} body={t.signedOut.body} />
  else {
    const code = fragment().get('error') || 'INVALID_REQUEST'
    content = <StaticPage t={t} title={t.errorTitle} body={t.errors[code] || t.errors.INTERNAL_ERROR} />
  }

  return <AuthShell lang={lang} setLang={setLang}>{content}</AuthShell>
}
