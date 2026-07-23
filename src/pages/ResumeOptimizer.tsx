import { useEffect, useRef, useState } from "react"
import { Download, FileText, LoaderCircle, Trash2, Upload, Sparkles, AlertCircle } from "lucide-react"
import { useDropzone, type FileRejection } from "react-dropzone"
import { useCurrentLanguage, useTranslation } from "../i18n"
import { downloadResumeDocx, sanitizeResumeFilename } from "../lib/resumeDocuments"
import {
  MAX_RESUME_FILE_SIZE,
  extractResumeText,
  validateResumeFile,
  type ResumeFileValidationError,
} from "../lib/resumeImport"
import {
  countResumeWords,
  createResumeAnalysisRequestCoordinator,
  type ResumeSuggestion,
  type ResumeSuggestionCategory,
} from "../lib/resumeOptimizer"
import { optimizeResumeWithLlm } from "../lib/resumeOptimizerAi"
import {
  clearResumeWorkspace as clearSavedResumeWorkspace,
} from "../lib/resumeWorkspaceStore"
import { useAppStore } from "../stores/useAppStore"

const SAMPLE_RESUME = `Alex Morgan
Product Designer

EXPERIENCE
I was responsible for product onboarding and design system improvements.
• Improved collaboration between design and engineering teams.

SKILLS
Product design • Figma • User research`

type PageStatus = { kind: "error" | "success" | "warning"; text: string } | null

