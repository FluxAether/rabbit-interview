import assert from 'node:assert/strict'
import {
  MAX_RESUME_FILE_SIZE,
  analyzeResume,
  applyAllResumeSuggestions,
  applyResumeSuggestion,
  countResumeWords,
  normalizeResumeText,
  sanitizeResumeFilename,
  validateResumeFile,
} from '../src/lib/resumeOptimizer.ts'
import { buildResumeDocxBlob } from '../src/lib/resumeDocuments.ts'

assert.equal(countResumeWords('Led design 用户研究'), 6, 'counts English words and CJK characters')

const unformatted = '  Alex  \r\n-  Built products   \r\n\r\n\r\nSkills  '
const normalized = 'Alex\n• Built products\n\nSkills'
assert.equal(normalizeResumeText(unformatted), normalized, 'normalizes whitespace and bullets')
assert.equal(normalizeResumeText(normalized), normalized, 'normalization is idempotent')

const analysis = analyzeResume(
  'I was responsible for product design\n• Improved onboarding',
  'Product design, TypeScript and 用户研究',
)
assert.equal(analysis.optimizedText.includes('TypeScript'), false, 'never invents missing JD keywords')
assert.ok(analysis.matchedKeywords.some((keyword) => keyword.toLowerCase() === 'product'), 'reports matched JD keywords')
assert.ok(analysis.missingKeywords.some((keyword) => keyword.toLowerCase() === 'typescript'), 'reports missing English JD keywords')
assert.ok(analysis.missingKeywords.includes('用户研究'), 'reports missing Chinese JD keywords')

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
assert.equal(sanitizeResumeFilename('My Resume 2026.docx'), 'My Resume 2026-optimized.docx', 'creates a safe DOCX filename')
assert.equal(sanitizeResumeFilename('../../.docx'), 'resume-optimized.docx', 'falls back for unsafe filenames')

const docxBlob = await buildResumeDocxBlob('Alex Morgan\nEXPERIENCE\n• Built onboarding')
assert.equal(docxBlob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'exports the DOCX MIME type')
assert.deepEqual([...new Uint8Array(await docxBlob.slice(0, 2).arrayBuffer())], [0x50, 0x4b], 'exports a ZIP-based DOCX file')

console.log('Resume optimizer verification passed')
