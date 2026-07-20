import { ArrowUp, Users, TrendingUp, Briefcase, Rocket } from 'lucide-react'

interface DashboardProps {
  onLaunchCopilot: () => void
}

import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../stores/useAppStore'
import { useTranslation } from '../i18n'

export default function Dashboard({ onLaunchCopilot }: DashboardProps) {
  const { history } = useAppStore()
  const t = useTranslation()

  const launch = async () => {
    try {
      await invoke('launch_copilot_window')
    } catch {
      onLaunchCopilot()
    }
  }

  return (
    <div className="w-full p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t('dashboard.welcome')}</h1>
          <p className="text-[#475569] mt-1">{t('dashboard.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white border border-[#e2e8f0] rounded-full pl-1 pr-4 py-1 text-sm">
            <div className="w-7 h-7 rounded-full bg-[#6366f1] text-white flex items-center justify-center text-xs mr-2">AM</div>
            Alex Morgan
          </div>
          <button className="p-2 hover:bg-white rounded-full border border-transparent hover:border-[#e2e8f0]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#64748b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 002.572 1.065c1.755.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 011.066-2.573z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] text-sm">
                <Users className="w-4 h-4" /> {t('dashboard.stat.interviews')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1">24</div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-0.5 rounded">
                <ArrowUp className="w-3 h-3 mr-0.5" /> 18%
              </div>
              <div className="text-[10px] text-[#64748b] mt-1">{t('dashboard.vsLastMonth')}</div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] text-sm">
                <TrendingUp className="w-4 h-4" /> {t('dashboard.stat.score')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1">82</div>
              <div className="text-xs text-[#64748b]">/100</div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-0.5 rounded">
                <ArrowUp className="w-3 h-3 mr-0.5" /> 8 pts
              </div>
              <div className="text-[10px] text-[#64748b] mt-1">{t('dashboard.vsLastMonth')}</div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-[#64748b] text-sm">
                <Briefcase className="w-4 h-4" /> {t('dashboard.stat.offers')}
              </div>
              <div className="text-[42px] font-semibold tracking-[-1.5px] leading-none mt-1">3</div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center text-emerald-600 text-xs font-medium bg-emerald-50 px-2 py-0.5 rounded">
                <ArrowUp className="w-3 h-3 mr-0.5" /> 50%
              </div>
              <div className="text-[10px] text-[#64748b] mt-1">{t('dashboard.vsLastMonth')}</div>
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
          <p className="text-[#475569] max-w-md">
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
          <button className="text-xs text-[#6366f1] hover:underline" onClick={() => window.location.hash = '#history'}>{t('dashboard.viewAllHistory')}</button>
        </div>
        
        {history.length > 0 ? (
          <div className="space-y-2">
            {history.slice(0, 3).map((item, idx) => (
              <div key={idx} className="card flex items-center px-4 py-3 text-sm">
                <div className="flex-1">{item.date} — {item.role} @ {item.company}</div>
                <div className="font-semibold text-[#6366f1]">{item.score}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center text-[#64748b] text-sm">
            {t('dashboard.noActivity')}
          </div>
        )}
      </div>
    </div>
  )
}
