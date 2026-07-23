import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDown, ExternalLink, Mic, SlidersHorizontal, Volume2 } from 'lucide-react'
import CopilotPanel from '../components/CopilotPanel'
import { useTranslation } from '../i18n'
import {
  exportCopilotRecording,
  type AudioCapabilities,
} from '../lib/copilotSession'
import {
  getCopilotWindowStatus,
  showCopilotWindow,
  subscribeCopilotWindowStatus,
  type CopilotWindowStatus,
} from '../lib/copilotWindow'
import { loadAppSettings, saveAppSettings } from '../lib/settingsStore'
import { useAppStore } from '../stores/useAppStore'

export default function StealthCopilot() {
  const t = useTranslation()
  const copilot = useAppStore((state) => state.copilot)
  const [devices, setDevices] = useState<string[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  const [useSystemAudio, setUseSystemAudio] = useState(true)
  const [useMicrophone, setUseMicrophone] = useState(true)
  const [capabilities, setCapabilities] = useState<AudioCapabilities | null>(null)
  const [windowStatus, setWindowStatus] = useState<CopilotWindowStatus | null>(null)
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false)
  const running = copilot.phase === 'starting' || copilot.phase === 'listening' || copilot.phase === 'stopping'

  const loadDevices = async (preferredDevice = selectedDevice) => {
    const values: string[] = await invoke<string[]>('list_audio_devices').catch(() => [])
    setDevices(values)
    setSelectedDevice(values.includes(preferredDevice) ? preferredDevice : values[0] || '')
  }

  useEffect(() => {
    let unsubscribeWindowStatus: (() => void) | undefined
    let cancelled = false
    subscribeCopilotWindowStatus(setWindowStatus).then((cleanup) => {
      if (cancelled) cleanup()
      else unsubscribeWindowStatus = cleanup
    })
    void Promise.all([
      invoke<AudioCapabilities>('get_audio_capabilities').then(setCapabilities),
      getCopilotWindowStatus().then(setWindowStatus),
      loadAppSettings().then((settings) => {
        setUseSystemAudio(settings.useSystemAudio ?? true)
        setUseMicrophone(settings.useMicWithSystem ?? true)
        return loadDevices(settings.micDevice || '')
      }),
    ]).catch((error) => console.warn('Unable to load Copilot capabilities', error))
    return () => {
      cancelled = true
      unsubscribeWindowStatus?.()
    }
  }, [])

  const persistCaptureMode = async (system: boolean, microphone: boolean, device = selectedDevice) => {
    await saveAppSettings({
      useSystemAudio: system,
      useMicWithSystem: microphone,
      micDevice: device || undefined,
    })
  }

  const handleExportRecording = () => {
    void exportCopilotRecording()
      .then((exported) => {
        if (!exported) alert(t('copilot.noRecording'))
      })
      .catch((error) => {
        console.error('[Copilot] Failed to export recording', error)
        alert(String(error))
      })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6 md:p-8">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {/* Header Bar */}
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-[#0f172a] dark:text-[#f8fafc]">
                {t('copilot.title')}
              </h1>
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                  running
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse'
                    : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                }`}
              >
                {t(`copilot.phase.${copilot.phase}`)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#64748b] dark:text-[#94a3b8]">
              {t('copilot.subtitle')}
            </p>
          </div>

          <div className="relative flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setAudioSettingsOpen((open) => !open)}
              className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-medium hover:bg-[#f8fafc] dark:border-[#334155] dark:bg-[#1e293b] dark:text-[#f8fafc]"
              aria-expanded={audioSettingsOpen}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#6366f1]" />
              <span>音频输入配置</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${audioSettingsOpen ? 'rotate-180' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => void showCopilotWindow().then(setWindowStatus)}
              className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2 text-xs font-medium text-[#0f172a] hover:bg-[#f8fafc] dark:border-[#334155] dark:bg-[#1e293b] dark:text-[#f8fafc]"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[#6366f1]" />
              <span>{t('copilot.detach')}</span>
            </button>
          </div>
        </div>

        {/* Compact Status Pills Bar */}
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white/80 px-3.5 py-2 text-xs text-[#64748b] backdrop-blur-sm dark:border-[#334155] dark:bg-[#1e293b]/80 dark:text-[#94a3b8]">
          <div className="flex items-center gap-1.5 font-medium">
            <Volume2 className="h-3.5 w-3.5 text-[#6366f1]" />
            <span>系统声音:</span>
            <span className={useSystemAudio ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
              {useSystemAudio ? '已开启' : '已禁用'}
            </span>
          </div>
          <span className="text-[#cbd5e1] dark:text-[#475569]">•</span>
          <div className="flex items-center gap-1.5 font-medium">
            <Mic className="h-3.5 w-3.5 text-[#6366f1]" />
            <span>麦克风:</span>
            <span className={useMicrophone ? 'font-semibold text-emerald-600' : 'text-slate-400'}>
              {useMicrophone ? '已开启' : '已禁用'}
            </span>
          </div>
          {selectedDevice && (
            <>
              <span className="text-[#cbd5e1] dark:text-[#475569]">•</span>
              <span className="truncate max-w-[200px] font-mono text-[11px] text-[#475569] dark:text-[#a5b4fc]" title={selectedDevice}>
                {selectedDevice}
              </span>
            </>
          )}
          <span className="ml-auto text-[11px] text-[#94a3b8]">
            {t('copilot.archive.autoSaveHint')}
          </span>
        </div>

        {/* Audio Settings Dropdown Popover Panel */}
        {audioSettingsOpen && (
          <section
            className="mb-3 shrink-0 rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-lg dark:border-[#334155] dark:bg-[#1e293b]"
            aria-label={t('copilot.device')}
          >
            <div className="grid gap-3 md:grid-cols-2 md:items-center">
              <label className="flex items-center gap-2 text-sm font-medium text-[#0f172a] dark:text-[#f8fafc]">
                <input
                  type="checkbox"
                  checked={useSystemAudio && Boolean(capabilities?.system_audio_available)}
                  disabled={running || !capabilities?.system_audio_available}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setUseSystemAudio(checked)
                    void persistCaptureMode(checked, useMicrophone)
                  }}
                  className="h-4 w-4 rounded accent-[#6366f1]"
                />
                {t('copilot.useSystemAudio')}
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-[#0f172a] dark:text-[#f8fafc]">
                <input
                  type="checkbox"
                  checked={useMicrophone}
                  disabled={running || !capabilities?.microphone_available}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setUseMicrophone(checked)
                    void persistCaptureMode(useSystemAudio, checked)
                  }}
                  className="h-4 w-4 rounded accent-[#6366f1]"
                />
                {t('copilot.alsoCaptureMic')}
              </label>
            </div>

            {!capabilities?.system_audio_available && capabilities?.system_audio_reason && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {capabilities.system_audio_reason}
              </p>
            )}

            {capabilities?.system_audio_available && (
              <p className="mt-2 text-[11px] text-[#64748b] dark:text-[#94a3b8]">
                AudioTee {capabilities.audiotee_commit.slice(0, 12)} · 16 kHz mono · macOS Default Output
              </p>
            )}

            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="shrink-0 font-medium text-[#64748b] dark:text-[#94a3b8]">
                {t('copilot.device')}:
              </span>
              <select
                value={selectedDevice}
                onChange={(event) => {
                  setSelectedDevice(event.target.value)
                  void persistCaptureMode(useSystemAudio, useMicrophone, event.target.value)
                }}
                disabled={running || !useMicrophone}
                className="min-w-0 flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#0f172a] outline-none dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#f8fafc]"
              >
                {devices.length === 0 && <option value="">{t('copilot.defaultDevice')}</option>}
                {devices.map((device) => (
                  <option key={device} value={device}>
                    {device}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void loadDevices()}
                disabled={running}
                className="rounded-lg p-1.5 text-[#6366f1] hover:bg-[#e0e7ff] dark:hover:bg-[#312e81]"
                title="刷新设备列表"
              >
                ↻
              </button>
            </div>
          </section>
        )}

        {/* Core Copilot Panel */}
        <div className="min-h-0 flex-1">
          <CopilotPanel
            windowStatus={windowStatus}
            onExportRecording={handleExportRecording}
            canExportRecording={copilot.hasRecording}
          />
        </div>
      </div>
    </div>
  )
}

