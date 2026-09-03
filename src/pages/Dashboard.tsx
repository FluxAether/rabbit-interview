import { ArrowDown, ArrowUp, Users, TrendingUp, ClipboardCheck, Rocket, Settings as SettingsIcon } from 'lucide-react'
import { FileText, Mic, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../i18n'
import { computeDashboardStats } from '../lib/dashboardStats'
import { deriveReadiness, primarySettingsTab, type SettingsTab } from '../lib/readiness'
import { getApiKey } from '../lib/keyStore'
import { useHostedAuth } from '../lib/hostedAuth'
import { invoke } from '@tauri-apps/api/core'
import type { AudioCapabilities } from '../lib/copilotSession'

interface DashboardProps {
  onLaunchCopilot: () => void
  onViewHistory: () => void
  onNavigateToSettings?: (tab?: SettingsTab) => void
  onNavigateToMock?: () => void
  onNavigateToResume?: () => void
}

function formatSigned(value: number, unit: string) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}${unit}`
}

function DeltaBadge({ value, unit }: { value: number | null; unit: string }) {
  if (value == null) {
    return <div className="text-[10px] text-[var(--text-muted)]">-</div>
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

export default function Dashboard({ onLaunchCopilot, onViewHistory, onNavigateToSettings, onNavigateToMock, onNavigateToResume }: DashboardProps) {
  const history = useAppStore((state) => state.history)
  const historyStatus = useAppStore((state) => state.historyStatus)
  const settings = useAppStore((state) => state.settings)
  const hosted = useHostedAuth()
  const targetRole = useAppStore((state) => state.resumeTargetRole)
  const targetCompany = useAppStore((state) => state.resumeTargetCompany)
  const t = useTranslation()
  const stats = useMemo(
    () => historyStatus === 'ready' ? computeDashboardStats(history) : null,
    [history, historyStatus],
  )
  const unavailableMetric = historyStatus === 'loading' ? '…' : '-'
  const [readinessLabel, setReadinessLabel] = useState('loading')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai')

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      getApiKey('GROQ_API_KEY'),
      getApiKey('OPENAI_API_KEY'),
      getApiKey('ANTHROPIC_API_KEY'),
      getApiKey('GEMINI_API_KEY'),
      getApiKey('DEEPGRAM_API_KEY'),
      invoke<AudioCapabilities>('get_audio_capabilities').catch(() => null),
    ]).then(([groq, openai, anthropic, gemini, deepgram, capabilities]) => {
      if (cancelled) return
      const readiness = deriveReadiness({
        settings: { aiModel: settings.aiModel, aiAccessMode: settings.aiAccessMode, sttProvider: settings.sttProvider },
        keys: { groq: !!groq, openai: !!openai, anthropic: !!anthropic, gemini: !!gemini, deepgram: !!deepgram },
        hosted: {
          authenticated: hosted.status === 'signed-in',
          reachable: hosted.status !== 'error',
          eligible: Boolean(hosted.entitlements?.eligible),
          status: hosted.entitlements?.status,
          sttUnits: hosted.entitlements?.balances.STT_AUDIO_MS || 0,
          llmUnits: hosted.entitlements?.balances.LLM_TOKEN_UNITS || 0,
          sttEnabled: Boolean(hosted.entitlements?.hosted_stt_enabled),
          llmEnabled: Boolean(hosted.entitlements?.hosted_llm_enabled),
        },
        useSystemAudio: settings.useSystemAudio ?? true,
        useMicrophone: settings.useMicWithSystem ?? false,
        capabilities,
        capabilitiesError: !capabilities,
      })
      setReadinessLabel(readiness.status)
      setSettingsTab(primarySettingsTab(readiness))
    })
    return () => { cancelled = true }
  }, [hosted, settings.aiAccessMode, settings.aiModel, settings.sttProvider, settings.useSystemAudio, settings.useMicWithSystem])

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
            onClick={() => onNavigateToSettings?.()}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            aria-label={t("nav.settings")}
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>

        <section className="mb-6 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">{t('dashboard.readiness.title')}</div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${readinessLabel === 'ready' ? 'bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]' : 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[var(--warning)]'}`}>
                  {t(`dashboard.readiness.${readinessLabel}`)}
                </span>
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {targetRole || targetCompany
                  ? `${targetCompany ? targetCompany + ' · ' : ''}${targetRole || t('dashboard.readiness.noRole')}`
                  : t('dashboard.readiness.noProfile')}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onNavigateToSettings?.(settingsTab)} className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]">
                {t('dashboard.readiness.fix')}
              </button>
              <button type="button" onClick={onNavigateToResume} className="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]">
                {t('dashboard.readiness.profile')}
              </button>
              <button type="button" onClick={launch} className="rounded-md bg-[var(--action)] px-3 py-1.5 text-xs font-medium text-[var(--action-text)]">
                {t('common.launch')}
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 border-t border-[var(--border-color)] pt-3 sm:grid-cols-3">
            <div className="flex items-center gap-2 text-xs">
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${Boolean(targetRole || targetCompany) ? 'bg-[var(--success)] text-[var(--bg-app)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'}`}>
                1
              </span>
              <span className={Boolean(targetRole || targetCompany) ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}>
                求职目标与岗位匹配
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${readinessLabel === 'ready' ? 'bg-[var(--success)] text-[var(--bg-app)]' : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]'}`}>
                2
              </span>
              <span className={readinessLabel === 'ready' ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}>
                AI 与语音通道就绪
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[10px] font-bold text-[var(--text-muted)]">
                3
              </span>
              <span className="text-[var(--text-muted)]">
                隐形悬浮窗 & 快捷键测试
              </span>
            </div>
          </div>
        </section>

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
                  {stats ? (stats.averageScore ?? '-') : unavailableMetric}
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

        {/* 3-Station Quick Launch Workspace */}
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('dashboard.quickLaunch.title')}</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Station 1: Stealth Copilot */}
            <div className="flex flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--text-muted)]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-[var(--action)]">
                    <Rocket className="h-4 w-4" />
                  </div>
                  <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">
                    {t('dashboard.launch.badge')}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-main)]">
                  {t('dashboard.station.copilot.title')}
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                  {t('dashboard.station.copilot.desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={launch}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--action)] py-2 text-xs font-medium text-[var(--action-text)] transition-opacity hover:opacity-90"
              >
                <span>{t('common.launch')}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Station 2: Mock Interview */}
            <div className="flex flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--text-muted)]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-[var(--action)]">
                    <Mic className="h-4 w-4" />
                  </div>
                  <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">
                    AI SIMULATION
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-main)]">
                  {t('dashboard.station.mock.title')}
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                  {t('dashboard.station.mock.desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToMock || launch}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span>{t('common.start')}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Station 3: Resume Optimizer */}
            <div className="flex flex-col justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--text-muted)]">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-subtle)] text-[var(--action)]">
                    <FileText className="h-4 w-4" />
                  </div>
                  <span className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">
                    ATS TARGETING
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-main)]">
                  {t('dashboard.station.resume.title')}
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                  {t('dashboard.station.resume.desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToResume || launch}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] py-2 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span>{t('common.analyze')}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

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
                <div className="w-10 text-right font-semibold tabular-nums">{item.score ?? '-'}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-6">
            <div className="mb-3 font-semibold text-sm text-[var(--text-main)]">{t('dashboard.onboarding.title')}</div>
            <p className="mb-4 text-xs text-[var(--text-muted)]">{t('dashboard.onboarding.subtitle')}</p>
            <div className="space-y-2.5 text-xs">
              <button
                type="button"
                onClick={() => onNavigateToSettings?.(settingsTab)}
                className="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span>{t('dashboard.onboarding.step1')}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </button>
              <button
                type="button"
                onClick={onNavigateToResume || launch}
                className="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span>{t('dashboard.onboarding.step2')}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </button>
              <button
                type="button"
                onClick={onNavigateToMock || launch}
                className="flex w-full items-center justify-between rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span>{t('dashboard.onboarding.step3')}</span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </button>
            </div>
          </div>
          )}
        </section>
      </div>
    </div>
  )
}
