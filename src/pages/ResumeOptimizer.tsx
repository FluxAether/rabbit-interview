import { useEffect, useState } from 'react'
import { Download, FileText, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { useTranslation } from '../i18n'
import { downloadResumeDocx } from '../lib/resumeDocuments'
import { extractResumeText } from '../lib/resumeImport'
import {
  analyzeResume,
  countResumeWords,
  sanitizeResumeFilename,
  validateResumeFile,
  type ResumeFileValidationError,
  type ResumeSuggestionCategory,
} from '../lib/resumeOptimizer'
import {
  clearResumeWorkspace as clearSavedResumeWorkspace,
  saveResumeWorkspace,
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
    updateResumeWorkspace,
    setResumeAnalysis,
    applyResumeSuggestion,
    applyAllResumeSuggestions,
    clearResumeWorkspace,
  } = useAppStore()
  const t = useTranslation()
  const [isParsing, setIsParsing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [status, setStatus] = useState<PageStatus>(null)
  const [persistenceError, setPersistenceError] = useState(false)

  useEffect(() => {
    if (!resumeHydrated) return
    const timer = window.setTimeout(() => {
      const workspace = {
        original: resumeOriginal,
        optimized: resumeOptimized,
        jobDescription,
        suggestions: resumeSuggestions,
        sourceFileName: resumeSourceFileName,
        matchedKeywords: resumeMatchedKeywords,
        missingKeywords: resumeMissingKeywords,
      }
      const hasContent = Boolean(
        resumeOriginal.trim() || resumeOptimized.trim() || jobDescription.trim() || resumeSourceFileName,
      )
      const request = hasContent ? saveResumeWorkspace(workspace) : clearSavedResumeWorkspace()
      request.then(() => setPersistenceError(false)).catch(() => setPersistenceError(true))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [
    jobDescription,
    resumeHydrated,
    resumeMatchedKeywords,
    resumeMissingKeywords,
    resumeOptimized,
    resumeOriginal,
    resumeSourceFileName,
    resumeSuggestions,
  ])

  const validationMessage = (error: ResumeFileValidationError) => t(`resume.upload.${error}`)

  const handleAcceptedFile = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const validationError = validateResumeFile(file)
    if (validationError) {
      setStatus({ kind: 'error', text: validationMessage(validationError) })
      return
    }

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
      setStatus({
        kind: result.warnings.length ? 'warning' : 'success',
        text: result.warnings.length
          ? `${t('resume.importWarning')} ${result.warnings.join('; ')}`
          : t('resume.importSuccess'),
      })
    } catch (error) {
      console.warn('Failed to import resume', error)
      setStatus({ kind: 'error', text: t('resume.importError') })
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
    maxSize: 5 * 1024 * 1024,
    multiple: false,
    disabled: isParsing || !resumeHydrated,
  })

  const runAnalysis = async (source: string) => {
    if (!source.trim()) {
      setStatus({ kind: 'error', text: t('resume.missingResume') })
      return
    }
    setIsAnalyzing(true)
    setStatus(null)
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    setResumeAnalysis(analyzeResume(source, jobDescription))
    setStatus({ kind: 'success', text: t('resume.analysisComplete') })
    setIsAnalyzing(false)
  }

  const handleApply = (id: string) => {
    if (applyResumeSuggestion(id)) {
      setStatus({ kind: 'success', text: t('resume.suggestionApplied') })
    } else {
      setStatus({ kind: 'error', text: t('resume.suggestionStale') })
    }
  }

  const handleApplyAll = () => {
    const pendingActionable = resumeSuggestions.some((suggestion) => suggestion.replacement && !suggestion.applied)
    const count = applyAllResumeSuggestions()
    setStatus({
      kind: count > 0 ? 'success' : pendingActionable ? 'error' : 'warning',
      text: count > 0
        ? t('resume.suggestionsApplied')
        : pendingActionable
          ? t('resume.suggestionStale')
          : t('resume.noActionableSuggestions'),
    })
  }

  const handleExport = async () => {
    if (!resumeOptimized.trim()) {
      setStatus({ kind: 'error', text: t('resume.missingOptimized') })
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
    setStatus({ kind: 'success', text: t('resume.sampleLoaded') })
  }

  const categoryLabel = (category: ResumeSuggestionCategory) => t(`resume.category.${category}`)
  const busy = !resumeHydrated || isParsing || isAnalyzing || isExporting

  return (
    <div className="w-full p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="text-lg font-medium text-[#6366f1]">{t('resume.title')}</div>
          <div className="rounded bg-[#6366f1] px-2 py-px text-xs text-white">{t('resume.badge')}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={handleClear} disabled={busy} className="flex items-center gap-1 rounded-xl border px-3 py-1.5 text-sm disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> {t('resume.clear')}
          </button>
          <button type="button" onClick={handleExport} disabled={busy || !resumeOptimized.trim()} className="flex items-center gap-1 rounded-xl border px-4 py-1.5 text-sm disabled:opacity-50">
            {isExporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} {t('resume.export')}
          </button>
        </div>
      </div>

      {(status || persistenceError) && (
        <div
          role={status?.kind === 'error' || persistenceError ? 'alert' : 'status'}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            status?.kind === 'error' || persistenceError
              ? 'border-red-200 bg-red-50 text-red-700'
              : status?.kind === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {persistenceError ? t('resume.persistenceError') : status?.text}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4">
        <section className="card p-6">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Upload className="h-4 w-4" /> {t('resume.upload.title')}</div>
          <div {...getRootProps()} className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#cbd5e1] text-center ${isDragActive ? 'bg-[#f8fafc]' : ''} ${isParsing ? 'cursor-wait opacity-60' : ''}`}>
            <input {...getInputProps()} />
            {isParsing ? <LoaderCircle className="mb-2 h-8 w-8 animate-spin text-[#6366f1]" /> : <FileText className="mb-2 h-8 w-8 text-[#64748b]" />}
            <div className="text-sm">{isParsing ? t('resume.upload.parsing') : isDragActive ? t('resume.upload.drop') : t('resume.upload.choose')}</div>
            <div className="text-xs text-[#64748b]">{resumeSourceFileName || t('resume.upload.hint')}</div>
          </div>
          <button type="button" onClick={useSample} disabled={busy} className="mt-4 w-full rounded-2xl bg-[#6366f1] py-2 text-sm text-white disabled:opacity-50">{t('common.useSample')}</button>
        </section>

        <section className="card p-6">
          <div className="mb-4 flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> {t('resume.jd.title')}</span>
            <span className="text-xs font-normal text-[#64748b]">{jobDescription.length}/5000</span>
          </div>
          <textarea
            value={jobDescription}
            maxLength={5000}
            onChange={(event) => updateResumeWorkspace({ jobDescription: event.target.value })}
            className="h-36 w-full rounded-xl border border-[#e2e8f0] p-3 text-sm"
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
            <div>{t('resume.original')} <span className="rounded bg-[#e2e8f0] px-1.5 text-xs">v1</span></div>
            <div className="text-[#64748b]">{t('resume.wordCount')}: {countResumeWords(resumeOriginal)}</div>
          </div>
          <div className="max-h-[360px] min-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border bg-[#fafafa] p-4 text-sm leading-relaxed text-[#334155]">
            {resumeOriginal || t('resume.originalPlaceholder')}
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-2 flex justify-between text-sm">
            <div>{t('resume.optimized')} <span className="rounded bg-[#e0e7ff] px-1.5 text-xs text-[#4338ca]">v2</span></div>
            <div className="flex items-center gap-3">
              <span className="text-[#64748b]">{t('resume.wordCount')}: {countResumeWords(resumeOptimized)}</span>
              <button type="button" onClick={() => runAnalysis(resumeOptimized || resumeOriginal)} disabled={busy || !(resumeOptimized || resumeOriginal).trim()} className="text-xs text-[#6366f1] disabled:opacity-40">{t('common.reoptimize')}</button>
            </div>
          </div>
          <textarea
            value={resumeOptimized}
            onChange={(event) => updateResumeWorkspace({ optimized: event.target.value })}
            className="min-h-[260px] w-full resize-y rounded-xl border bg-white p-4 text-sm leading-relaxed"
            placeholder={t('resume.optimizedPlaceholder')}
            aria-label={t('resume.optimized')}
          />
        </section>
      </div>

      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">{t('resume.suggestions')}</div>
            {jobDescription.trim() && (
              <div className="mt-1 text-xs text-[#64748b]">
                {t('resume.keywordMatch')}: {resumeMatchedKeywords.length} · {t('resume.keywordMissing')}: {resumeMissingKeywords.length}
              </div>
            )}
          </div>
          <button type="button" onClick={handleApplyAll} disabled={busy || !resumeSuggestions.some((suggestion) => suggestion.replacement && !suggestion.applied)} className="text-sm text-[#6366f1] disabled:opacity-40">{t('common.applyAll')}</button>
        </div>
        {resumeSuggestions.length === 0 ? (
          <p className="mt-4 text-sm text-[#64748b]">{t('resume.noSuggestions')}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {resumeSuggestions.map((suggestion) => (
              <article key={suggestion.id} className={`rounded-xl border p-3 ${suggestion.applied ? 'bg-[#f8fafc] opacity-65' : 'bg-white'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-[#6366f1]">{categoryLabel(suggestion.category)}</div>
                    <div className={suggestion.applied ? 'mt-1 text-sm font-medium line-through' : 'mt-1 text-sm font-medium'}>{suggestion.title}</div>
                  </div>
                  {!suggestion.applied && suggestion.replacement && (
                    <button type="button" onClick={() => handleApply(suggestion.id)} className="shrink-0 rounded-lg border px-2 py-1 text-xs">{t('common.apply')}</button>
                  )}
                  {!suggestion.applied && !suggestion.replacement && <span className="shrink-0 text-xs text-[#b45309]">{t('resume.manualRequired')}</span>}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#64748b]">{suggestion.description}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="mt-5 text-center text-xs text-[#64748b]">{t('resume.confidential')}</div>
    </div>
  )
}
