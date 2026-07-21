import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Download, ExternalLink } from 'lucide-react'
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
  const running = copilot.phase === 'starting' || copilot.phase === 'listening' || copilot.phase === 'stopping'

  const loadDevices = async () => {
    const values = await invoke<string[]>('list_audio_devices').catch(() => [])
    setDevices(values)
    setSelectedDevice((current) => current || values[0] || '')
  }

  useEffect(() => {
    let unsubscribeWindowStatus: (() => void) | undefined
    let cancelled = false
    subscribeCopilotWindowStatus(setWindowStatus).then((cleanup) => {
      if (cancelled) cleanup()
      else unsubscribeWindowStatus = cleanup
    })
    void Promise.all([
      loadDevices(),
      invoke<AudioCapabilities>('get_audio_capabilities').then(setCapabilities),
      getCopilotWindowStatus().then(setWindowStatus),
      loadAppSettings().then((settings) => {
        setUseSystemAudio(settings.useSystemAudio ?? true)
        setUseMicrophone(settings.useMicWithSystem ?? true)
        setSelectedDevice(settings.micDevice || '')
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-8">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="mb-6 flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{t('copilot.title')}</h1>
            <p className="text-[#475569]">{t('copilot.subtitle')}</p>
            <p className="mt-1 text-xs text-[#64748b]">{t('copilot.status')}: {t(`copilot.phase.${copilot.phase}`)}</p>
          </div>
          <button
            type="button"
            onClick={() => void showCopilotWindow().then(setWindowStatus)}
            className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-2 text-sm hover:bg-[#f8fafc]"
          >
            <ExternalLink className="h-4 w-4" /> {t('copilot.detach')}
          </button>
        </div>

        <section className="mb-5 shrink-0 rounded-2xl border border-[#e2e8f0] bg-white p-4" aria-label={t('copilot.device')}>
          <div className="grid gap-3 md:grid-cols-2">
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
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-[#64748b]">{t('copilot.device')}:</span>
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

        <div className="min-h-0 flex-1">
          <CopilotPanel windowStatus={windowStatus} />
        </div>

        <div className="mt-4 shrink-0">
          <p className="mb-2 text-center text-xs text-[#64748b]">{t('copilot.archive.autoSaveHint')}</p>
          <button
            type="button"
            onClick={() => {
              void exportCopilotRecording()
                .then((exported) => {
                  if (!exported) alert(t('copilot.noRecording'))
                })
                .catch((error) => {
                  console.error('[Copilot] Failed to export recording', error)
                  alert(String(error))
                })
            }}
            disabled={!copilot.hasRecording}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-white py-2 text-xs hover:bg-[#f8fafc] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> {t('copilot.exportRecording')}
          </button>
        </div>
      </div>
    </div>
  )
}
