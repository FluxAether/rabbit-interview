import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, Check, ChevronDown, ChevronUp, Clipboard, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Virtuoso, type ListItem, type VirtuosoHandle } from "react-virtuoso"
import { shallow } from "zustand/vanilla/shallow"
import { useTranslation } from "../i18n"
import { extractKeyTakeaways, groupCopilotMessages } from "../lib/copilotPresentation"
import { sendCopilotCommand } from "../lib/copilotSession"
import type { CopilotMessage } from "../lib/copilotSessionState"
import type { CopilotFontSize } from "../lib/settingsStore"

const fontClasses = { sm: "text-sm", base: "text-base", lg: "text-lg" }
const groupKey = (_index: number, group: CopilotMessage[]) => group[0].id

const CopilotMessageRow = memo(function CopilotMessageRow({ message, fontSize, running, isRegenerating, expanded, onExpand }: {
  message: CopilotMessage
  fontSize: CopilotFontSize
  running: boolean
  isRegenerating: boolean
  expanded: boolean
  onExpand: (id: number) => void
}) {
  const t = useTranslation()
  const mine = message.role === "me"
  const assistant = message.role === "assistant"
  const isGeneratingAnswer = assistant && !message.text
  const canCollapse = assistant && (message.text.length > 280 || message.text.split("\n").length > 8)
  const keyTakeaways = useMemo(() => assistant ? extractKeyTakeaways(message.text) : [], [assistant, message.text])
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
  const copy = () => {
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    }).catch((error) => console.warn("Unable to copy suggestion", error))
  }
  const date = new Date(message.createdAt)
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-message-id={message.id}>
      <article className="min-w-0 max-w-[min(92%,80ch)]">
        <div className={`mb-1 flex items-center gap-2 px-1 text-xs text-[var(--text-muted)] ${mine ? "justify-end" : ""}`}>
          <span className={assistant ? "font-semibold text-[var(--text-main)]" : "font-medium"}>{t(`copilot.role.${message.role}`)}</span>
          {message.createdAt ? <time className="text-[11px] tabular-nums" dateTime={date.toISOString()}>{clock}</time> : null}
        </div>
        <div className={`flex flex-col gap-2 ${fontClasses[fontSize]} leading-7 ${mine
          ? "rounded-lg rounded-br-sm bg-[var(--action)] px-3.5 py-2.5 text-[var(--action-text)]"
          : assistant
            ? "rounded-lg rounded-bl-sm border border-[var(--border-strong)] border-l-2 border-l-[var(--action)] bg-[var(--bg-hover)] px-3.5 py-2.5 text-[var(--text-main)]"
            : "rounded-lg rounded-bl-sm border border-[var(--border-color)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-[var(--text-main)]"}`}>
          <div id={`copilot-answer-${message.id}`} className="min-w-0 break-words">
            {isGeneratingAnswer ? (
              <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t("copilot.answer.generating")}
              </span>
            ) : canCollapse && !expanded && keyTakeaways.length > 0 ? (
              <ul className="space-y-1">
                {keyTakeaways.map((point, index) => <li key={index} className="flex gap-2"><span aria-hidden="true">•</span><span>{point}</span></li>)}
              </ul>
            ) : (
              <div className={`whitespace-pre-wrap ${canCollapse && !expanded ? "line-clamp-6" : ""}`}>{message.text}</div>
            )}
          </div>
          {canCollapse && (
            <button type="button" onClick={() => onExpand(message.id)}
              className="flex min-h-8 items-center gap-1 self-start rounded px-2 text-xs font-medium hover:bg-[var(--bg-subtle)]"
              aria-expanded={expanded} aria-controls={`copilot-answer-${message.id}`}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {t(expanded ? "copilot.collapseAnswer" : "copilot.expandAnswer")}
            </button>
          )}
          {message.role === "interviewer" && (
            <div className="flex justify-end border-t border-[var(--border-color)] pt-1">
              <button type="button" onClick={() => void sendCopilotCommand({ type: "retry", messageId: message.id })}
                disabled={!running || isRegenerating}
                className="flex min-h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40">
                {isRegenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {t("copilot.retry")}
              </button>
            </div>
          )}
          {assistant && !isGeneratingAnswer && (
            <div className="flex items-center justify-between border-t border-[var(--border-color)] pt-1 text-xs text-[var(--text-muted)]">
              <span>{t("copilot.suggestedHint")}</span>
              <button type="button" onClick={copy} className="flex min-h-8 items-center gap-1 rounded-md px-2 hover:bg-[var(--bg-subtle)]" aria-label={t("copilot.copySuggestion")}>
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Clipboard className="h-3.5 w-3.5" />}
                {t(copied ? "copilot.copied" : "copilot.copySuggestion")}
              </button>
            </div>
          )}
        </div>
      </article>
    </div>
  )
})

