import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { ChevronDown, ExternalLink, Mic, RefreshCw, SlidersHorizontal, Volume2 } from "lucide-react"
import CopilotPanel from "../components/CopilotPanel"
import { useTranslation } from "../i18n"
import {
  exportCopilotRecording,
  type AudioCapabilities,
} from "../lib/copilotSession"
import {
  getCopilotWindowStatus,
  showCopilotWindow,
  subscribeCopilotWindowStatus,
  type CopilotWindowStatus,
} from "../lib/copilotWindow"
import { loadAppSettings, saveAppSettings } from "../lib/settingsStore"
import { useAppStore } from "../stores/useAppStore"

export default function StealthCopilot({
  onOpenSettings,
}: {
  onOpenSettings?: (tab: 'ai' | 'stt' | 'shortcuts_privacy') => void
} = {}) {
  const t = useTranslation()
  const copilot = useAppStore((state) => state.copilot)
  const [devices, setDevices] = useState<string[]>([])
  const [selectedDevice, setSelectedDevice] = useState("")
  const [useSystemAudio, setUseSystemAudio] = useState(true)
  const [useMicrophone, setUseMicrophone] = useState(true)
  const [capabilities, setCapabilities] = useState<AudioCapabilities | null>(null)
  const [windowStatus, setWindowStatus] = useState<CopilotWindowStatus | null>(null)
  const [audioSettingsOpen, setAudioSettingsOpen] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [capabilitiesError, setCapabilitiesError] = useState(false)
  const running = copilot.phase === "starting" || copilot.phase === "listening" || copilot.phase === "stopping"

  useEffect(() => {
    if (!audioSettingsOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAudioSettingsOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [audioSettingsOpen])

  const loadDevices = async (preferredDevice = selectedDevice) => {
    const values: string[] = await invoke<string[]>("list_audio_devices").catch(() => {
      setCapabilitiesError(true)
      return []
    })
    setDevices(values)
    setSelectedDevice(values.includes(preferredDevice) ? preferredDevice : preferredDevice || values[0] || "")
  }

  useEffect(() => {
    let unsubscribeWindowStatus: (() => void) | undefined
    let cancelled = false
    subscribeCopilotWindowStatus(setWindowStatus).then((cleanup) => {
      if (cancelled) cleanup()
      else unsubscribeWindowStatus = cleanup
    })
    void Promise.all([
      invoke<AudioCapabilities>("get_audio_capabilities").then((value) => {
        setCapabilities(value)
        setCapabilitiesError(false)
      }),
      getCopilotWindowStatus().then(setWindowStatus),
      loadAppSettings().then((settings) => {
        setUseSystemAudio(settings.useSystemAudio ?? true)
        setUseMicrophone(settings.useMicWithSystem ?? false)
        setSelectedDevice(settings.micDevice || "")
      }),
    ]).then(() => {
      if (!cancelled) setAudioReady(true)
    }).catch((error) => {
      console.warn("Unable to load Copilot capabilities", error)
      if (!cancelled) {
        setCapabilitiesError(true)
        setAudioReady(false)
      }
    })
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
        if (!exported) alert(t("copilot.noRecording"))
      })
      .catch((error) => {
        console.error("[Copilot] Failed to export recording", error)
        alert(String(error))
      })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] p-4 text-[var(--text-main)]">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {/* Header Bar */}
        <div className="mb-2 flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border-color)] pb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--text-main)]">
                {t("copilot.title")}
              </h1>
              <span
                className={`rounded-md bg-[var(--bg-subtle)] px-2 py-0.5 text-[11px] font-medium ${
                  running
                    ? "text-[var(--success)]"
                    : "text-[var(--text-muted)]"
                }`}
              >
                {t(`copilot.phase.${copilot.phase}`)}
              </span>
            </div>
            <p className="truncate text-xs text-[var(--text-muted)]">
              {t("copilot.subtitle")}
            </p>
          </div>

          <div className="relative flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setAudioSettingsOpen((open) => {
                  const next = !open
                  if (next) void loadDevices()
                  return next
                })
              }}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
              aria-expanded={audioSettingsOpen}
              aria-controls="copilot-audio-settings"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span>{t("copilot.audioConfig")}</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${audioSettingsOpen ? "rotate-180" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => void showCopilotWindow().then(setWindowStatus)}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span>{t("copilot.detach")}</span>
            </button>

            {/* Audio Settings Dropdown Popover Panel */}
            {audioSettingsOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  aria-hidden="true"
                  onClick={() => setAudioSettingsOpen(false)}
                />
                <section
                  id="copilot-audio-settings"
                  className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.08)] md:w-96"
                  aria-label={t("copilot.device")}
                >
                <div className="grid gap-3 md:grid-cols-2 md:items-center">
                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-main)]">
                    <input
                      type="checkbox"
                      checked={useSystemAudio && Boolean(capabilities?.system_audio_available)}
                      disabled={running || !capabilities?.system_audio_available}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setUseSystemAudio(checked)
                        void persistCaptureMode(checked, useMicrophone)
                      }}
                      className="h-4 w-4 rounded accent-[var(--action)]"
                    />
                    {t("copilot.useSystemAudio")}
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-[var(--text-main)]">
                    <input
                      type="checkbox"
                      checked={useMicrophone}
                      disabled={running || !capabilities?.microphone_available}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setUseMicrophone(checked)
                        void persistCaptureMode(useSystemAudio, checked)
                      }}
                      className="h-4 w-4 rounded accent-[var(--action)]"
                    />
                    {t("copilot.alsoCaptureMic")}
                  </label>
                </div>

                {!capabilities?.system_audio_available && capabilities?.system_audio_reason && (
                  <p className="mt-2 rounded-lg bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--warning)]">
                    {capabilities.system_audio_reason}
                  </p>
                )}

                {capabilities?.system_audio_available && (
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                    AudioTee {capabilities.audiotee_commit.slice(0, 12)} · 16 kHz mono · macOS Default Output
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="shrink-0 font-medium text-[var(--text-muted)]">
                    {t("copilot.device")}:
                  </span>
                  <select
                    value={selectedDevice}
                    onChange={(event) => {
                      setSelectedDevice(event.target.value)
                      void persistCaptureMode(useSystemAudio, useMicrophone, event.target.value)
                    }}
                    disabled={running || !useMicrophone}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-main)] outline-none"
                  >
                    {devices.length === 0 && <option value="">{t("copilot.defaultDevice")}</option>}
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
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    title={t("copilot.refreshDevices")}
                    aria-label={t("copilot.refreshDevices")}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </section>
              </>
            )}
          </div>
        </div>

        {/* Compact Status Pills Bar */}
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 px-1 py-1 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-1.5 font-medium">
            <Volume2 className="h-3.5 w-3.5" />
            <span>{t("copilot.systemSound")}:</span>
            <span className={useSystemAudio && capabilities?.system_audio_available ? "font-semibold text-[var(--success)]" : "text-[var(--text-muted)]"}>
              {!audioReady ? t("copilot.statusUnknown") : useSystemAudio && capabilities?.system_audio_available ? t("copilot.enabled") : t("copilot.disabled")}
            </span>
          </div>
          <span className="text-[var(--border-color)]">•</span>
          <div className="flex items-center gap-1.5 font-medium">
            <Mic className="h-3.5 w-3.5" />
            <span>{t("copilot.microphone")}:</span>
            <span className={useMicrophone && (capabilities?.microphone_available ?? true) ? "font-semibold text-[var(--success)]" : "text-[var(--text-muted)]"}>
              {!audioReady || capabilitiesError ? t("copilot.statusUnknown") : useMicrophone && capabilities?.microphone_available ? t("copilot.enabled") : t("copilot.disabled")}
            </span>
          </div>
          {selectedDevice && (
            <>
              <span className="text-[var(--border-color)]">•</span>
              <span className="max-w-[200px] truncate font-mono text-[11px] text-[var(--text-muted)]" title={selectedDevice}>
                {selectedDevice}
              </span>
            </>
          )}
          <span className="ml-auto text-[11px] text-[var(--text-muted)]">
            {t("copilot.archive.autoSaveHint")}
          </span>
        </div>
        {(capabilitiesError || (!audioReady && !running)) && onOpenSettings && (
          <div className="mb-2 flex gap-2 text-xs">
            <button type="button" className="rounded-md border border-[var(--border-color)] px-2 py-1" onClick={() => onOpenSettings('ai')}>{t('copilot.fixAi')}</button>
            <button type="button" className="rounded-md border border-[var(--border-color)] px-2 py-1" onClick={() => onOpenSettings('stt')}>{t('copilot.fixStt')}</button>
            <button type="button" className="rounded-md border border-[var(--border-color)] px-2 py-1" onClick={() => onOpenSettings('shortcuts_privacy')}>{t('copilot.fixAudio')}</button>
          </div>
        )}

        {/* Core Copilot Panel */}
        <div className="min-h-0 flex-1">
          <CopilotPanel
            windowStatus={windowStatus}
            onDetach={() => void showCopilotWindow().then(setWindowStatus)}
            onExportRecording={handleExportRecording}
            canExportRecording={copilot.hasRecording}
          />
        </div>
      </div>
    </div>
  )
}
