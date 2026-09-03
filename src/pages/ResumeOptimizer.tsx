import { useEffect, useMemo, useRef, useState } from "react"
import { Download, FileText, LoaderCircle, Trash2, Upload, Sparkles, AlertCircle, X, ShieldCheck } from "lucide-react"
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
  resumeTextFingerprint,
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

function resumeAnalysisErrorKey(error: unknown, aborted: boolean): string {
  if (aborted) return "resume.analysisTimeout"
  if (!(error instanceof Error)) return "resume.analysisError"
  if (error.message === "resume-text-too-long") return "resume.textTooLong"
  if (error.message === "llm-output-truncated") return "resume.analysisTruncated"
  if (error.message === "The LLM returned invalid JSON. Please retry." || error.message === "The LLM returned an empty response.") {
    return "resume.analysisInvalidResponse"
  }
  if (error.message === "The LLM returned an incomplete optimized resume.") return "resume.analysisIncomplete"
  if (error.message === "The LLM changed protected factual content.") return "resume.analysisFactConflict"
  if (error.message.startsWith("No LLM API key is configured")) return "resume.analysisMissingKey"
  return "resume.analysisError"
}

export default function ResumeOptimizer() {
  const {
    resumeOriginal,
    resumeOptimized,
    jobDescription,
    resumeSuggestions,
    resumeSourceFileName,
    resumeTargetKeywords,
    resumeRequirements,
    resumeMatchedKeywords,
    resumeAnalysisOriginalFingerprint,
    resumeAnalysisJobDescriptionFingerprint,
    resumeAnalysisSource,
    resumeTargetRole,
    resumeTargetCompany,
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
  const [viewMode, setViewMode] = useState<"split" | "diff" | "requirements">("split")
  const [syncScroll, setSyncScroll] = useState(true)
  const [activeDiffChange, setActiveDiffChange] = useState(0)
  const analysisRequests = useRef(createResumeAnalysisRequestCoordinator(120_000))
  const originalScrollRef = useRef<HTMLDivElement>(null)
  const optimizedEditorRef = useRef<HTMLTextAreaElement>(null)
  const isScrollingSync = useRef(false)
  const reviewSectionRef = useRef<HTMLDivElement>(null)
  const diffContainerRef = useRef<HTMLDivElement>(null)
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
    if ((resumeOptimized.trim() || resumeSuggestions.length > 0) && !window.confirm(t("resume.replaceConfirm"))) return

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
        requirements: [],
        targetKeywords: [],
        matchedKeywords: [],
        missingKeywords: [],
        analysisOriginalFingerprint: "",
        analysisJobDescriptionFingerprint: "",
        analysisSource: "",
      })
      setReviewedOptimizedText("")
      setViewMode("split")
      setActiveDiffChange(0)
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

  const runAnalysis = async (source: string, sourceKind: "original" | "optimized") => {
    if (!source.trim()) {
      setStatus({ kind: "error", text: t("resume.missingResume") })
      return
    }
    const request = analysisRequests.current.start()
    const originalFingerprint = resumeTextFingerprint(resumeOriginal)
    const jobDescriptionFingerprint = resumeTextFingerprint(jobDescription)
    setIsAnalyzing(true)
    setReviewedOptimizedText("")
    setStatus(null)
    try {
      const result = await optimizeResumeWithLlm(source, jobDescription, language, request.signal)
      if (!request.isLatest() || !isMounted.current) return
      setResumeAnalysis(result, {
        source: sourceKind,
        originalFingerprint,
        jobDescriptionFingerprint,
      })
      setViewMode("diff")
      setActiveDiffChange(0)
      setStatus({ kind: "success", text: t("resume.analysisComplete") })
    } catch (error) {
      if (!request.isLatest() || !isMounted.current) return
      console.warn("Failed to optimize resume with LLM", error)
      setStatus({ kind: "error", text: t(resumeAnalysisErrorKey(error, request.signal.aborted)) })
    } finally {
      const latest = request.isLatest()
      request.finish()
      if (latest && isMounted.current) setIsAnalyzing(false)
    }
  }

  const handleCancelAnalysis = () => {
    analysisRequests.current.cancel()
    setIsAnalyzing(false)
    setStatus({ kind: "warning", text: t("resume.analysisCancelled") })
  }

  const handleScrollOriginal = (e: React.UIEvent<HTMLDivElement>) => {
    if (!syncScroll || isScrollingSync.current || !optimizedEditorRef.current) return
    const target = e.currentTarget
    const maxSrc = target.scrollHeight - target.clientHeight
    if (maxSrc <= 0) return
    const ratio = target.scrollTop / maxSrc
    const destMax = optimizedEditorRef.current.scrollHeight - optimizedEditorRef.current.clientHeight
    isScrollingSync.current = true
    optimizedEditorRef.current.scrollTop = ratio * destMax
    requestAnimationFrame(() => {
      isScrollingSync.current = false
    })
  }

  const handleScrollOptimized = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!syncScroll || isScrollingSync.current || !originalScrollRef.current) return
    const target = e.currentTarget
    const maxSrc = target.scrollHeight - target.clientHeight
    if (maxSrc <= 0) return
    const ratio = target.scrollTop / maxSrc
    const destMax = originalScrollRef.current.scrollHeight - originalScrollRef.current.clientHeight
    isScrollingSync.current = true
    originalScrollRef.current.scrollTop = ratio * destMax
    requestAnimationFrame(() => {
      isScrollingSync.current = false
    })
  }

  const handleRejectLineDiff = (lineText: string) => {
    if (!resumeOptimized.includes(lineText)) return
    const updated = resumeOptimized.replace(lineText + "\n", "").replace(lineText, "")
    setReviewedOptimizedText("")
    updateResumeWorkspace({ optimized: updated })
  }

  const handleExport = async () => {
    if (!resumeOptimized.trim()) {
      setStatus({ kind: "error", text: t("resume.missingOptimized") })
      return
    }
    if (analysisStale) {
      setStatus({ kind: "error", text: t("resume.analysisStaleExport") })
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
    setViewMode("split")
    setActiveDiffChange(0)
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
    if ((resumeOptimized.trim() || resumeSuggestions.length > 0) && !window.confirm(t("resume.replaceConfirm"))) return
    updateResumeWorkspace({
      original: SAMPLE_RESUME,
      optimized: "",
      suggestions: [],
      sourceFileName: "sample-resume.docx",
      requirements: [],
      targetKeywords: [],
      matchedKeywords: [],
      missingKeywords: [],
      analysisOriginalFingerprint: "",
      analysisJobDescriptionFingerprint: "",
      analysisSource: "",
    })
    setReviewedOptimizedText("")
    setViewMode("split")
    setActiveDiffChange(0)
    setStatus({ kind: "success", text: t("resume.sampleLoaded") })
  }

  const handleApplySuggestion = (suggestion: ResumeSuggestion) => {
    if (!suggestion.replacement) return
    if (!resumeOptimized.includes(suggestion.replacement.before)) {
      setStatus({ kind: "warning", text: t("resume.suggestionNoLongerApplies") })
      return
    }
    const newOptimized = resumeOptimized.replace(suggestion.replacement.before, suggestion.replacement.after)
    const updatedSuggestions = resumeSuggestions.map((s) =>
      s.id === suggestion.id ? { ...s, applied: true } : s
    )
    setReviewedOptimizedText("")
    setActiveDiffChange(0)
    updateResumeWorkspace({
      optimized: newOptimized,
      suggestions: updatedSuggestions,
    })
  }

  const handleManualSuggestion = () => {
    setViewMode("split")
    window.requestAnimationFrame(() => {
      optimizedEditorRef.current?.focus()
      optimizedEditorRef.current?.scrollIntoView({ block: "center" })
    })
  }

  const handleStartFactReview = () => {
    setViewMode("diff")
    window.requestAnimationFrame(() => diffContainerRef.current?.scrollIntoView({ block: "start" }))
  }

  const handleJobDescriptionChange = (value: string) => {
    setReviewedOptimizedText("")
    if (viewMode === "requirements") setViewMode("split")
    updateResumeWorkspace({ jobDescription: value })
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

  const diffLines = useMemo(() => computeLineDiff(resumeOriginal, resumeOptimized), [resumeOriginal, resumeOptimized])
  const changedDiffIndices = useMemo(
    () => diffLines.flatMap((line, index) => line.type === "same" ? [] : [index]),
    [diffLines],
  )
  const sensitiveDiffCount = useMemo(
    () => diffLines.filter((line) => line.type !== "same" && /\d|@|(?:https?:\/\/|www\.)/i.test(line.text)).length,
    [diffLines],
  )
  const analysisStale = Boolean(resumeOptimized.trim()) && (
    !resumeAnalysisOriginalFingerprint
    || !resumeAnalysisJobDescriptionFingerprint
    || resumeTextFingerprint(resumeOriginal) !== resumeAnalysisOriginalFingerprint
    || resumeTextFingerprint(jobDescription) !== resumeAnalysisJobDescriptionFingerprint
  )
  const supportedRequirements = resumeRequirements.filter((requirement) => requirement.status === "supported")
  const unsupportedRequirements = resumeRequirements.filter((requirement) => requirement.status === "unsupported")
  const matchedKeywordSet = new Set(resumeMatchedKeywords.map((keyword) => keyword.toLocaleLowerCase()))
  const totalKeywords = (resumeTargetKeywords.length > 0 ? resumeTargetKeywords : resumeRequirements.map(r => r.keyword)).length
  const atsMatchRate = totalKeywords > 0
    ? Math.min(100, Math.round((matchedKeywordSet.size / totalKeywords) * 100))
    : (resumeMatchedKeywords.length > 0 ? 85 : 0)
  const factCheckPassed = sensitiveDiffCount === 0 || reviewedOptimizedText === resumeOptimized
  const coveredRequirements = resumeRequirements.filter((requirement) => matchedKeywordSet.has(requirement.keyword.toLocaleLowerCase()))

  const jumpToDiffChange = (direction: -1 | 1) => {
    if (changedDiffIndices.length === 0) return
    const next = (activeDiffChange + direction + changedDiffIndices.length) % changedDiffIndices.length
    setActiveDiffChange(next)
    const diffIndex = changedDiffIndices[next]
    window.requestAnimationFrame(() => {
      diffContainerRef.current
        ?.querySelector<HTMLElement>(`[data-diff-index="${diffIndex}"]`)
        ?.scrollIntoView({ block: "center" })
    })
  }

  const categoryLabel = (category: ResumeSuggestionCategory) => t(`resume.category.${category}`)
  const busy = !resumeHydrated || isParsing || isAnalyzing || isExporting
  const factsReviewed = Boolean(resumeOptimized.trim()) && !analysisStale && reviewedOptimizedText === resumeOptimized
  const canExport = !busy && factsReviewed

  return (
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("resume.title")}</h1>
            <span className="border-l border-[var(--border-color)] pl-2 text-xs text-[var(--text-muted)]">{t("resume.badge")}</span>
          </div>
          <div className={`mt-1 text-xs ${resumePersistenceError ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
            {resumePersistenceError ? t("resume.persistenceError") : t("resume.localAutosave")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleClear} disabled={busy} className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {t("resume.clear")}
          </button>
          <div className="relative group">
            <button
              type="button"
              onClick={handleExport}
              disabled={!canExport}
              className="flex items-center gap-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-1.5 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t("resume.export")}
            </button>
            {!canExport && resumeOptimized.trim() && (
              <div className="pointer-events-none invisible absolute right-0 top-full z-10 mt-2 w-72 rounded-md border border-[var(--warning)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--warning)] opacity-0 shadow-sm transition-opacity group-hover:visible group-hover:opacity-100">
                <div className="mb-1 flex items-center gap-1 font-semibold"><AlertCircle className="h-3.5 w-3.5" /> {t("resume.exportLocked")}</div>
                {analysisStale ? t("resume.analysisStaleExport") : t("resume.factReviewRequired")}
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

      {analysisStale && resumeOptimized.trim() && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-[var(--warning)] bg-[var(--bg-subtle)] p-4 text-sm text-[var(--warning)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">{t("resume.analysisStaleTitle")}</div>
              <div className="mt-0.5 text-xs">{t("resume.analysisStaleDescription")}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => runAnalysis(resumeOriginal, "original")}
            disabled={busy || !resumeOriginal.trim()}
            className="shrink-0 self-start rounded-md bg-[var(--action)] px-3 py-1.5 text-xs font-medium text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-50 lg:self-auto"
          >
            {t("resume.reanalyzeCurrentInputs")}
          </button>
        </div>
      )}

      {resumeOptimized.trim() && !analysisStale && !factsReviewed && (
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
            onClick={handleStartFactReview}
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
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={resumeTargetRole}
              onChange={(event) => updateResumeWorkspace({ targetRole: event.target.value, profileUpdatedAt: new Date().toISOString() })}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-sm outline-none"
              placeholder={t('resume.targetRole')}
              aria-label={t('resume.targetRole')}
            />
            <input
              value={resumeTargetCompany}
              onChange={(event) => updateResumeWorkspace({ targetCompany: event.target.value, profileUpdatedAt: new Date().toISOString() })}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-2 text-sm outline-none"
              placeholder={t('resume.targetCompany')}
              aria-label={t('resume.targetCompany')}
            />
          </div>
          <textarea
            value={jobDescription}
            maxLength={5000}
            disabled={busy}
            aria-label={t("resume.jd.title")}
            onChange={(event) => handleJobDescriptionChange(event.target.value)}
            className="h-36 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm outline-none transition-colors focus:border-[var(--action)] disabled:opacity-60"
            placeholder={t("resume.jd.placeholder")}
          />
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => runAnalysis(resumeOriginal, "original")} disabled={busy || !resumeOriginal.trim()} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[var(--action)] py-2 text-sm text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-50">
              {isAnalyzing && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {isAnalyzing
                ? t("common.analyzing")
                : t(jobDescription.trim() ? "resume.analyzeForJob" : "resume.analyzeGeneral")}
            </button>
            {isAnalyzing && (
              <button type="button" onClick={handleCancelAnalysis} className="rounded-md border border-[var(--border-color)] px-3 py-2 text-xs transition-colors hover:bg-[var(--bg-hover)]">
                {t("resume.cancelAnalysis")}
              </button>
            )}
          </div>
          {isAnalyzing && (
            <div className="mt-2 text-xs text-[var(--text-muted)]">{t("resume.analysisInProgress")}</div>
          )}
        </section>
      </div>

      {resumeOptimized.trim() && !analysisStale && (
        <section className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-medium">{t("resume.resultOverview")}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t(resumeAnalysisSource === "optimized" ? "resume.basedOnCurrentDraft" : "resume.basedOnOriginal")}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-1 text-xs font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--action)]" />
                  <span>ATS 匹配率:</span>
                  <span className={atsMatchRate >= 75 ? "text-[var(--success)]" : atsMatchRate >= 50 ? "text-[var(--warning)]" : "text-[var(--danger)]"}>
                    {atsMatchRate}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-subtle)] px-3 py-1 text-xs">
                  <ShieldCheck className={`h-3.5 w-3.5 ${factCheckPassed ? "text-[var(--success)]" : "text-[var(--warning)]"}`} />
                  <span className="text-[var(--text-muted)]">真实性合规:</span>
                  <span className={factCheckPassed ? "font-medium text-[var(--success)]" : "font-medium text-[var(--warning)]"}>
                    {factCheckPassed ? "已合规验证" : `${sensitiveDiffCount} 处敏感数字/链接需核对`}
                  </span>
                </div>
                {resumeMatchedKeywords.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-[var(--text-muted)]">
                    {resumeMatchedKeywords.slice(0, 5).map(kw => (
                      <span key={kw} className="rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[var(--text-main)] border border-[var(--border-color)]">
                        ✓ {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {jobDescription.trim() && resumeRequirements.length > 0 && (
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
                  <div className="text-base font-semibold">{resumeRequirements.length}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{t("resume.requirementTotal")}</div>
                </div>
                <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
                  <div className="text-base font-semibold text-[var(--success)]">{supportedRequirements.length}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{t("resume.requirementSupported")}</div>
                </div>
                <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
                  <div className="text-base font-semibold text-[var(--action)]">{coveredRequirements.length}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{t("resume.requirementCoveredCount")}</div>
                </div>
                <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
                  <div className="text-base font-semibold text-[var(--warning)]">{unsupportedRequirements.length}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{t("resume.requirementGapCount")}</div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

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
            } disabled:opacity-40`}
          >
            {t("resume.viewDiff")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("requirements")}
            disabled={!resumeOptimized.trim() || analysisStale || !jobDescription.trim() || resumeRequirements.length === 0}
            className={`border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "requirements"
                ? "border-[var(--action)] text-[var(--text-main)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
            } disabled:opacity-40`}
          >
            {t("resume.viewRequirements")}
          </button>
        </div>
      </div>

      {viewMode === "diff" ? (
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="mb-3 flex flex-col gap-3 text-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="font-medium">{t("resume.diffTitle")}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("resume.diffSummary", { changes: changedDiffIndices.length, sensitive: sensitiveDiffCount })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => jumpToDiffChange(-1)} disabled={changedDiffIndices.length === 0} className="rounded border border-[var(--border-color)] px-2 py-1 transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40">{t("resume.diffPrevious")}</button>
                <span className="min-w-12 text-center text-[var(--text-muted)]">
                  {changedDiffIndices.length === 0 ? "0/0" : `${Math.min(activeDiffChange + 1, changedDiffIndices.length)}/${changedDiffIndices.length}`}
                </span>
                <button type="button" onClick={() => jumpToDiffChange(1)} disabled={changedDiffIndices.length === 0} className="rounded border border-[var(--border-color)] px-2 py-1 transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40">{t("resume.diffNext")}</button>
              </div>
              <span className="flex items-center gap-1 text-[var(--danger)]">
                <span className="h-2 w-2 bg-[var(--danger)]" /> {t("resume.diffRemoved")}
              </span>
              <span className="flex items-center gap-1 text-[var(--success)]">
                <span className="h-2 w-2 bg-[var(--success)]" /> {t("resume.diffAdded")}
              </span>
            </div>
          </div>
          <div ref={diffContainerRef} className="max-h-[560px] min-h-[320px] overflow-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-4 text-sm font-mono leading-relaxed">
            {diffLines.map((line, idx) => (
              <div
                key={idx}
                data-diff-index={idx}
                className={`group flex items-start justify-between gap-2 px-2 py-0.5 whitespace-pre-wrap transition-shadow ${
                  line.type !== "same" && /\d|@|(?:https?:\/\/|www\.)/i.test(line.text)
                    ? "border-l-2 border-[var(--warning)]"
                    : ""
                } ${changedDiffIndices[activeDiffChange] === idx ? "ring-1 ring-[var(--action)]" : ""} ${
                  line.type === "removed"
                    ? "bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)] line-through"
                    : line.type === "added"
                      ? "bg-[color-mix(in_srgb,var(--success)_10%,transparent)] font-medium text-[var(--success)]"
                      : "text-[var(--text-muted)] group-hover:text-[var(--text-main)]"
                }`}
              >
                <div className="flex-1">
                  {line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}
                  {line.text}
                </div>
                {line.type === "added" && (
                  <button
                    type="button"
                    onClick={() => handleRejectLineDiff(line.text)}
                    title="放弃该新增项 (还原)"
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[11px] flex items-center gap-0.5 rounded px-1 text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] transition-opacity"
                  >
                    <X className="h-3 w-3" />
                    <span>撤回</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : viewMode === "requirements" ? (
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
          <div className="mb-4">
            <div className="font-medium">{t("resume.requirementMatrix")}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">{t("resume.requirementMatrixDescription")}</div>
          </div>
          <div className="divide-y divide-[var(--border-color)] border-y border-[var(--border-color)]">
            {resumeRequirements.map((requirement) => {
              const covered = matchedKeywordSet.has(requirement.keyword.toLocaleLowerCase())
              return (
                <article key={`${requirement.priority}-${requirement.keyword}`} className="py-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{requirement.keyword}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${requirement.priority === "required" ? "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]" : "bg-[var(--bg-subtle)] text-[var(--text-muted)]"}`}>
                          {t(requirement.priority === "required" ? "resume.requirementRequired" : "resume.requirementPreferred")}
                        </span>
                      </div>
                      {requirement.status === "supported" && requirement.evidence && (
                        <div className="mt-2 rounded-md bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
                          <span className="font-medium text-[var(--text-main)]">{t("resume.requirementEvidence")}: </span>
                          {requirement.evidence}
                        </div>
                      )}
                    </div>
                    <div className={`shrink-0 text-xs ${requirement.status === "unsupported" ? "text-[var(--warning)]" : covered ? "text-[var(--success)]" : "text-[var(--action)]"}`}>
                      {requirement.status === "unsupported"
                        ? t("resume.requirementGap")
                        : covered
                          ? t("resume.requirementCovered")
                          : t("resume.requirementEvidenceOnly")}
                    </div>
                  </div>
                  {requirement.status === "unsupported" && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">{t("resume.requirementGapHint")}</p>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <div>{t("resume.original")} <span className="border-l border-[var(--border-color)] pl-1.5 text-xs text-[var(--text-muted)]">v1</span></div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-[var(--text-muted)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={syncScroll}
                    onChange={(e) => setSyncScroll(e.target.checked)}
                    className="rounded border-[var(--border-color)] text-[var(--action)] text-xs"
                  />
                  <span>双栏同步滚动</span>
                </label>
                <div className="text-[var(--text-muted)]">{t("resume.wordCount")}: {countResumeWords(resumeOriginal)}</div>
              </div>
            </div>
            <div ref={originalScrollRef} onScroll={handleScrollOriginal} className="max-h-[560px] min-h-[360px] overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-4 text-sm leading-relaxed">
              {resumeOriginal || t("resume.originalPlaceholder")}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
            <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
              <div>{t("resume.optimized")} <span className="border-l border-[var(--border-color)] pl-1.5 text-xs text-[var(--action)]">v2</span></div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-[var(--text-muted)]">{t("resume.wordCount")}: {countResumeWords(resumeOptimized)}</span>
                {resumeOptimized.trim() && (
                  <>
                    <button type="button" onClick={() => runAnalysis(resumeOriginal, "original")} disabled={busy || !resumeOriginal.trim()} className="text-xs text-[var(--action)] hover:underline disabled:opacity-40">{t("resume.reoptimizeFromOriginal")}</button>
                    <span className="text-[var(--border-color)]">·</span>
                    <button type="button" onClick={() => runAnalysis(resumeOptimized, "optimized")} disabled={busy} className="text-xs text-[var(--action)] hover:underline disabled:opacity-40">{t("resume.reoptimizeCurrentDraft")}</button>
                  </>
                )}
              </div>
            </div>
            <textarea
              ref={optimizedEditorRef}
              value={resumeOptimized}
              onScroll={handleScrollOptimized}
              disabled={busy}
              onChange={(event) => {
                setReviewedOptimizedText("")
                setActiveDiffChange(0)
                updateResumeWorkspace({ optimized: event.target.value })
              }}
              className="min-h-[360px] max-h-[640px] w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-sm leading-relaxed outline-none transition-colors focus:border-[var(--action)] disabled:opacity-60"
              placeholder={t("resume.optimizedPlaceholder")}
              aria-label={t("resume.optimized")}
            />
          </section>
        </div>
      )}

      {resumeOptimized.trim() && (
        <div
          ref={reviewSectionRef}
          className={`mt-4 rounded-lg border bg-[var(--bg-surface)] p-5 ${
            analysisStale || !factsReviewed ? "border-[var(--warning)]" : "border-[var(--success)]"
          }`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-medium">{t("resume.reviewAndExport")}</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("resume.reviewSummary", { changes: changedDiffIndices.length, sensitive: sensitiveDiffCount })}
              </div>
              {analysisStale && (
                <div className="mt-2 text-xs text-[var(--warning)]">{t("resume.analysisStaleExport")}</div>
              )}
            </div>
            <label className={`flex max-w-xl items-start gap-2.5 text-xs leading-relaxed ${analysisStale ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={factsReviewed}
                disabled={busy || analysisStale}
                onChange={(event) => setReviewedOptimizedText(event.target.checked ? resumeOptimized : "")}
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-color)] text-[var(--action)] focus:ring-[var(--action)]"
              />
              <div>
                <span className={`font-medium ${!factsReviewed && !analysisStale ? "text-[var(--warning)]" : ""}`}>
                  {!factsReviewed && !analysisStale ? t("resume.factReviewConfirmWarning") : t("resume.factReviewConfirmLabel")}
                </span>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{t("resume.factReviewConfirm")}</p>
              </div>
            </label>
          </div>
        </div>
      )}

      <section className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5">
        <div>
          <div>
            <div className="font-medium">{t("resume.suggestions")}</div>
            {resumeOptimized.trim() && !analysisStale && (
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {t("resume.suggestionStatusSummary", {
                  completed: resumeSuggestions.filter((suggestion) => suggestion.applied).length,
                  manual: resumeSuggestions.filter((suggestion) => !suggestion.applied).length,
                })}
              </div>
            )}
          </div>
        </div>
        {analysisStale && resumeOptimized.trim() ? (
          <p className="mt-4 text-sm text-[var(--warning)]">{t("resume.suggestionsStale")}</p>
        ) : resumeSuggestions.length === 0 ? (
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
                      {t(suggestion.applied ? "resume.aiCompleted" : "resume.needsYourInput")}
                    </span>
                    {!suggestion.applied && suggestion.replacement && (
                      <button
                        type="button"
                        onClick={() => handleApplySuggestion(suggestion)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-md bg-[var(--action)] px-2.5 py-1 text-xs text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        <Sparkles className="h-3 w-3" />
                        {t("resume.applyOneClick")}
                      </button>
                    )}
                    {!suggestion.applied && !suggestion.replacement && (
                      <button
                        type="button"
                        onClick={handleManualSuggestion}
                        disabled={busy}
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