export default memo(function CopilotChat({ messages, showMyBubbles, fontSize, running, generatingReplyToIds, floating }: {
  messages: CopilotMessage[]
  showMyBubbles: boolean
  fontSize: CopilotFontSize
  running: boolean
  generatingReplyToIds: number[]
  floating: boolean
  visible: boolean
}) {
  const t = useTranslation()
  const groups = useMemo(() => groupCopilotMessages(messages, showMyBubbles), [messages, showMyBubbles])
  const list = useRef<VirtuosoHandle>(null)
  const following = useRef(true)
  const scroller = useRef<HTMLElement | null>(null)
  const rendered = useRef<ListItem<CopilotMessage[]>[]>([])
  const readingAnchor = useRef<{ id: number; offset: number } | null>(null)
  const setScroller = useCallback((element: HTMLElement | Window | null) => {
    scroller.current = element instanceof HTMLElement ? element : null
  }, [])
  const rememberPosition = useCallback(() => {
    if (!scroller.current) return
    const top = scroller.current.scrollTop
    const item = rendered.current.find((entry) => entry.offset + entry.size > top)
    readingAnchor.current = item?.data ? { id: item.data[0].id, offset: item.offset - top } : null
  }, [])
  const onItemsRendered = useCallback((items: ListItem<CopilotMessage[]>[]) => {
    rendered.current = items
    const anchor = readingAnchor.current
    if (!following.current && anchor && scroller.current) {
      const item = items.find((entry) => entry.data?.[0].id === anchor.id)
      if (item) {
        // A late reply can resize a measured group above a stationary reader.
        const delta = item.offset - anchor.offset - scroller.current.scrollTop
        if (Math.abs(delta) > 1) list.current?.scrollBy({ top: delta, behavior: "auto" })
        return
      }
    }
    rememberPosition()
  }, [rememberPosition])
  const knownIds = useRef(new Set(messages.map((message) => message.id)))
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [unread, setUnread] = useState(0)
  const unreadIds = useRef(new Set<number>())
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const onExpand = useCallback((id: number) => setExpanded((previous) => ({ ...previous, [id]: !previous[id] })), [])
  const onBottom = useCallback((atBottom: boolean) => {
    following.current = atBottom
    setIsAtBottom(atBottom)
    if (atBottom) { unreadIds.current.clear(); setUnread(0); readingAnchor.current = null }
  }, [])

  useEffect(() => {
    const visible = new Set(messages.filter((message) => showMyBubbles || message.role !== "me").map((message) => message.id))
    if (following.current) unreadIds.current.clear()
    else for (const id of visible) if (!knownIds.current.has(id)) unreadIds.current.add(id)
    for (const id of unreadIds.current) if (!visible.has(id)) unreadIds.current.delete(id)
    knownIds.current = new Set(messages.map((message) => message.id))
    setUnread(unreadIds.current.size)
  }, [messages, showMyBubbles])

  useLayoutEffect(() => {
    // Virtuoso measures changing row heights; arm its bottom-follow before ResizeObserver runs.
    if (following.current) list.current?.autoscrollToBottom()
  }, [messages, expanded, fontSize])

  const renderGroup = useCallback((_index: number, group: CopilotMessage[]) => (
    <div className="space-y-1 px-3 py-2">
      {group.map((message) => <CopilotMessageRow key={message.id} message={message}
        fontSize={fontSize} running={running} isRegenerating={generatingReplyToIds.includes(message.id)}
        expanded={expanded[message.id] ?? false} onExpand={onExpand} />)}
    </div>
  ), [fontSize, running, generatingReplyToIds, expanded, onExpand])

  const scrollToBottom = () => {
    following.current = true
    readingAnchor.current = null
    unreadIds.current.clear()
    setUnread(0)
    list.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" role="region" aria-label={t("copilot.chat.label")}>
      {groups.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-xs text-[var(--text-muted)]">
          <Sparkles className="mb-2 h-7 w-7 opacity-40" />{t("copilot.chat.empty")}
        </div>
      ) : (
        <Virtuoso ref={list} className={`min-h-0 flex-1 overscroll-contain rounded-lg ${floating ? "bg-[var(--bg-sidebar)]" : "bg-[var(--bg-surface)]"}`}
          data={groups} computeItemKey={groupKey} itemContent={renderGroup}
          scrollerRef={setScroller} onScroll={rememberPosition} itemsRendered={onItemsRendered}
          initialTopMostItemIndex={{ index: "LAST", align: "end" }}
          followOutput="auto" atBottomThreshold={25} atBottomStateChange={onBottom}
          increaseViewportBy={{ top: 300, bottom: 300 }} />
      )}
      {!isAtBottom && groups.length > 0 && (
        <button type="button" onClick={scrollToBottom} title={t("copilot.readingHistory")}
          className="absolute bottom-3 right-3 z-10 flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-hover)]">
          <ArrowDown className="h-3.5 w-3.5" />
          <span aria-live="polite" aria-atomic="true">{unread > 0 ? t("copilot.unreadMessages", { count: unread }) : t("copilot.backToLatest")}</span>
        </button>
      )}
    </div>
  )
}, (previous, next) => !next.visible || shallow(previous, next))
