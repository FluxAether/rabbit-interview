import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, Mic, Volume2, FileText } from 'lucide-react'
import { useAppStore, selectResumeWorkspace } from '../stores/useAppStore'
import { useTranslation } from '../i18n'
import { saveInterview } from '../lib/db'
import { generateQuestionForSlot, generateFollowUpQuestion, evaluateMockTurn, generateMockReport } from '../lib/mockInterviewAi'
import { buildEvidenceBrief } from '../lib/mockInterviewEvidence'
import { buildInterviewPlan } from '../lib/mockInterviewPlan'
import { decideNextAction } from '../lib/mockInterviewPolicy'
import {
  applyAnswerCoverage,
  buildMockReportMarkdown,
  buildMockTranscript,
  countPrimaryQuestions,
  createInitialCoverage,
  createMockInterviewSnapshot,
  markFollowUpIssued,
  slotById,
  type MockInterviewQuestion,
  type MockInterviewSnapshot,
} from '../lib/mockInterviewState'
import {
  createMockInterviewVoiceSnapshot,
  mockInterviewVoiceSession,
  type MockInterviewVoiceSnapshot,
} from '../lib/mockInterviewVoiceSession'
import { MAX_RECORDING_SECONDS } from '../lib/recordingLimits'

interface SubmitAnswerInput {
  text?: string
  source?: 'voice' | 'text' | 'mixed'
  startedAt?: number
  submittedAt?: number
}

const labels = {
  'zh-CN': { title: 'AI 模拟面试', start: '开始面试', role: '目标职位', company: '公司（选填）', answer: '你的回答', submit: '提交回答', end: '提前结束', retry: '重试', new: '开始新面试', roleRequired: '请填写目标职位。', ending: '正在生成报告…', replay: '重播题目', generating: '正在生成问题…' },
  'zh-TW': { title: 'AI 模擬面試', start: '開始面試', role: '目標職位', company: '公司（選填）', answer: '你的回答', submit: '提交回答', end: '提前結束', retry: '重試', new: '開始新面試', roleRequired: '請填寫目標職位。', ending: '正在產生報告…', replay: '重播題目', generating: '正在產生問題…' },
  'en-US': { title: 'AI Mock Interview', start: 'Start interview', role: 'Target role', company: 'Company (optional)', answer: 'Your answer', submit: 'Submit answer', end: 'End early', retry: 'Retry', new: 'New interview', roleRequired: 'Please enter a target role.', ending: 'Generating report…', replay: 'Replay question', generating: 'Generating question…' },
}

