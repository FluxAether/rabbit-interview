import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { ArrowLeft, Check, KeyRound, Moon, ShieldCheck, Sun } from 'lucide-react'
import { authCopy, type AuthLang } from '../locales/authContent'
import { authLangFromStore, writeAuthLang } from '../locales/lang'
import { FALLBACK_PRODUCTS, formatCredits, formatYuan, gateway, isPaymentProduct, type PaymentProduct } from '../lib/catalog'
import { CREDIT_UNIT_SCALE, creditsToUnits } from '../lib/credits'
import { useTheme } from '../lib/theme'

type Interaction =
  | { step: 'login'; csrf: string }
  | { step: 'mfa'; csrf: string }
  | { step: 'consent'; csrf: string; scopes: string[] }
  | { step: 'complete'; redirect_to: string }

type PublicContext = { binding: string; csrf: string }
type TokenContext = { csrf: string }
type SecurityContext = { email: string; totp_enabled: boolean; csrf: string }
type TotpSetup = { qr_base64: string; secret: string; csrf: string }
type PaymentOrder = {
  merchant_order_no: string
  product_code: string
  status: 'PENDING' | 'PAID' | 'CLOSED'
  checkout_url: string | null
  expires_at: string
  paid_at: string | null
}
type SubscriptionContext = {
  email: string
  status: string
  balances: { CREDITS: number }
  credit_unit_scale: number
  byok_unlocked: boolean
  hosted_stt_enabled: boolean
  hosted_llm_enabled: boolean
  payments_enabled: boolean
  csrf: string
  products: PaymentProduct[]

}
type AccountLookup = {
  account_id: string
  email: string
  status: string
  balances: { CREDITS: number }
  credit_unit_scale: number
  byok_unlocked: boolean
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

const inputClass = 'mt-2 h-11 w-full rounded-xl border border-line bg-subtle px-3.5 text-sm text-ink placeholder:text-mute/60 focus:border-ink/40 focus:outline-none dark:border-white/15 dark:bg-black/20 dark:focus:border-white/35'
const primaryButton = 'inline-flex h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'inline-flex h-11 items-center justify-center rounded-xl border border-line bg-subtle px-5 text-sm font-medium text-ink transition-colors hover:border-ink/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.04] dark:hover:border-white/25'

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

