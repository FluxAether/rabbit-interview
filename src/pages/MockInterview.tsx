import { useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { saveInterview } from '../lib/db'
import { useTranslation } from '../i18n'

const STAGES_KEYS = [
  'mock.stage.introduction',
  'mock.stage.core',
  'mock.stage.behavioral',
  'mock.stage.technical',
  'mock.stage.conclusion'
]

export default function MockInterview() {
  const { 
    mockConversation, mockFeedback, 
    addMockMessage, setMockFeedback, resetMock, addHistory 
  } = useAppStore()
  const t = useTranslation()

  const [currentStage, setCurrentStage] = useState(1)
  const [answer, setAnswer] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEnded, setIsEnded] = useState(false)

  const submitAnswer = async () => {
    if (!answer.trim()) return
    
    setIsSubmitting(true)
    addMockMessage('user', answer)

    // Simulate AI response + scoring (in real: call LLM with context)
    await new Promise(r => setTimeout(r, 650))

    const nextQ = [
      "Great. Can you tell me about a time you had to influence without authority?",
      "How do you handle conflicting priorities from stakeholders?",
      "Describe a technical challenge you solved recently."
    ][currentStage % 3]

    addMockMessage('ai', nextQ)

    // Generate realistic feedback
    const newFeedback = [
      { label: 'Clarity', score: 78 + Math.floor(Math.random()*15), text: t('feedback.clarityText') },
      { label: 'Relevance', score: 85 + Math.floor(Math.random()*10), text: t('feedback.relevanceText') },
      { label: 'Impact', score: 70 + Math.floor(Math.random()*20), text: t('feedback.impactText') },
    ]
    setMockFeedback(newFeedback)

    // Advance stage
    if (currentStage < 5) {
      setCurrentStage(currentStage + 1)
    } else {
      setIsEnded(true)
    }

    setAnswer('')
    setIsSubmitting(false)
  }

  const endInterview = () => {
    const avg = mockFeedback.length > 0 
      ? Math.round(mockFeedback.reduce((a, b) => a + b.score, 0) / mockFeedback.length) 
      : 82

    const record = {
      date: new Date().toISOString().slice(0,16).replace('T', ' '),
      role: 'Product Designer',
      company: 'Demo Corp',
      score: avg,
      transcript: mockConversation.map(m => `${m.role}: ${m.text}`).join('\n'),
      duration: 780,
      mode: 'behavioral'
    }
    
    addHistory(record)
    // Persist to SQLite
    saveInterview(record).catch(console.error)
    
    setIsEnded(true)
    alert(`Interview complete! Overall score: ${avg}. Saved to History.`)
    resetMock()
    setCurrentStage(1)
    setIsEnded(false)
  }

  const startNew = () => {
    resetMock()
    setCurrentStage(1)
    setIsEnded(false)
    setAnswer('')
    addMockMessage('ai', t('mock.startPrompt'))
  }

  return (
    <div className="w-full p-8">
      <div className="card p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 text-[#6366f1] font-medium text-sm">
              <span>{t('mock.badge')}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">{t('mock.title')}</h1>
          </div>
          <div className="text-right">
            <div className="text-xs text-[#64748b]">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
            <button onClick={endInterview} className="mt-1 text-xs bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1 rounded-lg">{t('mock.end')}</button>
          </div>
        </div>

        {/* Progress stepper */}
        <div className="flex items-center gap-2 mb-8 text-xs">
          {STAGES_KEYS.map((labelKey, i) => {
            const n = i + 1
            const active = n === currentStage
            return (
              <div key={i} className="flex items-center gap-1.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${n < currentStage ? 'bg-[#22c55e] text-white' : active ? 'bg-[#6366f1] text-white' : 'bg-[#e2e8f0] text-[#64748b]'}`}>
                  {n}
                </div>
                <div className={active || n < currentStage ? 'text-[#4338ca]' : 'text-[#64748b]'}>{t(labelKey)}</div>
                {i < 4 && <div className="w-6 h-px bg-[#cbd5e1]" />}
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Conversation */}
          <div className="card p-5">
            <div className="text-sm font-medium mb-3">{t('mock.interviewer')}</div>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-full bg-[#e0e7ff] flex items-center justify-center text-xl">👤</div>
              <div>
                <div className="font-medium">Alex Morgan</div>
                <div className="text-xs text-[#6366f1]">{t('mock.interviewerSub')}</div>
              </div>
            </div>

            <div className="space-y-3 text-sm max-h-[240px] overflow-auto">
              {mockConversation.length === 0 && (
                <div className="bg-[#f1f5f9] rounded-xl p-3">Let's begin. Can you tell me about a time when you had to work under pressure to meet a tight deadline?</div>
              )}
              {mockConversation.map((msg, idx) => (
                <div key={idx} className={`${msg.role === 'ai' ? 'bg-[#f1f5f9]' : 'bg-[#6366f1] text-white ml-auto max-w-[82%]'} rounded-xl p-3`}>
                  {msg.text}
                </div>
              ))}
            </div>
          </div>

          {/* Response + Feedback */}
          <div className="space-y-4">
            {!isEnded ? (
              <div className="card p-5">
                <div className="flex justify-between text-sm mb-2">
                  <div className="font-medium">{t('mock.yourResponse')}</div>
                  <div className="text-[#64748b] text-xs">{answer.length} / 1000</div>
                </div>
                <textarea 
                  value={answer} 
                  onChange={e => setAnswer(e.target.value)} 
                  className="w-full h-28 border border-[#e2e8f0] rounded-xl p-3 text-sm resize-y" 
                  placeholder={t('mock.placeholder')} 
                />
                <button 
                  onClick={submitAnswer} 
                  disabled={isSubmitting || !answer.trim()}
                  className="mt-3 w-full bg-[#6366f1] disabled:opacity-60 text-white py-2 rounded-2xl text-sm font-medium"
                >
                  {isSubmitting ? t('common.thinking') : t('common.submit')}
                </button>
              </div>
            ) : (
              <div className="card p-5 text-center">
                <div className="text-lg font-semibold mb-1">{t('mock.complete.title')}</div>
                <button onClick={startNew} className="text-sm px-4 py-1 bg-[#6366f1] text-white rounded-xl mt-2">{t('mock.complete.new')}</button>
              </div>
            )}

            <div className="card p-5">
              <div className="font-medium mb-3 flex items-center gap-2">{t('mock.feedback')}</div>
              <div className="space-y-2.5 text-sm">
                {mockFeedback.length === 0 && <div className="text-[#64748b] text-xs">{t('mock.feedback.empty')}</div>}
                {mockFeedback.map((fb, i) => (
                  <div key={i} className="feedback-card p-3 flex justify-between items-center">
                    <div>
                      {t('feedback.' + (fb.label.toLowerCase() as any)) || fb.label}<br />
                      <span className="text-xs text-[#64748b]">{fb.text}</span>
                    </div>
                    <div className="text-xl font-semibold text-[#6366f1]">{fb.score}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 text-right">
          <button onClick={startNew} className="text-xs text-[#64748b] underline">{t('common.reset')}</button>
        </div>
      </div>
    </div>
  )
}
