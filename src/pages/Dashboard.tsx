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
    return <div className="text-[10px] text-[#94a3b8]">—</div>
  }

  const positive = value >= 0
  const Icon = positive ? ArrowUp : ArrowDown
  return (
    <div
      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded ${
        positive
          ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60'
          : 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60'
      }`}
    >
      <Icon className="w-3 h-3 mr-0.5" />
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
    <div className="w-full p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[#0f172a] dark:text-[#f8fafc]">{t('dashboard.welcome')}</h1>
          <p className="text-[#475569] dark:text-[#94a3b8] mt-1">{t('dashboard.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onNavigateToSettings}
            className="group flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-[#64748b] transition-colors hover:border-[#e2e8f0] hover:bg-white hover:text-[#0f172a] dark:text-[#94a3b8] dark:hover:border-[#334155] dark:hover:bg-[#1e293b] dark:hover:text-[#f8fafc]"
            aria-label="Settings"
          >
            <SettingsIcon className="h-4.5 w-4.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] dark:text-[#94a3b8] text-sm font-medium">
                <Users className="w-4 h-4 text-[#6366f1]" /> {t('dashboard.stat.interviews')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1 text-[#0f172a] dark:text-[#f8fafc]">{stats?.interviewCount ?? unavailableMetric}</div>
            </div>
            <div className="text-right">
              <DeltaBadge value={stats?.interviewDeltaPct ?? null} unit="%" />
              <div className="text-[10px] text-[#64748b] dark:text-[#94a3b8] mt-1">{t('dashboard.vsLastMonth')}</div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] dark:text-[#94a3b8] text-sm font-medium">
                <TrendingUp className="w-4 h-4 text-[#6366f1]" /> {t('dashboard.stat.score')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1 text-[#0f172a] dark:text-[#f8fafc]">
                {stats ? (stats.averageScore ?? '—') : unavailableMetric}
              </div>
              {stats?.averageScore != null && <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">/100</div>}
            </div>
            <div className="text-right">
              <DeltaBadge value={stats?.scoreDeltaPts ?? null} unit=" pts" />
              <div className="text-[10px] text-[#64748b] dark:text-[#94a3b8] mt-1">{t('dashboard.vsLastMonth')}</div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] dark:text-[#94a3b8] text-sm font-medium">
                <ClipboardCheck className="w-4 h-4 text-[#6366f1]" /> {t('dashboard.stat.scored')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1 text-[#0f172a] dark:text-[#f8fafc]">{stats?.scoredCount ?? unavailableMetric}</div>
            </div>
            <div className="text-right">
              <DeltaBadge value={stats?.scoredDeltaPct ?? null} unit="%" />
              <div className="text-[10px] text-[#64748b] dark:text-[#94a3b8] mt-1">{t('dashboard.vsLastMonth')}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Launch Stealth Copilot CTA */}
      <div className="launch-card rounded-3xl p-8 mb-8 flex items-center gap-8">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 text-[#6366f1] text-sm font-medium mb-3">
            <div className="w-8 h-8 rounded-2xl bg-[#6366f1]/10 flex items-center justify-center">
              <Rocket className="w-4 h-4" />
            </div>
            {t('dashboard.launch.badge')}
          </div>
          
          <h2 className="text-3xl font-semibold tracking-[-1px] mb-2">{t('dashboard.launch.title')}</h2>
          <p className="text-[#475569] dark:text-[#94a3b8] max-w-md">
            {t('dashboard.launch.subtitle')}
          </p>
          
          <button 
            onClick={launch}
            className="mt-6 inline-flex items-center gap-2 bg-[#6366f1] hover:bg-[#4f46e5] active:bg-[#4338ca] transition-colors text-white px-6 py-2.5 rounded-2xl text-sm font-medium shadow-sm"
          >
            {t('common.launch')}
          </button>
        </div>

        <div className="hidden md:block">
          <div className="w-36 h-36 rounded-[60px] bg-gradient-to-br from-[#6366f1] to-[#a5b4fc] flex items-center justify-center shadow-inner">
            <Rocket className="w-16 h-16 text-white" />
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="font-semibold">{t('dashboard.recentActivity')}</div>
          <button className="text-xs text-[#6366f1] hover:underline" onClick={onViewHistory}>{t('dashboard.viewAllHistory')}</button>
        </div>
        
        {historyStatus === 'loading' ? (
          <div className="card p-8 text-center text-[#64748b] dark:text-[#94a3b8] text-sm">
            {t('dashboard.loading')}
          </div>
        ) : historyStatus === 'error' ? (
          <div className="card p-8 text-center text-rose-600 dark:text-rose-400 text-sm">
            {t('dashboard.loadError')}
          </div>
        ) : history.length > 0 ? (
          <div className="space-y-2">
            {history.slice(0, 3).map((item, idx) => (
              <div key={item.id ?? idx} className="card flex items-center px-4 py-3 text-sm">
                <div className="flex-1">{item.date} — {item.role} @ {item.company}</div>
                <div className="font-semibold text-[#6366f1]">{item.score ?? '—'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center text-[#64748b] dark:text-[#94a3b8] text-sm">
            {t('dashboard.noActivity')}
          </div>
        )}
      </div>
    </div>
  )
}
