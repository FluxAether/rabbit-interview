import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as mammoth from 'mammoth'
import {
  countResumeWords,
  createEmptyResumeWorkspace,
  createResumeAnalysisRequestCoordinator,
  mergeResumeWorkspace,
  normalizeLlmResumeResult,
  normalizeResumeText,
} from '../src/lib/resumeOptimizer.ts'
import { buildResumeDocxBlob, sanitizeResumeFilename } from '../src/lib/resumeDocuments.ts'
import {
  MAX_RESUME_FILE_SIZE,
  MAX_RESUME_TEXT_LENGTH,
  extractResumeText,
  pdfItemsToText,
  validateResumeFile,
  validateResumeText,
} from '../src/lib/resumeImport.ts'
import {
  createResumeWriteQueue,
  hasResumeWorkspaceContent,
  normalizeResumeWorkspace,
  toPersistedResumeWorkspace,
} from '../src/lib/resumeWorkspaceStore.ts'

assert.equal(countResumeWords('Led design 用户研究'), 6, 'counts English words and CJK characters')

const unformatted = '  Alex  \r\n-  Built products   \r\n\r\n\r\nSkills  '
const normalized = 'Alex\n• Built products\n\nSkills'
assert.equal(normalizeResumeText(unformatted), normalized, 'normalizes whitespace and bullets')
assert.equal(normalizeResumeText(normalized), normalized, 'normalization is idempotent')

const editedWorkspace = mergeResumeWorkspace({
  original: 'React', optimized: 'React', jobDescription: 'React Rust', suggestions: [],
  sourceFileName: 'resume.docx', matchedKeywords: ['React'], missingKeywords: ['Rust'],
}, { optimized: 'React Rust' })
assert.deepEqual(editedWorkspace.missingKeywords, [], 'recomputes keyword gaps after resume edits')
const changedJob = mergeResumeWorkspace(editedWorkspace, { jobDescription: 'Kubernetes' })
assert.deepEqual(changedJob.missingKeywords, ['Kubernetes'], 'recomputes keyword gaps after job-description edits')

const requests = createResumeAnalysisRequestCoordinator(10_000)
const firstRequest = requests.start()
const secondRequest = requests.start()
assert.equal(firstRequest.signal.aborted, true, 'aborts an older resume analysis request')
assert.equal(firstRequest.isLatest(), false, 'marks an older resume analysis request as stale')
assert.equal(secondRequest.isLatest(), true, 'keeps the newest resume analysis request current')
requests.cancel()
assert.equal(secondRequest.signal.aborted, true, 'aborts the current request when the page unmounts')

const timedRequests = createResumeAnalysisRequestCoordinator(0)
const timedRequest = timedRequests.start()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(timedRequest.signal.aborted, true, 'aborts a resume analysis request after its timeout')
timedRequest.finish()

const llmAnalysis = normalizeLlmResumeResult({
  optimizedText: 'Alex Morgan\n• Led product design',
  suggestions: [
    {
      title: 'Improved formatting',
      description: 'Normalized the bullet formatting.',
      category: 'impact',
      requiresUserInput: false,
    },
    {
      title: 'Add a verified outcome',
      description: 'Add a metric only when the real result is known.',
      category: 'impact',
      requiresUserInput: true,
    },
  ],
}, 'Alex Morgan\nLed product design', 'Product design TypeScript')
assert.equal(llmAnalysis.optimizedText, 'Alex Morgan\n• Led product design', 'uses the LLM optimized resume')
assert.equal(llmAnalysis.suggestions[0]?.title, 'Improved formatting', 'keeps LLM copy separate from translation keys')
assert.equal(llmAnalysis.suggestions[0]?.applied, true, 'marks changes already included by the LLM as applied')
assert.equal(llmAnalysis.suggestions[1]?.applied, false, 'leaves factual gaps for manual input')
assert.ok(llmAnalysis.missingKeywords.some((keyword) => keyword.toLowerCase() === 'typescript'), 'derives keyword gaps locally')
const faithfulRewrite = normalizeLlmResumeResult({
  optimizedText: 'Contributed to product onboarding',
  suggestions: [],
}, 'Responsible for product onboarding', 'Candidates contributed to product onboarding')
assert.equal(faithfulRewrite.optimizedText, 'Contributed to product onboarding', 'accepts a faithful wording improvement')
const formattedNumber = normalizeLlmResumeResult({
  optimizedText: 'Supported 1000 users',
  suggestions: [],
}, 'Served 1,000 users', '')
assert.equal(formattedNumber.optimizedText, 'Supported 1000 users', 'accepts harmless thousands-separator formatting')
const formattedFullWidthNumber = normalizeLlmResumeResult({
  optimizedText: '成果：¥20%',
  suggestions: [],
}, '成果：￥２０％', '')
assert.equal(formattedFullWidthNumber.optimizedText, '成果：¥20%', 'accepts equivalent full-width numeric formatting')
const formattedDateRange = normalizeLlmResumeResult({
  optimizedText: '示例公司｜产品经理｜2020 - 2024',
  suggestions: [],
}, '示例公司｜产品经理｜2020-2024', '')
assert.equal(formattedDateRange.optimizedText, '示例公司｜产品经理｜2020 - 2024', 'accepts harmless date-range spacing')
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: '', suggestions: [] }, 'Original', ''),
  'rejects an empty LLM result',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Increased revenue by 40%', suggestions: [] }, 'Improved revenue', ''),
  'rejects numeric facts not present in the source resume',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Improved revenue', suggestions: [] }, 'Improved revenue by 20%', ''),
  'rejects removal of a protected numeric fact',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Variance: +20%', suggestions: [] }, 'Variance: -20%', ''),
  'rejects a changed numeric sign',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Score: 5.3', suggestions: [] }, 'Score: 3.5', ''),
  'rejects reordered decimal digits',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Score: 35', suggestions: [] }, 'Score: 3,5', ''),
  'rejects collapsing a decimal comma into an integer',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Impact: +$20', suggestions: [] }, 'Impact: -$20', ''),
  'rejects a changed sign before currency',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Budget: € 20', suggestions: [] }, 'Budget: $ 20', ''),
  'rejects a spaced currency change',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Growth: 20', suggestions: [] }, 'Growth: 20 %', ''),
  'rejects removal of a spaced percent sign',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: '成果：€２０％', suggestions: [] }, '成果：¥２０％', ''),
  'rejects a changed currency around full-width digits',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'linkedin.com/in/sam', suggestions: [] }, 'linkedin.com/in/alex', ''),
  'rejects a changed bare profile URL',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'portfolio.dev?ref=two', suggestions: [] }, 'portfolio.dev?ref=one', ''),
  'rejects a changed bare-domain query',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'sam@example.com', suggestions: [] }, 'alex@example.com', ''),
  'rejects a changed email address',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Improved revenue' }, 'Improved revenue', ''),
  'rejects an incomplete LLM schema',
)
assert.throws(
  () => normalizeLlmResumeResult({ optimizedText: 'Too short', suggestions: [] }, 'Relevant experience. '.repeat(30), ''),
  'rejects a materially truncated optimized resume',
)

