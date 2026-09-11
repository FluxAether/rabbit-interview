import { useEffect, useState, type ReactNode } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useTranslation } from '../i18n'
import { getHostedAuthSnapshot, hasAppAccess, initializeHostedAuth, refreshHostedEntitlements, signInHosted, signOutHosted, useHostedAuth } from '../lib/hostedAuth'
import { hideCopilotWindow } from '../lib/copilotWindow'

export default function AccountGate({ floating, children }: { floating: boolean; children: ReactNode }) {
  const auth = useHostedAuth()
  const t = useTranslation()
  const [hostAuthorized, setHostAuthorized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const authorized = floating ? hostAuthorized : hasAppAccess(auth)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const ready = floating
      ? listen<boolean>('account-access', (event) => setHostAuthorized(event.payload === true))
      : listen('account-access-request', () => { void emit('account-access', hasAppAccess(getHostedAuthSnapshot())) })
    void ready.then((cleanup) => {
      if (disposed) cleanup()
      else { unlisten = cleanup; if (floating) void emit('account-access-request') }
    })
    if (!floating) void initializeHostedAuth()
    return () => { disposed = true; unlisten?.() }
  }, [floating])

  useEffect(() => {
    if (floating) return
    void emit('account-access', authorized)
    if (!authorized) void hideCopilotWindow().catch(() => {})
  }, [authorized, floating])

  useEffect(() => {
    if (floating) return
    const refresh = () => {
      if (hasAppAccess(getHostedAuthSnapshot())) void refreshHostedEntitlements().catch(() => {})
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [floating])

  if (authorized) return children
  if (floating) return null
  const run = (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    void action().catch((reason) => setError(String(reason))).finally(() => setBusy(false))
  }
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--bg-app)] p-6 text-[var(--text-main)]">
      <section className="w-full max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-8">
        <img src="/logo.png" alt="" className="mb-5 h-12 w-12 rounded-xl" />
        <h1 className="text-xl font-semibold">{t('account.signInTitle')}</h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">{t('account.signInBody')}</p>
        {(error || auth.error) && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{error || auth.error}</p>}
        {auth.entitlements?.status && auth.entitlements.status !== 'ACTIVE' && <p role="alert" className="mt-4 text-sm">{t('account.unavailable')}</p>}
        <button type="button" disabled={busy || auth.status === 'restoring'} onClick={() => run(signInHosted)} className="mt-6 w-full rounded-lg bg-[var(--action)] px-4 py-2.5 text-sm font-medium text-[var(--action-text)] disabled:opacity-50">
          {busy || auth.status === 'restoring' ? t('account.connecting') : t('account.signInAction')}
        </button>
        {auth.status === 'error' && <button type="button" disabled={busy} onClick={() => run(initializeHostedAuth)} className="mt-3 w-full rounded-lg border border-[var(--border-color)] px-4 py-2 text-sm">{t('account.retry')}</button>}
        {auth.entitlements && <button type="button" disabled={busy} onClick={() => run(signOutHosted)} className="mt-3 w-full px-4 py-2 text-sm">{t('settings.hosted.signOut')}</button>}
      </section>
    </main>
  )
}
