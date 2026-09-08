import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, Check, Cpu, KeyRound, Mic, ShieldCheck, Sparkles } from 'lucide-react'
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
type PaymentProduct = {
  code: 'PRO_MONTH' | 'PRO_QUARTER'
  price_minor: number
  currency: 'CNY'
  duration_days: number
  stt_ms: number
  llm_units: number
}
type PaymentOrder = {
  merchant_order_no: string
  product_code: PaymentProduct['code']
  status: 'PENDING' | 'PAID' | 'CLOSED'
  checkout_url: string | null
  expires_at: string
  paid_at: string | null
  paid_through: string | null
}
type SubscriptionContext = {
  email: string
  status: string
  balances: { STT_AUDIO_MS: number; LLM_TOKEN_UNITS: number }
  hosted_stt_enabled: boolean
  hosted_llm_enabled: boolean
  payments_enabled: boolean
  csrf: string
  products: PaymentProduct[]
  subscription: null | {
    product_code: PaymentProduct['code']
    starts_at: string
    paid_through: string
  }
}
type AccountLookup = {
  account_id: string
  email: string
  status: string
  balances: { STT_AUDIO_MS: number; LLM_TOKEN_UNITS: number }
}
type RoutingKind = 'stt' | 'llm'
type RouteState = {
  provider: string
  model: string
  valid: boolean
  updated_by: string
  updated_at: string
}
type ProviderOption = {
  provider: string
  models: string[]
  selectable: boolean
  reason_code?: string
}
type RoutingResponse = {
  routes: Record<RoutingKind, RouteState>
  catalog: Record<RoutingKind, ProviderOption[]>
}
type T = (typeof authCopy)[AuthLang]

const inputClass = 'mt-2 h-11 w-full rounded-xl border border-white/15 bg-black/20 px-3.5 text-sm text-ink placeholder:text-mute/60 focus:border-white/35 focus:outline-none'
const primaryButton = 'inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-canvas disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-5 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50'

const env = (import.meta as ImportMeta & {
  readonly env?: { readonly VITE_HOSTED_GATEWAY_URL?: string; readonly DEV?: boolean }
}).env
const gateway = (env?.DEV ? (typeof window === 'undefined' ? '' : window.location.origin) : (env?.VITE_HOSTED_GATEWAY_URL?.trim() || (typeof window === 'undefined' ? '' : window.location.origin))).replace(/\/$/, '')

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

