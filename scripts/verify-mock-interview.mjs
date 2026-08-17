import assert from 'node:assert/strict'
import fs from 'node:fs'
import { defaultMockInterviewConfig } from '../src/lib/mockInterviewState.ts'
import {
  applyAnswerCoverage,
  createInitialCoverage,
  markFollowUpIssued,
  maxFollowUpsSession,
  normalizeFeedback,
} from '../src/lib/mockInterviewState.ts'
import { buildEvidenceBrief } from '../src/lib/mockInterviewEvidence.ts'
import { buildInterviewPlan, normalizePrimaryCount } from '../src/lib/mockInterviewPlan.ts'
import { decideNextAction, isNearDuplicateQuestion } from '../src/lib/mockInterviewPolicy.ts'
import {
  applyVoiceTranscriptEvent,
  createVoiceEndpointState,
  isMinimumVoiceAnswer,
  SPEECH_FINAL_GRACE_MS,
  transcriptFromEndpointState,
} from '../src/lib/mockInterviewVoiceEndpoint.ts'

const page = fs.readFileSync('src/pages/MockInterview.tsx', 'utf8')
const state = fs.readFileSync('src/lib/mockInterviewState.ts', 'utf8')
const ai = fs.readFileSync('src/lib/mockInterviewAi.ts', 'utf8')
const db = fs.readFileSync('src/lib/db.ts', 'utf8')
const speech = fs.readFileSync('src-tauri/src/speech.rs', 'utf8')
const voice = fs.readFileSync('src/lib/mockInterviewVoiceSession.ts', 'utf8')
const llm = fs.readFileSync('src/lib/llm.ts', 'utf8')
const i18n = fs.readFileSync('src/i18n/translations.ts', 'utf8')

const checks = [
  [!page.includes('Math.random'), 'random scoring removed'],
  [!page.includes("role: 'Product Designer'"), 'fixed demo role removed'],
  [page.includes('generateQuestionForSlot') && page.includes('evaluateMockTurn') && page.includes('decideNextAction'), 'planned interview flow wired'],
  [voice.includes('startDeepgramStream') && voice.includes("invoke<AudioConfig>('start_audio_capture'"), 'voice runtime owns microphone transcription'],
  [page.includes('mockInterviewVoiceSession.start') && page.includes('mockInterviewVoiceSession.ask'), 'page delegates voice turns to voice runtime'],
  [!page.includes('startDeepgramStream') && !page.includes("listen<AudioChunk>('audio-source-chunk'"), 'page no longer owns STT transport'],
  [page.includes("invoke('speak_text'"), 'text fallback speech wired'],
  [state.includes('calculateOverallScore') && state.includes('technicalAccuracy: number | null'), 'deterministic scoring implemented'],
  [ai.includes('Do not generate another question'), 'evaluate cannot create the next question'],
  [ai.includes('generateQuestionForSlot') && ai.includes('generateFollowUpQuestion'), 'question generation is slot-scoped'],
  [!ai.includes('generateFirstMockQuestion'), 'legacy first-question helper removed'],
  [db.includes('details_json'), 'structured interview details persisted'],
  [speech.includes('/usr/bin/say') && !speech.includes('sh -c'), 'macOS speech uses direct command arguments'],
  [speech.includes('child.try_wait()') && speech.includes('tokio::time::sleep') && speech.includes('SpeechState'), 'TTS resolves on real process completion with cancellation generation'],
  [!page.includes('question.text.length *') && page.includes('presentQuestion'), 'question timing no longer uses text-length delays'],
  [page.includes('preserveTranscript') && page.includes('replayCurrentQuestion'), 'replay preserves the current voice transcript'],
  [page.includes('await mockInterviewVoiceSession.stop({ saveRecording: false })') && page.includes('copy.roleRequired'), 'start failure stops leftover voice runtime and localizes validation'],
  [page.includes('finishingRef.current') && page.includes('submittingQuestionIdRef.current'), 'end and answer submission are single-flight'],
  [page.includes('version: 2') && page.includes('plan: current.plan'), 'detailsJson persists plan coverage'],
  [page.includes("t('mock.progress.primary'") && page.includes("t('mock.report.coverage')"), 'coverage copy is localized'],
  [page.includes('if (!nextSlot) throw new Error') && !page.includes('currentSlot || plan.slots[0]') && !page.includes('slotById(plan, action.slotId) || plan.slots[0]'), 'missing slots fail instead of falling back to intro'],
  [page.includes('const reportController = new AbortController()') && page.includes('generateMockReport(current.config, current.plan, coverage, turns, completedNormally, reportController.signal)'), 'report generation uses a fresh abort signal'],
  [voice.includes("reason: 'utterance-end' | 'speech-final' | 'manual'") && voice.includes('finalizedAnswerGeneration'), 'voice runtime finalizes each answer at most once'],
  [llm.includes('DeepgramStreamOptions') && llm.includes('__deepgramOptions') && llm.includes('options.language'), 'Deepgram stream options survive reconnects'],
  [state.includes('voiceInputEnabled: true'), 'voice interview is the default mode'],
]

