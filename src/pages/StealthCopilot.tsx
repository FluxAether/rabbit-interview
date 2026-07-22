import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDown, ExternalLink, SlidersHorizontal } from 'lucide-react'
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-8">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-xl font-semibold">{t('copilot.title')}</h1>
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                {t(`copilot.phase.${copilot.phase}`)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[#64748b]">{t('copilot.subtitle')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setAudioSettingsOpen((open) => !open)}
              className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs hover:bg-[#f8fafc]"
              aria-expanded={audioSettingsOpen}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('copilot.device')}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${audioSettingsOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => void showCopilotWindow().then(setWindowStatus)}
              className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs hover:bg-[#f8fafc]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> {t('copilot.detach')}
            </button>
          </div>
        </div>

        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-[11px] text-[#64748b]">
          <span>{t('copilot.useSystemAudio')}: {useSystemAudio ? 'On' : 'Off'}</span>
          <span className="text-[#cbd5e1]">•</span>
          <span>{t('copilot.alsoCaptureMic')}: {useMicrophone ? 'On' : 'Off'}</span>
          {selectedDevice && <><span className="text-[#cbd5e1]">•</span><span className="truncate">{selectedDevice}</span></>}
          <span className="text-[#cbd5e1]">•</span>
          <span>{t('copilot.archive.autoSaveHint')}</span>
        </div>

        {audioSettingsOpen && (
          <section className="mb-3 shrink-0 rounded-2xl border border-[#e2e8f0] bg-white p-3" aria-label={t('copilot.device')}>
          <div className="grid gap-3 md:grid-cols-[auto_auto_minmax(220px,1fr)] md:items-center">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useSystemAudio && Boolean(capabilities?.system_audio_available)}
                disabled={running || !capabilities?.system_audio_available}
                onChange={(event) => {
                  const checked = event.target.checked
                  setUseSystemAudio(checked)
                  void persistCaptureMode(checked, useMicrophone)
                }}
                className="accent-[#6366f1]"
              />
              {t('copilot.useSystemAudio')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useMicrophone}
                disabled={running || !capabilities?.microphone_available}
                onChange={(event) => {
                  const checked = event.target.checked
                  setUseMicrophone(checked)
                  void persistCaptureMode(useSystemAudio, checked)
                }}
                className="accent-[#6366f1]"
              />
              {t('copilot.alsoCaptureMic')}
            </label>
          </div>
          {!capabilities?.system_audio_available && capabilities?.system_audio_reason && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{capabilities.system_audio_reason}</p>
          )}
          {!capabilities?.microphone_available && capabilities?.microphone_reason && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{capabilities.microphone_reason}</p>
          )}
          {capabilities?.system_audio_available && (
            <p className="mt-2 text-[11px] text-[#64748b]">AudioTee {capabilities.audiotee_commit.slice(0, 12)} · 16 kHz mono · default output</p>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="shrink-0 text-[#64748b]">{t('copilot.device')}:</span>
            <select
              value={selectedDevice}
              onChange={(event) => {
                setSelectedDevice(event.target.value)
                void persistCaptureMode(useSystemAudio, useMicrophone, event.target.value)
              }}
              disabled={running || !useMicrophone}
              className="min-w-0 max-w-[360px] rounded border border-[#e2e8f0] bg-white px-2 py-1"
            >
              {devices.length === 0 && <option value="">{t('copilot.defaultDevice')}</option>}
              {devices.map((device) => <option key={device} value={device}>{device}</option>)}
            </select>
            <button type="button" onClick={() => void loadDevices()} disabled={running} className="text-[#6366f1]">↻</button>
          </div>
        </section>
        )}

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
