import type { InterviewRecord } from '../stores/useAppStore'

type HistoryExportMode = 'copilot' | 'mock'

export interface HistoryExportOptions {
  mode: HistoryExportMode
  page: number
  search?: string
}

interface PdfImagePage {
  data: Uint8Array
  width: number
  height: number
}

const CANVAS_WIDTH = 1240
const CANVAS_HEIGHT = 1754
const MARGIN_X = 80
const MARGIN_Y = 72
const CONTENT_WIDTH = CANVAS_WIDTH - (MARGIN_X * 2)
const PAGE_BOTTOM = CANVAS_HEIGHT - MARGIN_Y
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
const PDF_WIDTH = 595.28
const PDF_HEIGHT = 841.89

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  parts.forEach((part) => {
    result.set(part, offset)
    offset += part.length
  })
  return result
}

function buildPdf(pages: PdfImagePage[]): Uint8Array {
  const pageObjectNumbers = pages.map((_, index) => 3 + (index * 3))
  const objects = new Map<number, Uint8Array>()

  objects.set(1, asciiBytes('<< /Type /Catalog /Pages 2 0 R >>'))
  objects.set(2, asciiBytes(`<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`))

  pages.forEach((page, index) => {
    const pageObject = 3 + (index * 3)
    const contentObject = pageObject + 1
    const imageObject = pageObject + 2
    const content = asciiBytes(`q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n/Im0 Do\nQ`)

    objects.set(pageObject, asciiBytes(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
    ))
    objects.set(contentObject, concatBytes([
      asciiBytes(`<< /Length ${content.length} >>\nstream\n`),
      content,
      asciiBytes('\nendstream'),
    ]))
    objects.set(imageObject, concatBytes([
      asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`),
      page.data,
      asciiBytes('\nendstream'),
    ]))
  })

  const maxObject = Math.max(...objects.keys())
  const chunks: Uint8Array[] = [asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]
  const offsets = new Array<number>(maxObject + 1).fill(0)
  let byteOffset = chunks[0].length

  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    const body = objects.get(objectNumber)
    if (!body) throw new Error(`Missing PDF object ${objectNumber}`)
    const prefix = asciiBytes(`${objectNumber} 0 obj\n`)
    const suffix = asciiBytes('\nendobj\n')
    offsets[objectNumber] = byteOffset
    chunks.push(prefix, body, suffix)
    byteOffset += prefix.length + body.length + suffix.length
  }

  const xrefOffset = byteOffset
  const xrefRows = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  const trailer = asciiBytes(
    `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n${xrefRows}trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  )
  chunks.push(trailer)
  return concatBytes(chunks)
}

function formatDetails(value?: string | null): string {
  if (!value) return '—'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function createFileName(options: HistoryExportOptions): string {
  const date = new Date().toISOString().slice(0, 10)
  return `rabbit-interview-history-${options.mode}-page-${Math.max(1, options.page)}-${date}.pdf`
}

export function exportHistoryRecordsPdf(records: InterviewRecord[], options: HistoryExportOptions): void {
  if (records.length === 0) return

  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  const pages: PdfImagePage[] = []
  let y = MARGIN_Y
  let pageHasContent = false
  let exportPageNumber = 1

  const startPage = () => {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    context.fillStyle = '#64748b'
    context.font = `400 18px ${FONT_STACK}`
    context.textBaseline = 'top'
    context.fillText(`OnCue · ${options.mode === 'mock' ? 'Mock Interview' : 'Stealth Copilot'} · data page ${options.page}`, MARGIN_X, 28)
    context.textAlign = 'right'
    context.fillText(`PDF ${exportPageNumber}`, CANVAS_WIDTH - MARGIN_X, 28)
    context.textAlign = 'left'
    y = MARGIN_Y
    pageHasContent = false
  }

  const finishPage = () => {
    if (!pageHasContent) return
    pages.push({
      data: dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.9)),
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    })
    exportPageNumber += 1
    startPage()
  }

  const ensureSpace = (height: number) => {
    if (y + height <= PAGE_BOTTOM) return
    finishPage()
  }

  const drawRule = () => {
    ensureSpace(32)
    context.strokeStyle = '#cbd5e1'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(MARGIN_X, y + 12)
    context.lineTo(CANVAS_WIDTH - MARGIN_X, y + 12)
    context.stroke()
    y += 32
    pageHasContent = true
  }

  const drawWrappedText = (
    text: string,
    font: string,
    color: string,
    lineHeight: number,
    indent = 0,
  ) => {
    context.font = font
    context.fillStyle = color
    context.textBaseline = 'top'

    const paragraphs = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
    paragraphs.forEach((paragraph) => {
      if (!paragraph) {
        ensureSpace(lineHeight)
        y += lineHeight
        pageHasContent = true
        return
      }

      let line = ''
      let width = 0
      for (const char of paragraph) {
        const charWidth = context.measureText(char).width
        if (line && width + charWidth > CONTENT_WIDTH - indent) {
          ensureSpace(lineHeight)
          context.fillText(line, MARGIN_X + indent, y)
          y += lineHeight
          pageHasContent = true
          line = char
          width = charWidth
        } else {
          line += char
          width += charWidth
        }
      }

      if (line) {
        ensureSpace(lineHeight)
        context.fillText(line, MARGIN_X + indent, y)
        y += lineHeight
        pageHasContent = true
      }
    })
  }

  const drawLabelValue = (label: string, value: unknown) => {
    drawWrappedText(`${label}: ${value == null || value === '' ? '—' : String(value)}`, `400 22px ${FONT_STACK}`, '#334155', 32)
  }

  startPage()
  drawWrappedText('Interview History Export', `700 38px ${FONT_STACK}`, '#0f172a', 50)
  drawLabelValue('Exported at', new Date().toLocaleString())
  drawLabelValue('Current page', options.page)
  drawLabelValue('Records', records.length)
  if (options.search?.trim()) drawLabelValue('Search', options.search.trim())
  drawRule()

  records.forEach((record, index) => {
    ensureSpace(72)
    drawWrappedText(`Record ${index + 1}`, `700 30px ${FONT_STACK}`, '#0f172a', 42)
    drawLabelValue('ID', record.id ?? '—')
    drawLabelValue('Date', record.date)
    drawLabelValue('Role', record.role)
    drawLabelValue('Company', record.company)
    drawLabelValue('Score', record.score ?? '—')
    drawLabelValue('Duration (seconds)', record.duration)
    drawLabelValue('Mode', record.mode)
    drawLabelValue('Recording path', record.recordingPath || '—')

    y += 8
    drawWrappedText('Transcript', `600 24px ${FONT_STACK}`, '#0f172a', 34)
    drawWrappedText(record.transcript || '—', `400 21px ${FONT_STACK}`, '#334155', 31, 18)

    y += 8
    drawWrappedText('Details JSON', `600 24px ${FONT_STACK}`, '#0f172a', 34)
    drawWrappedText(formatDetails(record.detailsJson), `400 19px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`, '#475569', 28, 18)
    drawRule()
  })

  finishPage()
  const pdfBytes = buildPdf(pages)
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = createFileName(options)
  link.click()
  URL.revokeObjectURL(url)
}