let failed = 0
for (const [ok, description] of checks) {
  if (ok) console.log(`✓ ${description}`)
  else { console.error(`✗ ${description}`); failed += 1 }
}

for (const key of [
  'mock.setup.primaryCount',
  'mock.progress.primary',
  'mock.progress.followUp',
  'mock.question.followUp',
  'mock.report.coverage',
  'mock.coverage.weak',
  'mock.voice.finishAnswer',
  'mock.voice.phase.listening',
]) {
  const count = i18n.split(`'${key}'`).length - 1
  if (count === 3) console.log(`✓ ${key} translated`)
  else {
    console.error(`✗ ${key} expected in 3 locales, found ${count}`)
    failed += 1
  }
}

const emptyBrief = buildEvidenceBrief('', '')
assert.equal(emptyBrief.source, 'empty')
assert.equal(emptyBrief.resumeEmpty, true)
assert.deepEqual(emptyBrief.projects, [])

const extracted = buildEvidenceBrief(
  '项目经历\n支付中台 2023\n• 负责对账链路，使用 Rust 和 Kafka 降低延迟 30%\n专业技能\nRust, Kafka, React',
  'Must have Rust and Kubernetes.\nNice to have Figma.',
)
assert.equal(extracted.source, 'extracted')
assert.ok(extracted.projects.some(project => project.name.includes('支付中台')), 'extracts project names from resume headings')
assert.ok(extracted.overlap.includes('Rust'), 'marks overlapping JD skills')
assert.ok(extracted.gaps.includes('Kubernetes'), 'keeps missing required skills as gaps')
assert.ok(!extracted.projects.some(project => /Acme|invented/i.test(project.name)), 'does not invent companies')

const workspaceBrief = buildEvidenceBrief(
  'React engineer',
  'Must have React and Rust.',
  {
    requirements: [
      { keyword: 'React', priority: 'required', status: 'supported', evidence: 'React engineer' },
      { keyword: 'Rust', priority: 'required', status: 'unsupported', evidence: '' },
    ],
    analysisOriginalFingerprint: '15:8f0c7b3f',
    analysisJobDescriptionFingerprint: '21:deadbeef',
  },
)
assert.equal(workspaceBrief.source, 'extracted', 'stale workspace fingerprints fall back to local extraction')

const config = defaultMockInterviewConfig('zh-CN')
config.role = 'Backend Engineer'
config.interviewType = 'mixed'
config.difficulty = 'mid'
config.questionCount = 5
config.resumeContext = extracted.projects[0]?.summary || 'Rust'
config.jobDescription = 'Must have Rust and Kubernetes.'

const mixedPlan = buildInterviewPlan(config, extracted)
assert.equal(mixedPlan.primaryCount, 5)
assert.equal(mixedPlan.slots.length, 5)
assert.equal(mixedPlan.slots[0].stage, 'introduction')
assert.equal(mixedPlan.slots.at(-1)?.stage, 'conclusion')
assert.equal(mixedPlan.slots[0].allowFollowUp, false)
assert.equal(mixedPlan.slots.at(-1)?.allowFollowUp, false)
assert.equal(mixedPlan.maxFollowUpsSession, maxFollowUpsSession(5))
const mixedCores = mixedPlan.slots.slice(1, -1)
assert.ok(mixedCores.some(slot => slot.stage === 'behavioral'), 'mixed plan includes behavioral cores')
assert.ok(mixedCores.some(slot => slot.stage === 'technical'), 'mixed plan includes technical cores')

config.interviewType = 'behavioral'
const behavioralPlan = buildInterviewPlan(config, extracted)
assert.ok(behavioralPlan.slots.slice(1, -1).every(slot => slot.stage === 'behavioral'), 'behavioral type locks core stages')

config.interviewType = 'technical'
config.questionCount = 8
const technicalPlan = buildInterviewPlan(config, extracted)
assert.equal(normalizePrimaryCount(8), 8)
assert.equal(technicalPlan.slots.length, 8)
assert.ok(technicalPlan.slots.slice(1, -1).every(slot => slot.stage === 'technical'), 'technical type locks core stages')