export default function ResumeOptimizer() {
  const {
    resumeOriginal,
    resumeOptimized,
    jobDescription,
    resumeSuggestions,
    resumeSourceFileName,
    resumeMatchedKeywords,
    resumeMissingKeywords,
    resumeHydrated,
    resumePersistenceError,
    updateResumeWorkspace,
    setResumeAnalysis,
    clearResumeWorkspace,
  } = useAppStore()
  const t = useTranslation()
  const language = useCurrentLanguage()
  const [isParsing, setIsParsing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [status, setStatus] = useState<PageStatus>(null)
  const [reviewedOptimizedText, setReviewedOptimizedText] = useState("")
  const [viewMode, setViewMode] = useState<"split" | "diff">("split")
  const analysisRequests = useRef(createResumeAnalysisRequestCoordinator())

  useEffect(() => () => analysisRequests.current.cancel(), [])

  const validationMessage = (error: ResumeFileValidationError) => t(`resume.upload.${error}`)

  const handleAcceptedFile = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const validationError = validateResumeFile(file)
    if (validationError) {
      setStatus({ kind: "error", text: validationMessage(validationError) })
      return
    }

    analysisRequests.current.cancel()
    setIsAnalyzing(false)
    setIsParsing(true)
    setStatus(null)
    try {
      const result = await extractResumeText(file)
      updateResumeWorkspace({
        original: result.text,
        optimized: "",
        suggestions: [],
        sourceFileName: file.name,
        matchedKeywords: [],
        missingKeywords: [],
      })
      setReviewedOptimizedText("")
      setStatus({
        kind: result.warnings.length ? "warning" : "success",
        text: result.warnings.length
          ? `${t("resume.importWarning")} ${result.warnings.join("; ")}`
          : t("resume.importSuccess"),
      })
    } catch (error) {
      console.warn("Failed to import resume", error)
      setStatus({
        kind: "error",
        text: t(error instanceof Error && error.message === "resume-text-too-long"
          ? "resume.textTooLong"
          : "resume.importError"),
      })
    } finally {
      setIsParsing(false)
    }
  }

  const handleRejectedFile = (rejections: FileRejection[]) => {
    const code = rejections[0]?.errors[0]?.code
    const key = code === "file-too-large"
      ? "resume.upload.file-too-large"
      : code === "too-many-files"
        ? "resume.upload.too-many-files"
        : "resume.upload.unsupported-file-type"
    setStatus({ kind: "error", text: t(key) })
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted: handleAcceptedFile,
    onDropRejected: handleRejectedFile,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    maxFiles: 1,
    maxSize: MAX_RESUME_FILE_SIZE,
    multiple: false,
    disabled: isParsing || isAnalyzing || isExporting || !resumeHydrated,
  })

  const runAnalysis = async (source: string) => {
    if (!source.trim()) {
      setStatus({ kind: "error", text: t("resume.missingResume") })
      return
    }
    const request = analysisRequests.current.start()
    setIsAnalyzing(true)
    setReviewedOptimizedText("")
    setStatus(null)
    try {
      const result = await optimizeResumeWithLlm(source, jobDescription, language, request.signal)
      if (!request.isLatest()) return
      setResumeAnalysis(result)
      setStatus({ kind: "success", text: t("resume.analysisComplete") })
    } catch (error) {
      if (!request.isLatest()) return
      console.warn("Failed to optimize resume with LLM", error)
      const key = request.signal.aborted
        ? "resume.analysisTimeout"
        : error instanceof Error && error.message === "resume-text-too-long"
          ? "resume.textTooLong"
          : "resume.analysisError"
      setStatus({ kind: "error", text: t(key) })
    } finally {
      const latest = request.isLatest()
      request.finish()
      if (latest) setIsAnalyzing(false)
    }
  }

  const handleExport = async () => {
    if (!resumeOptimized.trim()) {
      setStatus({ kind: "error", text: t("resume.missingOptimized") })
      return
    }
    if (reviewedOptimizedText !== resumeOptimized) {
      setStatus({ kind: "error", text: t("resume.factReviewRequired") })
      return
    }
    setIsExporting(true)
    setStatus(null)
    try {
      await downloadResumeDocx(resumeOptimized, sanitizeResumeFilename(resumeSourceFileName))
      setStatus({ kind: "success", text: t("resume.exportSuccess") })
    } catch (error) {
      console.warn("Failed to export resume", error)
      setStatus({ kind: "error", text: t("resume.exportError") })
    } finally {
      setIsExporting(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm(t("resume.clearConfirm"))) return
    setReviewedOptimizedText("")
    clearResumeWorkspace()
    try {
      await clearSavedResumeWorkspace()
      setStatus({ kind: "success", text: t("resume.cleared") })
    } catch {
      setStatus({ kind: "error", text: t("resume.persistenceError") })
    }
  }

  const useSample = () => {
    updateResumeWorkspace({
      original: SAMPLE_RESUME,
      optimized: "",
      suggestions: [],
      sourceFileName: "sample-resume.docx",
      matchedKeywords: [],
      missingKeywords: [],
    })
    setReviewedOptimizedText("")
    setStatus({ kind: "success", text: t("resume.sampleLoaded") })
  }

  const handleApplySuggestion = (suggestion: ResumeSuggestion) => {
    let newOptimized = resumeOptimized
    if (suggestion.replacement) {
      if (newOptimized.includes(suggestion.replacement.before)) {
        newOptimized = newOptimized.replace(suggestion.replacement.before, suggestion.replacement.after)
      } else {
        newOptimized = newOptimized ? `${newOptimized}\n• ${suggestion.replacement.after}` : suggestion.replacement.after
      }
    } else {
      const textToAppend = suggestion.description || suggestion.title
      if (textToAppend && !newOptimized.includes(textToAppend)) {
        newOptimized = newOptimized ? `${newOptimized}\n• ${textToAppend}` : textToAppend
      }
    }
    const updatedSuggestions = resumeSuggestions.map((s) =>
      s.id === suggestion.id ? { ...s, applied: true } : s
    )
    updateResumeWorkspace({
      optimized: newOptimized,
      suggestions: updatedSuggestions,
    })
  }

  const computeLineDiff = (original: string, optimized: string) => {
    const origLines = original.split("\n")
    const optLines = optimized.split("\n")
    const origSet = new Set(origLines.map((l) => l.trim()).filter(Boolean))
    const optSet = new Set(optLines.map((l) => l.trim()).filter(Boolean))

    const result: { type: "same" | "removed" | "added"; text: string }[] = []
    let i = 0
    let j = 0
    while (i < origLines.length || j < optLines.length) {
      if (i < origLines.length && j < optLines.length && origLines[i] === optLines[j]) {
        result.push({ type: "same", text: origLines[i] })
        i++
        j++
      } else if (i < origLines.length && !optSet.has(origLines[i].trim())) {
        result.push({ type: "removed", text: origLines[i] })
        i++
      } else if (j < optLines.length && !origSet.has(optLines[j].trim())) {
        result.push({ type: "added", text: optLines[j] })
        j++
      } else {
        if (i < origLines.length) {
          result.push({ type: "removed", text: origLines[i] })
          i++
        }
        if (j < optLines.length) {
          result.push({ type: "added", text: optLines[j] })
          j++
        }
      }
    }
    return result
  }

  const categoryLabel = (category: ResumeSuggestionCategory) => t(`resume.category.${category}`)
  const busy = !resumeHydrated || isParsing || isAnalyzing || isExporting
  const factsReviewed = Boolean(resumeOptimized.trim()) && reviewedOptimizedText === resumeOptimized

  return (
    <div className="w-full p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="text-lg font-medium text-[#6366f1]">{t("resume.title")}</div>
          <div className="rounded bg-[#6366f1] px-2 py-px text-xs text-white">{t("resume.badge")}</div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleClear} disabled={busy} className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-3 py-1.5 text-sm dark:border-[#334155] disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {t("resume.clear")}
          </button>
          <div className="relative group">
            <button
              type="button"
              onClick={handleExport}
              disabled={busy || !factsReviewed}
              className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-4 py-1.5 text-sm dark:border-[#334155] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t("resume.export")}
            </button>
            {!factsReviewed && resumeOptimized.trim() && (
              <div className="absolute right-0 top-full mt-2 hidden w-64 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 shadow-lg group-hover:block dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 z-10">
                <div className="font-semibold mb-1 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5 text-amber-600" /> 导出未解锁</div>
                {t("resume.factReviewRequired")}
              </div>
            )}
          </div>
        </div>
      </div>

      {(status || resumePersistenceError) && (
        <div
          role={status?.kind === "error" || resumePersistenceError ? "alert" : "status"}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            status?.kind === "error" || resumePersistenceError
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
              : status?.kind === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
          }`}
        >
          {resumePersistenceError ? t("resume.persistenceError") : status?.text}
        </div>
      )}

      {resumeOptimized.trim() && !factsReviewed && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-semibold">未完成事实核对确认：</span>
              <span>导出功能目前已锁定。请在下方核对优化内容后勾选“事实核对确认”复选框。</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReviewedOptimizedText(resumeOptimized)}
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
          >
            一键确认核对
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4">
        <section className="card p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4" /> {t("resume.upload.title")}</div>
          <div {...getRootProps()} className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#cbd5e1] text-center dark:border-[#475569] ${isDragActive ? "bg-[#f8fafc] dark:bg-[#0f172a]" : ""} ${isParsing ? "cursor-wait opacity-60" : ""}`}>
            <input {...getInputProps()} />
            {isParsing ? <LoaderCircle className="mb-2 h-8 w-8 animate-spin text-[#6366f1]" /> : <FileText className="mb-2 h-8 w-8 text-[#64748b] dark:text-[#94a3b8]" />}
            <div className="text-sm">{isParsing ? t("resume.upload.parsing") : isDragActive ? t("resume.upload.drop") : t("resume.upload.choose")}</div>
            <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{resumeSourceFileName || t("resume.upload.hint")}</div>
          </div>
          <button type="button" onClick={useSample} disabled={busy} className="mt-4 w-full rounded-2xl bg-[#6366f1] py-2 text-sm text-white disabled:opacity-50">{t("common.useSample")}</button>
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> {t("resume.jd.title")}</span>
            <span className="text-xs font-normal text-[#64748b] dark:text-[#94a3b8]">{jobDescription.length}/5000</span>
          </div>
          <textarea
            value={jobDescription}
            maxLength={5000}
            disabled={busy}
            onChange={(event) => updateResumeWorkspace({ jobDescription: event.target.value })}
            className="h-36 w-full rounded-xl border border-[#e2e8f0] p-3 text-sm disabled:opacity-60"
            placeholder={t("resume.jd.placeholder")}
          />
          <button type="button" onClick={() => runAnalysis(resumeOriginal)} disabled={busy || !resumeOriginal.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6366f1] py-2 text-sm text-white disabled:opacity-50">
            {isAnalyzing && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isAnalyzing ? t("common.analyzing") : t("common.analyze")}
          </button>
        </section>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-[#f1f5f9] p-1 dark:bg-[#1e293b]">
          <button
            type="button"
            onClick={() => setViewMode("split")}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
              viewMode === "split"
                ? "bg-white text-[#6366f1] shadow-sm dark:bg-[#0f172a] dark:text-[#818cf8]"
                : "text-[#64748b] hover:text-[#0f172a] dark:text-[#94a3b8] dark:hover:text-white"
            }`}
          >
            左右对比 (Split View)
          </button>
          <button
            type="button"
            onClick={() => setViewMode("diff")}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
              viewMode === "diff"
                ? "bg-white text-[#6366f1] shadow-sm dark:bg-[#0f172a] dark:text-[#818cf8]"
                : "text-[#64748b] hover:text-[#0f172a] dark:text-[#94a3b8] dark:hover:text-white"
            }`}
          >
            差异对比 (Diff View)
          </button>
        </div>
      </div>

      {viewMode === "diff" ? (
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between text-sm">
            <div className="font-medium text-[#334155] dark:text-[#e2e8f0]">修改差异对比 (Diff View)</div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500" /> 原文删改
              </span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> 优化精进/新增
              </span>
            </div>
          </div>
          <div className="max-h-[400px] min-h-[260px] overflow-auto rounded-xl border border-[#e2e8f0] bg-[#fafafa] p-4 text-sm font-mono leading-relaxed dark:border-[#334155] dark:bg-[#0f172a]">
            {computeLineDiff(resumeOriginal, resumeOptimized).map((line, idx) => (
              <div
                key={idx}
                className={`px-2 py-0.5 whitespace-pre-wrap rounded ${
                  line.type === "removed"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 line-through"
                    : line.type === "added"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-medium"
                      : "text-[#475569] dark:text-[#94a3b8]"
                }`}
              >
                {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}
                {line.text}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <section className="card p-5">
            <div className="mb-2 flex justify-between text-sm">
              <div>{t("resume.original")} <span className="rounded bg-[#e2e8f0] px-1.5 text-xs dark:bg-[#334155]">v1</span></div>
              <div className="text-[#64748b] dark:text-[#94a3b8]">{t("resume.wordCount")}: {countResumeWords(resumeOriginal)}</div>
            </div>
            <div className="max-h-[360px] min-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#e2e8f0] bg-[#fafafa] p-4 text-sm leading-relaxed text-[#334155] dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#e2e8f0]">
              {resumeOriginal || t("resume.originalPlaceholder")}
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-2 flex justify-between text-sm">
              <div>{t("resume.optimized")} <span className="rounded bg-[#e0e7ff] px-1.5 text-xs text-[#4338ca] dark:bg-[#312e81] dark:text-[#a5b4fc]">v2</span></div>
              <div className="flex items-center gap-3">
                <span className="text-[#64748b] dark:text-[#94a3b8]">{t("resume.wordCount")}: {countResumeWords(resumeOptimized)}</span>
                <button type="button" onClick={() => runAnalysis(resumeOptimized || resumeOriginal)} disabled={busy || !(resumeOptimized || resumeOriginal).trim()} className="text-xs text-[#6366f1] disabled:opacity-40">{t("common.reoptimize")}</button>
              </div>
            </div>
            <textarea
              value={resumeOptimized}
              disabled={busy}
              onChange={(event) => updateResumeWorkspace({ optimized: event.target.value })}
              className="min-h-[260px] w-full resize-y rounded-xl border bg-white p-4 text-sm leading-relaxed disabled:opacity-60 dark:bg-[#0f172a] dark:border-[#334155]"
              placeholder={t("resume.optimizedPlaceholder")}
              aria-label={t("resume.optimized")}
            />
            <div
              className={`mt-3 rounded-xl border p-3 transition-colors ${
                !factsReviewed && resumeOptimized.trim()
                  ? "border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  : "border-[#e2e8f0] bg-[#f8fafc] dark:border-[#334155] dark:bg-[#0f172a]"
              }`}
            >
              <label className="flex items-start gap-2.5 text-xs leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={factsReviewed}
                  disabled={busy || !resumeOptimized.trim()}
                  onChange={(event) => setReviewedOptimizedText(event.target.checked ? resumeOptimized : "")}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#6366f1] focus:ring-[#6366f1]"
                />
                <div>
                  <span className="font-medium">
                    {!factsReviewed && resumeOptimized.trim() ? "⚠️ [导出前必读] 事实核对确认" : "事实核对确认"}
                  </span>
                  <p className="mt-0.5 text-[11px] opacity-90">{t("resume.factReviewConfirm")}</p>
                </div>
              </label>
            </div>
          </section>
        </div>
      )}

      <section className="card mt-4 p-5">
        <div>
          <div>
            <div className="font-medium">{t("resume.suggestions")}</div>
            {jobDescription.trim() && (
              <div className="mt-1 text-xs text-[#64748b] dark:text-[#94a3b8]">
                {t("resume.keywordMatch")}: {resumeMatchedKeywords.length} · {t("resume.keywordMissing")}: {resumeMissingKeywords.length}
              </div>
            )}
          </div>
        </div>
        {resumeSuggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#64748b] dark:text-[#94a3b8]">{t("resume.noSuggestions")}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {resumeSuggestions.map((suggestion) => (
              <article key={suggestion.id} className="rounded-xl border border-[#e2e8f0] bg-white p-3 dark:border-[#334155] dark:bg-[#0f172a]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-[#6366f1]">{categoryLabel(suggestion.category)}</div>
                    <div className="mt-1 text-sm font-medium">{suggestion.title ?? t(suggestion.titleKey ?? "")}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs ${suggestion.applied ? "text-[#047857] dark:text-emerald-400" : "text-[#b45309] dark:text-amber-400"}`}>
                      {t(suggestion.applied ? "resume.includedInDraft" : "resume.manualRequired")}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleApplySuggestion(suggestion)}
                      disabled={busy || suggestion.applied}
                      className="flex items-center gap-1 rounded-lg bg-[#6366f1] px-2.5 py-1 text-xs text-white hover:bg-[#4f46e5] disabled:opacity-40"
                    >
                      <Sparkles className="h-3 w-3" />
                      {suggestion.applied ? "已应用" : "一键应用"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b] dark:text-[#94a3b8]">{suggestion.description ?? t(suggestion.descriptionKey ?? "", suggestion.descriptionParams)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 text-center text-xs text-[#64748b] dark:text-[#94a3b8]">{t("resume.confidential")}</div>
    </div>
  )
}
