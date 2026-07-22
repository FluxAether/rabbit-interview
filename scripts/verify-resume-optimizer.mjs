import assert from 'node:assert/strict'
import * as mammoth from 'mammoth'
import {
  analyzeResume,
  applyAllResumeSuggestions,
  applyResumeSuggestion,
  countResumeWords,
  normalizeResumeText,
} from '../src/lib/resumeOptimizer.ts'
import { buildResumeDocxBlob, sanitizeResumeFilename } from '../src/lib/resumeDocuments.ts'
import {
  MAX_RESUME_FILE_SIZE,
  extractResumeText,
  pdfItemsToText,
  validateResumeFile,
} from '../src/lib/resumeImport.ts'
import {
  createResumeWriteQueue,
  toPersistedResumeWorkspace,
} from '../src/lib/resumeWorkspaceStore.ts'

assert.equal(countResumeWords('Led design 用户研究'), 6, 'counts English words and CJK characters')

const unformatted = '  Alex  \r\n-  Built products   \r\n\r\n\r\nSkills  '
const normalized = 'Alex\n• Built products\n\nSkills'
assert.equal(normalizeResumeText(unformatted), normalized, 'normalizes whitespace and bullets')
assert.equal(normalizeResumeText(normalized), normalized, 'normalization is idempotent')

const analysis = analyzeResume(
  'I was responsible for product design\n• Improved onboarding',
  'Product design, TypeScript and 用户研究',
  'en-US',
)
assert.doesNotMatch(analysis.suggestions.map((suggestion) => suggestion.title).join(''), /[\u3400-\u9fff]/, 'localizes English suggestion titles')
assert.match(analysis.suggestions.find((suggestion) => suggestion.category === 'keywords')?.description ?? '', /^Not found from the JD:/, 'localizes English suggestion guidance')
assert.equal(analysis.optimizedText.includes('TypeScript'), false, 'never invents missing JD keywords')
assert.ok(analysis.matchedKeywords.some((keyword) => keyword.toLowerCase() === 'product'), 'reports matched JD keywords')
assert.ok(analysis.missingKeywords.some((keyword) => keyword.toLowerCase() === 'typescript'), 'reports missing English JD keywords')
assert.ok(analysis.missingKeywords.includes('用户研究'), 'reports missing Chinese JD keywords')

const chineseAnalysis = analyzeResume('本人负责产品设计', '用户研究', 'zh-CN')
assert.match(chineseAnalysis.suggestions[0]?.title ?? '', /[\u3400-\u9fff]/, 'localizes Chinese suggestions')

const actionable = analysis.suggestions.find((suggestion) => suggestion.replacement)
assert.ok(actionable, 'creates a safe actionable suggestion')
const applied = applyResumeSuggestion(analysis.optimizedText, actionable)
assert.equal(applied.applied, true, 'applies an exact replacement')
assert.match(applied.text, /^Responsible for product design/m, 'removes first-person filler without changing facts')

const stale = applyResumeSuggestion('Text was edited', actionable)
assert.equal(stale.applied, false, 'does not overwrite manually edited content')
assert.equal(stale.text, 'Text was edited', 'keeps edited content when a suggestion is stale')

const allApplied = applyAllResumeSuggestions(analysis.optimizedText, analysis.suggestions)
assert.ok(allApplied.suggestions.some((suggestion) => !suggestion.replacement && !suggestion.applied), 'leaves guidance-only suggestions pending')

assert.equal(validateResumeFile({ name: 'resume.pdf', size: MAX_RESUME_FILE_SIZE }), null, 'accepts a PDF at the size limit')
assert.equal(validateResumeFile({ name: 'resume.docx', size: MAX_RESUME_FILE_SIZE + 1 }), 'file-too-large', 'rejects files over 5 MiB')
assert.equal(validateResumeFile({ name: 'resume.txt', size: 12 }), 'unsupported-file-type', 'rejects unsupported file types')
assert.equal(
  pdfItemsToText([{ str: 'Alex Morgan', hasEOL: true }, { str: 'EXPERIENCE', hasEOL: true }, { str: 'Built products', hasEOL: false }]),
  'Alex Morgan\nEXPERIENCE\nBuilt products',
  'preserves PDF line boundaries',
)
assert.equal(sanitizeResumeFilename('My Resume 2026.docx'), 'My Resume 2026-optimized.docx', 'creates a safe DOCX filename')
assert.equal(sanitizeResumeFilename('../../.docx'), 'resume-optimized.docx', 'falls back for unsafe filenames')

const docxBlob = await buildResumeDocxBlob('Alex Morgan\nEXPERIENCE\n• Built onboarding')
assert.equal(docxBlob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'exports the DOCX MIME type')
assert.deepEqual([...new Uint8Array(await docxBlob.slice(0, 2).arrayBuffer())], [0x50, 0x4b], 'exports a ZIP-based DOCX file')
const importedDocx = await extractResumeText(new File([docxBlob], 'resume.docx', { type: docxBlob.type }))
assert.match(importedDocx.text, /Alex Morgan/, 'imports text from a real DOCX file')
await assert.rejects(
  extractResumeText(new File(['not a docx'], 'broken.docx')),
  'rejects a corrupt DOCX file without mock fallback',
)

const chineseDocx = await buildResumeDocxBlob('张三\n负责产品设计与用户研究。\n工作经历\n• 完成项目')
const rendered = await mammoth.convertToHtml({ buffer: Buffer.from(await chineseDocx.arrayBuffer()) })
assert.match(rendered.value, /<h1>工作经历<\/h1>/, 'styles known Chinese section headings')
assert.doesNotMatch(rendered.value, /<h1>负责产品设计与用户研究。<\/h1>/, 'keeps ordinary Chinese text as a paragraph')

const persisted = toPersistedResumeWorkspace({
  original: 'original', optimized: 'optimized', jobDescription: 'jd', suggestions: [],
  sourceFileName: 'resume.docx', matchedKeywords: ['saved?'], missingKeywords: ['saved?'],
})
assert.equal('matchedKeywords' in persisted, false, 'does not persist derived matched keywords')
assert.equal('missingKeywords' in persisted, false, 'does not persist derived missing keywords')

const enqueue = createResumeWriteQueue()
await assert.rejects(enqueue(async () => { throw new Error('disk failure') }), 'reports the current persistence failure')
let recoveredWriteRan = false
await enqueue(async () => { recoveredWriteRan = true })
assert.equal(recoveredWriteRan, true, 'continues persistence after an earlier write failure')

console.log('Resume optimizer verification passed')
