import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { RefreshCw, Mic, Volume2, FileText } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { saveInterview } from '../lib/db'
import { closeDeepgramStream, sendAudioChunk, startDeepgramStream } from '../lib/llm'
import { generateFirstMockQuestion, evaluateMockTurn, generateMockReport } from '../lib/mockInterviewAi'
import {
  buildMockReportMarkdown,
  buildMockTranscript,
  createMockInterviewSnapshot,
  type MockInterviewQuestion,
  type MockInterviewSnapshot,
} from '../lib/mockInterviewState'
import { tryRequestMicrophone } from '../lib/permissions'

interface AudioChunk { source: 'system' | 'microphone'; samples: number[] }
interface SavedRecording { path: string; duration_seconds: number; sample_rate: number }

const labels = {
  'zh-CN': { title: 'AI 模拟面试', start: '开始面试', role: '目标职位', company: '公司（选填）', answer: '你的回答', submit: '提交回答', end: '提前结束', retry: '重试', new: '开始新面试', roleRequired: '请填写目标职位。', ending: '正在生成报告…', replay: '重播题目', generating: '正在生成问题…' },
  'zh-TW': { title: 'AI 模擬面試', start: '開始面試', role: '目標職位', company: '公司（選填）', answer: '你的回答', submit: '提交回答', end: '提前結束', retry: '重試', new: '開始新面試', roleRequired: '請填寫目標職位。', ending: '正在產生報告…', replay: '重播題目', generating: '正在產生問題…' },
  'en-US': { title: 'AI Mock Interview', start: 'Start interview', role: 'Target role', company: 'Company (optional)', answer: 'Your answer', submit: 'Submit answer', end: 'End early', retry: 'Retry', new: 'New interview', roleRequired: 'Please enter a target role.', ending: 'Generating report…', replay: 'Replay question', generating: 'Generating question…' },
}

