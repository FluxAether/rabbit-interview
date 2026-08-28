import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import { ArrowDown, Check, ChevronDown, ChevronUp, Clipboard, Download, EyeOff, Loader2, Mic, RefreshCw, Shield, Sparkles, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useTranslation } from "../i18n"
import { sendCopilotCommand } from "../lib/copilotSession"
import { waveformSampleLevel } from "../lib/copilotWaveform"
import { setCopilotWindowOpacity, type CopilotWindowStatus } from "../lib/copilotWindow"
import { protectionMessageKey } from "../lib/copilotWindowState"
import { orderCopilotMessagesForDisplay, type CopilotMessage } from "../lib/copilotSessionState"
import { loadAppSettings, saveAppSettings, type CopilotFontSize } from "../lib/settingsStore"
import { useAppStore } from "../stores/useAppStore"

interface CopilotPanelProps {
  floating?: boolean
  windowStatus?: CopilotWindowStatus | null
  onHide?: () => void
  onExportRecording?: () => void
  canExportRecording?: boolean
}

function CopilotWaveform({ amplitude, active }: { amplitude: number; active: boolean }) {
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

  return <canvas ref={canvasRef} className="mb-2 h-[64px] w-full shrink-0" aria-hidden="true" />
}

// Extract key takeaways (first 1-3 bullet points or key sentences) from assistant text
function extractKeyTakeaways(text: string): string[] {
  if (!text) return []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[•\-*]\s*/, ""))
    .filter((l) => l.length > 5)
  return lines.slice(0, 3)
}

function groupCopilotMessages(messages: CopilotMessage[]): CopilotMessage[][] {
  const groups: CopilotMessage[][] = []
  for (const message of orderCopilotMessagesForDisplay(messages)) {
    const previous = groups[groups.length - 1]
    if (
      message.role === "assistant"
      && previous
      && (previous[0].role === "interviewer" || previous[0].source === "follow-up")
    ) {
      previous.push(message)
      continue
    }
    groups.push([message])
  }
  return groups
}

