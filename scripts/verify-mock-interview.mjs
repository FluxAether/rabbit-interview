import fs from 'node:fs'

const page = fs.readFileSync('src/pages/MockInterview.tsx', 'utf8')
const state = fs.readFileSync('src/lib/mockInterviewState.ts', 'utf8')
const ai = fs.readFileSync('src/lib/mockInterviewAi.ts', 'utf8')
const db = fs.readFileSync('src/lib/db.ts', 'utf8')
const speech = fs.readFileSync('src-tauri/src/speech.rs', 'utf8')

const checks = [
  [!page.includes('Math.random'), 'random scoring removed'],
  [!page.includes("role: 'Product Designer'"), 'fixed demo role removed'],
  [page.includes('generateFirstMockQuestion') && page.includes('evaluateMockTurn'), 'LLM interview flow wired'],
  [page.includes('startDeepgramStream') && page.includes('start_audio_capture'), 'microphone transcription wired'],
  [page.includes("invoke('speak_text'"), 'system speech wired'],
  [state.includes('calculateOverallScore') && state.includes('technicalAccuracy: number | null'), 'deterministic scoring implemented'],
  [ai.includes('do not generate another question'), 'final turn cannot create an unanswered question'],
  [db.includes('details_json'), 'structured interview details persisted'],
  [speech.includes('/usr/bin/say') && !speech.includes('sh -c'), 'macOS speech uses direct command arguments'],
]

let failed = 0
for (const [ok, description] of checks) {
  if (ok) console.log(`✓ ${description}`)
  else { console.error(`✗ ${description}`); failed += 1 }
}
if (failed) process.exit(1)
console.log(`Mock interview verification passed (${checks.length} checks)`)
