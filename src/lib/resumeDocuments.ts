import { Document, HeadingLevel, Packer, Paragraph } from 'docx'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SECTION_HEADINGS = /^(?:experience|education|skills|projects|summary|profile|certifications|工作经历|教育经历|技能|项目经历|个人总结|个人简介|证书)$/i

function isSectionHeading(line: string): boolean {
  if (SECTION_HEADINGS.test(line)) return true
  const letters = line.replace(/[^\p{L}]/gu, '')
  return letters.length >= 3 && line.length <= 48 && letters === letters.toLocaleUpperCase()
}

export async function buildResumeDocxBlob(text: string): Promise<Blob> {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let firstContent = true
  const children = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return new Paragraph('')
    if (firstContent) {
      firstContent = false
      return new Paragraph({ text: trimmed, heading: HeadingLevel.TITLE })
    }
    if (isSectionHeading(trimmed)) {
      return new Paragraph({ text: trimmed, heading: HeadingLevel.HEADING_1 })
    }
    const bullet = trimmed.match(/^[•*\-]\s*(.+)$/)
    return bullet
      ? new Paragraph({ text: bullet[1], bullet: { level: 0 } })
      : new Paragraph(trimmed)
  })

  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
  return blob.type === DOCX_MIME
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: DOCX_MIME })
}

export async function downloadResumeDocx(text: string, fileName: string): Promise<void> {
  const url = URL.createObjectURL(await buildResumeDocxBlob(text))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
