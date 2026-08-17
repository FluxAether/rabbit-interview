import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const mock = read('src/pages/MockInterview.tsx')
const resume = read('src/pages/ResumeOptimizer.tsx')
const history = read('src/pages/History.tsx')
const settings = read('src/pages/Settings.tsx')
const i18n = read('src/i18n/translations.ts')
const stats = read('src/lib/dashboardStats.ts')
const dashboard = read('src/pages/Dashboard.tsx')
const stealth = read('src/pages/StealthCopilot.tsx')
const panel = read('src/components/CopilotPanel.tsx')

assert.match(mock, /current\.currentQuestion\?\.id === question\.id && current\.phase === 'speaking'/)
assert.match(mock, /copy\.roleRequired/)
assert.match(mock, /finishingRef\.current/)
assert.match(mock, /await mockInterviewVoiceSession\.stop\(\{ saveRecording: false \}\)/)
assert.equal(mock.includes('suggestion.description || suggestion.title'), false)

assert.match(resume, /if \(!suggestion\.replacement\) return/)
assert.match(resume, /resume\.startFactReview/)
assert.match(resume, /resume\.manualFill/)
assert.equal(resume.includes('suggestion.description || suggestion.title'), false)

assert.match(history, /listStatus === \'loading\'/)
assert.match(history, /history\.loadError/)
assert.match(history, /history\.exportPage/)
assert.match(history, /history\.noTranscript/)

assert.match(settings, /settings\.saveFailed/)
assert.match(settings, /settingsHydrated/)
assert.match(settings, /settings\.heading\./)
assert.match(settings, /settings\.stt\.title/)
assert.match(settings, /shortcutMod/)

assert.match(stats, /current > 0 \? null : 0/)
assert.match(dashboard, /dashboard\.monthDelta/)
assert.match(dashboard, /dashboard\.stat\.total/)

assert.match(stealth, /audioReady/)
assert.match(stealth, /copilot\.audioConfig/)
assert.match(panel, /role="log"/)
assert.doesNotMatch(panel, /aria-live="polite"/)

for (const key of [
  'history.replayModal.title',
  'settings.apiKeys.help',
  'settings.secureNote',
  'resume.startFactReview',
  'settings.saveFailed',
]) {
  assert.equal(i18n.split(`'${key}'`).length - 1, 3, `${key} exists in all languages`)
}

console.log('UI audit fixes verification passed')
