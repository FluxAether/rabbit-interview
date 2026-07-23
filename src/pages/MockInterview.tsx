import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
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
  'zh-CN': { title: 'AI 模拟面试', start: '开始面试', role: '目标职位', company: '公司（选填）', answer: '你的回答', submit: '提交回答', end: '提前结束', retry: '重试', new: '开始新面试' },
  'zh-TW': { title: 'AI 模擬面試', start: '開始面試', role: '目標職位', company: '公司（選填）', answer: '你的回答', submit: '提交回答', end: '提前結束', retry: '重試', new: '開始新面試' },
  'en-US': { title: 'AI Mock Interview', start: 'Start interview', role: 'Target role', company: 'Company (optional)', answer: 'Your answer', submit: 'Submit answer', end: 'End early', retry: 'Retry', new: 'New interview' },
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
  const abortRef = useRef<AbortController | null>(null)
  const sessionIdRef = useRef(crypto.randomUUID())
  const finalTranscriptRef = useRef('')
  const acceptingAudioRef = useRef(false)

  useEffect(() => {
    if (!session.startedAt || session.phase === 'completed' || session.phase === 'setup') return
    const timer = window.setInterval(() => setSession(current => ({ ...current, elapsedSeconds: Math.floor((Date.now() - (current.startedAt || Date.now())) / 1000) })), 1000)
    return () => window.clearInterval(timer)
  }, [session.startedAt, session.phase])

  useEffect(() => () => {
    abortRef.current?.abort()
    acceptingAudioRef.current = false
    closeDeepgramStream(deepgramRef.current)
    unlistenRef.current?.()
    void invoke('stop_speaking')
    void invoke('stop_audio_capture').catch(() => {})
  }, [])

  const patch = (update: Partial<MockInterviewSnapshot>) => setSession(current => ({ ...current, ...update }))
  const updateConfig = (update: Partial<MockInterviewSnapshot['config']>) => setSession(current => ({ ...current, config: { ...current.config, ...update } }))

  const startVoice = async () => {
    if (!(await tryRequestMicrophone())) throw new Error('Microphone permission is required for voice answers.')
    const socket = await startDeepgramStream(({ text, boundary }) => {
      if (!text.trim()) return
      if (boundary === 'interim') {
        patch({ interimTranscript: text })
      } else {
        finalTranscriptRef.current = [finalTranscriptRef.current, text].filter(Boolean).join(' ').trim()
        setSession(current => ({ ...current, draftAnswer: finalTranscriptRef.current, interimTranscript: '' }))
      }
    }, error => patch({ error: String(error) }), 16_000)
    deepgramRef.current = socket
    unlistenRef.current = await listen<AudioChunk>('audio-source-chunk', event => {
      if (acceptingAudioRef.current && event.payload.source === 'microphone' && deepgramRef.current) sendAudioChunk(deepgramRef.current, new Float32Array(event.payload.samples))
    })
    await invoke('start_audio_capture', { useSystemAudio: false, useMicrophone: true, deviceName: session.config.microphoneDevice })
    acceptingAudioRef.current = false
    setIsListening(true)
  }

  const stopVoice = async (): Promise<SavedRecording | null> => {
    if (!isListening) return null
    acceptingAudioRef.current = false
    closeDeepgramStream(deepgramRef.current)
    deepgramRef.current = null
    unlistenRef.current?.()
    unlistenRef.current = null
    await invoke('stop_audio_capture').catch(() => {})
    setIsListening(false)
    return await invoke<SavedRecording | null>('save_audio_recording', { sessionId: sessionIdRef.current }).catch(() => null)
  }

  const speakQuestion = async (question: MockInterviewQuestion) => {
    if (!session.config.speechEnabled) {
      acceptingAudioRef.current = session.config.voiceInputEnabled
      return
    }
    acceptingAudioRef.current = false
    patch({ phase: 'speaking' })
    await invoke('speak_text', { text: question.text, language: session.config.language, rate: 185 }).catch(error => patch({ error: String(error) }))
    const delay = Math.min(12_000, Math.max(900, question.text.length * (session.config.language === 'en-US' ? 55 : 150)))
    await new Promise(resolve => window.setTimeout(resolve, delay))
    acceptingAudioRef.current = session.config.voiceInputEnabled
  }

  const startInterview = async () => {
    if (!session.config.role.trim()) return patch({ error: 'Please enter a target role.' })
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    patch({ phase: 'starting', error: null, turns: [], report: null, recordId: null, startedAt: Date.now() })
    try {
      if (session.config.voiceInputEnabled) await startVoice()
      const question = await generateFirstMockQuestion(session.config, abortRef.current.signal)
      setSession(current => ({ ...current, currentQuestion: question, turns: [{ question, answer: null, feedback: null }], phase: 'speaking' }))
      await speakQuestion(question)
      patch({ phase: 'answering' })
    } catch (error) {
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
      patch({ phase: 'answering' })
    } catch (error) {
      patch({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const finishInterview = async (turns = session.turns, completedNormally = false) => {
    if (session.recordId) return
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
      patch({ phase: 'error', turns, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    void stopVoice()
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
    <div className="w-full p-8"><div className="card mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-1 text-sm text-[#64748b] dark:text-[#94a3b8]">根据职位、简历和 JD 动态出题，支持文本或麦克风回答。</p>
      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="text-sm">{copy.role}<input className="mt-1 w-full rounded-xl border p-3" value={session.config.role} onChange={e => updateConfig({ role: e.target.value })} /></label>
        <label className="text-sm">{copy.company}<input className="mt-1 w-full rounded-xl border p-3" value={session.config.company} onChange={e => updateConfig({ company: e.target.value })} /></label>
        <label className="text-sm">面试类型<select className="mt-1 w-full rounded-xl border p-3" value={session.config.interviewType} onChange={e => updateConfig({ interviewType: e.target.value as any })}><option value="mixed">综合</option><option value="behavioral">行为</option><option value="technical">技术</option></select></label>
        <label className="text-sm">难度<select className="mt-1 w-full rounded-xl border p-3" value={session.config.difficulty} onChange={e => updateConfig({ difficulty: e.target.value as any })}><option value="junior">初级</option><option value="mid">中级</option><option value="senior">高级</option></select></label>
        <label className="text-sm">题目数量<select className="mt-1 w-full rounded-xl border p-3" value={session.config.questionCount} onChange={e => updateConfig({ questionCount: Number(e.target.value) })}><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option></select></label>
        <label className="text-sm">语言<select className="mt-1 w-full rounded-xl border p-3" value={session.config.language} onChange={e => updateConfig({ language: e.target.value as any })}><option value="zh-CN">简体中文</option><option value="zh-TW">繁體中文</option><option value="en-US">English</option></select></label>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] p-3 text-sm dark:border-[#334155]"><input type="checkbox" checked={session.config.voiceInputEnabled} onChange={e => updateConfig({ voiceInputEnabled: e.target.checked })} />麦克风实时转写</label>
        <label className="flex items-center gap-2 rounded-xl border border-[#e2e8f0] p-3 text-sm dark:border-[#334155]"><input type="checkbox" checked={session.config.speechEnabled} onChange={e => updateConfig({ speechEnabled: e.target.checked })} />系统朗读题目</label>
      </div>
      <details className="mt-4 rounded-xl border border-[#e2e8f0] p-4 dark:border-[#334155]"><summary className="cursor-pointer text-sm font-medium">面试上下文</summary><textarea className="mt-3 h-28 w-full rounded-xl border p-3 text-sm" placeholder="简历" value={session.config.resumeContext} onChange={e => updateConfig({ resumeContext: e.target.value })} /><textarea className="mt-3 h-28 w-full rounded-xl border p-3 text-sm" placeholder="职位描述" value={session.config.jobDescription} onChange={e => updateConfig({ jobDescription: e.target.value })} /></details>
      {session.error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">{session.error}</div>}
      <button onClick={startInterview} className="mt-6 w-full rounded-2xl bg-[#6366f1] py-3 font-medium text-white">{copy.start}</button>
    </div></div>
  )

  if (session.phase === 'completed' && session.report) return (
    <div className="w-full p-8"><div className="card mx-auto max-w-5xl p-8">
      <div className="flex items-start justify-between"><div><h1 className="text-2xl font-semibold">面试报告</h1><p className="text-sm text-[#64748b] dark:text-[#94a3b8]">{session.config.role} · {session.config.company || '未指定'}</p></div><div className="text-4xl font-semibold text-[#6366f1]">{session.report.overallScore}</div></div>
      <p className="mt-5 rounded-xl bg-[#f8fafc] p-4 dark:bg-[#0f172a]">{session.report.summary}</p>
      <div className="mt-5 grid grid-cols-2 gap-4"><section className="rounded-xl border border-[#e2e8f0] p-4 dark:border-[#334155]"><h2 className="font-medium">优势</h2>{session.report.strengths.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section><section className="rounded-xl border border-[#e2e8f0] p-4 dark:border-[#334155]"><h2 className="font-medium">优先改进</h2>{session.report.priorityImprovements.map(v => <div key={v} className="mt-2 text-sm">• {v}</div>)}</section></div>
      <div className="mt-5 space-y-3">{session.turns.map((turn, index) => <details key={turn.question.id} className="rounded-xl border border-[#e2e8f0] p-4 dark:border-[#334155]"><summary className="cursor-pointer font-medium">第 {index + 1} 题 · {turn.feedback?.overallScore ?? 0} 分</summary><p className="mt-3">{turn.question.text}</p><p className="mt-2 rounded-lg bg-[#f8fafc] p-3 text-sm dark:bg-[#0f172a]">{turn.answer?.text}</p><p className="mt-2 text-sm text-[#475569] dark:text-[#94a3b8]">{turn.feedback?.summary}</p></details>)}</div>
      <div className="mt-6 flex gap-3"><button onClick={exportReport} className="flex-1 rounded-xl border border-[#e2e8f0] py-2 dark:border-[#334155]">导出 Markdown</button><button onClick={reset} className="flex-1 rounded-xl bg-[#6366f1] py-2 text-white">{copy.new}</button></div>
    </div></div>
  )

  const busy = ['starting', 'speaking', 'evaluating', 'generating-report', 'saving'].includes(session.phase)
  return (
    <div className="w-full p-8"><div className="card mx-auto max-w-6xl p-8">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">{copy.title}</h1><div className="text-sm text-[#64748b] dark:text-[#94a3b8]">第 {session.turns.length}/{session.config.questionCount} 题 · {Math.floor(session.elapsedSeconds / 60)}:{String(session.elapsedSeconds % 60).padStart(2, '0')}</div></div><button onClick={() => finishInterview(session.turns, false)} className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950/60 dark:text-red-300">{copy.end}</button></div>
      <div className="mt-6 grid grid-cols-[1.2fr_0.8fr] gap-5">
        <section className="rounded-2xl border border-[#e2e8f0] p-5 dark:border-[#334155]"><div className="text-xs font-medium uppercase text-[#6366f1]">{session.currentQuestion?.stage}</div><div className="mt-3 text-xl leading-relaxed">{session.currentQuestion?.text || '正在生成问题…'}</div>{session.currentQuestion?.intent && <div className="mt-3 text-sm text-[#64748b] dark:text-[#94a3b8]">考察重点：{session.currentQuestion.intent}</div>}<button onClick={() => session.currentQuestion && speakQuestion(session.currentQuestion)} disabled={!session.config.speechEnabled || busy} className="mt-4 rounded-xl border border-[#e2e8f0] px-3 py-2 text-sm dark:border-[#334155] disabled:opacity-40">🔊 重播题目</button></section>
        <section className="rounded-2xl border border-[#e2e8f0] p-5 dark:border-[#334155]"><div className="font-medium">上一题反馈</div>{session.turns.slice().reverse().find(turn => turn.feedback)?.feedback ? (() => { const fb = session.turns.slice().reverse().find(turn => turn.feedback)!.feedback!; return <><div className="mt-3 text-3xl font-semibold text-[#6366f1]">{fb.overallScore}</div><p className="mt-2 text-sm">{fb.summary}</p><div className="mt-3 text-xs text-[#64748b] dark:text-[#94a3b8]">{fb.improvements.join(' · ')}</div></> })() : <p className="mt-3 text-sm text-[#64748b] dark:text-[#94a3b8]">提交回答后获得逐题评分。</p>}</section>
      </div>
      <section className="mt-5 rounded-2xl border border-[#e2e8f0] p-5 dark:border-[#334155]"><div className="flex justify-between"><div className="font-medium">{copy.answer}</div><div className="text-xs text-[#64748b] dark:text-[#94a3b8]">{session.draftAnswer.length}/4000</div></div><textarea maxLength={4000} value={session.draftAnswer} onChange={e => patch({ draftAnswer: e.target.value })} disabled={busy} className="mt-3 h-40 w-full rounded-xl border p-3 disabled:bg-[#f8fafc]" placeholder={session.config.voiceInputEnabled ? '直接说话，转写结果可编辑…' : '输入你的回答…'} />{session.interimTranscript && <div className="mt-2 text-sm text-[#64748b] dark:text-[#94a3b8]">正在识别：{session.interimTranscript}</div>}<button onClick={submitAnswer} disabled={busy || !session.draftAnswer.trim()} className="mt-4 w-full rounded-2xl bg-[#6366f1] py-3 font-medium text-white disabled:opacity-40">{session.phase === 'evaluating' ? '正在分析…' : copy.submit}</button></section>
      {session.error && <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300">{session.error}<button onClick={() => patch({ phase: session.currentQuestion ? 'answering' : 'setup', error: null })} className="ml-3 underline">{copy.retry}</button></div>}
    </div></div>
  )
}