export default function MockInterview() {
  const { settings, resumeOriginal, jobDescription, addHistory } = useAppStore()
  const language = (settings.language || 'zh-CN') as 'zh-CN' | 'zh-TW' | 'en-US'
  const copy = labels[language]
  const [session, setSession] = useState<MockInterviewSnapshot>(() => {
    const initial = createMockInterviewSnapshot(language)
    initial.config.resumeContext = resumeOriginal
    initial.config.jobDescription = jobDescription
    return initial
  })
  const [isListening, setIsListening] = useState(false)
  const deepgramRef = useRef<WebSocket | null>(null)
  const unlistenRef = useRef<UnlistenFn | null>(null)
  const isListeningRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef(crypto.randomUUID())
  const finalTranscriptRef = useRef('')
  const acceptingAudioRef = useRef(false)
  const finishingRef = useRef(false)
  const sessionRef = useRef(session)
  sessionRef.current = session

  useEffect(() => {
    if (!session.startedAt || session.phase === 'completed' || session.phase === 'setup') return
    const timer = window.setInterval(() => setSession(current => ({ ...current, elapsedSeconds: Math.floor((Date.now() - (current.startedAt || Date.now())) / 1000) })), 1000)
    return () => window.clearInterval(timer)
  }, [session.startedAt, session.phase])

  useEffect(() => () => {
    abortRef.current?.abort()
    acceptingAudioRef.current = false
    void stopVoice({ saveRecording: false })
    void invoke('stop_speaking')
  }, [])

  const patch = (update: Partial<MockInterviewSnapshot>) => setSession(current => ({ ...current, ...update }))
  const updateConfig = (update: Partial<MockInterviewSnapshot['config']>) => setSession(current => ({ ...current, config: { ...current.config, ...update } }))

  const handleSyncWorkspace = () => {
    updateConfig({
      resumeContext: resumeOriginal,
      jobDescription: jobDescription,
    })
  }

  const startVoice = async () => {
    if (!(await tryRequestMicrophone())) throw new Error('Microphone permission is required for voice answers.')
    await stopVoice({ saveRecording: false })
    const socket = await startDeepgramStream(
      ({ text, boundary }) => {
        if (!text.trim()) return
        if (boundary === 'interim') {
          patch({ interimTranscript: text })
        } else {
          setSession(current => {
            const next = [current.draftAnswer, text].filter(Boolean).join(' ').trim()
            finalTranscriptRef.current = next
            return { ...current, draftAnswer: next, interimTranscript: '' }
          })
        }
      },
      error => patch({ error: String(error) }),
      16_000,
      (next) => {
        deepgramRef.current = next
      },
    )
    deepgramRef.current = socket
    unlistenRef.current = await listen<AudioChunk>('audio-source-chunk', event => {
      if (acceptingAudioRef.current && event.payload.source === 'microphone' && deepgramRef.current) sendAudioChunk(deepgramRef.current, new Float32Array(event.payload.samples))
    })
    await invoke('start_audio_capture', { useSystemAudio: false, useMicrophone: true, deviceName: session.config.microphoneDevice })
    acceptingAudioRef.current = false
    isListeningRef.current = true
    setIsListening(true)
  }

  const stopVoice = async (options: { saveRecording?: boolean } = {}): Promise<SavedRecording | null> => {
    const saveRecording = options.saveRecording !== false
    const hadActiveVoice = isListeningRef.current || deepgramRef.current != null || unlistenRef.current != null
    if (!hadActiveVoice) return null
    acceptingAudioRef.current = false
    closeDeepgramStream(deepgramRef.current)
    deepgramRef.current = null
    unlistenRef.current?.()
    unlistenRef.current = null
    await invoke('stop_audio_capture').catch(() => {})
    isListeningRef.current = false
    setIsListening(false)
    if (!saveRecording) return null
    return await invoke<SavedRecording | null>('save_audio_recording', {
      sessionId: sessionIdRef.current,
    }).catch(() => null)
  }

  const speakQuestion = async (question: MockInterviewQuestion) => {
    if (!session.config.speechEnabled) {
      acceptingAudioRef.current = session.config.voiceInputEnabled
      return
    }
    acceptingAudioRef.current = false
    patch({ phase: 'speaking' })
    try {
      await invoke('speak_text', { text: question.text, language: session.config.language, rate: 185 }).catch(error => patch({ error: String(error) }))
      const delay = Math.min(12_000, Math.max(900, question.text.length * (session.config.language === 'en-US' ? 55 : 150)))
      await new Promise(resolve => window.setTimeout(resolve, delay))
    } finally {
      acceptingAudioRef.current = session.config.voiceInputEnabled
      if (sessionRef.current.phase === 'speaking') patch({ phase: 'answering' })
    }
  }

  const startInterview = async () => {
    if (!session.config.role.trim()) return patch({ error: copy.roleRequired })
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    finishingRef.current = false
    patch({ phase: 'starting', error: null, turns: [], report: null, recordId: null, startedAt: Date.now() })
    try {
      if (session.config.voiceInputEnabled) await startVoice()
      const question = await generateFirstMockQuestion(session.config, abortRef.current.signal)
      setSession(current => ({ ...current, currentQuestion: question, turns: [{ question, answer: null, feedback: null }], phase: 'speaking' }))
      await speakQuestion(question)
    } catch (error) {
      await stopVoice({ saveRecording: false })
      patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const submitAnswer = async () => {
    const answer = session.draftAnswer.trim()
    if (!answer || !session.currentQuestion) return
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const source = session.config.voiceInputEnabled ? 'voice' as const : 'text' as const
    const answeredTurns = session.turns.map((turn, index) => index === session.turns.length - 1 ? {
      ...turn, answer: { text: answer, source, startedAt: turn.question.createdAt, submittedAt: Date.now() },
    } : turn)
    patch({ phase: 'evaluating', turns: answeredTurns, error: null })
    try {
      const { feedback, nextQuestion } = await evaluateMockTurn(session.config, answeredTurns, answer, abortRef.current.signal)
      const evaluated = answeredTurns.map((turn, index) => index === answeredTurns.length - 1 ? { ...turn, feedback } : turn)
      if (!nextQuestion) {
        await finishInterview(evaluated, true)
        return
      }
      finalTranscriptRef.current = ''
      setSession(current => ({ ...current, turns: [...evaluated, { question: nextQuestion, answer: null, feedback: null }], currentQuestion: nextQuestion, draftAnswer: '', interimTranscript: '', phase: 'speaking' }))
      await speakQuestion(nextQuestion)
    } catch (error) {
      patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const finishInterview = async (turns = session.turns, completedNormally = false) => {
    if (session.recordId || finishingRef.current) return
    finishingRef.current = true
    abortRef.current?.abort()
    void invoke('stop_speaking')
    patch({ phase: 'generating-report', error: null })
    try {
      const recording = await stopVoice()
      const report = await generateMockReport(session.config, turns, completedNormally, abortRef.current?.signal)
      patch({ phase: 'saving', report, recordingPath: recording?.path || null })
      const record = {
        date: new Date().toISOString().slice(0, 16).replace('T', ' '), role: session.config.role,
        company: session.config.company || 'Not specified', score: report.overallScore,
        transcript: buildMockTranscript(turns), duration: Math.max(0, Math.floor((Date.now() - (session.startedAt || Date.now())) / 1000)),
        mode: `mock-${session.config.interviewType}`, recordingPath: recording?.path || null,
        detailsJson: JSON.stringify({ config: session.config, turns, report }),
      }
      const id = await saveInterview(record)
      addHistory({ ...record, id })
      setSession(current => ({ ...current, turns, report, recordId: id, recordingPath: recording?.path || null, phase: 'completed', currentQuestion: null }))
    } catch (error) {
      finishingRef.current = false
      patch({ phase: 'error', turns, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const reset = () => {
    finishingRef.current = false
    abortRef.current?.abort()
    void stopVoice({ saveRecording: false })
    void invoke('stop_speaking')
    sessionIdRef.current = crypto.randomUUID()
    finalTranscriptRef.current = ''
    const initial = createMockInterviewSnapshot(language)
    initial.config.resumeContext = resumeOriginal
    initial.config.jobDescription = jobDescription
    setSession(initial)
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
      <p className="mt-1 text-sm text-[var(--text-muted)]">根据职位、简历和 JD 动态出题，支持文本或麦克风回答。</p>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="text-sm">{copy.role}<input className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.role} onChange={e => updateConfig({ role: e.target.value })} placeholder="例如: Senior Product Manager / 资深前端工程师" /></label>
        <label className="text-sm">{copy.company}<input className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.company} onChange={e => updateConfig({ company: e.target.value })} placeholder="例如: ByteDance / Tencent" /></label>
        <label className="text-sm">面试类型<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.interviewType} onChange={e => updateConfig({ interviewType: e.target.value as any })}><option value="mixed">综合</option><option value="behavioral">行为</option><option value="technical">技术</option></select></label>
        <label className="text-sm">难度<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.difficulty} onChange={e => updateConfig({ difficulty: e.target.value as any })}><option value="junior">初级</option><option value="mid">中级</option><option value="senior">高级</option></select></label>
        <label className="text-sm">题目数量<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.questionCount} onChange={e => updateConfig({ questionCount: Number(e.target.value) })}><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option></select></label>
        <label className="text-sm">语言<select className="mt-1 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 py-2.5 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]" value={session.config.language} onChange={e => updateConfig({ language: e.target.value as any })}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English</option></select></label>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <label className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm"><input type="checkbox" checked={session.config.voiceInputEnabled} onChange={e => updateConfig({ voiceInputEnabled: e.target.checked })} />麦克风实时转写</label>
        <label className="flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-sm"><input type="checkbox" checked={session.config.speechEnabled} onChange={e => updateConfig({ speechEnabled: e.target.checked })} />系统朗读题目</label>
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
              className="h-32 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]"
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
              className="h-32 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-subtle)] p-3 text-xs leading-relaxed outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)]"
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
      <p className="mt-5 border-l-2 border-[var(--action)] bg-[var(--bg-subtle)] p-4">{session.report.summary}</p>
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2"><section className="rounded-md border border-[var(--border-color)] p-4"><h2 className="font-medium">优势</h2>{session.report.strengths.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section><section className="rounded-md border border-[var(--border-color)] p-4"><h2 className="font-medium">优先改进</h2>{session.report.priorityImprovements.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section></div>
      <div className="mt-5 space-y-3">{session.turns.map((turn, index) => <details key={turn.question.id} className="rounded-md border border-[var(--border-color)] p-4"><summary className="cursor-pointer font-medium">第 {index + 1} 题 · {turn.feedback ? `${turn.feedback.overallScore} 分` : '未作答'}</summary><p className="mt-3">{turn.question.text}</p><p className="mt-2 bg-[var(--bg-subtle)] p-3 text-sm">{turn.answer?.text}</p><p className="mt-2 text-sm text-[var(--text-muted)]">{turn.feedback?.summary}</p></details>)}</div>
      <div className="mt-6 flex flex-col gap-3 lg:flex-row"><button onClick={exportReport} className="flex-1 rounded-md border border-[var(--border-color)] py-2 transition-colors hover:bg-[var(--bg-hover)]">导出 Markdown</button><button onClick={reset} className="flex-1 rounded-md bg-[var(--action)] py-2 text-[var(--action-text)] transition-opacity hover:opacity-90">{copy.new}</button></div>
      </section>
    </div>
  )

  const busy = ['starting', 'speaking', 'evaluating', 'generating-report', 'saving'].includes(session.phase)
  const lastFeedback = session.turns.slice().reverse().find(turn => turn.feedback)?.feedback

  return (
    <div className="w-full bg-[var(--bg-app)] px-5 py-6 text-[var(--text-main)] lg:px-8">
      <section className="mx-auto max-w-6xl rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-5 lg:p-7">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1><div className="mt-1 text-sm text-[var(--text-muted)]">第 {session.turns.length}/{session.config.questionCount} 题 · <span className="tabular-nums">{Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(2, '0')}</span></div></div><button onClick={() => finishInterview(session.turns, false)} disabled={busy} className="rounded-md border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40">{session.phase === 'generating-report' || session.phase === 'saving' ? copy.ending : copy.end}</button></div>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="rounded-md border border-[var(--border-color)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--action)]">{session.currentQuestion?.stage}</div>
            {session.phase === 'speaking' && (
              <div className="flex animate-pulse items-center gap-1.5 text-xs font-medium text-[var(--action)]">
                <Volume2 className="h-3.5 w-3.5" /> 朗读题目中...
              </div>
            )}
          </div>
          <div className="mt-3 text-xl leading-relaxed">{session.currentQuestion?.text || copy.generating}</div>
          {session.currentQuestion?.intent && <div className="mt-3 text-sm text-[var(--text-muted)]">考察重点：{session.currentQuestion.intent}</div>}
          <button onClick={() => session.currentQuestion && speakQuestion(session.currentQuestion)} disabled={!session.config.speechEnabled || busy} className="mt-4 flex items-center gap-2 rounded-md border border-[var(--border-color)] px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"><Volume2 className="h-4 w-4" /> {copy.replay}</button>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <span>{copy.answer}</span>
            {isListening && (
              <span className="flex items-center gap-1 rounded bg-[var(--bg-subtle)] px-2 py-0.5 text-xs font-normal text-[var(--danger)]">
                <Mic className="h-3 w-3 animate-pulse" /> 正在录音...
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--text-muted)]">{session.draftAnswer.length}/4000</div>
        </div>

        {(isListening || session.phase === 'speaking') && (
          <div className="my-3 flex items-center justify-center gap-1.5 border-y border-[var(--border-color)] bg-[var(--bg-subtle)] py-3">
            <div className="h-4 w-1 animate-[bounce_1s_infinite_100ms] bg-[var(--action)]" />
            <div className="h-7 w-1 animate-[bounce_1s_infinite_200ms] bg-[var(--action)]" />
            <div className="h-10 w-1 animate-[bounce_1s_infinite_300ms] bg-[var(--action)]" />
            <div className="h-6 w-1 animate-[bounce_1s_infinite_400ms] bg-[var(--action)]" />
            <div className="h-8 w-1 animate-[bounce_1s_infinite_250ms] bg-[var(--action)]" />
            <div className="h-5 w-1 animate-[bounce_1s_infinite_150ms] bg-[var(--action)]" />
            <span className="ml-2 text-xs font-medium text-[var(--action)]">
              {session.phase === 'speaking' ? '系统发音中...' : '音频捕捉中...'}
            </span>
          </div>
        )}

        <textarea maxLength={4000} value={session.draftAnswer} onChange={e => { finalTranscriptRef.current = e.target.value; patch({ draftAnswer: e.target.value }) }} disabled={busy} className="mt-3 h-36 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 outline-none transition-colors focus:border-[var(--action)] focus:ring-1 focus:ring-[var(--action)] disabled:bg-[var(--bg-subtle)]" placeholder={session.config.voiceInputEnabled ? '直接说话，转写结果可编辑…' : '输入你的回答…'} />
        {session.interimTranscript && <div className="mt-2 text-sm text-[var(--text-muted)]">正在识别：{session.interimTranscript}</div>}
        <button onClick={submitAnswer} disabled={busy || !session.draftAnswer.trim()} className="mt-4 w-full rounded-md bg-[var(--action)] py-2.5 font-medium text-[var(--action-text)] transition-opacity hover:opacity-90 disabled:opacity-40">{session.phase === 'evaluating' ? '正在分析…' : copy.submit}</button>
      </section>
      {session.error && <div className="mt-4 rounded-md border border-[var(--danger)] bg-[var(--bg-subtle)] p-4 text-sm text-[var(--danger)]">{session.error}<button onClick={() => { if (!session.currentQuestion) void stopVoice({ saveRecording: false }); patch({ phase: session.currentQuestion ? 'answering' : 'setup', error: null }) }} className="ml-3 underline">{copy.retry}</button></div>}
      </section>
    </div>
  )
}
