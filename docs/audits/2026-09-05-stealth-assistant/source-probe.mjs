// Read-only source probe. Run from the repository root with Node.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

function loadFunctions(file, names, dependencies = {}) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const selected = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  assert.equal(selected.length, names.length, `Missing source functions in ${file}`)
  const output = ts.transpileModule(selected.map((node) => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export /gm, '')
  return new Function(...Object.keys(dependencies), `${output}; return {${names.join(',')}}`)(...Object.values(dependencies))
}

const { orderCopilotMessagesForDisplay: order, createInitialSnapshot, reduceCopilotSnapshot: reduce } = loadFunctions(
  'src/lib/copilotSessionState.ts',
  ['isCurrent', 'upsertMessage', 'isFollowUp', 'isDisplayAnchor', 'orderCopilotMessagesForDisplay', 'createInitialSnapshot', 'reduceCopilotSnapshot'],
)
const { groupCopilotMessages: group, extractKeyTakeaways: takeaways } = loadFunctions(
  'src/lib/copilotPresentation.ts', ['groupCopilotMessages', 'extractKeyTakeaways'],
  { orderCopilotMessagesForDisplay: order },
)
const answer = '先确认需求边界，再说明实施步骤，最后给出验证结果。'.repeat(12)
const makeMessages = (count) => Array.from({ length: count }, (_, index) => ({
  id: index + 1, role: index % 2 ? 'assistant' : 'interviewer',
  source: index % 2 ? 'llm' : 'system-stt', text: index % 2 ? answer : `请说明方案 ${index / 2 + 1}`,
  createdAt: index, ...(index % 2 ? { replyToId: index } : {}),
}))

function measure(fn) {
  for (let i = 0; i < 12; i++) fn()
  const samples = Array.from({ length: 50 }, () => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }).sort((a, b) => a - b)
  return { medianMs: +samples[25].toFixed(3), p95Ms: +samples[47].toFixed(3) }
}

const timings = [50, 200, 500, 1000, 2000].map((count) => {
  const messages = makeMessages(count)
  let visits = 0
  const counted = new Proxy(messages, { get(target, key, receiver) {
    if (key === Symbol.iterator) return function* () { for (const message of target) { visits++; yield message } }
    if (key === 'find') return (predicate) => target.find((message) => { visits++; return predicate(message) })
    return Reflect.get(target, key, receiver)
  } })
  const ordered = order(counted)
  assert.equal(ordered.length, count)
  assert.equal(new Set(ordered.map((message) => message.id)).size, count)
  const snapshot = { ...createInitialSnapshot(), messages }
  return { count, sourceScanVisits: visits, grouping: measure(() => group(messages)),
    allTakeaways: measure(() => messages.forEach((message) => { if (message.role === 'assistant') takeaways(message.text) })),
    snapshotJsonBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    stringify: measure(() => JSON.stringify(snapshot)),
  }
})

const messages = makeMessages(2)
const snapshot = { ...createInitialSnapshot(), phase: 'listening', sessionId: 1, messages }
const amplitude = reduce(snapshot, { type: 'amplitude', sessionId: 1, amplitude: 0.4 })
const streamed = reduce(snapshot, { type: 'stream-answer', sessionId: 1,
  suggestion: { id: 2, text: answer + '新增文字', category: 'AI' }, replyToId: 1 })
assert.notEqual(amplitude, snapshot)
assert.equal(amplitude.messages, snapshot.messages)
assert.equal(streamed.messages[0], messages[0])

console.log(JSON.stringify({
  evidenceScope: 'Node source functions only; excludes React reconciliation, DOM layout, paint, IPC and scrolling FPS.',
  node: process.version, timings,
  observations: {
    singleParagraphTakeawayDuplicatesFullAnswer: takeaways(answer).join('') === answer,
    groupKeyBeforeAnswer: group(messages.slice(0, 1))[0][0].id,
    groupKeyAfterAnswer: group(messages)[0][0].id,
    amplitudeChangesSnapshot: amplitude !== snapshot,
    amplitudePreservesMessageArrayInHost: amplitude.messages === snapshot.messages,
    serializationRoundTripPreservesMessageArray: JSON.parse(JSON.stringify(amplitude)).messages === snapshot.messages,
    streamPreservesUnchangedQuestionObject: streamed.messages[0] === messages[0],
  },
}, null, 2))
