export const MAX_RESUME_FILE_SIZE = 5 * 1024 * 1024

export type ResumeFileValidationError = 'file-empty' | 'file-too-large' | 'unsupported-file-type'

export interface ResumeImportResult {
  text: string
  warnings: string[]
}

export function validateResumeFile(file: Pick<File, 'name' | 'size'>): ResumeFileValidationError | null {
  if (file.size === 0) return 'file-empty'
  if (file.size > MAX_RESUME_FILE_SIZE) return 'file-too-large'
  return /\.(?:pdf|docx)$/i.test(file.name) ? null : 'unsupported-file-type'
}

export function pdfItemsToText(items: readonly unknown[]): string {
  let text = ''
  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') continue
    text += item.str
    text += 'hasEOL' in item && item.hasEOL === true ? '\n' : ' '
  }
  return text.replace(/[ \t]+\n/g, '\n').trim()
}

export async function extractResumeText(file: File): Promise<ResumeImportResult> {
  const validationError = validateResumeFile(file)
  if (validationError) throw new Error(validationError)
  const arrayBuffer = await file.arrayBuffer()
  if (/\.pdf$/i.test(file.name)) {
    const [pdfjsLib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(pdfItemsToText(content.items))
    }
    const text = pages.join('\n').trim()
    if (!text) throw new Error('empty-resume-text')
    return { text, warnings: [] }
  }

  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText(
    typeof window === 'undefined' ? { buffer: Buffer.from(arrayBuffer) } : { arrayBuffer },
  )
  const text = result.value.trim()
  if (!text) throw new Error('empty-resume-text')
  return {
    text,
    warnings: result.messages.map((message) => message.message).filter(Boolean),
  }
}
