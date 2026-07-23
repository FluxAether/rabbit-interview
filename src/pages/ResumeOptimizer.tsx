import { useEffect, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { useCurrentLanguage, useTranslation } from '../i18n'
import { downloadResumeDocx, sanitizeResumeFilename } from '../lib/resumeDocuments'
import {
  MAX_RESUME_FILE_SIZE,
  extractResumeText,
  validateResumeFile,
  type ResumeFileValidationError,
} from '../lib/resumeImport'
import {
  countResumeWords,
  createResumeAnalysisRequestCoordinator,
  type ResumeSuggestionCategory,
} from '../lib/resumeOptimizer'
import { optimizeResumeWithLlm } from '../lib/resumeOptimizerAi'
import {
  clearResumeWorkspace as clearSavedResumeWorkspace,
} from '../lib/resumeWorkspaceStore'
import { useAppStore } from '../stores/useAppStore'

const SAMPLE_RESUME = `Alex Morgan
Product Designer

EXPERIENCE
I was responsible for product onboarding and design system improvements.
• Improved collaboration between design and engineering teams.

SKILLS
Product design • Figma • User research`

type PageStatus = { kind: 'error' | 'success' | 'warning'; text: string } | null

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
  const [reviewedOptimizedText, setReviewedOptimizedText] = useState('')
  const analysisRequests = useRef(createResumeAnalysisRequestCoordinator())

  useEffect(() => () => analysisRequests.current.cancel(), [])

  const validationMessage = (error: ResumeFileValidationError) => t(`resume.upload.${error}`)

  const handleAcceptedFile = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const validationError = validateResumeFile(file)
    if (validationError) {
      setStatus({ kind: 'error', text: validationMessage(validationError) })
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
        optimized: '',
        suggestions: [],
        sourceFileName: file.name,
        matchedKeywords: [],
        missingKeywords: [],
      })
      setReviewedOptimizedText('')
      setStatus({
        kind: result.warnings.length ? 'warning' : 'success',
        text: result.warnings.length
          ? `${t('resume.importWarning')} ${result.warnings.join('; ')}`
          : t('resume.importSuccess'),
      })
    } catch (error) {
      console.warn('Failed to import resume', error)
      setStatus({
        kind: 'error',
        text: t(error instanceof Error && error.message === 'resume-text-too-long'
          ? 'resume.textTooLong'
          : 'resume.importError'),
      })
    } finally {
      setIsParsing(false)
    }
  }

  const handleRejectedFile = (rejections: FileRejection[]) => {
    const code = rejections[0]?.errors[0]?.code
    const key = code === 'file-too-large'
      ? 'resume.upload.file-too-large'
      : code === 'too-many-files'
        ? 'resume.upload.too-many-files'
        : 'resume.upload.unsupported-file-type'
    setStatus({ kind: 'error', text: t(key) })
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted: handleAcceptedFile,
    onDropRejected: handleRejectedFile,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxFiles: 1,
    maxSize: MAX_RESUME_FILE_SIZE,
    multiple: false,
    disabled: isParsing || isAnalyzing || isExporting || !resumeHydrated,
  })

  const runAnalysis = async (source: string) => {
    if (!source.trim()) {
      setStatus({ kind: 'error', text: t('resume.missingResume') })
      return
    }
    const request = analysisRequests.current.start()
    setIsAnalyzing(true)
    setReviewedOptimizedText('')
    setStatus(null)
    try {
      const result = await optimizeResumeWithLlm(source, jobDescription, language, request.signal)
      if (!request.isLatest()) return
      setResumeAnalysis(result)
      setStatus({ kind: 'success', text: t('resume.analysisComplete') })
    } catch (error) {
      if (!request.isLatest()) return
      console.warn('Failed to optimize resume with LLM', error)
      const key = request.signal.aborted
        ? 'resume.analysisTimeout'
        : error instanceof Error && error.message === 'resume-text-too-long'
          ? 'resume.textTooLong'
          : 'resume.analysisError'
      setStatus({ kind: 'error', text: t(key) })
    } finally {
      const latest = request.isLatest()
      request.finish()
      if (latest) setIsAnalyzing(false)
    }
  }

  const handleExport = async () => {
    if (!resumeOptimized.trim()) {
      setStatus({ kind: 'error', text: t('resume.missingOptimized') })
      return
    }
    if (reviewedOptimizedText !== resumeOptimized) {
      setStatus({ kind: 'error', text: t('resume.factReviewRequired') })
      return
    }
    setIsExporting(true)
    setStatus(null)
    try {
      await downloadResumeDocx(resumeOptimized, sanitizeResumeFilename(resumeSourceFileName))
      setStatus({ kind: 'success', text: t('resume.exportSuccess') })
    } catch (error) {
      console.warn('Failed to export resume', error)
      setStatus({ kind: 'error', text: t('resume.exportError') })
    } finally {
      setIsExporting(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm(t('resume.clearConfirm'))) return
    setReviewedOptimizedText('')
    clearResumeWorkspace()
    try {
      await clearSavedResumeWorkspace()
      setStatus({ kind: 'success', text: t('resume.cleared') })
    } catch {
      setStatus({ kind: 'error', text: t('resume.persistenceError') })
    }
  }

  const useSample = () => {
    updateResumeWorkspace({
      original: SAMPLE_RESUME,
      optimized: '',
      suggestions: [],
      sourceFileName: 'sample-resume.docx',
      matchedKeywords: [],
      missingKeywords: [],
    })
    setReviewedOptimizedText('')
    setStatus({ kind: 'success', text: t('resume.sampleLoaded') })
  }

  const categoryLabel = (category: ResumeSuggestionCategory) => t(`resume.category.${category}`)
  const busy = !resumeHydrated || isParsing || isAnalyzing || isExporting
  const factsReviewed = Boolean(resumeOptimized.trim()) && reviewedOptimizedText === resumeOptimized

  return (
    <div className="w-full p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="text-lg font-medium text-[#6366f1]">{t('resume.title')}</div>
          <div className="rounded bg-[#6366f1] px-2 py-px text-xs text-white">{t('resume.badge')}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleClear} disabled={busy} className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-3 py-1.5 text-sm dark:border-[#334155] disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {t('resume.clear')}
          </button>
          <button type="button" onClick={handleExport} disabled={busy || !factsReviewed} className="flex items-center gap-1 rounded-xl border border-[#e2e8f0] px-4 py-1.5 text-sm dark:border-[#334155] disabled:opacity-50">
            {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t('resume.export')}
          </button>
        </div>
      </div>

      {(status || resumePersistenceError) && (
        <div
          role={status?.kind === 'error' || resumePersistenceError ? 'alert' : 'status'}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            status?.kind === 'error' || resumePersistenceError
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300'
              : status?.kind === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
          }`}
        >
          {resumePersistenceError ? t('resume.persistenceError') : status?.text}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4">
        <section className="card p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4" /> {t('resume.upload.title')}</div>
          <div {...getRootProps()} className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#cbd5e1] text-center dark:border-[#475569] ${isDragActive ? 'bg-[#f8fafc] dark:bg-[#0f172a]' : ''} ${isParsing ? 'cursor-wait opacity-60' : ''}`}>
            <input {...getInputProps()} />
            {isParsing ? <LoaderCircle className="mb-2 h-8 w-8 animate-spin text-[#6366f1]" /> : <FileText className="mb-2 h-8 w-8 text-[#64748b] dark:text-[#94a3b8]" />}
            <div className="text-sm">{isParsing ? t('resume.upload.parsing') : isDragActive ? t('resume.upload.drop') : t('resume.upload.choose')}</div>
            <div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{resumeSourceFileName || t('resume.upload.hint')}</div>
          </div>
          <button type="button" onClick={useSample} disabled={busy} className="mt-4 w-full rounded-2xl bg-[#6366f1] py-2 text-sm text-white disabled:opacity-50">{t('common.useSample')}</button>
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> {t('resume.jd.title')}</span>
            <span className="text-xs font-normal text-[#64748b] dark:text-[#94a3b8]">{jobDescription.length}/5000</span>
          </div>
          <textarea
            value={jobDescription}
            maxLength={5000}
            disabled={busy}
            onChange={(event) => updateResumeWorkspace({ jobDescription: event.target.value })}
            className="h-36 w-full rounded-xl border border-[#e2e8f0] p-3 text-sm disabled:opacity-60"
            placeholder={t('resume.jd.placeholder')}
          />
          <button type="button" onClick={() => runAnalysis(resumeOriginal)} disabled={busy || !resumeOriginal.trim()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6366f1] py-2 text-sm text-white disabled:opacity-50">
            {isAnalyzing && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isAnalyzing ? t('common.analyzing') : t('common.analyze')}
          </button>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="card p-5">
          <div className="mb-2 flex justify-between text-sm">
            <div>{t('resume.original')} <span className="rounded bg-[#e2e8f0] px-1.5 text-xs dark:bg-[#334155]">v1</span></div>
            <div className="text-[#64748b] dark:text-[#94a3b8]">{t('resume.wordCount')}: {countResumeWords(resumeOriginal)}</div>
          </div>
          <div className="max-h-[360px] min-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border border-[#e2e8f0] bg-[#fafafa] p-4 text-sm leading-relaxed text-[#334155] dark:border-[#334155] dark:bg-[#0f172a] dark:text-[#e2e8f0]">
            {resumeOriginal || t('resume.originalPlaceholder')}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-2 flex justify-between text-sm">
            <div>{t('resume.optimized')} <span className="rounded bg-[#e0e7ff] px-1.5 text-xs text-[#4338ca] dark:bg-[#312e81] dark:text-[#a5b4fc]">v2</span></div>
            <div className="flex items-center gap-3">
              <span className="text-[#64748b] dark:text-[#94a3b8]">{t('resume.wordCount')}: {countResumeWords(resumeOptimized)}</span>
              <button type="button" onClick={() => runAnalysis(resumeOptimized || resumeOriginal)} disabled={busy || !(resumeOptimized || resumeOriginal).trim()} className="text-xs text-[#6366f1] disabled:opacity-40">{t('common.reoptimize')}</button>
            </div>
          </div>
          <textarea
            value={resumeOptimized}
            disabled={busy}
            onChange={(event) => updateResumeWorkspace({ optimized: event.target.value })}
            className="min-h-[260px] w-full resize-y rounded-xl border bg-white p-4 text-sm leading-relaxed disabled:opacity-60"
            placeholder={t('resume.optimizedPlaceholder')}
            aria-label={t('resume.optimized')}
          />
          <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[#475569] dark:text-[#94a3b8]">
            <input
              type="checkbox"
              checked={factsReviewed}
              disabled={busy || !resumeOptimized.trim()}
              onChange={(event) => setReviewedOptimizedText(event.target.checked ? resumeOptimized : '')}
              className="mt-0.5"
            />
            <span>{t('resume.factReviewConfirm')}</span>
          </label>
        </section>
      </div>

      <section className="card mt-4 p-5">
        <div>
          <div>
            <div className="font-medium">{t('resume.suggestions')}</div>
            {jobDescription.trim() && (
              <div className="mt-1 text-xs text-[#64748b] dark:text-[#94a3b8]">
                {t('resume.keywordMatch')}: {resumeMatchedKeywords.length} · {t('resume.keywordMissing')}: {resumeMissingKeywords.length}
              </div>
            )}
          </div>
        </div>
        {resumeSuggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#64748b] dark:text-[#94a3b8]">{t('resume.noSuggestions')}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {resumeSuggestions.map((suggestion) => (
              <article key={suggestion.id} className="rounded-xl border border-[#e2e8f0] bg-white p-3 dark:border-[#334155] dark:bg-[#0f172a]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-[#6366f1]">{categoryLabel(suggestion.category)}</div>
                    <div className="mt-1 text-sm font-medium">{suggestion.title ?? t(suggestion.titleKey ?? '')}</div>
                  </div>
                  <span className={`shrink-0 text-xs ${suggestion.applied ? 'text-[#047857] dark:text-emerald-400' : 'text-[#b45309] dark:text-amber-400'}`}>
                    {t(suggestion.applied ? 'resume.includedInDraft' : 'resume.manualRequired')}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b] dark:text-[#94a3b8]">{suggestion.description ?? t(suggestion.descriptionKey ?? '', suggestion.descriptionParams)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 text-center text-xs text-[#64748b] dark:text-[#94a3b8]">{t('resume.confidential')}</div>
    </div>
  )
}