function initialLang(hideTraditional = false): AuthLang {
  const requested = fragment().get('lang')
  return authLangFromStore(requested, hideTraditional)
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
    <p role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm leading-6 text-red-600 dark:border-red-300/15 dark:bg-red-300/[0.06] dark:text-red-100">
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
            <li className="flex items-start gap-3 rounded-xl border border-line bg-subtle px-3.5 py-3 text-sm dark:border-white/10 dark:bg-white/[0.025]" key={scope}>
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
        <a className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink/40 dark:decoration-white/20 dark:hover:decoration-white/50" href={authHref('/auth/login')}>{t.register.signIn}</a>
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
        <a className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink/40 dark:decoration-white/20 dark:hover:decoration-white/50" href={authHref('/auth/login')}>{t.forgot.backToSignIn}</a>
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
      <div className="mt-6 rounded-xl border border-line bg-subtle px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.025]">
        <p className="text-xs text-mute">{t.security.account}</p>
        <p className="mt-1 break-all text-sm font-medium">{context.email}</p>
      </div>
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {notice ? <p role="status" className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-700 dark:border-emerald-200/15 dark:bg-emerald-200/[0.05] dark:text-emerald-100">{notice}</p> : null}
      {recoveryCodes.length ? (
        <section className="mt-7">
          <h2 className="text-lg font-semibold">{t.security.recoveryTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-mute">{t.security.recoveryHelp}</p>
          <div className="mt-4 grid grid-cols-2 gap-2" aria-label={t.security.recoveryTitle}>
            {recoveryCodes.map((code) => <code className="rounded-lg border border-line bg-subtle px-3 py-2 text-center text-xs dark:border-white/10 dark:bg-black/20" key={code}>{code}</code>)}
          </div>
        </section>
      ) : setup ? (
        <section className="mt-7">
          <h2 className="text-lg font-semibold">{t.security.setupTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-mute">{t.security.setupHelp}</p>
          <img className="mx-auto mt-5 h-52 w-52 rounded-xl bg-white p-2" src={setup.qr_base64.startsWith('data:') ? setup.qr_base64 : `data:image/png;base64,${setup.qr_base64}`} alt={t.security.setupTitle} />
          <p className="mt-4 text-xs text-mute">{t.security.secret}</p>
          <code className="mt-2 block break-all rounded-lg border border-line bg-subtle px-3 py-2 text-xs dark:border-white/10 dark:bg-black/20">{setup.secret}</code>
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
          <div className="flex items-start gap-3 rounded-xl border border-line bg-subtle px-4 py-4 dark:border-white/10 dark:bg-white/[0.025]">
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
      <hr className="my-7 border-line dark:border-white/10" />
      <button className={`${secondaryButton} w-full`} disabled={busy} onClick={() => void revoke()}>{t.security.revoke}</button>
    </>
  )
}

let inFlightSubscription: Promise<SubscriptionContext> | null = null

function fetchSubscriptionContext(path: string): Promise<SubscriptionContext> {
  if (!inFlightSubscription) {
    inFlightSubscription = jsonApi<SubscriptionContext>(path).then(context => {
      if (context.credit_unit_scale !== CREDIT_UNIT_SCALE || !Number.isSafeInteger(context.balances?.CREDITS)
        || context.balances.CREDITS < 0 || typeof context.byok_unlocked !== 'boolean'
        || !Array.isArray(context.products) || !context.products.every(isPaymentProduct)) throw new Error('GATEWAY_UNREACHABLE')
      return context
    }).finally(() => {
      inFlightSubscription = null
    })
  }
  return inFlightSubscription
}

function SubscribePage({ t }: { t: T }) {
  const [context, setContext] = useState<SubscriptionContext | null>(null)
  const [order, setOrder] = useState<PaymentOrder | null>(null)
  const [busyProduct, setBusyProduct] = useState('')
  const [selectedPlan, setSelectedPlan] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('plan') || '' : ''))
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
          setContext(await fetchSubscriptionContext('/account/subscription/context'))
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

  const refreshOrder = async () => {
    if (!context || !order) return
    setBusyProduct(order.product_code)
    setError('')
    try {
      const next = await jsonApi<PaymentOrder>(`/account/payment-orders/${order.merchant_order_no}/refresh`, {
        json: {}, headers: { 'X-CSRF-Token': context.csrf },
      })
      setOrder(next)
      if (next.status === 'PAID') setContext(await fetchSubscriptionContext('/account/subscription/context'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'INTERNAL_ERROR')
    } finally {
      setBusyProduct('')
    }
  }

  return (
    <div className="space-y-6">
      <Intro title={context ? t.subscribe.signedInTitle : t.subscribe.guestTitle} body={t.subscribe.subtitle} />
      {error ? <ErrorMessage>{errorText(t, new Error(error))}</ErrorMessage> : null}
      {loading ? <p role="status" className="text-sm text-mute">{t.loading}</p> : null}
      {context ? (
        <section className="rounded-2xl border border-line bg-subtle p-5 dark:border-white/10 dark:bg-white/[0.025]">
          <p className="text-xs text-mute">{t.subscribe.signedIn}</p>
          <p className="mt-1 break-all font-medium">{context.email}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-mute">{t.subscribe.credits}</dt>
              <dd className="mt-1 text-2xl font-semibold">{formatCredits(context.balances.CREDITS, context.credit_unit_scale, t.htmlLang)}</dd>
            </div>
            <div>
              <dt className="text-xs text-mute">{t.subscribe.byokTitle}</dt>
              <dd className="mt-1 font-medium">{context.byok_unlocked ? t.subscribe.byokUnlocked : t.subscribe.byokLocked}</dd>
            </div>
          </dl>
        </section>
      ) : <p className="text-sm text-mute">{t.subscribe.signedOut}</p>}
      {order ? (
        <div role="status" className="space-y-3 rounded-xl border border-line bg-subtle px-4 py-3 text-sm dark:border-white/10 dark:bg-transparent">
          <p>{order.status === 'PAID' ? t.subscribe.paymentPaid : order.status === 'CLOSED' ? t.subscribe.paymentClosed : t.subscribe.paymentPending}</p>
          <p className="break-all text-xs text-mute">{t.subscribe.orderNo}: {order.merchant_order_no}</p>
          {order.status === 'PENDING' ? <button className={secondaryButton} disabled={Boolean(busyProduct)} onClick={() => void refreshOrder()}>{t.subscribe.checkPayment}</button> : null}
        </div>
      ) : null}
      {context && !context.payments_enabled ? <p className="text-sm text-mute">{t.subscribe.paymentsOff}</p> : null}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {(context?.products || FALLBACK_PRODUCTS).map((product) => {
          const byok = product.kind === 'BYOK'
          const isPass = product.code === 'PASS_WEEK_7D'
          const unlocked = byok && context?.byok_unlocked
          const isSelected = selectedPlan === product.code
          const tag = byok ? t.subscribe.lifetime : isPass ? t.subscribe.sprint : t.subscribe.permanent
          return (
            <section
              key={product.code}
              onClick={() => setSelectedPlan(product.code)}
              className={`flex flex-col rounded-2xl border p-5 transition-all cursor-pointer ${
                isSelected
                  ? 'border-emerald-500/80 bg-emerald-500/[0.05] ring-1 ring-emerald-500/30'
                  : 'border-line bg-surface hover:border-ink/20 dark:border-white/15 dark:bg-white/[0.025] dark:hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className={`text-xs ${isPass ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'}`}>{tag}</p>
                {isSelected ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">✓</span> : null}
              </div>
              <h2 className="mt-3 text-lg font-semibold">{byok ? t.subscribe.byokTitle : `${formatCredits(product.credit_units, product.credit_unit_scale, t.htmlLang)} ${t.subscribe.creditLabel}`}</h2>
              <p className="mt-4 text-3xl font-semibold">{formatYuan(product.price_minor)}</p>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-mute">{byok ? t.subscribe.byokBody : t.subscribe.hostedBody}</p>
              <p className="my-4 flex gap-2 text-xs text-mute"><Check className="h-4 w-4 shrink-0" />{byok ? t.subscribe.noCredits : t.subscribe.availableNow}</p>
              {context ? (
                <button
                  className={primaryButton}
                  disabled={Boolean(busyProduct) || unlocked || !context.payments_enabled || context.status !== 'ACTIVE'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void buy(product.code)
                  }}
                >
                  {unlocked ? t.subscribe.byokUnlocked : busyProduct === product.code ? t.subscribe.redirecting : t.subscribe.buy}
                </button>
              ) : (
                <a
                  href={authHref('/auth/login')}
                  className={secondaryButton}
                  onClick={(e) => e.stopPropagation()}
                >
                  {t.subscribe.openToBuy}
                </a>
              )}
            </section>
          )
        })}
      </div>
      <p className="text-xs text-mute">{t.subscribe.paymentsNote}</p>
      <section className="rounded-xl border border-line bg-subtle/50 p-4 text-sm dark:border-white/10 dark:bg-transparent">
        <h2 className="font-medium">{t.subscribe.grantTitle}</h2>
        <p className="mt-2 leading-relaxed text-mute">{t.subscribe.grantBody}</p>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 dark:border-white/10">
        <a className={secondaryButton} href="/"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />{t.backHome}</a>
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
  const [creditAmount, setCreditAmount] = useState('')
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
      <section className="rounded-xl border border-line bg-subtle/60 p-4 dark:border-white/10 dark:bg-white/[0.025]">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-xs text-mute">
          {t.admin.activeRoute}: <span className="text-ink">{current.provider} / {current.model}</span>
          {!current.valid ? <span className="ml-2 text-amber-600 dark:text-amber-200">{t.admin.routeInvalid}</span> : null}
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
    const units = creditsToUnits(Number(creditAmount), account.credit_unit_scale)
    if (!Number.isSafeInteger(units) || units <= 0 || !reason.trim()) {
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
          metric: 'CREDITS',
          units,
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
      setCreditAmount('')
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
      {notice ? <p role="status" className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-700 dark:border-emerald-200/15 dark:bg-emerald-200/[0.05] dark:text-emerald-100">{notice}</p> : null}
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
          <div className="mt-7 rounded-xl border border-line bg-subtle px-4 py-4 text-sm dark:border-white/10 dark:bg-white/[0.025]">
            <p className="text-xs text-mute">{t.admin.account}</p>
            <p className="mt-1 break-all font-medium">{account.email}</p>
            <p className="mt-3 text-xs text-mute">{t.admin.status}</p>
            <p className="mt-1">{account.status}</p>
            <dl className="mt-4 text-sm">
              <div>
                <dt className="text-mute">{t.subscribe.credits}</dt>
                <dd className="mt-1 font-medium">{formatCredits(account.balances.CREDITS, account.credit_unit_scale, t.htmlLang)}</dd>
                <dt className="mt-3 text-mute">{t.subscribe.byokTitle}</dt>
                <dd className="mt-1 font-medium">{account.byok_unlocked ? t.subscribe.byokUnlocked : t.subscribe.byokLocked}</dd>
              </div>
            </dl>
          </div>
          <form className="mt-7 space-y-5" onSubmit={grant} aria-busy={busy}>
            <label className="block text-sm font-medium">
              {t.admin.credits}
              <input className={inputClass} inputMode="decimal" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} />
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
  t,
  maxWidth = 'max-w-xl',
  hideTraditional = false,
}: {
  children: ReactNode
  lang: AuthLang
  setLang: (lang: AuthLang) => void
  t: T
  maxWidth?: string
  hideTraditional?: boolean
}) {
  const { resolvedTheme, toggleTheme } = useTheme()

  return (
    <div className="relative min-h-dvh overflow-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,0,0,0.04),transparent_43%)] dark:bg-[radial-gradient(circle_at_50%_-10%,rgba(244,244,247,0.13),transparent_43%)]" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <a href="/" className="flex items-center gap-2.5 text-sm font-semibold transition-opacity hover:opacity-80">
          <img src="/logo.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="hidden sm:inline">OnCue</span>
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center rounded-full border border-line bg-subtle p-0.5 text-[11px] font-medium dark:border-white/10 dark:bg-white/[0.03]" aria-label="Language">
            {(hideTraditional ? (['zh-CN', 'en'] as const) : (['zh-CN', 'zh-TW', 'en'] as const)).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLang(value)}
                className={`rounded-full px-2.5 py-1.5 transition-all ${
                  lang === value
                    ? 'border border-line/60 bg-surface font-semibold text-ink shadow-xs dark:border-transparent dark:bg-white/15'
                    : 'text-mute hover:text-ink'
                }`}
                aria-pressed={lang === value}
              >
                {hideTraditional
                  ? (value === 'zh-CN' ? '中文' : 'EN')
                  : (value === 'zh-CN' ? '简' : value === 'zh-TW' ? '繁' : 'EN')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-subtle text-ink transition-colors hover:border-ink/20 focus-visible:outline-2 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20"
            aria-label={t.themeToggle}
            title={resolvedTheme === 'dark' ? t.themeLight : t.themeDark}
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </header>
      <main className={`relative mx-auto flex w-full ${maxWidth} items-center px-5 pb-16 pt-8 sm:min-h-[calc(100dvh-152px)] sm:pt-4`}>
        <div className="w-full rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-9 dark:border-white/10 dark:bg-surface/90 dark:shadow-glow dark:backdrop-blur-xl">
          <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-subtle dark:border-white/10 dark:bg-white/[0.04]">
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
  const path = propPath || window.location.pathname
  const isSubscribe = path === '/subscribe'
  const [lang, setLangState] = useState<AuthLang>(() => initialLang(isSubscribe))
  const effectiveLang = isSubscribe && lang === 'zh-TW' ? 'zh-CN' : lang
  const t = authCopy[effectiveLang]

  useEffect(() => {
    document.documentElement.lang = t.htmlLang
    document.title = t.title
  }, [t])

  const setLang = (next: AuthLang) => {
    const target = isSubscribe && next === 'zh-TW' ? 'zh-CN' : next
    setLangState(target)
    writeAuthLang(target)
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

  const maxWidth = isSubscribe ? 'max-w-4xl' : 'max-w-xl'
  return (
    <AuthShell
      lang={effectiveLang}
      setLang={setLang}
      t={t}
      maxWidth={maxWidth}
      hideTraditional={isSubscribe}
    >
      {content}
    </AuthShell>
  )
}
