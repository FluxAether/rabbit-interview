import * as mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export interface ResumeImportResult {
  text: string
  warnings: string[]
}

export async function extractResumeText(file: File): Promise<ResumeImportResult> {
  const arrayBuffer = await file.arrayBuffer()
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' '))
    }
    const text = pages.join('\n').trim()
    if (!text) throw new Error('empty-resume-text')
    return { text, warnings: [] }
  }

  const result = await mammoth.extractRawText({ arrayBuffer })
  const text = result.value.trim()
  if (!text) throw new Error('empty-resume-text')
  return {
    text,
    warnings: result.messages.map((message) => message.message).filter(Boolean),
  }
}
