import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react"
import { ArrowDown, Check, ChevronDown, ChevronUp, Clipboard, Download, EyeOff, Mic, RefreshCw, Shield, Sparkles, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { useTranslation } from "../i18n"
import { sendCopilotCommand } from "../lib/copilotSession"
import { setCopilotWindowOpacity, type CopilotWindowStatus } from "../lib/copilotWindow"
import { protectionMessageKey } from "../lib/copilotWindowState"
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
  const [fontSize, setFontSize] = useState<"sm" | "base" | "lg">("base")
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
    if (!running && !busy) return
    setNow(Date.now())
    const timer = globalThis.setInterval(() => setNow(Date.now()), 1_000)
    return () => globalThis.clearInterval(timer)
  }, [running, busy, copilot.startedAt])

  const fontSizeClass =
    fontSize === "sm"
      ? "text-sm"
      : fontSize === "lg"
        ? "text-lg"
        : "text-base"

  const toggleTakeawayCollapse = (id: number) => {
    setCollapsedTakeaways((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <section
      className={`floating-panel flex min-h-0 w-full flex-col border border-[#e2e8f0] p-4 text-sm transition-opacity duration-150 dark:border-[#334155] ${
        floating ? "h-[100dvh] rounded-none bg-white/85 dark:bg-[#1e293b]/85" : "h-full shadow-xl bg-white dark:bg-[#1e293b]"
      }`}
      aria-label={t("copilot.floating.title")}
    >
      {/* Header Controls */}
      <header
        className={`mb-2 flex items-center justify-between gap-3 px-1 ${floating ? "cursor-move select-none" : ""}`}
        data-tauri-drag-region={floating ? true : undefined}
        onMouseDown={startWindowDrag}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${running ? "bg-red-500 animate-pulse" : "bg-[#6366f1]"}`}>
            <Mic className="h-3.5 w-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold tracking-tight text-[#0f172a] dark:text-[#f8fafc]">
              {t("copilot.floating.title")}
            </div>
            <div className="text-[10px] text-[#64748b] dark:text-[#94a3b8]" role="status">
              {t(`copilot.phase.${copilot.phase}`)}
            </div>
          </div>
        </div>

        {/* Toolbar: Font Size, Opacity (floating mode) & Duration */}
        <div className="ml-auto flex items-center gap-2">
          <div className={`flex items-center rounded-lg border border-[#e2e8f0] p-0.5 text-xs dark:border-[#334155] ${floating ? "bg-white/70 dark:bg-[#0f172a]/70" : "bg-white dark:bg-[#0f172a]"}`}>
            <button
              type="button"
              onClick={() => setFontSize((s) => (s === "lg" ? "base" : "sm"))}
              className={`rounded p-1 hover:bg-[#f1f5f9] dark:hover:bg-[#1e293b] ${fontSize === "sm" ? "text-[#6366f1] font-bold" : "text-[#64748b] dark:text-[#94a3b8]"}`}
              title="缩小字体"
              data-no-drag
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setFontSize((s) => (s === "sm" ? "base" : "lg"))}
              className={`rounded p-1 hover:bg-[#f1f5f9] dark:hover:bg-[#1e293b] ${fontSize === "lg" ? "text-[#6366f1] font-bold" : "text-[#64748b] dark:text-[#94a3b8]"}`}
              title="放大字体"
              data-no-drag
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          {floating && (
            <div
              className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white/70 px-2 py-1 text-xs dark:border-[#334155] dark:bg-[#0f172a]/70"
              title="滑动调节透明度"
              data-no-drag
            >
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-[#64748b] dark:text-[#94a3b8]" />
              <input
                type="range"
                min={30}
                max={100}
                step={1}
                value={opacity}
                onChange={(event) => handleOpacityChange(Number(event.target.value))}
                className="h-1.5 w-16 cursor-pointer appearance-none rounded-lg bg-[#e2e8f0] accent-[#6366f1] dark:bg-[#334155]"
                data-no-drag
              />
              <span className="w-7 text-right font-mono text-[10px] font-medium text-[#64748b] dark:text-[#94a3b8]">
                {opacity}%
              </span>
            </div>
          )}

          {copilot.startedAt != null && (
            <div
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#475569] dark:bg-[#0f172a] dark:text-[#a5b4fc]"
              title={t("copilot.sessionDuration")}
            >
              {formatElapsed(sessionElapsedSeconds)}
            </div>
          )}

          {floating && onHide && (
            <button
              type="button"
              onClick={onHide}
              className="rounded-lg p-1.5 text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#334155] dark:text-[#94a3b8] dark:hover:bg-[#334155] dark:hover:text-white"
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
      <div className="mb-2.5 flex h-1.5 items-center gap-1 overflow-hidden rounded-full bg-[#e2e8f0] px-1 dark:bg-[#334155]" aria-hidden="true">
        <div
          className="h-full rounded-full bg-[#6366f1] transition-all duration-75"
          style={{ width: `${amplitude}%` }}
        />
      </div>

      {/* Chat & AI Suggestions Container */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesRef}
          onScroll={handleScroll}
          className={`h-full overflow-y-auto overscroll-contain rounded-xl p-3 ${
            floating ? "bg-[#f8fafc]/70 dark:bg-[#0f172a]/70 backdrop-blur-sm" : "bg-[#f8fafc] dark:bg-[#0f172a]"
          }`}
          aria-live="polite"
        >
          {copilot.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-xs text-[#64748b] dark:text-[#94a3b8]">
              <Sparkles className="mb-2 h-8 w-8 text-[#6366f1] opacity-50 animate-bounce" />
              {t("copilot.chat.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              {copilot.messages.map((message) => {
                const mine = message.role === "me"
                const assistant = message.role === "assistant"
                const keyTakeaways = assistant ? extractKeyTakeaways(message.text) : []
                const isTakeawayCollapsed = collapsedTakeaways[message.id] ?? false

                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <article className="max-w-[92%]">
                      <div
                        className={`mb-1 flex items-center gap-2 px-1 text-xs font-semibold text-[#475569] dark:text-[#cbd5e1] ${
                          mine ? "justify-end" : ""
                        } ${floating ? "[text-shadow:0_1px_2px_rgba(0,0,0,0.4)]" : ""}`}
                      >
                        <span>{roleLabels[message.role]}</span>
                        {message.createdAt ? (
                          <span className="text-[10px] font-normal tabular-nums text-[#64748b] dark:text-[#94a3b8]">
                            {formatClock(message.createdAt)}
                          </span>
                        ) : null}
                      </div>

                      {/* Main Content Box */}
                      <div
                        className={`flex flex-col gap-2 rounded-2xl p-3.5 ${fontSizeClass} leading-relaxed transition-all shadow-sm ${
                          mine
                            ? floating
                              ? "rounded-br-none border border-[#6366f1]/50 bg-[#4338ca] font-medium text-white"
                              : "rounded-br-none bg-[#4f46e5] font-medium text-white"
                            : assistant
                              ? floating
                                ? "rounded-bl-none border-2 border-[#818cf8] bg-[#312e81] font-semibold text-white shadow-md"
                                : "rounded-bl-none border border-[#c7d2fe] bg-[#eef2ff] font-semibold text-[#0f172a] dark:border-[#6366f1] dark:bg-[#312e81] dark:text-[#f8fafc]"
                              : floating
                                ? "rounded-bl-none border border-slate-300 bg-white font-medium text-slate-900 dark:border-[#475569] dark:bg-[#1e293b] dark:text-white"
                                : "rounded-bl-none border border-[#e2e8f0] bg-white text-[#1e293b] dark:border-[#334155] dark:bg-[#1e293b] dark:text-[#f8fafc]"
                        }`}
                      >
                        {/* Highlighted Takeaways for AI Assistant */}
                        {assistant && keyTakeaways.length > 0 && (
                          <div
                            className={`mb-1 rounded-xl border p-2.5 text-xs shadow-xs ${
                              floating
                                ? "border-[#a5b4fc]/50 bg-white text-[#1e1b4b]"
                                : "border-[#a5b4fc]/60 bg-white text-[#1e1b4b] dark:border-[#6366f1]/50 dark:bg-[#0f172a] dark:text-[#e0e7ff]"
                            }`}
                          >
                            <div
                              className={`flex items-center justify-between font-bold ${
                                floating ? "text-[#4338ca]" : "text-[#4338ca] dark:text-[#c7d2fe]"
                              }`}
                            >
                              <div className="flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-[#6366f1]" />
                                <span>核心提示词 (Key Points)</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleTakeawayCollapse(message.id)}
                                className={`rounded p-0.5 text-[#6366f1] ${
                                  floating ? "hover:bg-[#e0e7ff]" : "hover:bg-[#e0e7ff] dark:hover:bg-[#312e81]"
                                }`}
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
                                    <span className="font-bold text-[#6366f1]">•</span>
                                    <span className="font-semibold leading-relaxed">{point}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}

                        <div
                          className={`min-w-0 flex-1 whitespace-pre-wrap leading-relaxed ${
                            assistant
                              ? floating
                                ? "text-white"
                                : "text-[#0f172a] dark:text-[#f8fafc]"
                              : ""
                          }`}
                        >
                          {message.text}
                        </div>

                        {/* Copy Helper for Assistant */}
                        {assistant && (
                          <div
                            className={`mt-1 flex items-center justify-between border-t pt-2 text-xs ${
                              floating
                                ? "border-white/20"
                                : "border-[#c7d2fe]/50 dark:border-[#6366f1]/40"
                            }`}
                          >
                            <span
                              className={`text-[10px] ${
                                floating ? "text-[#c7d2fe]" : "text-[#4f46e5] dark:text-[#c7d2fe]"
                              }`}
                            >
                              推荐提示
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(message.id, message.text)}
                              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium shadow-xs ${
                                floating
                                  ? "bg-white text-[#4338ca] hover:bg-[#e0e7ff]"
                                  : "bg-white text-[#4f46e5] hover:bg-[#e0e7ff] dark:bg-[#1e1b4b] dark:text-[#c7d2fe]"
                              }`}
                              aria-label={t("copilot.copySuggestion")}
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" />
                                  <span className="text-emerald-600">已复制</span>
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
            className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 rounded-full bg-[#6366f1] px-3 py-1.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:bg-[#4f46e5] animate-bounce"
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
              ? "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
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
              ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
              : copilot.archiveStatus === "saved"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          }`}
          role={copilot.archiveStatus === "error" ? "alert" : "status"}
        >
          {copilot.archiveStatus === "saving"
            ? t("copilot.archive.saving")
            : t(copilot.archiveNotice || "copilot.archive.saved")}
        </div>
      )}

      {copilot.error && (
        <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300" role="alert">
          {copilot.error}
        </div>
      )}

      {/* Follow-up Form */}
      <form className="mt-2 flex gap-2" onSubmit={submitFollowUp}>
        <input
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={t("copilot.followUp")}
          className={`min-w-0 flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2 text-xs outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/20 dark:border-[#334155] dark:text-[#f8fafc] ${
            floating ? "bg-white/90 dark:bg-[#0f172a]/90 font-medium" : "bg-white dark:bg-[#0f172a]"
          }`}
          disabled={!running}
          aria-label={t("copilot.followUp")}
        />
        <button
          type="submit"
          className="rounded-xl bg-[#6366f1] px-3 py-2 text-xs font-medium text-white shadow-xs disabled:opacity-40"
          disabled={!running || !followUp.trim()}
        >
          {t("copilot.ask")}
        </button>
      </form>

      {/* Control Buttons Footer */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[#e2e8f0] pt-2.5 dark:border-[#334155]">
        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: "toggle" })}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-colors disabled:opacity-60 ${
            running ? "bg-rose-500 hover:bg-rose-600" : "bg-[#6366f1] hover:bg-[#4f46e5]"
          }`}
        >
          {running ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {running ? t("copilot.stopCapture") : t("copilot.startCapture")}
        </button>

        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: "retry" })}
          disabled={!running || !copilot.question}
          className={`flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-2.5 py-1.5 text-xs text-[#475569] hover:bg-[#f8fafc] disabled:opacity-40 dark:border-[#334155] dark:text-[#94a3b8] dark:hover:bg-[#1e293b] ${
            floating ? "bg-white/80 dark:bg-[#0f172a]/80" : "bg-white dark:bg-[#0f172a]"
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t("copilot.retry")}
        </button>

        <button
          type="button"
          onClick={() => void sendCopilotCommand({ type: "clear" })}
          className={`flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-2.5 py-1.5 text-xs text-[#475569] hover:bg-[#f8fafc] dark:border-[#334155] dark:text-[#94a3b8] dark:hover:bg-[#1e293b] ${
            floating ? "bg-white/80 dark:bg-[#0f172a]/80" : "bg-white dark:bg-[#0f172a]"
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("copilot.clear")}
        </button>

        {!floating && onExportRecording && (
          <button
            type="button"
            onClick={onExportRecording}
            disabled={!canExportRecording}
            className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs text-[#475569] hover:bg-[#f8fafc] disabled:opacity-40 dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#94a3b8] dark:hover:bg-[#1e293b]"
          >
            <Download className="h-3.5 w-3.5" /> {t("copilot.exportRecording")}
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 text-[10px] text-[#64748b] dark:text-[#94a3b8]">
          <span className={`flex items-center gap-1 rounded-full px-2 py-1 ${windowStatus?.protection_applied ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}`} title={t("copilot.protection.caveat")}>
            <Shield className="h-3 w-3" /> {protectionLabel}
          </span>
        </div>
      </div>

      {(copilot.capabilityNotice || windowStatus?.error) && (
        <div className="mt-2 text-[10px]">
          {copilot.capabilityNotice && <div className="text-amber-700 dark:text-amber-400">{copilot.capabilityNotice}</div>}
          {windowStatus?.error && <div className="text-red-600 dark:text-red-400">{windowStatus.error}</div>}
        </div>
      )}
    </section>
  )
}
