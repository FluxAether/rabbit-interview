import { useEffect, useState, type ReactNode } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { useTranslation } from '../i18n'
import { getHostedAuthSnapshot, hasAppAccess, initializeHostedAuth, refreshHostedEntitlements, useHostedAuth } from '../lib/hostedAuth'
import { hideCopilotWindow } from '../lib/copilotWindow'
import AccountSettings from './AccountSettings'

export default function AccountGate({ floating, children }: { floating: boolean; children: ReactNode }) {
  const auth = useHostedAuth()
  const t = useTranslation()
  const [hostAuthorized, setHostAuthorized] = useState(false)
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
  return (
    <main className="h-[100dvh] overflow-auto bg-[var(--bg-app)] p-6 text-[var(--text-main)] sm:p-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('settings.heading.account')}</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">{t('settings.account.description')}</p>
        <AccountSettings />
      </div>
    </main>
  )
}
