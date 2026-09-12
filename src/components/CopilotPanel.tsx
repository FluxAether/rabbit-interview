import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react"
import { useShallow } from "zustand/react/shallow"
import CopilotChat from "./CopilotChat"
import { Download, EyeOff, LayoutTemplate, Mic, MoreHorizontal, RefreshCw, Shield, Sparkles, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useTranslation } from "../i18n"
import { sendCopilotCommand } from "../lib/copilotSession"
import { waveformSampleLevel } from "../lib/copilotWaveform"
import { setCopilotWindowOpacity, type CopilotWindowStatus } from "../lib/copilotWindow"
import { protectionMessageKey } from "../lib/copilotWindowState"
import { extractKeyTakeaways } from "../lib/copilotPresentation"
import { getRealtimePerformanceSnapshot, useRealtimeHudVisible, type RealtimePerformanceSnapshot } from "../lib/realtimeMetrics"
import { loadAppSettings, saveAppSettings, type CopilotFontSize } from "../lib/settingsStore"
import { useAppStore } from "../stores/useAppStore"
import { isInsufficientBalanceError } from "../lib/credits"

interface CopilotPanelProps {
  floating?: boolean
  windowStatus?: CopilotWindowStatus | null
  onHide?: () => void
  onExportRecording?: () => void
  canExportRecording?: boolean
}

const CopilotWaveform = memo(function CopilotWaveform({ active }: { active: boolean }) {
  const amplitude = useAppStore((state) => state.copilot.amplitude)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const amplitudeRef = useRef(amplitude)
  const activeRef = useRef(active)
  const drawRef = useRef<() => void>(() => {})

  amplitudeRef.current = amplitude
  activeRef.current = active

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reducedMotion = motion.matches
    let width = 1
    let height = 1
    let dpr = 1

    const align = (value: number) => Math.round(value * dpr) / dpr
    const draw = () => {
      const styles = window.getComputedStyle(canvas)
      const mainColor = styles.getPropertyValue("--text-main").trim() || "#18181b"
      const mutedColor = styles.getPropertyValue("--text-muted").trim() || "#71717a"
      const successColor = styles.getPropertyValue("--success").trim() || "#16a05d"
      const borderColor = styles.getPropertyValue("--border-color").trim() || "#e4e4e7"
      const horizontalPadding = Math.min(4, width / 4)
      const drawableWidth = Math.max(1, width - horizontalPadding * 2)
      const rawCount = Math.max(49, Math.min(161, Math.floor(width / 8)))
      const count = rawCount % 2 === 0 ? rawCount + 1 : rawCount
      const step = drawableWidth / Math.max(1, count - 1)
      const barWidth = Math.max(1 / dpr, Math.round(1.5 * dpr) / dpr)
      const midpoint = height / 2

      context.clearRect(0, 0, width, height)
      context.fillStyle = borderColor
      context.globalAlpha = 0.16
      context.fillRect(align(horizontalPadding + drawableWidth * 0.52), 3, 1 / dpr, height - 6)

      for (let index = 0; index < count; index += 1) {
        const position = index / Math.max(1, count - 1)
        const baseLevel = waveformSampleLevel(index, count, amplitudeRef.current, activeRef.current)
        const displayLevel = Math.min(1, baseLevel * 1.35)
        const level = reducedMotion ? displayLevel * 0.58 : displayLevel
        const dot = level < 0.055
        const sampleHeight = dot ? 2 : Math.max(4, level * (height - 4))
        const highlighted = activeRef.current && position >= 0.34 && position <= 0.68
        const x = align(horizontalPadding + index * step - barWidth / 2)
        const y = align(midpoint - sampleHeight / 2)

        context.fillStyle = highlighted ? successColor : dot ? mutedColor : mainColor
        context.globalAlpha = highlighted ? 0.92 : dot ? 0.5 : 0.7
        context.fillRect(x, y, barWidth, align(sampleHeight))
      }
      context.globalAlpha = 1
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.max(1, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }
    const onMotionChange = () => {
      reducedMotion = motion.matches
      draw()
    }
    const observer = new ResizeObserver(resize)

    drawRef.current = draw
    observer.observe(canvas)
    motion.addEventListener("change", onMotionChange)
    resize()

    return () => {
      drawRef.current = () => {}
      observer.disconnect()
      motion.removeEventListener("change", onMotionChange)
    }
  }, [])

  useEffect(() => {
    drawRef.current()
  }, [amplitude, active])

  return <canvas ref={canvasRef} className="h-6 w-20 shrink-0" aria-hidden="true" />
})

