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
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      analysisRequests.current.cancel()
    }
  }, [])

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
      if (!isMounted.current) return
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
      if (!isMounted.current) return
      setStatus({
        kind: "error",
        text: t(error instanceof Error && error.message === "resume-text-too-long"
          ? "resume.textTooLong"
          : "resume.importError"),
      })
    } finally {
      if (isMounted.current) setIsParsing(false)
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
      if (!request.isLatest() || !isMounted.current) return
      setResumeAnalysis(result)
      setStatus({ kind: "success", text: t("resume.analysisComplete") })
    } catch (error) {
      if (!request.isLatest() || !isMounted.current) return
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
      if (latest && isMounted.current) setIsAnalyzing(false)
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
      if (!isMounted.current) return
      setStatus({ kind: "success", text: t("resume.exportSuccess") })
    } catch (error) {
      console.warn("Failed to export resume", error)
      if (!isMounted.current) return
      setStatus({ kind: "error", text: t("resume.exportError") })
    } finally {
      if (isMounted.current) setIsExporting(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm(t("resume.clearConfirm"))) return
    setReviewedOptimizedText("")
    clearResumeWorkspace()
    try {
      await clearSavedResumeWorkspace()
      if (!isMounted.current) return
      setStatus({ kind: "success", text: t("resume.cleared") })
    } catch {
      if (!isMounted.current) return
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
    if (!suggestion.replacement) return
    let newOptimized = resumeOptimized
    if (newOptimized.includes(suggestion.replacement.before)) {
      newOptimized = newOptimized.replace(suggestion.replacement.before, suggestion.replacement.after)
    } else {
      newOptimized = newOptimized ? `${newOptimized}\n• ${suggestion.replacement.after}` : suggestion.replacement.after
    }
    const updatedSuggestions = resumeSuggestions.map((s) =>
      s.id === suggestion.id ? { ...s, applied: true } : s
    )
    updateResumeWorkspace({
      optimized: newOptimized,
      suggestions: updatedSuggestions,
    })
  }

  const handleManualSuggestion = () => {
    setViewMode("split")
    const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label]')
    editor?.focus()
    editor?.scrollIntoView({ block: "center" })
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
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{t("resume.title")}</h1>
          <span className="border-l border-[var(--border-color)] pl-2 text-xs text-[var(--text-muted)]">{t("resume.badge")}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleClear} disabled={busy} className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {t("resume.clear")}
          </button>
          <div className="relative group">
            <button
              type="button"
              onClick={handleExport}
              disabled={busy || !factsReviewed}
              className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-1.5 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t("resume.export")}
            </button>
            {!factsReviewed && resumeOptimized.trim() && (
              <div className="absolute right-0 top-full z-10 mt-2 w-64 rounded-md border border-[var(--warning)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--warning)]">
                <div className="mb-1 flex items-center gap-1 font-semibold"><AlertCircle className="h-3.5 w-3.5" /> {t("resume.exportLocked")}</div>
                {t("resume.factReviewRequired")}
              </div>
            )}
          </div>
        </div>
      </div>

      {(status || resumePersistenceError) && (
        <div
          role={status?.kind === "error" || resumePersistenceError ? "alert" : "status"}
          className={`mb-4 rounded-md border bg-[var(--bg-subtle)] px-4 py-3 text-sm ${
            status?.kind === "error" || resumePersistenceError
              ? "border-[var(--danger)] text-[var(--danger)]"
              : status?.kind === "warning"
                ? "border-[var(--warning)] text-[var(--warning)]"
                : "border-[var(--success)] text-[var(--success)]"
          }`}
        >
          {resumePersistenceError ? t("resume.persistenceError") : status?.text}
        </div>
      )}

      {resumeOptimized.trim() && !factsReviewed && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-[var(--warning)] bg-[var(--bg-subtle)] p-4 text-sm text-[var(--warning)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <span className="font-semibold">{t("resume.factReviewPending")}</span>
              <span>{t("resume.factReviewLockNotice")}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleManualSuggestion}
            className="shrink-0 self-start rounded-md border border-[var(--warning)] px-3 py-1 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)] lg:self-auto"
          >
            {t("resume.startFactReview")}
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4" /> {t("resume.upload.title")}</div>
          <div {...getRootProps()} className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-[var(--border-color)] bg-[var(--bg-subtle)] text-center transition-colors hover:bg-[var(--bg-hover)] ${isDragActive ? "border-[var(--action)] bg-[var(--bg-hover)]" : ""} ${isParsing ? "cursor-wait opacity-60" : ""}`}>
            <input {...getInputProps()} />
            {isParsing ? <LoaderCircle className="mb-2 h-8 w-8 animate-spin text-[var(--action)]" /> : <FileText className="mb-2 h-8 w-8 text-[var(--text-muted)]" />}
            <div className="text-sm">{isParsing ? t("resume.upload.parsing") : isDragActive ? t("resume.upload.drop") : t("resume.upload.choose")}</div>
            <div className="text-xs text-[var(--text-muted)]">{resumeSourceFileName || t("resume.upload.hint")}</div>
          </div>
          <button type="button" onClick={useSample} disabled={busy} className="mt-4 w-full rounded-md border border-[var(--border-color)] py-2 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50">{t("common.useSample")}</button>
        </section>

        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="mb-4 flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> {t("resume.jd.title")}</span>
            <span className="text-xs font-normal text-[var(--text-muted)]">{jobDescription.length}/5000</span>
          </div>
          <textarea
            value={jobDescription}
            maxLength={5000}
            disabled={busy}
            aria-label={t("resume.jd.title")}
            onChange={(event) => updateResumeWorkspace({ jobDescription: event.target.value })}
            className="h-36 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)] disabled:opacity-60"
            placeholder={t("resume.jd.placeholder")}
          />
          <button type="button" onClick={() => runAnalysis(resumeOriginal)} disabled={busy || !resumeOriginal.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-[var(--action)] py-2 text-sm text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-50">
            {isAnalyzing && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isAnalyzing ? t("common.analyzing") : t("common.analyze")}
          </button>
        </section>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-[var(--border-color)]">
          <button
            type="button"
            onClick={() => setViewMode("split")}
            className={`border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "split"
                ? "border-[var(--action)] text-[var(--text-main)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {t("resume.viewSplit")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("diff")}
            disabled={!resumeOptimized.trim()}
            className={`border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "diff"
                ? "border-[var(--action)] text-[var(--text-main)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {t("resume.viewDiff")}
          </button>
        </div>
      </div>

      {viewMode === "diff" ? (
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="mb-3 flex items-center justify-between text-sm">
            <div className="font-medium">{t("resume.diffTitle")}</div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1 text-[var(--danger)]">
                <span className="h-2 w-2 bg-[var(--danger)]" /> {t("resume.diffRemoved")}
              </span>
              <span className="flex items-center gap-1 text-[var(--success)]">
                <span className="h-2 w-2 bg-[var(--success)]" /> {t("resume.diffAdded")}
              </span>
            </div>
          </div>
          <div className="max-h-[400px] min-h-[260px] overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-4 text-sm font-mono leading-relaxed">
            {computeLineDiff(resumeOriginal, resumeOptimized).map((line, idx) => (
              <div
                key={idx}
                className={`px-2 py-0.5 whitespace-pre-wrap ${
                  line.type === "removed"
                    ? "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)] line-through"
                    : line.type === "added"
                      ? "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] font-medium text-[var(--success)]"
                      : "text-[var(--text-muted)]"
                }`}
              >
                {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}
                {line.text}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <div>{t("resume.original")} <span className="border-l border-[var(--border-color)] pl-1.5 text-xs text-[var(--text-muted)]">v1</span></div>
              <div className="text-[var(--text-muted)]">{t("resume.wordCount")}: {countResumeWords(resumeOriginal)}</div>
            </div>
            <div className="max-h-[360px] min-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-4 text-sm leading-relaxed">
              {resumeOriginal || t("resume.originalPlaceholder")}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <div>{t("resume.optimized")} <span className="border-l border-[var(--border-color)] pl-1.5 text-xs text-[var(--action)]">v2</span></div>
              <div className="flex items-center gap-3">
                <span className="text-[var(--text-muted)]">{t("resume.wordCount")}: {countResumeWords(resumeOptimized)}</span>
                <button type="button" onClick={() => runAnalysis(resumeOptimized || resumeOriginal)} disabled={busy || !(resumeOptimized || resumeOriginal).trim()} className="text-xs text-[var(--action)] hover:underline disabled:opacity-40">{t("common.reoptimize")}</button>
              </div>
            </div>
            <textarea
              value={resumeOptimized}
              disabled={busy}
              onChange={(event) => updateResumeWorkspace({ optimized: event.target.value })}
              className="min-h-[260px] w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-sm leading-relaxed outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)] disabled:opacity-60"
              placeholder={t("resume.optimizedPlaceholder")}
              aria-label={t("resume.optimized")}
            />
            <div
              className={`mt-3 rounded-md border bg-[var(--bg-subtle)] p-3 transition-colors ${
                !factsReviewed && resumeOptimized.trim()
                  ? "border-[var(--warning)] text-[var(--warning)]"
                  : "border-[var(--border-color)]"
              }`}
            >
              <label className="flex items-start gap-2.5 text-xs leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={factsReviewed}
                  disabled={busy || !resumeOptimized.trim()}
                  onChange={(event) => setReviewedOptimizedText(event.target.checked ? resumeOptimized : "")}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-color)] text-[var(--action)] focus:ring-[var(--action)]"
                />
                <div>
                  <span className="font-medium">
                    {!factsReviewed && resumeOptimized.trim() ? t("resume.factReviewConfirmWarning") : t("resume.factReviewConfirmLabel")}
                  </span>
                  <p className="mt-0.5 text-[11px] opacity-90">{t("resume.factReviewConfirm")}</p>
                </div>
              </label>
            </div>
          </section>
        </div>
      )}

      <section className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
        <div>
          <div>
            <div className="font-medium">{t("resume.suggestions")}</div>
            {jobDescription.trim() && (
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("resume.keywordMatch")}: {resumeMatchedKeywords.length} · {t("resume.keywordMissing")}: {resumeMissingKeywords.length}
                {resumeMissingKeywords.length > 0 && (
                  <div className="mt-1">{resumeMissingKeywords.slice(0, 8).join(" · ")}</div>
                )}
              </div>
            )}
          </div>
        </div>
        {resumeSuggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">{t("resume.noSuggestions")}</p>
        ) : (
          <div className="mt-4 divide-y divide-[var(--border-color)] border-y border-[var(--border-color)]">
            {resumeSuggestions.map((suggestion) => (
              <article key={suggestion.id} className="py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs text-[var(--action)]">{categoryLabel(suggestion.category)}</div>
                    <div className="mt-1 text-sm font-medium">{suggestion.title ?? t(suggestion.titleKey ?? "")}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs ${suggestion.applied ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>
                      {t(suggestion.applied ? "resume.includedInDraft" : "resume.manualRequired")}
                    </span>
                    {suggestion.replacement ? (
                      <button
                        type="button"
                        onClick={() => handleApplySuggestion(suggestion)}
                        disabled={busy || suggestion.applied}
                        className="flex items-center gap-1 rounded-md bg-[var(--action)] px-2.5 py-1 text-xs text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        <Sparkles className="h-3 w-3" />
                        {suggestion.applied ? t("resume.applied") : t("resume.applyOneClick")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleManualSuggestion}
                        disabled={busy || suggestion.applied}
                        className="flex items-center gap-1 rounded-md border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                      >
                        {t("resume.manualFill")}
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{suggestion.description ?? t(suggestion.descriptionKey ?? "", suggestion.descriptionParams)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 text-center text-xs text-[var(--text-muted)]">{t("resume.confidential")}</div>
      </div>
    </div>
  )
}