assert.equal(validateResumeFile({ name: 'resume.pdf', size: MAX_RESUME_FILE_SIZE }), null, 'accepts a PDF at the size limit')
assert.equal(validateResumeFile({ name: 'resume.docx', size: MAX_RESUME_FILE_SIZE + 1 }), 'file-too-large', 'rejects files over 5 MiB')
assert.equal(validateResumeFile({ name: 'resume.txt', size: 12 }), 'unsupported-file-type', 'rejects unsupported file types')
assert.equal(validateResumeText('A'.repeat(MAX_RESUME_TEXT_LENGTH)), null, 'accepts resume text at the analysis limit')
assert.equal(validateResumeText('A'.repeat(MAX_RESUME_TEXT_LENGTH + 1)), 'resume-text-too-long', 'rejects resume text beyond the analysis limit')
assert.equal(validateResumeText('  '), 'empty-resume-text', 'rejects resume files without extractable text')
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
assert.equal(hasResumeWorkspaceContent(createEmptyResumeWorkspace()), false, 'clears persistence for an empty workspace')
assert.equal(hasResumeWorkspaceContent({ ...createEmptyResumeWorkspace(), jobDescription: 'React' }), true, 'persists a workspace containing only a job description')
const restored = normalizeResumeWorkspace({
  original: 'Product design', optimized: 'Product design', jobDescription: 'Product design TypeScript',
  suggestions: [], sourceFileName: 'resume.docx',
})
assert.ok(restored.missingKeywords.some((keyword) => keyword.toLowerCase() === 'typescript'), 'recomputes JD match counts when restoring a workspace')
const restoredLlmSuggestion = normalizeResumeWorkspace({
  original: 'Alex Morgan', optimized: llmAnalysis.optimizedText, jobDescription: '',
  suggestions: llmAnalysis.suggestions, sourceFileName: 'resume.docx',
})
assert.equal(restoredLlmSuggestion.suggestions[0]?.title, 'Improved formatting', 'restores saved LLM suggestion copy')

const enqueue = createResumeWriteQueue()
await assert.rejects(enqueue(async () => { throw new Error('disk failure') }), 'reports the current persistence failure')
let recoveredWriteRan = false
await enqueue(async () => { recoveredWriteRan = true })
assert.equal(recoveredWriteRan, true, 'continues persistence after an earlier write failure')

const translations = fs.readFileSync('src/i18n/translations.ts', 'utf8')
for (const key of [
  'resume.analysisComplete',
  'resume.analysisError',
  'resume.analysisTimeout',
  'resume.factReviewConfirm',
  'resume.factReviewRequired',
  'resume.includedInDraft',
  'resume.textTooLong',
]) {
  assert.equal(translations.split(`'${key}'`).length - 1, 3, `translates ${key} in all supported UI languages`)
}

console.log('Resume optimizer verification passed')