const CopilotElapsed = memo(function CopilotElapsed({ startedAt, active, lastMessageCreatedAt }: {
  startedAt: number; active: boolean; lastMessageCreatedAt?: number
}) {
  const t = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(timer)
  }, [active, startedAt])
  const seconds = Math.max(0, Math.floor(((active ? now : (lastMessageCreatedAt ?? now)) - startedAt) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const elapsed = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  return <span className="rounded-md bg-[var(--bg-subtle)] px-2 py-1 text-xs tabular-nums text-[var(--text-muted)]" title={t("copilot.sessionDuration")}>{hours > 0 ? `${hours}:${elapsed}` : elapsed}</span>
})

export default function CopilotPanel({
  floating = false,
  windowStatus = null,
  onHide,
  onExportRecording,
  canExportRecording = false,
}: CopilotPanelProps) {
  const t = useTranslation()
  const copilot = useAppStore(useShallow((state) => {
    const { amplitude, revision, ...content } = state.copilot
    return content
  }))
  const [fontSize, setFontSize] = useState<CopilotFontSize>("base")
  const [fontSizeReady, setFontSizeReady] = useState(false)
  const [showMyBubbles, setShowMyBubbles] = useState(true)
  const [showMyBubblesReady, setShowMyBubblesReady] = useState(false)
  const [opacity, setOpacity] = useState<number>(100)
  const [hudMode, setHudMode] = useState<boolean>(false)
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)

  const moreMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreActionsOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreActionsOpen(false)
    }
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setMoreActionsOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [moreActionsOpen])
  const running = copilot.phase === "starting" || copilot.phase === "listening"
  const busy = copilot.phase === "stopping"
  const lastMessageCreatedAt = copilot.messages.length > 0
    ? copilot.messages[copilot.messages.length - 1]?.createdAt
    : undefined
  const protectionLabel = t(protectionMessageKey(windowStatus))

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (!floating || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, input, textarea, select, a, [data-no-drag]")) return

    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  const handleOpacityChange = (value: number) => {
    setOpacity(value)
    void setCopilotWindowOpacity(value / 100).catch((error) => {
      console.warn("Unable to update Copilot window opacity", error)
    })
  }

  useEffect(() => {
    let cancelled = false
    void loadAppSettings()
      .then((settings) => {
        if (cancelled) return
        if (settings.copilotFontSize === "sm" || settings.copilotFontSize === "base" || settings.copilotFontSize === "lg") {
          setFontSize(settings.copilotFontSize)
        }
        if (typeof settings.copilotShowMyBubbles === "boolean") {
          setShowMyBubbles(settings.copilotShowMyBubbles)
        }
      })
      .catch((error) => {
        console.warn("Unable to load Copilot settings", error)
      })
      .finally(() => {
        if (!cancelled) {
          setFontSizeReady(true)
          setShowMyBubblesReady(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const fontSteps: CopilotFontSize[] = ["sm", "base", "lg"]
  const fontSizeLabels: Record<CopilotFontSize, string> = {
    sm: t("copilot.font.sm"),
    base: t("copilot.font.base"),
    lg: t("copilot.font.lg"),
  }

  const changeFontSize = (next: CopilotFontSize) => {
    setFontSize(next)
    void saveAppSettings({ copilotFontSize: next }).catch((error) => {
      console.warn("Unable to save Copilot font size", error)
    })
  }

  const decreaseFontSize = () => {
    const index = fontSteps.indexOf(fontSize)
    if (index > 0) changeFontSize(fontSteps[index - 1])
  }

  const increaseFontSize = () => {
    const index = fontSteps.indexOf(fontSize)
    if (index >= 0 && index < fontSteps.length - 1) changeFontSize(fontSteps[index + 1])
  }

  const toggleShowMyBubbles = () => {
    const next = !showMyBubbles
    setShowMyBubbles(next)
    void saveAppSettings({ copilotShowMyBubbles: next }).catch((error) => {
      console.warn("Unable to save Copilot showMyBubbles setting", error)
    })
  }

  const hudTakeaways = useMemo(() => {
    if (!hudMode || !floating) return []
    const latest = [...copilot.messages].reverse().find((message) => message.role === "assistant" && message.text)
    if (!latest) return []
    const points = extractKeyTakeaways(latest.text)
    return points.length ? points : [latest.text]
  }, [copilot.messages, hudMode, floating])
  const showRealtimeHud = useRealtimeHudVisible()
  const [realtimeHud, setRealtimeHud] = useState<RealtimePerformanceSnapshot | null>(null)
  useEffect(() => {
    if (!showRealtimeHud || !running) return
    let cancelled = false
    const tick = () => {
      void getRealtimePerformanceSnapshot().then((snapshot) => {
        if (!cancelled) setRealtimeHud(snapshot)
      })
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [running, showRealtimeHud])

  return (
    <section
      className={`floating-panel flex min-h-0 w-full flex-col border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-main)] shadow-none transition-opacity duration-150 ${
        floating ? "h-[100dvh] rounded-none" : "h-full rounded-lg"
      }`}
      aria-label={t("copilot.floating.title")}
    >
      {/* Header Controls */}
      <header
        className={`mb-2 flex items-center justify-between gap-3 ${floating ? "cursor-move select-none" : ""}`}
        data-tauri-drag-region={floating ? true : undefined}
        onMouseDown={startWindowDrag}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            {floating && <div className="truncate font-semibold">{t("copilot.floating.title")}</div>}
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]" role="status">
              <span className={`h-2 w-2 shrink-0 rounded-full ${running ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"}`} />
              <span className="truncate">{copilot.generatingReplyToIds.length > 0 ? t("copilot.intent.generating") : t(`copilot.phase.${copilot.phase}`)}</span>
            </div>
          </div>
          <div title={t("copilot.audioLevel")}><CopilotWaveform active={running} /></div>
        </div>

        {/* Toolbar: Show/Hide My Bubbles, Font Size, Opacity (floating mode) & Duration */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
          <div
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
            title={showMyBubbles ? t("copilot.hideMyBubbles") : t("copilot.showMyBubbles")}
            data-no-drag
          >
          <span className="text-[11px] font-medium text-[var(--text-muted)] select-none">
            {t("copilot.myBubbles")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={showMyBubbles}
            disabled={!showMyBubblesReady}
            onClick={toggleShowMyBubbles}
            className={`relative inline-flex min-h-[28px] w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out disabled:opacity-40 ${
              showMyBubbles ? "bg-[var(--action)]" : "bg-[var(--bg-hover)] border border-[var(--border-color)]"
            }`}
            aria-label={t("copilot.myBubbles")}
            data-no-drag
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-[var(--bg-surface)] shadow-sm ring-0 transition-transform duration-200 ease-in-out ${
                showMyBubbles ? "translate-x-5 bg-white" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {floating && (
          <button
            type="button"
            onClick={() => setHudMode(!hudMode)}
            className={`flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2 py-1 text-xs transition-colors ${
              hudMode ? "bg-[var(--action)] font-medium text-[var(--action-text)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
            title={hudMode ? t("copilot.viewMode.normal") : t("copilot.viewMode.hud")}
            aria-label={hudMode ? t("copilot.viewMode.normal") : t("copilot.viewMode.hud")}
            data-no-drag
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium">{hudMode ? "HUD" : "Normal"}</span>
          </button>
        )}

        <div className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-0.5 text-xs">
            <button
              type="button"
              onClick={decreaseFontSize}
              disabled={!fontSizeReady || fontSize === "sm"}
              className={`rounded p-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-40 ${fontSize === "sm" ? "font-bold text-[var(--text-main)]" : "text-[var(--text-muted)]"}`}
              title={t("copilot.fontSmaller")}
              aria-label={t("copilot.fontSmaller")}
              data-no-drag
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span
              className="min-w-5 px-0.5 text-center text-[11px] font-semibold tabular-nums text-[var(--text-muted)]"
              title={t("copilot.fontCurrent", { size: fontSizeLabels[fontSize] })}
              data-no-drag
            >
              {fontSizeLabels[fontSize]}
            </span>
            <button
              type="button"
              onClick={increaseFontSize}
              disabled={!fontSizeReady || fontSize === "lg"}
              className={`rounded p-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-40 ${fontSize === "lg" ? "font-bold text-[var(--text-main)]" : "text-[var(--text-muted)]"}`}
              title={t("copilot.fontLarger")}
              aria-label={t("copilot.fontLarger")}
              data-no-drag
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {floating && (
            <div
              className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-0.5 text-xs"
              data-no-drag
            >
              <div className="flex items-center gap-1 px-1.5 py-0.5" title={t("copilot.opacity")}>
                <EyeOff className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                <input
                  type="range"
                  min={30}
                  max={100}
                  step={1}
                  value={opacity}
                  onChange={(event) => handleOpacityChange(Number(event.target.value))}
                  className="h-1.5 w-12 cursor-pointer appearance-none rounded-lg bg-[var(--bg-hover)] accent-[var(--action)]"
                  aria-label={t("copilot.opacity")}
                  data-no-drag
                />
              </div>
              <div className="flex items-center gap-0.5 border-l border-[var(--border-color)] pl-1 pr-0.5">
                {[100, 70, 40].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => handleOpacityChange(val)}
                    className={`rounded px-1 py-0.5 font-mono text-[11px] transition-colors ${
                      opacity === val
                        ? "bg-[var(--action)] font-bold text-[var(--action-text)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                    }`}
                    data-no-drag
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>
          )}

          {copilot.startedAt != null && <CopilotElapsed startedAt={copilot.startedAt} active={running || busy} lastMessageCreatedAt={lastMessageCreatedAt} />}

          {floating && onHide && (
            <button
              type="button"
              onClick={onHide}
              className="rounded-md p-2 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
              aria-label={t("copilot.hide")}
              data-tauri-drag-region="false"
              data-no-drag
            >
              <EyeOff className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Pinned Current Question Banner */}
      {copilot.question && (
        <div className="mb-2 flex shrink-0 items-start justify-between gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-subtle)] p-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--action)]">
              <Sparkles className="h-3 w-3" />
              <span>{t("copilot.pinCurrentQuestion")}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs font-medium text-[var(--text-main)]">
              {copilot.question}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void sendCopilotCommand({ type: "retry" })}
            disabled={!running}
            className="flex shrink-0 items-center gap-1 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-1.5 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40"
            title={t("copilot.retryCurrent")}
            aria-label={t("copilot.retryCurrent")}
          >
            <RefreshCw className="h-3 w-3" />
            <span>{t("copilot.retryCurrent")}</span>
          </button>
        </div>
      )}

      {/* HUD Teleprompter Overlay / View */}
      {hudMode && floating && (
        <div className="mb-2 shrink-0 rounded-lg border border-[var(--border-strong)] bg-slate-950/90 p-3 text-white backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-300 uppercase">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[var(--action)]" />
              {t("copilot.keyPoints")} (HUD)
            </span>
            <span className="text-[11px] text-slate-400">Eye-Level Teleprompter</span>
          </div>
          {hudTakeaways.length > 0 ? (
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {hudTakeaways.map((point, idx) => (
                <div key={idx} className="rounded border border-slate-800/80 bg-slate-900/80 p-2 text-xs leading-relaxed text-slate-200">
                  <div className="mb-1 font-mono text-[11px] font-bold text-[var(--action)]">0{idx + 1}</div>
                  <p className="line-clamp-3 font-medium">{point}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 text-center text-xs text-slate-400">
              {t("copilot.suggestions.empty")}
            </div>
          )}
        </div>
      )}

      <div role="log" className="relative flex min-h-0 flex-1 flex-col">
        <CopilotChat key={copilot.startedAt ?? "idle"} messages={copilot.messages} showMyBubbles={showMyBubbles}
          fontSize={fontSize} running={running} generatingReplyToIds={copilot.generatingReplyToIds} floating={floating} visible={!floating || windowStatus?.visible !== false} />
      </div>
      {showRealtimeHud && realtimeHud && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-[var(--bg-subtle)] px-2.5 py-2 font-mono text-[11px] text-[var(--text-muted)]" aria-label={t("copilot.realtime.hud")}>
          <span>IPC {realtimeHud.audioIpcKbPerSecond.toFixed(1)} KB/s</span>
          <span>STT {realtimeHud.sttQueueMs.toFixed(0)} ms</span>
          <span>Rec {realtimeHud.recorderQueueMs.toFixed(0)} ms</span>
          <span>Drop {realtimeHud.droppedAudioMs.toFixed(0)} ms</span>
          <span>TTFT {realtimeHud.llmTtftMs ?? "—"}</span>
          <span>E2E {realtimeHud.lastTurnE2eMs ?? "—"}</span>
        </div>
      )}

      {copilot.answerStatus !== "idle" && (
        <div
          className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${
            copilot.answerStatus === "incomplete"
              ? "bg-[var(--bg-subtle)] text-[var(--warning)]"
              : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
          }`}
          role={copilot.answerStatus === "incomplete" ? "alert" : "status"}
        >
          <div>{t(`copilot.answer.${copilot.answerStatus}`)}</div>
          {copilot.answerNotice && <div className="mt-1">{t(copilot.answerNotice)}</div>}
        </div>
      )}

      {copilot.archiveStatus !== "idle" && (
        <div
          className={`mt-2 rounded-lg px-2.5 py-2 text-xs ${
            copilot.archiveStatus === "error"
              ? "bg-[var(--bg-subtle)] text-[var(--danger)]"
              : copilot.archiveStatus === "saved"
                ? "bg-[var(--bg-subtle)] text-[var(--success)]"
                : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"
          }`}
          role={copilot.archiveStatus === "error" ? "alert" : "status"}
        >
          {copilot.archiveStatus === "saving"
            ? t("copilot.archive.saving")
            : t(copilot.archiveNotice || "copilot.archive.saved")}
          {isInsufficientBalanceError(copilot.archiveNotice) && <div>{t("account.insufficientBalance")}</div>}
        </div>
      )}

      {copilot.error && (
        <div className="mt-2 rounded-lg bg-[var(--bg-subtle)] px-2.5 py-2 text-xs text-[var(--danger)]" role="alert">
          {isInsufficientBalanceError(copilot.error) ? t("account.insufficientBalance") : copilot.error}
        </div>
      )}

      <CopilotFollowUp running={running} />

      {/* Control Buttons Footer */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--border-color)] pt-2.5">
        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: "toggle" })}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium text-[var(--action-text)] transition-colors disabled:opacity-60 ${
            running ? "bg-[var(--danger)]" : "bg-[var(--action)]"
          }`}
        >
          {running ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {running ? t("copilot.stopCapture") : t("copilot.startCapture")}
        </button>

        <div className="relative" ref={moreMenuRef}>
          <button
            type="button"
            onClick={() => setMoreActionsOpen((prev) => !prev)}
            className="flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
            title={t("copilot.moreActions")}
            aria-label={t("copilot.moreActions")}
            aria-expanded={moreActionsOpen}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>

          {moreActionsOpen && (
            <div className="absolute bottom-full left-0 mb-1.5 z-20 min-w-[140px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-1 shadow-lg">
              {!floating && onExportRecording && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreActionsOpen(false)
                    onExportRecording()
                  }}
                  disabled={!canExportRecording}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{t("copilot.exportRecording")}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setMoreActionsOpen(false)
                  const hasContent = Boolean(copilot.question || copilot.messages.length || copilot.suggestions.length)
                  if (copilot.archiveStatus === "saving") return
                  if (hasContent && !window.confirm(t("copilot.clearConfirm"))) return
                  void sendCopilotCommand({ type: "clear" })
                }}
                disabled={copilot.archiveStatus === "saving"}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t("copilot.clear")}</span>
              </button>
            </div>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-[11px] text-[var(--text-muted)]">
          <span className={`flex items-center gap-1 rounded-md bg-[var(--bg-subtle)] px-2 py-1 ${windowStatus?.protection_applied ? "text-[var(--success)]" : "text-[var(--warning)]"}`} title={t("copilot.protection.caveat")}>
            <Shield className="h-3 w-3" /> {protectionLabel}
          </span>
        </div>
      </div>

      {(copilot.capabilityNotice || windowStatus?.error) && (
        <div className="mt-2 text-[11px]">
          {copilot.capabilityNotice && <div className="text-[var(--warning)]">{copilot.capabilityNotice}</div>}
          {windowStatus?.error && <div className="text-[var(--danger)]">{windowStatus.error}</div>}
        </div>
      )}
    </section>
  )
}

const CopilotFollowUp = memo(function CopilotFollowUp({ running }: { running: boolean }) {
  const t = useTranslation()
  const [followUp, setFollowUp] = useState("")
  const submitFollowUp = (event: FormEvent) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text) return
    void sendCopilotCommand({ type: "follow-up", text })
    setFollowUp("")
  }

  const quickPrompts = [
    { key: "copilot.quick.brief", label: `💡 ${t("copilot.quick.brief")}`, prompt: t("copilot.quick.brief") },
    { key: "copilot.quick.star", label: `📐 ${t("copilot.quick.star")}`, prompt: t("copilot.quick.star") },
    { key: "copilot.quick.metrics", label: `📊 ${t("copilot.quick.metrics")}`, prompt: t("copilot.quick.metrics") },
    { key: "copilot.quick.followUp", label: `❓ ${t("copilot.quick.followUp")}`, prompt: t("copilot.quick.followUp") },
  ]

  return (
    <>
      {/* Quick Prompts */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {quickPrompts.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => void sendCopilotCommand({ type: "follow-up", text: item.prompt })}
            disabled={!running}
            className="min-h-7 rounded-full border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Follow-up Form */}
      <form className="mt-2 flex gap-2" onSubmit={submitFollowUp}>
        <input
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={t("copilot.followUp")}
          className="min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-main)] outline-none focus:border-[var(--text-muted)] disabled:opacity-50"
          disabled={!running}
          aria-label={t("copilot.followUp")}
        />
        <button
          type="submit"
          className="rounded-lg bg-[var(--action)] px-3 py-2 text-xs font-medium text-[var(--action-text)] disabled:opacity-40"
          disabled={!running || !followUp.trim()}
        >
          {t("copilot.ask")}
        </button>
      </form>

    </>
  )
})