async function jsonApi<TResponse>(path: string, init?: { json?: unknown; headers?: Record<string, string> }): Promise<TResponse> {
  let response: Response
  try {
    response = await fetch(`${gateway}${path}`, {
      method: init?.json ? 'POST' : 'GET',
      credentials: 'include',
      headers: {
        ...(init?.json ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers || {}),
      },
      body: init?.json ? JSON.stringify(init.json) : undefined,
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

function authHref(path: string): string {
  const params = new URLSearchParams()
  const request = fragment().get('request')
  const lang = fragment().get('lang')
  if (request) params.set('request', request)
  if (lang) params.set('lang', lang)
  const hash = params.toString()
  return hash ? `${path}#${hash}` : path
}

function errorText(t: T, error: unknown): string {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
  return t.errors[code] || t.errors.INTERNAL_ERROR
}

function routingErrorText(t: T, error: unknown): string {
  const code = error instanceof Error ? error.message : 'INTERNAL_ERROR'
  return t.admin.routingErrors[code] || t.admin.routingErrors.INTERNAL_ERROR
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

  const accept = (next: Interaction, showSuccess = true) => {
    if (next.step === 'complete') {
      if (showSuccess) setInteraction(next)
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
      }), decision === 'allow')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  if (!request) {
    return (
      <>
        <Intro title={t.login.desktopOnlyTitle} body={t.login.desktopOnlyBody} />
        <div className="mt-7 grid gap-3">
          <a className={`${primaryButton} w-full`} href={authHref('/auth/register')}>{t.login.register}</a>
          <a className={`${secondaryButton} w-full`} href="/">{t.backHome}</a>
        </div>
      </>
    )
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

  if (interaction.step === 'complete') {
    return <StaticPage t={t} title={t.login.successTitle} body={t.login.successBody} />
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
          <a className="hover:text-ink" href={authHref('/auth/forgot-password')}>{t.login.forgot}</a>
          <a className="hover:text-ink" href={authHref('/auth/register')}>{t.login.register}</a>
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
      <p className="mt-5 text-center text-sm text-mute">
        {t.register.existing}{' '}
        <a className="text-ink underline decoration-white/20 underline-offset-4 hover:decoration-white/50" href={authHref('/auth/login')}>{t.register.signIn}</a>
      </p>
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
      <p className="mt-5 text-center text-sm text-mute">
        <a className="text-ink underline decoration-white/20 underline-offset-4 hover:decoration-white/50" href={authHref('/auth/login')}>{t.forgot.backToSignIn}</a>
      </p>
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

function formatMinutes(ms: number | undefined): string {
  return (Math.max(0, Number(ms) || 0) / 60_000).toFixed(1)
}

function formatUnits(units: number | undefined): string {
  return Math.max(0, Number(units) || 0).toLocaleString()
}

function formatDate(value: string | undefined, lang: string): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString(lang)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(start|end)\}/g, (token, key: string) => values[key] || token)
}

function periodPreview(
  product: PaymentProduct,
  paidThrough: string | undefined,
  lang: string,
): { start: string; end: string; renewing: boolean } {
  const now = new Date()
  const currentEnd = paidThrough ? new Date(paidThrough) : null
  const renewing = Boolean(currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd.getTime() > now.getTime())
  const start = renewing && currentEnd ? currentEnd : now
  return {
    start: formatDate(start.toISOString(), lang),
    end: formatDate(addDays(start, product.duration_days).toISOString(), lang),
    renewing,
  }
}

function paidOrderCopy(order: PaymentOrder, products: PaymentProduct[], lang: string, t: T): string {
  const product = products.find((item) => item.code === order.product_code)
  const end = order.paid_through ? new Date(order.paid_through) : null
  if (!product || !end || Number.isNaN(end.getTime())) return t.subscribe.paymentPaid
  const start = addDays(end, -product.duration_days)
  const copy = start.getTime() > Date.now() ? t.subscribe.paymentRenewed : t.subscribe.paymentPaid
  return fillTemplate(copy, {
    start: formatDate(start.toISOString(), lang),
    end: formatDate(end.toISOString(), lang),
  })
}

const DEFAULT_PRODUCTS: PaymentProduct[] = [
  {
    code: 'PRO_MONTH',
    price_minor: 8_900,
    currency: 'CNY',
    duration_days: 30,
    stt_ms: 54_000_000,
    llm_units: 2_000_000,
  },
  {
    code: 'PRO_QUARTER',
    price_minor: 19_900,
    currency: 'CNY',
    duration_days: 90,
    stt_ms: 180_000_000,
    llm_units: 8_000_000,
  },
]

let inFlightSubscription: Promise<SubscriptionContext> | null = null

function fetchSubscriptionContext(path: string): Promise<SubscriptionContext> {
  if (!inFlightSubscription) {
    inFlightSubscription = jsonApi<SubscriptionContext>(path).finally(() => {
      inFlightSubscription = null
    })
  }
  return inFlightSubscription
}

function SubscribePage({ t }: { t: T }) {
  const [context, setContext] = useState<SubscriptionContext | null>(null)
  const [order, setOrder] = useState<PaymentOrder | null>(null)
  const [busyProduct, setBusyProduct] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(window.location.search)
    const returnedOrder = params.get('out_trade_no')
    const ticket = params.get('ticket')
    const contextPath = ticket
      ? `/account/subscription/context?ticket=${encodeURIComponent(ticket)}`
      : '/account/subscription/context'
    fetchSubscriptionContext(contextPath)
      .then(async (value) => {
        if (!active) return
        setContext(value)
        if (ticket || (returnedOrder && !/^RI[a-f0-9]{32}$/i.test(returnedOrder))) {
          const next = new URLSearchParams()
          if (returnedOrder && !/^RI[a-f0-9]{32}$/i.test(returnedOrder)) next.set('out_trade_no', returnedOrder)
          const query = next.toString()
          window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
        }
        if (!value.payments_enabled || !returnedOrder || !/^RI[a-f0-9]{32}$/i.test(returnedOrder)) return
        window.history.replaceState(null, '', window.location.pathname)
        let refreshed = await jsonApi<PaymentOrder>(`/account/payment-orders/${returnedOrder}/refresh`, {
          json: {},
          headers: { 'X-CSRF-Token': value.csrf },
        })
        if (!active) return
        setOrder(refreshed)
        for (let attempt = 0; attempt < 10 && refreshed.status === 'PENDING' && active; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500))
          refreshed = await jsonApi<PaymentOrder>(`/account/payment-orders/${returnedOrder}`)
          if (active) setOrder(refreshed)
        }
        if (active && refreshed.status === 'PAID') {
          setContext(await jsonApi<SubscriptionContext>('/account/subscription/context'))
        }
      })
      .catch((reason: unknown) => {
        if (!active) return
        const code = reason instanceof Error ? reason.message : 'INTERNAL_ERROR'
        if (code !== 'AUTH_REQUIRED') setError(code)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const buy = async (productCode: PaymentProduct['code']) => {
    if (!context) return
    setBusyProduct(productCode)
    setError('')
    try {
      const created = await jsonApi<PaymentOrder>('/account/payment-orders', {
        json: { product_code: productCode },
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
          'X-CSRF-Token': context.csrf,
        },
      })
      if (!created.checkout_url) throw new Error('INTERNAL_ERROR')
      const checkout = new URL(created.checkout_url)
      const local = checkout.hostname === 'localhost' || checkout.hostname === '127.0.0.1'
      if (checkout.protocol !== 'https:' && !(local && checkout.protocol === 'http:')) {
        throw new Error('INTERNAL_ERROR')
      }
      window.location.assign(checkout.toString())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
      setBusyProduct('')
    }
  }

  const planName = (code: PaymentProduct['code']) => code === 'PRO_QUARTER'
    ? t.subscribe.quarterPlan
    : t.subscribe.monthPlan

  const renderPlanCard = (product: PaymentProduct, preview?: { start: string; end: string; renewing: boolean }) => {
    const isQuarter = product.code === 'PRO_QUARTER'
    const price = (product.price_minor / 100).toFixed(0)
    const dailyPrice = (product.price_minor / 100 / product.duration_days).toFixed(1)
    const action = preview
      ? (isQuarter
          ? (preview.renewing ? t.subscribe.renewQuarter : t.subscribe.buyQuarter)
          : (preview.renewing ? t.subscribe.renewMonth : t.subscribe.buyMonth))
      : (isQuarter ? t.subscribe.buyQuarter : t.subscribe.buyMonth)

    return (
      <section
        key={product.code}
        className={`relative flex flex-col justify-between rounded-2xl border p-6 transition-all duration-200 ${
          isQuarter
            ? 'border-emerald-500/30 bg-gradient-to-b from-emerald-950/15 via-white/[0.03] to-white/[0.015] shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-500/20'
            : 'border-white/10 bg-white/[0.025] hover:border-white/15'
        }`}
      >
        {isQuarter ? (
          <div className="absolute -top-3 right-6 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 backdrop-blur-md">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            <span>{t.htmlLang === 'en' ? 'Most Popular' : '超值推荐'}</span>
          </div>
        ) : null}

        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{planName(product.code)}</h2>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs text-mute">
              {product.duration_days} {t.subscribe.days}
            </span>
          </div>

          <div className="mt-4 flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tracking-tight text-ink">¥{price}</span>
            <span className="text-xs text-mute">/ {product.duration_days} {t.subscribe.days} (约 ¥{dailyPrice}/天)</span>
          </div>

          <div className="mt-6 space-y-3 border-t border-white/10 pt-5 text-xs">
            <div className="flex items-center gap-2.5 text-ink/90">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-emerald-400">
                <Mic className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <span>
                <strong className="font-semibold text-ink">{formatMinutes(product.stt_ms)}</strong> {t.subscribe.sttMinutes}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-ink/90">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-purple-400">
                <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <span>
                <strong className="font-semibold text-ink">{formatUnits(product.llm_units)}</strong> {t.subscribe.llmUnits}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-ink/90">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-blue-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <span className="text-mute">{t.subscribe.oneTimeNote}</span>
            </div>
          </div>

          {preview ? (
            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-mute">
              <p className="font-medium text-ink">{t.subscribe.renewLabel}</p>
              <p className="mt-1 leading-relaxed">
                {fillTemplate(preview.renewing ? t.subscribe.renewPreview : t.subscribe.buyPreview, {
                  start: preview.start,
                  end: preview.end,
                })}
              </p>
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          {context && context.payments_enabled ? (
            <button
              type="button"
              className={`${isQuarter ? primaryButton : secondaryButton} w-full shadow-sm`}
              disabled={Boolean(busyProduct)}
              onClick={() => void buy(product.code)}
            >
              {busyProduct === product.code ? t.subscribe.redirecting : action}
            </button>
          ) : (
            <a
              href={authHref('/auth/register')}
              className={`${isQuarter ? primaryButton : secondaryButton} w-full shadow-sm`}
            >
              {t.login.register}
            </a>
          )}
          <p className="mt-2 text-center text-[11px] text-mute">
            {preview?.renewing ? t.subscribe.renewNote : t.subscribe.paymentsNote}
          </p>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-7">
      <div>
        <Intro title={t.subscribe.title} body={t.subscribe.subtitle} />
      </div>

      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}

      {loading ? <Loading t={t} /> : context ? (
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-mute">{t.subscribe.signedIn}</p>
                <p className="mt-0.5 break-all text-sm font-semibold text-ink">{context.email}</p>
              </div>
              {context.subscription ? (
                <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  {planName(context.subscription.product_code)} · {t.subscribe.paidThrough} {formatDate(context.subscription.paid_through, t.htmlLang)}
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 p-3">
                <Mic className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <div>
                  <p className="text-[11px] text-mute">{t.subscribe.stt}</p>
                  <p className="text-sm font-semibold text-ink">{formatMinutes(context.balances.STT_AUDIO_MS)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 p-3">
                <Cpu className="h-4 w-4 text-purple-400" aria-hidden="true" />
                <div>
                  <p className="text-[11px] text-mute">{t.subscribe.llm}</p>
                  <p className="text-sm font-semibold text-ink">{formatUnits(context.balances.LLM_TOKEN_UNITS)}</p>
                </div>
              </div>
            </div>
          </section>

          {order ? (
            <p className="rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm">
              {order.status === 'PAID'
                ? paidOrderCopy(order, context.products, t.htmlLang, t)
                : order.status === 'CLOSED'
                  ? t.subscribe.paymentClosed
                  : t.subscribe.paymentPending}
            </p>
          ) : null}

          {context.payments_enabled ? (
            <div className="grid gap-5 sm:grid-cols-2">
              {context.products.map((product) => {
                const preview = periodPreview(product, context.subscription?.paid_through, t.htmlLang)
                return renderPlanCard(product, preview)
              })}
            </div>
          ) : (
            <p className="text-xs text-mute">{t.subscribe.paymentsOff}</p>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {DEFAULT_PRODUCTS.map((product) => renderPlanCard(product))}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
            <p className="text-sm text-mute">{t.subscribe.signedOut}</p>
          </div>
        </div>
      )}

      {/* Info & Policy Features */}
      <div className="grid gap-4 border-t border-white/10 pt-6 text-xs sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-white/[0.015] p-3.5">
          <h3 className="font-semibold text-ink">{t.subscribe.hostedTitle}</h3>
          <p className="mt-1.5 leading-relaxed text-mute">{t.subscribe.hostedBody}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.015] p-3.5">
          <h3 className="font-semibold text-ink">{t.subscribe.byokTitle}</h3>
          <p className="mt-1.5 leading-relaxed text-mute">{t.subscribe.byokBody}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.015] p-3.5">
          <h3 className="font-semibold text-ink">{t.subscribe.grantTitle}</h3>
          <p className="mt-1.5 leading-relaxed text-mute">{t.subscribe.grantBody}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <a className={secondaryButton} href="/">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          {t.backHome}
        </a>
        <a className={secondaryButton} href={authHref('/auth/register')}>{t.login.register}</a>
      </div>
    </div>
  )
}

function AdminPage({ t }: { t: T }) {
  const [token, setToken] = useState('')
  const [actor, setActor] = useState('')
  const [email, setEmail] = useState('')
  const [account, setAccount] = useState<AccountLookup | null>(null)
  const [sttMinutes, setSttMinutes] = useState('')
  const [reason, setReason] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [error, setError] = useState('')
  const [errorScope, setErrorScope] = useState<'general' | 'routing'>('general')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [routing, setRouting] = useState<RoutingResponse | null>(null)
  const [routeDrafts, setRouteDrafts] = useState<Record<RoutingKind, { provider: string; model: string }>>({
    stt: { provider: '', model: '' },
    llm: { provider: '', model: '' },
  })

  const headers = () => ({ 'X-Admin-Token': token, 'X-Admin-Actor': actor })

  const lookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorScope('general')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setAccount(await jsonApi<AccountLookup>('/internal/accounts/lookup', {
        json: { email },
        headers: headers(),
      }))
    } catch (reason) {
      setAccount(null)
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const loadRouting = async () => {
    setErrorScope('routing')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await jsonApi<RoutingResponse>('/internal/ai-routing', { headers: headers() })
      setRouting(next)
      setRouteDrafts({
        stt: { provider: next.routes.stt.provider, model: next.routes.stt.model },
        llm: { provider: next.routes.llm.provider, model: next.routes.llm.model },
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const selectRouteProvider = (kind: RoutingKind, provider: string) => {
    const option = routing?.catalog[kind].find((candidate) => candidate.provider === provider)
    setRouteDrafts((current) => ({
      ...current,
      [kind]: { provider, model: option?.models[0] || '' },
    }))
  }

  const activateRoute = async (kind: RoutingKind) => {
    const draft = routeDrafts[kind]
    if (!draft.provider || !draft.model) return
    setErrorScope('routing')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const route = await jsonApi<RouteState>(`/internal/ai-routing/${kind}`, {
        json: draft,
        headers: headers(),
      })
      setRouting((current) => current ? {
        ...current,
        routes: { ...current.routes, [kind]: route },
      } : current)
      setNotice(t.admin.routeActivated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  const routeCard = (kind: RoutingKind, title: string) => {
    if (!routing) return null
    const current = routing.routes[kind]
    const draft = routeDrafts[kind]
    const providers = routing.catalog[kind]
    const selected = providers.find((option) => option.provider === draft.provider)
    const unchanged = current.provider === draft.provider && current.model === draft.model
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-xs text-mute">
          {t.admin.activeRoute}: <span className="text-ink">{current.provider} / {current.model}</span>
          {!current.valid ? <span className="ml-2 text-amber-200">{t.admin.routeInvalid}</span> : null}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {t.admin.provider}
            <select className={inputClass} value={draft.provider} onChange={(event) => selectRouteProvider(kind, event.target.value)}>
              {providers.map((option) => (
                <option key={option.provider} value={option.provider} disabled={!option.selectable}>
                  {option.provider}{option.selectable ? '' : ` (${option.reason_code || t.admin.unavailable})`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t.admin.model}
            <select
              className={inputClass}
              value={draft.model}
              onChange={(event) => setRouteDrafts((value) => ({ ...value, [kind]: { ...value[kind], model: event.target.value } }))}
            >
              {(selected?.models || []).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-mute">{t.admin.updatedBy}: {current.updated_by} · {new Date(current.updated_at).toLocaleString()}</p>
          <button type="button" className={secondaryButton} disabled={busy || unchanged || !selected?.selectable || !draft.model} onClick={() => void activateRoute(kind)}>
            {t.admin.activate}
          </button>
        </div>
      </section>
    )
  }

  const grant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorScope('general')
    if (!account) return
    const minutes = Number(sttMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0 || !reason.trim()) {
      setError('INVALID_REQUEST')
      return
    }
    let expires: string | undefined
    if (validUntil) {
      const parsed = new Date(validUntil)
      if (Number.isNaN(parsed.getTime())) {
        setError('INVALID_REQUEST')
        return
      }
      expires = parsed.toISOString()
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await jsonApi(`/internal/accounts/${account.account_id}/quota-adjustments`, {
        json: {
          metric: 'STT_AUDIO_MS',
          units: Math.round(minutes * 60_000),
          reason: reason.trim(),
          ...(expires ? { valid_until: expires } : {}),
        },
        headers: headers(),
      })
      setAccount(await jsonApi<AccountLookup>('/internal/accounts/lookup', {
        json: { email: account.email },
        headers: headers(),
      }))
      setNotice(t.admin.granted)
      setSttMinutes('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Intro title={t.admin.title} body={t.admin.subtitle} />
      {error ? <ErrorMessage>{errorScope === 'routing' ? routingErrorText(t, new Error(error)) : errorText(t, new Error(error))}</ErrorMessage> : null}
      {notice ? <p role="status" className="mt-5 rounded-xl border border-emerald-200/15 bg-emerald-200/[0.05] px-3.5 py-3 text-sm text-emerald-100">{notice}</p> : null}
      <form className="mt-7 space-y-5" onSubmit={lookup} aria-busy={busy}>
        <label className="block text-sm font-medium">
          {t.admin.token}
          <input className={inputClass} type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required />
        </label>
        <label className="block text-sm font-medium">
          {t.admin.actor}
          <input className={inputClass} value={actor} onChange={(event) => setActor(event.target.value)} maxLength={128} required />
        </label>
        <label className="block text-sm font-medium">
          {t.admin.email}
          <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <button className={primaryButton} disabled={busy}>{t.admin.lookup}</button>
          <button type="button" className={secondaryButton} disabled={busy || !token || !actor} onClick={() => void loadRouting()}>{t.admin.loadRouting}</button>
        </div>
      </form>
      {routing ? (
        <div className="mt-7 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{t.admin.routingTitle}</h2>
            <p className="mt-1 text-sm text-mute">{t.admin.routingSubtitle}</p>
          </div>
          {routeCard('stt', t.admin.sttRoute)}
          {routeCard('llm', t.admin.llmRoute)}
        </div>
      ) : null}
      {account ? (
        <>
          <div className="mt-7 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-4 text-sm">
            <p className="text-xs text-mute">{t.admin.account}</p>
            <p className="mt-1 break-all font-medium">{account.email}</p>
            <p className="mt-3 text-xs text-mute">{t.admin.status}</p>
            <p className="mt-1">{account.status}</p>
            <dl className="mt-4 text-sm">
              <div>
                <dt className="text-mute">{t.subscribe.stt}</dt>
                <dd className="mt-1 font-medium">{formatMinutes(account.balances.STT_AUDIO_MS)}</dd>
              </div>
            </dl>
          </div>
          <form className="mt-7 space-y-5" onSubmit={grant} aria-busy={busy}>
            <label className="block text-sm font-medium">
              {t.admin.sttMinutes}
              <input className={inputClass} inputMode="decimal" value={sttMinutes} onChange={(event) => setSttMinutes(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              {t.admin.reason}
              <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={512} required />
            </label>
            <label className="block text-sm font-medium">
              {t.admin.validUntil}
              <input className={inputClass} type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
            </label>
            <button className={`${primaryButton} w-full`} disabled={busy}>{t.admin.grant}</button>
          </form>
        </>
      ) : null}
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

function AuthShell({
  children,
  lang,
  setLang,
  maxWidth = 'max-w-xl',
}: {
  children: ReactNode
  lang: AuthLang
  setLang: (lang: AuthLang) => void
  maxWidth?: string
}) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(244,244,247,0.13),transparent_43%)]" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <a href="/" className="flex items-center gap-2.5 text-sm font-semibold">
          <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="hidden sm:inline">OnCue</span>
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
      <main className={`relative mx-auto flex w-full ${maxWidth} items-center px-5 pb-16 pt-8 sm:min-h-[calc(100dvh-152px)] sm:pt-4`}>
        <div className="w-full rounded-2xl border border-white/10 bg-surface/90 p-6 shadow-glow backdrop-blur-xl sm:p-9">
          <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
            <KeyRound className="h-5 w-5 text-mute" aria-hidden="true" />
          </div>
          {children}
        </div>
      </main>
      <footer className="relative px-5 pb-6 text-center text-[11px] text-mute">© 2026 OnCue</footer>
    </div>
  )
}

export default function AuthPage({ path: propPath }: { path?: string } = {}) {
  const [lang, setLangState] = useState<AuthLang>(initialLang)
  const t = authCopy[lang]
  const path = propPath || window.location.pathname

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
  else if (path === '/subscribe') content = <SubscribePage t={t} />
  else if (path === '/admin') content = <AdminPage t={t} />
  else {
    const code = fragment().get('error') || 'INVALID_REQUEST'
    content = <StaticPage t={t} title={t.errorTitle} body={t.errors[code] || t.errors.INTERNAL_ERROR} />
  }

  const maxWidth = path === '/subscribe' ? 'max-w-4xl' : 'max-w-xl'
  return <AuthShell lang={lang} setLang={setLang} maxWidth={maxWidth}>{content}</AuthShell>
}