export default function MockInterview() {
  const { settings, resumeOriginal, resumeOptimized, jobDescription, addHistory } = useAppStore()
  const t = useTranslation()
  const language = (settings.language || 'zh-CN') as 'zh-CN' | 'zh-TW' | 'en-US'
  const copy = labels[language]
  const workspaceResume = resumeOptimized.trim() || resumeOriginal
  const [session, setSession] = useState<MockInterviewSnapshot>(() => {
    const initial = createMockInterviewSnapshot(language)
    initial.config.resumeContext = workspaceResume
    initial.config.jobDescription = jobDescription
    return initial
  })
  const [voiceSnapshot, setVoiceSnapshot] = useState<MockInterviewVoiceSnapshot>(() => createMockInterviewVoiceSnapshot())
  const [endedByLimit, setEndedByLimit] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const finishingRef = useRef(false)
  const submittingQuestionIdRef = useRef<string | null>(null)
  const failedAnswerRef = useRef<SubmitAnswerInput | null>(null)
  const submitAnswerRef = useRef<((input?: SubmitAnswerInput) => Promise<void>) | null>(null)
  const finishInterviewRef = useRef<((turns?: MockInterviewSnapshot['turns'], coverage?: MockInterviewSnapshot['coverage'], completedNormally?: boolean) => Promise<void>) | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    if (!session.startedAt || session.phase === 'completed' || session.phase === 'setup') return
    const timer = window.setInterval(() => setSession(current => ({ ...current, elapsedSeconds: Math.floor((Date.now() - (current.startedAt || Date.now())) / 1000) })), 1000)
    return () => window.clearInterval(timer)
  }, [session.startedAt, session.phase])

  useEffect(() => {
    if (
      !session.startedAt
      || !session.config.voiceInputEnabled
      || ['completed', 'setup', 'generating-report', 'saving', 'error'].includes(session.phase)
    ) return
    const remainingMs = Math.max(0, MAX_RECORDING_SECONDS * 1000 - (Date.now() - session.startedAt))
    const timer = window.setTimeout(() => {
      setEndedByLimit(true)
      void finishInterviewRef.current?.()
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [session.startedAt, session.phase, session.config.voiceInputEnabled])

  useEffect(() => {
    const unsubscribe = mockInterviewVoiceSession.subscribe(event => {
      if (event.type === 'snapshot') {
        setVoiceSnapshot(event.snapshot)
        setSession(current => {
          if (!current.config.voiceInputEnabled || current.phase === 'setup' || current.phase === 'completed') return current
          if (
            current.draftAnswer === event.snapshot.finalTranscript
            && current.interimTranscript === event.snapshot.interimTranscript
          ) return current
          return {
            ...current,
            draftAnswer: event.snapshot.finalTranscript,
            interimTranscript: event.snapshot.interimTranscript,
          }
        })
        return
      }
      if (event.type === 'answer-final') {
        void submitAnswerRef.current?.({
          text: event.text,
          source: 'voice',
          startedAt: event.startedAt,
          submittedAt: event.endedAt,
        })
        return
      }
      if (event.type === 'limit-reached') {
        setEndedByLimit(true)
        void finishInterviewRef.current?.()
        return
      }
      setSession(current => current.config.voiceInputEnabled && current.phase !== 'completed'
        ? { ...current, phase: 'error', error: event.error }
        : current)
    })

    return () => {
      unsubscribe()
      abortRef.current?.abort()
      void mockInterviewVoiceSession.stop({ saveRecording: false })
    }
  }, [])

  const patch = (update: Partial<MockInterviewSnapshot>) => setSession(current => ({ ...current, ...update }))
  const updateConfig = (update: Partial<MockInterviewSnapshot['config']>) => setSession(current => ({ ...current, config: { ...current.config, ...update } }))

  const handleSyncWorkspace = () => {
    updateConfig({
      resumeContext: workspaceResume,
      jobDescription: jobDescription,
    })
  }

  const workspaceHint = () => {
    const workspace = selectResumeWorkspace(useAppStore.getState())
    return {
      requirements: workspace.requirements,
      targetKeywords: workspace.targetKeywords,
      matchedKeywords: workspace.matchedKeywords,
      missingKeywords: workspace.missingKeywords,
      analysisOriginalFingerprint: workspace.analysisOriginalFingerprint,
      analysisJobDescriptionFingerprint: workspace.analysisJobDescriptionFingerprint,
    }
  }

  const presentQuestion = async (question: MockInterviewQuestion, preserveTranscript = false) => {
    const config = sessionRef.current.config
    patch({ phase: 'speaking', error: null })

    if (config.voiceInputEnabled) {
      await mockInterviewVoiceSession.ask(question.text, { preserveTranscript })
    } else if (config.speechEnabled) {
      await invoke('speak_text', {
        text: question.text,
        language: config.language,
        rate: 185,
      })
    }

    setSession(current => current.currentQuestion?.id === question.id && current.phase === 'speaking'
      ? { ...current, phase: 'answering' }
      : current)
  }

  const startInterview = async () => {
    if (!session.config.role.trim()) return patch({ error: copy.roleRequired })
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    finishingRef.current = false
    setEndedByLimit(false)
    submittingQuestionIdRef.current = null
    failedAnswerRef.current = null
    const brief = buildEvidenceBrief(session.config.resumeContext, session.config.jobDescription, workspaceHint())
    const plan = buildInterviewPlan(session.config, brief)
    const coverage = createInitialCoverage(plan)
    const firstSlot = plan.slots[0]
    patch({
      phase: 'starting', error: null, turns: [], report: null, recordId: null,
      startedAt: Date.now(), plan, coverage, currentQuestion: null,
    })
    try {
      if (session.config.voiceInputEnabled) {
        await mockInterviewVoiceSession.start({
          language: session.config.language,
          microphoneDevice: session.config.microphoneDevice,
          speechEnabled: session.config.speechEnabled,
        })
      } else {
        await mockInterviewVoiceSession.stop({ saveRecording: false })
      }
      const question = await generateQuestionForSlot(session.config, plan, firstSlot, [], 1, controller.signal)
      setSession(current => ({ ...current, plan, coverage, currentQuestion: question, turns: [{ question, answer: null, feedback: null }], phase: 'speaking' }))
      await presentQuestion(question)
    } catch (error) {
      if (finishingRef.current) return
      await mockInterviewVoiceSession.stop({ saveRecording: false })
      patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const submitAnswer = async (input: SubmitAnswerInput = {}) => {
    const current = sessionRef.current
    const question = current.currentQuestion
    const answer = (input.text ?? current.draftAnswer).trim()
    if (!answer || !question) return
    if (submittingQuestionIdRef.current === question.id) return

    const source = input.source ?? (current.config.voiceInputEnabled ? 'voice' as const : 'text' as const)
    const startedAt = input.startedAt ?? question.createdAt
    const submittedAt = input.submittedAt ?? Date.now()
    const failedInput: SubmitAnswerInput = { text: answer, source, startedAt, submittedAt }
    submittingQuestionIdRef.current = question.id
    failedAnswerRef.current = null
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const answeredTurns = current.turns.map(turn => turn.question.id === question.id ? {
      ...turn,
      answer: { text: answer, source, startedAt, submittedAt },
    } : turn)
    setSession(latest => ({
      ...latest,
      phase: 'evaluating',
      turns: answeredTurns,
      draftAnswer: answer,
      interimTranscript: '',
      error: null,
    }))

    try {
      const plan = current.plan
      if (!plan) throw new Error('Interview plan is missing.')
      const currentSlot = slotById(plan, question.slotId)
      const feedback = await evaluateMockTurn(current.config, plan, currentSlot, answeredTurns, answer, controller.signal)
      const evaluated = answeredTurns.map(turn => turn.question.id === question.id ? { ...turn, feedback } : turn)
      const coverageAfterAnswer = applyAnswerCoverage(current.coverage, currentSlot?.id || question.slotId || '', feedback)
      const action = decideNextAction({
        plan,
        coverage: coverageAfterAnswer,
        currentSlotId: currentSlot?.id || question.slotId || '',
        feedback,
      })

      if (action.type === 'end') {
        submittingQuestionIdRef.current = null
        await finishInterview(evaluated, coverageAfterAnswer, true)
        return
      }

      const nextSlot = action.type === 'follow-up' ? currentSlot : slotById(plan, action.slotId)
      if (!nextSlot) throw new Error('Interview slot is missing.')
      const nextQuestion = action.type === 'follow-up'
        ? await generateFollowUpQuestion(
          current.config, plan, nextSlot, question, answer,
          action.gaps, evaluated.length + 1, evaluated.map(turn => turn.question.text), controller.signal,
        )
        : await generateQuestionForSlot(
          current.config, plan, nextSlot, evaluated,
          evaluated.length + 1, controller.signal,
        )
      const nextCoverage = action.type === 'follow-up'
        ? markFollowUpIssued(coverageAfterAnswer, action.slotId)
        : coverageAfterAnswer

      failedAnswerRef.current = null
      submittingQuestionIdRef.current = null
      setSession(latest => ({
        ...latest,
        plan,
        coverage: nextCoverage,
        turns: [...evaluated, { question: nextQuestion, answer: null, feedback: null }],
        currentQuestion: nextQuestion,
        draftAnswer: '',
        interimTranscript: '',
        phase: 'speaking',
      }))
      try {
        await presentQuestion(nextQuestion)
      } catch (error) {
        patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    } catch (error) {
      submittingQuestionIdRef.current = null
      if (finishingRef.current) return
      failedAnswerRef.current = failedInput
      setSession(latest => ({
        ...latest,
        phase: 'error',
        turns: answeredTurns,
        draftAnswer: answer,
        interimTranscript: '',
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  submitAnswerRef.current = submitAnswer

  const finishInterview = async (turns = sessionRef.current.turns, coverage = sessionRef.current.coverage, completedNormally = false) => {
    const current = sessionRef.current
    if (current.recordId || finishingRef.current) return
    finishingRef.current = true
    submittingQuestionIdRef.current = null
    failedAnswerRef.current = null
    abortRef.current?.abort()
    const reportController = new AbortController()
    abortRef.current = reportController
    patch({ phase: 'generating-report', error: null })
    try {
      const recording = await mockInterviewVoiceSession.stop({ saveRecording: true })
      const report = await generateMockReport(current.config, current.plan, coverage, turns, completedNormally, reportController.signal)
      patch({ phase: 'saving', report, coverage, recordingPath: recording?.path || null })
      const record = {
        date: new Date().toISOString().slice(0, 16).replace('T', ' '), role: current.config.role,
        company: current.config.company || 'Not specified', score: report.overallScore,
        transcript: buildMockTranscript(turns), duration: Math.max(0, Math.floor((Date.now() - (current.startedAt || Date.now())) / 1000)),
        mode: `mock-${current.config.interviewType}`, recordingPath: recording?.path || null,
        detailsJson: JSON.stringify({ version: 2, config: current.config, plan: current.plan, coverage, turns, report }),
      }
      const id = await saveInterview(record)
      addHistory({ ...record, id })
      setSession(latest => ({ ...latest, turns, coverage, report, recordId: id, recordingPath: recording?.path || null, phase: 'completed', currentQuestion: null }))
    } catch (error) {
      finishingRef.current = false
      patch({ phase: 'error', turns, error: error instanceof Error ? error.message : String(error) })
    }
  }

  finishInterviewRef.current = finishInterview

  const reset = () => {
    finishingRef.current = false
    setEndedByLimit(false)
    submittingQuestionIdRef.current = null
    failedAnswerRef.current = null
    abortRef.current?.abort()
    void mockInterviewVoiceSession.stop({ saveRecording: false })
    const initial = createMockInterviewSnapshot(language)
    initial.config.resumeContext = workspaceResume
    initial.config.jobDescription = jobDescription
    setSession(initial)
  }

  const replayCurrentQuestion = async () => {
    const current = sessionRef.current
    if (!current.currentQuestion || ['evaluating', 'generating-report', 'saving'].includes(current.phase)) return
    try {
      await presentQuestion(current.currentQuestion, true)
    } catch (error) {
      patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const retryFailedAnalysis = () => {
    const failed = failedAnswerRef.current
    if (!failed) return
    void submitAnswer(failed)
  }

  const restartAnswer = () => {
    const current = sessionRef.current
    failedAnswerRef.current = null
    submittingQuestionIdRef.current = null
    setSession(latest => ({
      ...latest,
      turns: latest.turns.map(turn => turn.question.id === current.currentQuestion?.id
        ? { ...turn, answer: null, feedback: null }
        : turn),
      draftAnswer: '',
      interimTranscript: '',
      phase: 'answering',
      error: null,
    }))
    if (current.config.voiceInputEnabled) mockInterviewVoiceSession.restartAnswer()
  }

  const switchToTextAnswer = async () => {
    const current = sessionRef.current
    const preservedAnswer = current.draftAnswer
    abortRef.current?.abort()
    submittingQuestionIdRef.current = null
    failedAnswerRef.current = null
    await mockInterviewVoiceSession.stop({ saveRecording: false, preserveRecording: true })
    setSession(latest => ({
      ...latest,
      config: { ...latest.config, voiceInputEnabled: false },
      phase: latest.currentQuestion ? 'answering' : 'setup',
      draftAnswer: preservedAnswer,
      interimTranscript: '',
      error: null,
    }))
  }

  const exportReport = () => {
    const markdown = buildMockReportMarkdown(session)
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${session.config.role || 'mock-interview'}-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (session.phase === 'setup') return (
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <section className="mx-auto max-w-4xl rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 lg:p-7">
      <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{t('mock.setup.subtitle')}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="text-sm">{copy.role}<input className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.role} onChange={e => updateConfig({ role: e.target.value })} placeholder="例如: Senior Product Manager / 资深前端工程师" /></label>
        <label className="text-sm">{copy.company}<input className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.company} onChange={e => updateConfig({ company: e.target.value })} placeholder="例如: ByteDance / Tencent" /></label>
        <label className="text-sm">面试类型<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.interviewType} onChange={e => updateConfig({ interviewType: e.target.value as any })}><option value="mixed">综合</option><option value="behavioral">行为</option><option value="technical">技术</option></select></label>
        <label className="text-sm">难度<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.difficulty} onChange={e => updateConfig({ difficulty: e.target.value as any })}><option value="junior">初级</option><option value="mid">中级</option><option value="senior">高级</option></select></label>
        <label className="text-sm">{t('mock.setup.primaryCount')}<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.questionCount} onChange={e => updateConfig({ questionCount: Number(e.target.value) })}><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option></select></label>
        <label className="text-sm">语言<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)]" value={session.config.language} onChange={e => updateConfig({ language: e.target.value as any })}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English</option></select></label>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm"><input type="checkbox" checked={session.config.voiceInputEnabled} onChange={e => updateConfig({ voiceInputEnabled: e.target.checked })} />{t('mock.voice.mode')}</label>
        <label className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm"><input type="checkbox" checked={session.config.speechEnabled} onChange={e => updateConfig({ speechEnabled: e.target.checked })} />{t('mock.voice.speech')}</label>
      </div>

      <div className="mt-6 border-t border-[var(--border-color)] pt-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText className="h-4 w-4 text-[var(--action)]" /> 面试上下文 (Resume & JD Context)
          </div>
          <button
            type="button"
            onClick={handleSyncWorkspace}
            className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 一键同步工作区简历与JD
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--text-muted)]">
              <span>候选人简历</span>
              <span>{session.config.resumeContext.length} 字</span>
            </div>
            <textarea
              className="h-32 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed outline-none transition-colors focus:border-[var(--action)]"
              placeholder="粘贴简历内容或点击上方按钮同步..."
              value={session.config.resumeContext}
              onChange={e => updateConfig({ resumeContext: e.target.value })}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--text-muted)]">
              <span>目标职位描述 (JD)</span>
              <span>{session.config.jobDescription.length} 字</span>
            </div>
            <textarea
              className="h-32 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed outline-none transition-colors focus:border-[var(--action)]"
              placeholder="粘贴目标 JD 或点击上方按钮同步..."
              value={session.config.jobDescription}
              onChange={e => updateConfig({ jobDescription: e.target.value })}
            />
          </div>
        </div>
      </div>

      {session.error && <div className="mt-4 rounded-md border border-[var(--danger)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--danger)]">{session.error}</div>}
      <button onClick={startInterview} className="mt-6 w-full rounded-md bg-[var(--action)] py-2.5 font-medium text-[var(--action-text)] transition-opacity hover:opacity-90">{copy.start}</button>
      </section>
    </div>
  )

  if (session.phase === 'completed' && session.report) return (
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <section className="mx-auto max-w-5xl rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 lg:p-7">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">面试报告</h1><p className="mt-1 text-sm text-[var(--text-muted)]">{session.config.role} · {session.config.company || '未指定'}</p></div><div className="tabular-nums text-3xl font-semibold text-[var(--action)]">{session.report.overallScore}</div></div>
      {endedByLimit && (
        <p className="mt-4 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-muted)]">{t('mock.limit.reached')}</p>
      )}
      <p className="mt-5 border-l-2 border-[var(--action)] bg-[var(--bg-subtle)] p-4">{session.report.summary}</p>
      {session.report.coverageSummary.length > 0 && (
        <section className="mt-5 rounded-md border border-[var(--border-color)] p-4">
          <h2 className="font-medium">{t('mock.report.coverage')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {session.report.coverageSummary.map(item => (
              <span key={`${item.competency}-${item.status}`} className="rounded-md bg-[var(--bg-subtle)] px-2 py-1 text-xs">
                {item.competency} · {t(`mock.coverage.${item.status}`)}
              </span>
            ))}
          </div>
          {session.report.uncoveredCompetencies.length > 0 && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">{t('mock.report.uncovered')}: {session.report.uncoveredCompetencies.join(' · ')}</p>
          )}
        </section>
      )}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2"><section className="rounded-md border border-[var(--border-color)] p-4"><h2 className="font-medium">优势</h2>{session.report.strengths.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section><section className="rounded-md border border-[var(--border-color)] p-4"><h2 className="font-medium">优先改进</h2>{session.report.priorityImprovements.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section></div>
      <div className="mt-5 space-y-3">{session.turns.map((turn, index) => <details key={turn.question.id} className="rounded-md border border-[var(--border-color)] p-4"><summary className="cursor-pointer font-medium">第 {index + 1} 题 · {turn.question.kind === 'follow-up' ? t('mock.question.followUp') : t('mock.question.primary')} · {turn.feedback ? `${turn.feedback.overallScore} 分` : '未作答'}</summary><p className="mt-3">{turn.question.text}</p><p className="mt-2 bg-[var(--bg-subtle)] p-3 text-sm">{turn.answer?.text}</p><p className="mt-2 text-sm text-[var(--text-muted)]">{turn.feedback?.summary}</p></details>)}</div>
      <div className="mt-6 flex flex-col gap-3 lg:flex-row"><button onClick={exportReport} className="flex-1 rounded-md border border-[var(--border-color)] py-2 transition-colors hover:bg-[var(--bg-hover)]">导出 Markdown</button><button onClick={reset} className="flex-1 rounded-md bg-[var(--action)] py-2 text-[var(--action-text)] transition-opacity hover:opacity-90">{copy.new}</button></div>
      </section>
    </div>
  )

  const busy = ['starting', 'speaking', 'evaluating', 'generating-report', 'saving'].includes(session.phase)
  const finishBusy = ['generating-report', 'saving'].includes(session.phase)
  const lastFeedback = session.turns.slice().reverse().find(turn => turn.feedback)?.feedback
  const voiceStatus = session.phase === 'evaluating'
    ? t('mock.voice.evaluating')
    : t(`mock.voice.phase.${voiceSnapshot.phase}`)
  const canFinalizeVoice = ['listening', 'candidate-speaking'].includes(voiceSnapshot.phase)
    && Boolean((voiceSnapshot.finalTranscript || voiceSnapshot.interimTranscript).trim())

  return (
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <section className="mx-auto max-w-6xl rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 lg:p-7">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1><div className="mt-1 text-sm text-[var(--text-muted)]">{t('mock.progress.primary', { current: countPrimaryQuestions(session.turns), total: session.plan?.primaryCount ?? session.config.questionCount })}{session.currentQuestion?.kind === 'follow-up' ? ` · ${t('mock.progress.followUp')}` : ''} · <span className="tabular-nums">{Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(2, '0')}</span></div></div><button onClick={() => finishInterview(session.turns, session.coverage, false)} disabled={finishBusy} className="rounded-md border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40">{session.phase === 'generating-report' || session.phase === 'saving' ? copy.ending : copy.end}</button></div>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="rounded-md border border-[var(--border-color)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--action)]">{session.currentQuestion?.kind === 'follow-up' ? t('mock.question.followUp') : t(`mock.stage.${session.currentQuestion?.stage || 'core'}`)}</div>
            {session.phase === 'speaking' && (
              <div className="flex animate-pulse items-center gap-1.5 text-xs font-medium text-[var(--action)]">
                <Volume2 className="h-3.5 w-3.5" /> 朗读题目中...
              </div>
            )}
          </div>
          <div className="mt-3 text-xl leading-relaxed">{session.currentQuestion?.text || copy.generating}</div>
          {session.currentQuestion?.intent && <div className="mt-3 text-sm text-[var(--text-muted)]">考察重点：{session.currentQuestion.intent}</div>}
          <button onClick={() => void replayCurrentQuestion()} disabled={!session.config.speechEnabled || busy} className="mt-4 flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"><Volume2 className="h-4 w-4" /> {copy.replay}</button>
        </section>

        <section className="rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-5">
          <div className="font-medium">上一题多维度评估</div>
          {lastFeedback ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums text-3xl font-semibold text-[var(--action)]">{lastFeedback.overallScore}</span>
                <span className="text-xs text-[var(--text-muted)]">/ 100 综合得分</span>
              </div>
              
              <div className="space-y-2 pt-1 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--text-muted)]">逻辑与结构 (Structure)</span>
                    <span className="font-medium">{lastFeedback.scores.structure || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden bg-[var(--bg-hover)]">
                    <div className="h-full bg-[var(--action)] transition-all duration-500" style={{ width: `${lastFeedback.scores.structure || 0}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--text-muted)]">回答切题度 (Relevance)</span>
                    <span className="font-medium">{lastFeedback.scores.relevance || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden bg-[var(--bg-hover)]">
                    <div className="h-full bg-[var(--success)] transition-all duration-500" style={{ width: `${lastFeedback.scores.relevance || 0}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--text-muted)]">语言表达力 (Clarity)</span>
                    <span className="font-medium">{lastFeedback.scores.clarity || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden bg-[var(--bg-hover)]">
                    <div className="h-full bg-[var(--action)] transition-all duration-500" style={{ width: `${lastFeedback.scores.clarity || 0}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--text-muted)]">具体成果/影响力 (Impact)</span>
                    <span className="font-medium">{lastFeedback.scores.impact || 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden bg-[var(--bg-hover)]">
                    <div className="h-full bg-[var(--warning)] transition-all duration-500" style={{ width: `${lastFeedback.scores.impact || 0}%` }} />
                  </div>
                </div>
              </div>

              <p className="pt-2 text-xs leading-relaxed text-[var(--text-muted)]">{lastFeedback.summary}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">提交回答后获得多维度实时评分与优化建议。</p>
          )}
        </section>
      </div>

      <section className="mt-5 rounded-md border border-[var(--border-color)] p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-medium">
            <span>{copy.answer}</span>
            {session.config.voiceInputEnabled && voiceSnapshot.captureActive && (
              <span className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-normal text-[var(--action)]">
                <Mic className="h-3 w-3" /> {t('mock.voice.captureReady')}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)]">{session.draftAnswer.length}/4000</div>
        </div>

        {session.config.voiceInputEnabled ? (
          <>
            <div className="my-3 flex min-h-16 items-center justify-center gap-1.5 border-y border-[var(--border-color)] bg-[var(--bg-subtle)] py-3">
              {[0.55, 0.85, 1, 0.7, 0.9, 0.6].map((scale, index) => (
                <div
                  key={index}
                  className="w-1 bg-[var(--action)] transition-[height] duration-100"
                  style={{ height: `${Math.max(7, Math.round(8 + voiceSnapshot.amplitude * 34 * scale))}px` }}
                />
              ))}
              <span className="ml-2 text-xs font-medium text-[var(--action)]">{voiceStatus}</span>
            </div>

            <div className="min-h-36 rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-sm leading-relaxed">
              {voiceSnapshot.finalTranscript || session.draftAnswer ? (
                <span>{voiceSnapshot.finalTranscript || session.draftAnswer}</span>
              ) : (
                <span className="text-[var(--text-muted)]">{t('mock.voice.placeholder')}</span>
              )}
              {voiceSnapshot.interimTranscript && (
                <span className="ml-1 text-[var(--text-muted)]">{voiceSnapshot.interimTranscript}</span>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => mockInterviewVoiceSession.finalizeAnswer()}
                disabled={busy || !canFinalizeVoice}
                className="flex-1 rounded-md bg-[var(--action)] py-2.5 font-medium text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {session.phase === 'evaluating' ? t('mock.voice.evaluating') : t('mock.voice.finishAnswer')}
              </button>
              <button
                type="button"
                onClick={() => void switchToTextAnswer()}
                disabled={['generating-report', 'saving'].includes(session.phase)}
                className="rounded-md border border-[var(--border-color)] px-4 py-2.5 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
              >
                {t('mock.voice.switchToText')}
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              maxLength={4000}
              value={session.draftAnswer}
              onChange={e => patch({ draftAnswer: e.target.value })}
              disabled={busy}
              className="mt-3 h-36 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 outline-none transition-colors focus:border-[var(--action)] disabled:bg-[var(--bg-subtle)]"
              placeholder={t('mock.placeholder')}
            />
            <button onClick={() => void submitAnswer()} disabled={busy || !session.draftAnswer.trim()} className="mt-4 w-full rounded-md bg-[var(--action)] py-2.5 font-medium text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-40">{session.phase === 'evaluating' ? t('mock.voice.evaluating') : copy.submit}</button>
          </>
        )}
      </section>
      {session.error && (
        <div className="mt-4 rounded-md border border-[var(--danger)] bg-[var(--bg-subtle)] p-4 text-sm text-[var(--danger)]">
          <div>{session.error}</div>
          <div className="mt-3 flex flex-wrap gap-3">
            {failedAnswerRef.current ? (
              <>
                <button onClick={retryFailedAnalysis} className="underline">{t('mock.voice.retryAnalysis')}</button>
                <button onClick={restartAnswer} className="underline">{t('mock.voice.restartAnswer')}</button>
              </>
            ) : (
              <button onClick={() => void switchToTextAnswer()} className="underline">{t('mock.voice.switchToText')}</button>
            )}
            <button onClick={reset} className="underline">{copy.retry}</button>
          </div>
        </div>
      )}
      </section>
    </div>
  )
}