const coverage = createInitialCoverage(mixedPlan)
const weakFeedback = normalizeFeedback({
  scores: { clarity: 70, relevance: 60, structure: 65, specificity: 40, impact: 30, technicalAccuracy: null },
  gaps: ['metric', 'technical-depth', 'not-a-gap'],
  coveredCompetency: false,
})
assert.deepEqual(weakFeedback.gaps, ['metric', 'technical-depth'])
const afterIntro = applyAnswerCoverage(coverage, mixedPlan.slots[0].id, weakFeedback)
assert.equal(decideNextAction({
  plan: mixedPlan,
  coverage: afterIntro,
  currentSlotId: mixedPlan.slots[0].id,
  feedback: weakFeedback,
}).type, 'next-primary', 'intro never follow-ups')

const coreSlot = mixedPlan.slots[1]
const afterCore = applyAnswerCoverage(afterIntro, coreSlot.id, weakFeedback)
const follow = decideNextAction({
  plan: mixedPlan,
  coverage: afterCore,
  currentSlotId: coreSlot.id,
  feedback: weakFeedback,
})
assert.equal(follow.type, 'follow-up')
if (follow.type === 'follow-up') {
  assert.ok(follow.gaps.includes('metric'))
}

const afterFollow = markFollowUpIssued(afterCore, coreSlot.id)
const covered = normalizeFeedback({
  scores: { clarity: 80, relevance: 80, structure: 80, specificity: 80, impact: 80, technicalAccuracy: null },
  gaps: [],
  coveredCompetency: true,
})
assert.equal(decideNextAction({
  plan: mixedPlan,
  coverage: afterFollow,
  currentSlotId: coreSlot.id,
  feedback: covered,
}).type, 'next-primary', 'one follow-up per primary')

const exhausted = mixedPlan.slots.reduce((current, slot) => {
  const asked = applyAnswerCoverage(current, slot.id, covered)
  return slot.allowFollowUp ? markFollowUpIssued(asked, slot.id) : asked
}, createInitialCoverage(mixedPlan))
assert.equal(decideNextAction({
  plan: mixedPlan,
  coverage: exhausted,
  currentSlotId: mixedPlan.slots.at(-1).id,
  feedback: covered,
}).type, 'end')

assert.equal(isNearDuplicateQuestion('Tell me about a time you led a project', ['Tell me about a time you led a project.']), true)
assert.equal(isNearDuplicateQuestion('How would you design a payment ledger?', ['Tell me about a time you led a project']), false)

let endpoint = createVoiceEndpointState()
let endpointUpdate = applyVoiceTranscriptEvent(endpoint, {
  text: '我最近',
  isFinal: false,
  boundary: 'interim',
}, 1_000)
endpoint = endpointUpdate.state
assert.equal(endpoint.answerStartedAt, 1_000, 'first voice activity records answer start time')
assert.equal(endpoint.interimTranscript, '我最近')

endpointUpdate = applyVoiceTranscriptEvent(endpoint, {
  text: '我最近负责支付平台',
  isFinal: true,
  boundary: 'speech-final',
}, 1_500)
endpoint = endpointUpdate.state
assert.equal(endpointUpdate.endpoint, 'speech-final')
assert.equal(transcriptFromEndpointState(endpoint), '我最近负责支付平台')
assert.equal(isMinimumVoiceAnswer(transcriptFromEndpointState(endpoint)), true)

endpointUpdate = applyVoiceTranscriptEvent(endpoint, {
  text: '我最近负责支付平台',
  isFinal: true,
  boundary: 'final',
}, 1_600)
endpoint = endpointUpdate.state
assert.equal(transcriptFromEndpointState(endpoint), '我最近负责支付平台', 'duplicate final transcript is ignored')

endpointUpdate = applyVoiceTranscriptEvent(endpoint, {
  text: '我最近负责支付平台和账务系统',
  isFinal: true,
  boundary: 'final',
}, 1_700)
endpoint = endpointUpdate.state
assert.equal(transcriptFromEndpointState(endpoint), '我最近负责支付平台和账务系统', 'cumulative final transcript replaces its shorter prefix')

endpointUpdate = applyVoiceTranscriptEvent(endpoint, {
  text: '',
  isFinal: false,
  boundary: 'utterance-end',
}, 2_000)
assert.equal(endpointUpdate.endpoint, 'utterance-end')
assert.equal(isMinimumVoiceAnswer('嗯'), false, 'single CJK filler is not auto-submitted')
assert.equal(isMinimumVoiceAnswer('yes'), false, 'single English token is not auto-submitted')
assert.equal(isMinimumVoiceAnswer('yes I did'), true, 'three English tokens form a valid automatic answer')
assert.equal(SPEECH_FINAL_GRACE_MS, 900, 'speech-final uses the planned grace period')

if (failed) process.exit(1)
console.log(`Mock interview verification passed (${checks.length} static checks + planner/voice assertions)`)