export default function CopilotPanel({
  floating = false,
  windowStatus = null,
  onHide,
  onExportRecording,
  canExportRecording = false,
}: CopilotPanelProps) {
  const t = useTranslation()
  const copilot = useAppStore((state) => state.copilot)
  const [followUp, setFollowUp] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [fontSize, setFontSize] = useState<CopilotFontSize>("base")
  const [fontSizeReady, setFontSizeReady] = useState(false)
  const [opacity, setOpacity] = useState<number>(100)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [collapsedTakeaways, setCollapsedTakeaways] = useState<Record<number, boolean>>({})

  const messagesRef = useRef<HTMLDivElement>(null)
  const running = copilot.phase === "starting" || copilot.phase === "listening"
  const busy = copilot.phase === "stopping"
  const roleLabels = {
    interviewer: t("copilot.role.interviewer"),
    assistant: t("copilot.role.assistant"),
    me: t("copilot.role.me"),
  }

  const formatClock = (timestamp: number) => {
    const date = new Date(timestamp)
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`
  }

  const formatElapsed = (totalSeconds: number) => {
    const seconds = Math.max(0, Math.floor(totalSeconds))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remain = seconds % 60
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`
    }
    return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`
  }

  const lastMessageCreatedAt = copilot.messages.length > 0
    ? copilot.messages[copilot.messages.length - 1]?.createdAt
    : undefined
  const sessionElapsedSeconds = copilot.startedAt
    ? Math.floor((((running || busy) ? now : (lastMessageCreatedAt ?? now)) - copilot.startedAt) / 1000)
    : 0

  const submitFollowUp = (event: FormEvent) => {
    event.preventDefault()
    const text = followUp.trim()
    if (!text) return
    void sendCopilotCommand({ type: "follow-up", text })
    setFollowUp("")
  }

  const protectionLabel = t(protectionMessageKey(windowStatus))

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (!floating || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, input, textarea, select, a, [data-no-drag]")) return

    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  const handleCopy = (id: number, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    }).catch((error) => {
      console.warn("Unable to copy suggestion", error)
    })
  }

  const handleOpacityChange = (value: number) => {
    setOpacity(value)
    void setCopilotWindowOpacity(value / 100).catch((error) => {
      console.warn("Unable to update Copilot window opacity", error)
    })
  }

  const scrollToBottom = () => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
      setIsAtBottom(true)
    }
  }

  const handleScroll = () => {
    const container = messagesRef.current
    if (!container) return
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 25
    setIsAtBottom(atBottom)
  }

  useLayoutEffect(() => {
    if (isAtBottom && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [copilot.messages, isAtBottom])

  useEffect(() => {
    let cancelled = false
    void loadAppSettings()
      .then((settings) => {
        if (cancelled) return
        if (settings.copilotFontSize === "sm" || settings.copilotFontSize === "base" || settings.copilotFontSize === "lg") {
          setFontSize(settings.copilotFontSize)
        }
      })
      .catch((error) => {
        console.warn("Unable to load Copilot font size", error)
      })
      .finally(() => {
        if (!cancelled) setFontSizeReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!running && !busy) return
    setNow(Date.now())
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(timer)
  }, [running, busy, copilot.startedAt])

  const fontSteps: CopilotFontSize[] = ["sm", "base", "lg"]
  const fontSizeLabels: Record<CopilotFontSize, string> = {
    sm: t("copilot.font.sm"),
    base: t("copilot.font.base"),
    lg: t("copilot.font.lg"),
  }

  const fontSizeClass =
    fontSize === "sm"
      ? "text-sm"
      : fontSize === "lg"
        ? "text-lg"
        : "text-base"

  const takeawaySizeClass =
    fontSize === "sm"
      ? "text-[11px]"
      : fontSize === "lg"
        ? "text-sm"
        : "text-xs"

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

  const toggleTakeawayCollapse = (id: number) => {
    setCollapsedTakeaways((prev) => ({ ...prev, [id]: !prev[id] }))
  }

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
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${running ? "bg-[var(--danger)]" : "bg-[var(--action)]"}`}>
            <Mic className="h-3.5 w-3.5 text-[var(--action-text)]" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold tracking-tight text-[var(--text-main)]">
              {t("copilot.floating.title")}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]" role="status">
              {t(`copilot.phase.${copilot.phase}`)}
            </div>
          </div>
        </div>

        {/* Toolbar: Font Size, Opacity (floating mode) & Duration */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
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
              className="min-w-5 px-0.5 text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]"
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
                    className={`rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
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

          {copilot.startedAt != null && (
            <div
              className="rounded-md bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text-muted)]"
              title={t("copilot.sessionDuration")}
            >
              {formatElapsed(sessionElapsedSeconds)}
            </div>
          )}

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

      <CopilotWaveform amplitude={copilot.amplitude} active={running} />

      {/* Chat & AI Suggestions Container */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesRef}
          onScroll={handleScroll}
          className={`h-full overflow-y-auto overscroll-contain rounded-lg p-3 ${floating ? "bg-[var(--bg-sidebar)]" : "bg-[var(--bg-surface)]"}`}
          role="log" aria-relevant="additions"
        >
          {copilot.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-xs text-[var(--text-muted)]">
              <Sparkles className="mb-2 h-7 w-7 opacity-40" />
              {t("copilot.chat.empty")}
            </div>
          ) : (
            <div className="space-y-4">
              {groupCopilotMessages(copilot.messages).map((group) => (
                <div key={group.map((message) => message.id).join("-")} className="space-y-1">
                  {group.map((message) => {
                    const mine = message.role === "me"
                    const assistant = message.role === "assistant"
                    const isRegenerating = copilot.generatingReplyToIds?.includes(message.id) ?? false
                    const keyTakeaways = assistant ? extractKeyTakeaways(message.text) : []
                    const isTakeawayCollapsed = collapsedTakeaways[message.id] ?? false

                    return (
                      <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <article className="max-w-[88%]">
                          <div
                            className={`mb-1 flex items-center gap-2 px-1 text-[11px] font-medium text-[var(--text-muted)] ${
                              mine ? "justify-end" : ""
                            }`}
                          >
                            <span>{roleLabels[message.role]}</span>
                            {message.createdAt ? (
                              <span className="text-[10px] font-normal tabular-nums text-[var(--text-muted)]">
                                {formatClock(message.createdAt)}
                              </span>
                            ) : null}
                          </div>

                          <div
                            className={`flex flex-col gap-3 ${fontSizeClass} leading-7 transition-colors ${
                              mine
                                ? "rounded-lg bg-[var(--bg-subtle)] px-3.5 py-2.5 text-[var(--text-main)]"
                                : "rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[var(--text-main)]"
                            }`}
                          >
                            {assistant && keyTakeaways.length > 0 && (
                              <div className={`rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] p-2.5 text-[var(--text-main)] ${takeawaySizeClass}`}>
                                <div className="flex items-center justify-between font-semibold text-[var(--text-main)]">
                                  <div className="flex items-center gap-1.5">
                                    <Sparkles className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                    {t("copilot.keyPoints")}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => toggleTakeawayCollapse(message.id)}
                                    className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                    title={isTakeawayCollapsed ? t("copilot.expandPoints") : t("copilot.collapsePoints")}
                                  >
                                    {isTakeawayCollapsed ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronUp className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </div>
                                {!isTakeawayCollapsed && (
                                  <ul className="mt-1.5 space-y-1 pl-1">
                                    {keyTakeaways.map((point, idx) => (
                                      <li key={idx} className="flex items-start gap-1.5">
                                        <span className="font-bold text-[var(--text-muted)]">•</span>
                                        <span className="leading-relaxed">{point}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}

                            <div className="min-w-0 flex-1 whitespace-pre-wrap text-[var(--text-main)]">
                              {message.text}
                            </div>

                            {message.role === "interviewer" && (
                              <div className="mt-1 flex items-center justify-end border-t border-[var(--border-color)] pt-1.5 text-xs">
                                <button
                                  type="button"
                                  onClick={() => void sendCopilotCommand({ type: "retry", messageId: message.id })}
                                  disabled={!running || isRegenerating}
                                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40"
                                  aria-label={t("copilot.retry")}
                                  title={t("copilot.retry")}
                                  data-no-drag
                                >
                                  {isRegenerating ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3" />
                                  )}
                                  <span>{t("copilot.retry")}</span>
                                </button>
                              </div>
                            )}

                            {assistant && (
                              <div className="mt-1 flex items-center justify-between border-t border-[var(--border-color)] pt-2 text-xs">
                                <span className="text-[10px] text-[var(--text-muted)]">{t("copilot.suggestedHint")}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(message.id, message.text)}
                                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                  aria-label={t("copilot.copySuggestion")}
                                >
                                  {copiedId === message.id ? (
                                    <>
                                      <Check className="h-3 w-3 text-[var(--success)]" />
                                      <span className="text-[var(--success)]">{t("copilot.copied")}</span>
                                    </>
                                  ) : (
                                    <>
                                      <Clipboard className="h-3 w-3" />
                                      <span>{t("copilot.copySuggestion")}</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </article>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Floating Scroll to Bottom Button */}
        {!isAtBottom && copilot.messages.length > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>{t("copilot.newMessages")}</span>
          </button>
        )}
      </div>

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
        </div>
      )}

      {copilot.error && (
        <div className="mt-2 rounded-lg bg-[var(--bg-subtle)] px-2.5 py-2 text-xs text-[var(--danger)]" role="alert">
          {copilot.error}
        </div>
      )}

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

        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: "retry" })}
          disabled={!running || !copilot.question}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("copilot.retry")}
        </button>

        <button
          type="button"
          onClick={() => {
            const hasContent = Boolean(copilot.question || copilot.messages.length || copilot.suggestions.length)
            if (copilot.archiveStatus === "saving") return
            if (hasContent && !window.confirm(t("copilot.clearConfirm"))) return
            void sendCopilotCommand({ type: "clear" })
          }}
          disabled={copilot.archiveStatus === "saving"}
          className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("copilot.clear")}
        </button>

        {!floating && onExportRecording && (
          <button
            type="button"
            onClick={onExportRecording}
            disabled={!canExportRecording}
            className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> {t("copilot.exportRecording")}
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-[10px] text-[var(--text-muted)]">
          <span className={`flex items-center gap-1 rounded-md bg-[var(--bg-subtle)] px-2 py-1 ${windowStatus?.protection_applied ? "text-[var(--success)]" : "text-[var(--warning)]"}`} title={t("copilot.protection.caveat")}>
            <Shield className="h-3 w-3" /> {protectionLabel}
          </span>
        </div>
      </div>

      {(copilot.capabilityNotice || windowStatus?.error) && (
        <div className="mt-2 text-[10px]">
          {copilot.capabilityNotice && <div className="text-[var(--warning)]">{copilot.capabilityNotice}</div>}
          {windowStatus?.error && <div className="text-[var(--danger)]">{windowStatus.error}</div>}
        </div>
      )}
    </section>
  )
}
