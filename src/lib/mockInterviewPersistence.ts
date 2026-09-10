import { deleteSetting, getDb, loadSetting, saveSetting } from './db.ts'
import { createMockInterviewSnapshot, type MockInterviewSnapshot } from './mockInterviewState.ts'
import type { InterviewRecord } from '../stores/useAppStore'

const DRAFT_KEY = 'mock_interview_draft_v1'
let writes: Promise<unknown> = Promise.resolve()

export async function loadMockDraft(): Promise<MockInterviewSnapshot | null> {
  await writes.catch(() => {})
  const raw = await loadSetting(DRAFT_KEY)
  if (raw === null) return null
  return parseMockDraft(raw)
}

export function parseMockDraft(raw: string): MockInterviewSnapshot {
  const saved = JSON.parse(raw)
  if (!saved || typeof saved.sessionId !== 'string' || !saved.config
    || !['zh-CN', 'zh-TW', 'en-US'].includes(saved.config.language)
    || !['role', 'company', 'resumeContext', 'jobDescription'].every(key => typeof saved.config[key] === 'string')
    || !Array.isArray(saved.turns) || !Array.isArray(saved.coverage)
    || !saved.turns.every((turn: any) => turn?.question && typeof turn.question.id === 'string'
      && typeof turn.question.text === 'string' && Array.isArray(turn.question.competencies)
      && (turn.answer === null || typeof turn.answer?.text === 'string'))
    || (saved.plan !== null && !Array.isArray(saved.plan?.slots))) {
    throw new Error('Invalid saved mock interview')
  }
  const empty = createMockInterviewSnapshot(saved.config.language)
  return { ...empty, ...saved, config: { ...empty.config, ...saved.config }, phase: saved.phase === 'completed' ? 'completed' : 'paused' }
}

export function persistMockDraft(snapshot: MockInterviewSnapshot, recording?: Promise<{ path: string } | null>): Promise<void> {
  // Queue immediately so a remounted page waits for navigation cleanup before loading.
  const json = JSON.stringify(snapshot)
  const operation = writes.catch(() => {}).then(async () => {
    const saved: MockInterviewSnapshot = JSON.parse(json)
    if (recording) saved.recordingPath = (await recording)?.path || saved.recordingPath
    await saveSetting(DRAFT_KEY, JSON.stringify(saved))
  })
  writes = operation
  return operation
}

export function clearMockDraft(): Promise<void> {
  const operation = writes.catch(() => {}).then(() => deleteSetting(DRAFT_KEY))
  writes = operation
  return operation
}

export async function saveMockInterviewRecord(record: InterviewRecord, sessionId: string): Promise<number> {
  const db = await getDb()
  const predicate = "mode LIKE 'mock%' AND CASE WHEN json_valid(details_json) THEN json_extract(details_json, '$.sessionId') END = ?"
  const values = [record.date, record.role, record.company, record.score, record.transcript, record.duration, record.mode, record.recordingPath ?? null, record.detailsJson ?? null]
  // The conditional insert is atomic; retry after a crash updates the same session.
  await db.execute(`INSERT INTO interviews (date, role, company, score, transcript, duration, mode, recording_path, details_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM interviews WHERE ${predicate})`, [...values, sessionId])
  const rows = await db.select<{ id: number }>(`SELECT id FROM interviews WHERE ${predicate} LIMIT 1`, [sessionId])
  const id = rows[0]?.id
  if (id == null) throw new Error('Interview was not saved')
  await db.execute('UPDATE interviews SET date = ?, role = ?, company = ?, score = ?, transcript = ?, duration = ?, mode = ?, recording_path = ?, details_json = ? WHERE id = ?', [...values, id])
  return id
}
