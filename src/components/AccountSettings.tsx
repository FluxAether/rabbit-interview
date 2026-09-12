import { useEffect, useState } from 'react'
import { ArrowUpRight, CheckCircle2, Loader2, LogOut, RefreshCw, UserRound, Wallet } from 'lucide-react'
import { useCurrentLanguage, useTranslation } from '../i18n'
import { formatCreditsDisplay } from '../lib/credits'
import { hasAppAccess, hostedFetch, initializeHostedAuth, openHostedSubscription, refreshHostedEntitlements, signInHosted, signOutHosted, useHostedAuth } from '../lib/hostedAuth'

export default function AccountSettings() {
  const t = useTranslation()
  const language = useCurrentLanguage()
  const auth = useHostedAuth()
  const entitlements = auth.entitlements
  const signedIn = auth.status === 'signed-in'
  const authorized = hasAppAccess(auth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState<{ sub: string; email: string; name: string | null } | null>(null)
  const [profileFailed, setProfileFailed] = useState(false)
  const currentProfile = signedIn && profile?.sub === entitlements?.account_id ? profile : null

  useEffect(() => {
    setProfile(null)
    setProfileFailed(false)
    if (!signedIn || !entitlements) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    let disposed = false
    void hostedFetch('/oauth2/userinfo', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load account profile.')
        const value = await response.json()
        if (value?.sub !== entitlements.account_id || typeof value.email !== 'string') throw new Error('Invalid account profile.')
        if (!disposed) setProfile({ sub: value.sub, email: value.email, name: typeof value.name === 'string' ? value.name : null })
      })
      .catch(() => { if (!disposed) setProfileFailed(true) })
      .finally(() => window.clearTimeout(timeout))
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [signedIn, entitlements])

  const run = (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    void action().catch((reason) => setError(String(reason))).finally(() => setBusy(false))
  }

  return (
    <div className="space-y-4" aria-busy={busy || auth.status === 'restoring'}>
      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5" aria-labelledby="account-info-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-subtle)]">
              <UserRound className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 id="account-info-title" className="break-words font-semibold">{signedIn ? currentProfile?.name || t('settings.account.info') : t('account.signInTitle')}</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t(`settings.hosted.status.${auth.status}`)}</p>
            </div>
          </div>
          {authorized && <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-bg)] px-2.5 py-1 text-xs font-medium text-[var(--success)]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{t('settings.account.active')}</span>}
        </div>

        {signedIn && entitlements ? (
          <dl className="mt-5 space-y-3 border-t border-[var(--border-color)] pt-4 text-sm">
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[var(--text-muted)]">{t('settings.account.email')}</dt>
              <dd className="break-all">{currentProfile?.email || t(profileFailed ? 'settings.account.profileFailed' : 'account.connecting')}</dd>
            </div>
            <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-[var(--text-muted)]">{t('settings.account.id')}</dt>
              <dd className="break-all font-mono text-xs leading-5">{entitlements.account_id}</dd>
            </div>
          </dl>
        ) : <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">{t('account.signInBody')}</p>}

        {entitlements && !authorized && <p role="alert" className="mt-4 text-sm text-[var(--danger)]">{t('account.unavailable')}</p>}
        {(error || auth.error) && <p role="alert" className="mt-4 break-words text-sm text-[var(--danger)]">{error || auth.error}</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          {!signedIn && <button type="button" disabled={busy || auth.status === 'restoring'} onClick={() => run(signInHosted)} className="inline-flex items-center gap-2 rounded-md bg-[var(--action)] px-4 py-2 text-sm font-medium text-[var(--action-text)] disabled:opacity-50">
            {(busy || auth.status === 'restoring') && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy || auth.status === 'restoring' ? t('account.connecting') : t('account.signInAction')}
          </button>}
          {auth.status === 'error' && <button type="button" disabled={busy} onClick={() => run(initializeHostedAuth)} className="rounded-md border border-[var(--border-color)] px-4 py-2 text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50">{t('account.retry')}</button>}
          {(signedIn || entitlements) && <button type="button" disabled={busy} onClick={() => run(signOutHosted)} className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"><LogOut className="h-3.5 w-3.5" aria-hidden="true" />{t('settings.hosted.signOut')}</button>}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5" aria-labelledby="account-balance-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="account-balance-title" className="flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />{t('settings.account.balance')}</h2>
          <button type="button" disabled={busy || !authorized} onClick={() => run(refreshHostedEntitlements)} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t('settings.hosted.refresh')}</button>
        </div>
        <p className="mt-4 flex items-baseline gap-2" aria-live="polite">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{authorized && entitlements ? formatCreditsDisplay(entitlements.balances.CREDITS, entitlements.credit_unit_scale, language) : '—'}</span>
          <span className="text-sm text-[var(--text-muted)]">{t('settings.account.credits')}</span>
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{t(authorized ? 'settings.account.balanceDesc' : 'settings.hosted.status.signed-out')}</p>
      </section>

      <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5" aria-labelledby="account-subscription-title">
        <h2 id="account-subscription-title" className="font-semibold">{t('settings.account.subscription')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{t('settings.account.subscriptionDesc')}</p>
        {authorized && entitlements && <p className="mt-4 rounded-md bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed text-[var(--text-muted)]">{t(entitlements.byok_unlocked ? 'account.byokUnlocked' : 'account.byokLocked')}</p>}
        <button type="button" disabled={busy || !authorized} onClick={() => run(openHostedSubscription)} className="mt-4 inline-flex items-center gap-2 rounded-md bg-[var(--action)] px-4 py-2 text-sm font-medium text-[var(--action-text)] disabled:opacity-50">{t('settings.hosted.manage')}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></button>
      </section>
    </div>
  )
}
