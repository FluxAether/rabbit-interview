import { ArrowDown, ArrowUp, Users, TrendingUp, ClipboardCheck, Rocket, Settings as SettingsIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../i18n'
import { computeDashboardStats } from '../lib/dashboardStats'

interface DashboardProps {
  onLaunchCopilot: () => void
  onViewHistory: () => void
  onNavigateToSettings?: () => void
}

function formatSigned(value: number, unit: string) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}${unit}`
}

function DeltaBadge({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) {
    return <div className="text-[10px] text-[var(--text-muted)]">—</div>
  }

  if (value === 0) {
    return (
      <div className="text-xs font-medium text-[var(--text-muted)]">
        {formatSigned(value, unit)}
      </div>
    )
  }

  const positive = value > 0
  const Icon = positive ? ArrowUp : ArrowDown
  return (
    <div
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        positive
          ? 'text-[var(--success)]'
          : 'text-[var(--danger)]'
      }`}
    >
      <Icon className="h-3 w-3" />
      {formatSigned(value, unit)}
    </div>
  )
}

export default function Dashboard({ onLaunchCopilot, onViewHistory, onNavigateToSettings }: DashboardProps) {
  const history = useAppStore((state) => state.history)
  const historyStatus = useAppStore((state) => state.historyStatus)
  const t = useTranslation()
  const stats = useMemo(
    () => historyStatus === 'ready' ? computeDashboardStats(history) : null,
    [history, historyStatus],
  )
  const unavailableMetric = historyStatus === 'loading' ? '…' : '—'

  const launch = () => {
    onLaunchCopilot()
  }

  return (
    <div className="h-full w-full overflow-auto bg-[var(--bg-app)] p-6 text-[var(--text-main)] sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.welcome')}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{t('dashboard.subtitle')}</p>
          </div>

          <button
            type="button"
            onClick={onNavigateToSettings}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            aria-label={t("nav.settings")}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-6 grid grid-cols-1 divide-y divide-[var(--border-color)] overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <Users className="h-4 w-4" /> {t('dashboard.stat.interviews')}
                </div>
                <div className="mt-3 text-3xl font-semibold leading-none tabular-nums">{stats?.interviewCount ?? unavailableMetric}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('dashboard.stat.total')}</div>
              </div>
              <div className="text-right">
                <DeltaBadge value={stats?.interviewDeltaPct ?? null} unit="%" />
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('dashboard.monthDelta')}</div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <TrendingUp className="h-4 w-4" /> {t('dashboard.stat.score')}
                </div>
                <div className="mt-3 text-3xl font-semibold leading-none tabular-nums">
                  {stats ? (stats.averageScore ?? '—') : unavailableMetric}
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{stats?.averageScore != null ? '/100 · ' : ''}{t('dashboard.stat.total')}</div>
              </div>
              <div className="text-right">
                <DeltaBadge value={stats?.scoreDeltaPts ?? null} unit=" pts" />
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('dashboard.monthDelta')}</div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-muted)]">
                  <ClipboardCheck className="h-4 w-4" /> {t('dashboard.stat.scored')}
                </div>
                <div className="mt-3 text-3xl font-semibold leading-none tabular-nums">{stats?.scoredCount ?? unavailableMetric}</div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('dashboard.stat.total')}</div>
              </div>
              <div className="text-right">
                <DeltaBadge value={stats?.scoredDeltaPct ?? null} unit="%" />
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t('dashboard.monthDelta')}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 flex items-center justify-between gap-5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-[var(--text-main)]">
              <Rocket className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{t('dashboard.launch.badge')}</div>
              <h2 className="mt-0.5 text-base font-semibold">{t('dashboard.launch.title')}</h2>
              <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">{t('dashboard.launch.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={launch}
            className="shrink-0 rounded-md bg-[var(--action)] px-4 py-2 text-sm font-medium text-[var(--action-text)] transition-opacity hover:opacity-90"
          >
            {t('common.launch')}
          </button>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('dashboard.recentActivity')}</h2>
            <button type="button" className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]" onClick={onViewHistory}>{t('dashboard.viewAllHistory')}</button>
          </div>
        
          {historyStatus === 'loading' ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
            {t('dashboard.loading')}
          </div>
        ) : historyStatus === 'error' ? (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--danger)]">
            <p>{t('dashboard.loadError')}</p>
            <button type="button" onClick={onViewHistory} className="mt-3 text-sm font-medium underline underline-offset-2">
              {t('dashboard.viewAllHistory')}
            </button>
          </div>
        ) : history.length > 0 ? (
          <div className="divide-y divide-[var(--border-color)] overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]">
            {history.slice(0, 3).map((item, idx) => (
              <div key={item.id ?? idx} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-[var(--bg-hover)]">
                <div className="w-32 shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{item.date}</div>
                <div className="min-w-0 flex-1 truncate font-medium">{item.role}</div>
                <div className="w-10 text-right font-semibold tabular-nums">{item.score ?? '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
            <p>{t('dashboard.noActivity')}</p>
            <button type="button" onClick={launch} className="mt-3 text-sm font-medium text-[var(--text-main)] underline underline-offset-2">
              {t('common.launch')}
            </button>
          </div>
          )}
        </section>
      </div>
    </div>
  )
}
