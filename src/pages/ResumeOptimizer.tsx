import { useState } from 'react'
import { Upload, FileText } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useAppStore } from '../stores/useAppStore'
import * as pdfjsLib from 'pdfjs-dist'
import { useTranslation } from '../i18n'

// Configure PDF.js worker (use CDN for simplicity in desktop build)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export default function ResumeOptimizer() {
  const { 
    resumeOriginal, resumeOptimized, jobDescription, resumeSuggestions, 
    setResumeData, applyResumeSuggestion 
  } = useAppStore()
  const t = useTranslation()

  const [jd, setJd] = useState(jobDescription)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    try {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        let fullText = ''
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          const pageText = textContent.items.map((item: any) => item.str).join(' ')
          fullText += pageText + '\n'
        }
        setResumeData(fullText.trim() || 'Extracted text from PDF.', fullText.trim(), jd)
      } else {
        // For other files or DOCX fallback to text read
        const text = await file.text()
        setResumeData(text, text, jd)
      }
    } catch (e) {
      // Fallback
      const text = await file.text()
      const mock = text || `Alex Morgan\nProduct Designer\n\nEXPERIENCE\nSenior Product Designer — TechNova Inc. (2021–Present)`
      setResumeData(mock, mock, jd)
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } 
  })

  const analyze = async () => {
    setIsAnalyzing(true)
    // Simulate LLM analysis (in real call Groq / OpenAI / Claude / Gemini)
    await new Promise(r => setTimeout(r, 850))
    
    const optimized = resumeOriginal ? 
      resumeOriginal.replace('Led the design', 'Led the design of the core product platform used by 100k+ customers, resulting in a 40% improvement') : 
      'Optimized resume content...'
    
    setResumeData(resumeOriginal || 'Original resume text here...', optimized, jd)
    setIsAnalyzing(false)
  }

  const applyAll = () => {
    resumeSuggestions.forEach(s => applyResumeSuggestion(s.id))
  }

  const exportResume = () => {
    const blob = new Blob([resumeOptimized || 'Optimized content'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'optimized_resume.txt'
    a.click()
  }

  return (
    <div className="w-full p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div className="text-[#6366f1] font-medium text-lg">{t('resume.title')}</div>
          <div className="text-xs bg-[#6366f1] text-white px-2 py-px rounded">{t('resume.badge')}</div>
        </div>
        <button onClick={exportResume} className="text-sm px-4 py-1 border rounded-xl">{t('resume.export')}</button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Upload */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4 text-sm font-medium"><Upload className="w-4 h-4" /> {t('resume.upload.title')}</div>
          <div {...getRootProps()} className={`border border-dashed border-[#cbd5e1] rounded-2xl h-36 flex flex-col items-center justify-center text-center cursor-pointer ${isDragActive ? 'bg-[#f8fafc]' : ''}`}>
            <input {...getInputProps()} />
            <FileText className="w-8 h-8 text-[#64748b] mb-2" />
            <div className="text-sm">{isDragActive ? t('resume.upload.drop') : t('resume.upload.choose')}</div>
            <div className="text-xs text-[#64748b]">{t('resume.upload.hint')}</div>
          </div>
          <button onClick={() => setResumeData('Alex Morgan\nProduct Designer\n• Led design of core product...', 'Alex Morgan\nProduct Designer\n• Led design...', jd)} className="mt-4 w-full bg-[#6366f1] text-white py-2 rounded-2xl text-sm">{t('common.useSample')}</button>
        </div>

        {/* JD */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4 text-sm font-medium"><FileText className="w-4 h-4" /> {t('resume.jd.title')}</div>
          <textarea 
            value={jd} 
            onChange={e => setJd(e.target.value)}
            className="w-full h-36 border border-[#e2e8f0] rounded-xl p-3 text-sm" 
            placeholder={t('resume.jd.placeholder')} 
          />
          <button onClick={analyze} disabled={isAnalyzing} className="mt-4 w-full bg-[#6366f1] text-white py-2 rounded-2xl text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {isAnalyzing ? t('common.analyzing') : t('common.analyze')}
          </button>
        </div>
      </div>

      {/* Comparison + Suggestions */}
      <div className="grid grid-cols-2 gap-4 relative">
        <div className="card p-5">
          <div className="flex justify-between mb-2 text-sm">
            <div>{t('resume.original')} <span className="text-xs bg-[#e2e8f0] px-1.5 rounded">v1</span></div>
            <div className="text-[#64748b]">{t('resume.wordCount')}: {(resumeOriginal || '').split(' ').length}</div>
          </div>
          <div className="text-sm leading-relaxed text-[#334155] border p-4 rounded-xl bg-[#fafafa] whitespace-pre-wrap min-h-[160px]">
            {resumeOriginal || t('resume.originalPlaceholder')}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex justify-between mb-2 text-sm">
            <div>{t('resume.optimized')} <span className="text-xs bg-[#e0e7ff] px-1.5 rounded text-[#4338ca]">v2</span></div>
            <button onClick={analyze} className="text-xs text-[#6366f1]">{t('common.reoptimize')}</button>
          </div>
          <div className="text-sm leading-relaxed border p-4 rounded-xl bg-white whitespace-pre-wrap min-h-[160px]">
            {resumeOptimized || t('resume.optimizedPlaceholder')}
          </div>
        </div>

        {/* Floating suggestions panel matching design */}
        {resumeSuggestions.length > 0 && (
          <div className="absolute -right-1 top-2 bg-white border shadow rounded-2xl p-3 w-[210px] text-xs z-10">
            <div className="font-medium mb-2 flex items-center gap-1">{t('resume.suggestions')}</div>
            <div className="space-y-1.5">
              {resumeSuggestions.map((s) => (
                <div key={s.id} className="flex justify-between items-center bg-[#f8fafc] px-2 py-1 rounded">
                  <span className={s.applied ? 'line-through opacity-50' : ''}>{s.text}</span>
                  {!s.applied && (
                    <button onClick={() => applyResumeSuggestion(s.id)} className="text-[10px] bg-white border px-2 py-px rounded">Apply</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={applyAll} className="mt-2 text-[#6366f1] text-xs w-full">{t('common.applyAll')}</button>
          </div>
        )}
      </div>

      <div className="text-center mt-5 text-xs text-[#64748b]">{t('resume.confidential')}</div>
    </div>
  )
}
