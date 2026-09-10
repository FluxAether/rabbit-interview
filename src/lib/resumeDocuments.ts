import { Document, HeadingLevel, Packer, Paragraph } from 'docx'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const SECTION_HEADINGS = /^(?:experience|education|skills|projects|summary|profile|certifications|工作经历|实习经历|教育经历|技能|专业技能|技能专长|项目经历|项目课题|个人总结|个人简介|自我评价|证书|获奖情况|荣誉证书|荣誉奖项|求职意向|基本信息|校内职务|论文成果|语言能力)$/i

function isSectionHeading(line: string): boolean {
  if (SECTION_HEADINGS.test(line)) return true
  const latinLetters = line.replace(/[^A-Za-z]/g, '')
  return latinLetters.length >= 3 && line.length <= 48 && latinLetters === latinLetters.toUpperCase()
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

export async function downloadResumeDocx(text: string, fileName: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  const blob = await buildResumeDocxBlob(text)
  return invoke<string>('export_resume_docx', {
    fileName,
    bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  })
}

export function sanitizeResumeFilename(sourceFileName: string): string {
  const baseName = sourceFileName.split(/[\\/]/).pop()?.replace(/\.(?:pdf|docx)$/i, '') ?? ''
  const safeName = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/^\.+|\.+$/g, '').trim()
  return `${safeName || 'resume'}-optimized.docx`
}
