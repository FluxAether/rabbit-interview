import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import { ArrowDown, Check, ChevronDown, ChevronUp, Clipboard, Download, EyeOff, Mic, RefreshCw, Shield, Sparkles, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useTranslation } from "../i18n"
import { sendCopilotCommand } from "../lib/copilotSession"
import { setCopilotWindowOpacity, type CopilotWindowStatus } from "../lib/copilotWindow"
import { protectionMessageKey } from "../lib/copilotWindowState"
import { loadAppSettings, saveAppSettings, type CopilotFontSize } from "../lib/settingsStore"
import { useAppStore } from "../stores/useAppStore"

interface CopilotPanelProps {
  floating?: boolean
  windowStatus?: CopilotWindowStatus | null
  onHide?: () => void
  onExportRecording?: () => void
  canExportRecording?: boolean
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
  const amplitude = Math.min(100, Math.round(copilot.amplitude * 140))
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
    void navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
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
    sm: "小",
    base: "中",
    lg: "大",
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
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-0.5 text-xs">
            <button
              type="button"
              onClick={decreaseFontSize}
              disabled={!fontSizeReady || fontSize === "sm"}
              className={`rounded p-1 hover:bg-[var(--bg-hover)] disabled:opacity-40 ${fontSize === "sm" ? "font-bold text-[var(--text-main)]" : "text-[var(--text-muted)]"}`}
              title="缩小字体 (小/中/大)"
              aria-label="缩小字体"
              data-no-drag
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span
              className="min-w-5 px-0.5 text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]"
              title={`当前字体：${fontSizeLabels[fontSize]}`}
              data-no-drag
            >
              {fontSizeLabels[fontSize]}
            </span>
            <button
              type="button"
              onClick={increaseFontSize}
              disabled={!fontSizeReady || fontSize === "lg"}
              className={`rounded p-1 hover:bg-[var(--bg-hover)] disabled:opacity-40 ${fontSize === "lg" ? "font-bold text-[var(--text-main)]" : "text-[var(--text-muted)]"}`}
              title="放大字体 (小/中/大)"
              aria-label="放大字体"
              data-no-drag
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {floating && (
            <div
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-2 py-1 text-xs"
              title="滑动调节透明度"
              data-no-drag
            >
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
              <input
                type="range"
                min={30}
                max={100}
                step={1}
                value={opacity}
                onChange={(event) => handleOpacityChange(Number(event.target.value))}
                className="h-1.5 w-16 cursor-pointer appearance-none rounded-lg bg-[var(--bg-hover)] accent-[var(--action)]"
                aria-label="调整浮窗透明度"
                data-no-drag
              />
              <span className="w-7 text-right font-mono text-[10px] font-medium text-[var(--text-muted)]">
                {opacity}%
              </span>
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
              className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
              aria-label={t("copilot.hide")}
              data-tauri-drag-region="false"
              data-no-drag
            >
              <EyeOff className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Dynamic Audio Visualizer Bar */}
      <div className="mb-2 flex h-1 items-center overflow-hidden rounded-full bg-[var(--bg-hover)]" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-all duration-75 ${running ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"}`}
          style={{ width: `${amplitude}%` }}
        />
      </div>

      {/* Chat & AI Suggestions Container */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesRef}
          onScroll={handleScroll}
          className={`h-full overflow-y-auto overscroll-contain rounded-lg p-3 ${floating ? "bg-[var(--bg-sidebar)]" : "bg-[var(--bg-surface)]"}`}
          aria-live="polite"
        >
          {copilot.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-xs text-[var(--text-muted)]">
              <Sparkles className="mb-2 h-7 w-7 opacity-40" />
              {t("copilot.chat.empty")}
            </div>
          ) : (
            <div className="space-y-4">
              {copilot.messages.map((message) => {
                const mine = message.role === "me"
                const assistant = message.role === "assistant"
                const keyTakeaways = assistant ? extractKeyTakeaways(message.text) : []
                const isTakeawayCollapsed = collapsedTakeaways[message.id] ?? false

                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <article className={assistant ? "w-full" : "max-w-[88%]"}>
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

                      {/* Main Content Box */}
                      <div
                        className={`flex flex-col gap-3 ${fontSizeClass} leading-7 transition-colors ${
                          mine
                            ? "rounded-lg bg-[var(--bg-subtle)] px-3.5 py-2.5 text-[var(--text-main)]"
                            : assistant
                              ? floating
                                ? "rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3.5 text-[var(--text-main)]"
                                : "bg-transparent px-1 py-2 text-[var(--text-main)]"
                              : "rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[var(--text-main)]"
                        }`}
                      >
                        {/* Highlighted Takeaways for AI Assistant */}
                        {assistant && keyTakeaways.length > 0 && (
                          <div className={`rounded-lg border border-[var(--border-color)] bg-[var(--bg-subtle)] p-2.5 text-[var(--text-main)] ${takeawaySizeClass}`}>
                            <div
                              className="flex items-center justify-between font-semibold text-[var(--text-main)]"
                            >
                              <div className="flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                                <span>核心提示词 (Key Points)</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleTakeawayCollapse(message.id)}
                                className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                                title={isTakeawayCollapsed ? "展开提示词" : "折叠提示词"}
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

                        {/* Copy Helper for Assistant */}
                        {assistant && (
                          <div className="mt-1 flex items-center justify-between border-t border-[var(--border-color)] pt-2 text-xs">
                            <span className="text-[10px] text-[var(--text-muted)]">
                              推荐提示
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(message.id, message.text)}
                              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]"
                              aria-label={t("copilot.copySuggestion")}
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="h-3 w-3 text-[var(--success)]" />
                                  <span className="text-[var(--success)]">已复制</span>
                                </>
                              ) : (
                                <>
                                  <Clipboard className="h-3 w-3" />
                                  <span>复制建议</span>
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
            <span>↓ 有新消息</span>
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
          onClick={() => void sendCopilotCommand({ type: "clear" })}
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
