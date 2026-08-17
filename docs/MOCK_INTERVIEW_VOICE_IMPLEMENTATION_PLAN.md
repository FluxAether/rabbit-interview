# 模拟面试语音对话实施计划

> 目标：把当前“文本提交 + 语音转写辅助”的模拟面试升级为“AI 面试官自动提问 → 候选人自然语音回答 → 自动判断回答结束 → 自动评估/追问/下一题”的连续语音对话，同时保留现有 Interview Engine、结构化评分、追问策略、报告和历史记录。
>
> 核心原则：**保留 Interview Engine，新增 Voice Conversation Runtime。** 语音层只负责“说、听、判断一轮回答结束、清理资源”，不接管题目规划、评分和报告。

## 1. 当前实现基线

现有模拟面试已经具备以下能力：

- `src/lib/mockInterviewPlan.ts`：按岗位、难度、类型和证据上下文生成面试计划。
- `src/lib/mockInterviewPolicy.ts`：根据 competency coverage 和 gaps 决定追问、下一主问题或结束。
- `src/lib/mockInterviewAi.ts`：生成问题、生成追问、评估回答、生成最终报告。
- `src/pages/MockInterview.tsx`：整合页面、麦克风采集、Deepgram STT、系统 TTS、手动提交、录音和保存。
- `src/lib/llm.ts`：Deepgram WebSocket、`interim/final/speech-final/utterance-end` 边界、重连、KeepAlive。
- `src-tauri/src/audio/`：麦克风采集、实时音频 chunk、振幅、录音保存。
- `src-tauri/src/speech.rs`：macOS `/usr/bin/say`、Windows SAPI TTS 和 `stop_speaking`。

当前真实交互仍然是：

```text
AI 生成题目
  ↓
系统朗读
  ↓
麦克风转写到 draftAnswer
  ↓
用户点击“提交回答”
  ↓
evaluateMockTurn
  ↓
decideNextAction
```

本次改造后的目标交互是：

```text
AI 生成题目
  ↓
AI 朗读完成
  ↓
自动进入聆听
  ↓
候选人说话 + 实时字幕
  ↓
Deepgram endpoint + grace period 判断回答结束
  ↓
自动锁定本轮回答
  ↓
evaluateMockTurn
  ↓
decideNextAction
  ↓
自动追问 / 自动下一题 / 结束
```

## 2. 范围与非目标

### 2.1 本轮必须完成

1. 语音模式成为模拟面试的主交互方式。
2. AI 朗读结束后自动开始接收候选人回答。
3. 候选人自然停顿后自动结束本轮回答，不再要求点击“提交回答”。
4. 保留“完成回答”作为手动兜底。
5. 实时展示 interim/final transcript 和明确的语音状态。
6. 自动进入评估，然后自动追问/下一题。
7. 一整场面试只启动一次音频采集和一次 STT runtime，不逐题开关麦克风。
8. 整场录音、历史记录、报告结构继续兼容。
9. TTS 完成必须以真实进程结束为准，删除字符长度估算等待。
10. 语音 runtime 的启动、停止、迟到回调和重复提交必须具备幂等/防竞态处理。

### 2.2 明确保留

以下现有 Interview Engine 不重写：

- `buildEvidenceBrief`
- `buildInterviewPlan`
- `generateQuestionForSlot`
- `generateFollowUpQuestion`
- `evaluateMockTurn`
- `applyAnswerCoverage`
- `decideNextAction`
- `generateMockReport`
- `buildMockTranscript`
- History/SQLite 保存结构

### 2.3 首版不做

1. **不做 barge-in**：候选人在 AI 讲话时开口，不立即打断 AI。
2. 不做声学 AEC/回声消除。
3. 不替换为端到端 Realtime Agent。
4. 不做 streaming TTS。
5. 不做多人面试官或多角色语音。
6. 不做逐题独立录音文件。
7. 不新增云后端或服务器中转。

这些能力放到后续阶段，避免把 MVP 变成音频基础设施重写。

## 3. 设计原则

### 3.1 两层状态，不做一个巨型状态机

业务层继续使用现有：

```ts
type MockInterviewPhase =
  | 'setup'
  | 'starting'
  | 'speaking'
  | 'answering'
  | 'evaluating'
  | 'generating-report'
  | 'saving'
  | 'completed'
  | 'error'
```

新增语音 runtime 状态：

```ts
type MockInterviewVoicePhase =
  | 'idle'
  | 'starting'
  | 'interviewer-speaking'
  | 'listening'
  | 'candidate-speaking'
  | 'finalizing'
  | 'paused'
  | 'stopping'
  | 'error'
```

含义：

- `MockInterviewPhase` 回答“业务正在做什么”。
- `MockInterviewVoicePhase` 回答“音频 runtime 正在做什么”。
- 不把 `candidate-speaking`、`speech-final` 等音频细节塞进 `MockInterviewSnapshot` 的业务 phase。

### 3.2 Capture active 与 Listening 必须分开

整场面试建议保持原生 capture 活跃，但只在候选人可回答时把 microphone chunk 发给 STT：

```text
captureActive = true     // 整场录音/麦克风资源已启动
acceptingAudio = false   // AI 正在讲话或 AI 正在评估

captureActive = true
acceptingAudio = true    // 候选人回答窗口
```

UI 不再把 `captureActive` 直接文案化为“正在听你说话”。

### 3.3 Voice Runtime 不理解面试业务

`mockInterviewVoiceSession.ts` 不允许 import：

- `mockInterviewAi.ts`
- `mockInterviewPlan.ts`
- `mockInterviewPolicy.ts`
- coverage/report 逻辑

它只产出一个完整的候选人回答，页面再交给现有 Interview Engine。

## 4. 目标模块结构

```text
src/
├── pages/
│   └── MockInterview.tsx
│
├── lib/
│   ├── mockInterviewAi.ts
│   ├── mockInterviewEvidence.ts
│   ├── mockInterviewPlan.ts
│   ├── mockInterviewPolicy.ts
│   ├── mockInterviewState.ts
│   ├── mockInterviewVoiceSession.ts      # 新增：语音 runtime 深 module
│   └── mockInterviewVoiceEndpoint.ts     # 新增：纯 transcript/endpoint 逻辑
│
├── i18n/
│   └── translations.ts
│
src-tauri/
└── src/
    ├── audio/
    └── speech.rs

scripts/
└── verify-mock-interview.mjs
```

`mockInterviewVoiceEndpoint.ts` 是 `mockInterviewVoiceSession.ts` 的内部实现 seam，目的是把最容易出错的 transcript 聚合/endpoint 判断做成纯逻辑，便于验证；页面不直接使用它。

## 5. Voice Session 外部 interface

建议对页面只暴露以下能力：

```ts
export interface MockInterviewVoiceConfig {
  language: SupportedLanguage
  microphoneDevice: string | null
  speechEnabled: boolean
}

export interface MockInterviewVoiceSnapshot {
  phase: MockInterviewVoicePhase
  captureActive: boolean
  finalTranscript: string
  interimTranscript: string
  amplitude: number
  error: string | null
}

export type MockInterviewVoiceEvent =
  | { type: 'snapshot'; snapshot: MockInterviewVoiceSnapshot }
  | {
      type: 'answer-final'
      text: string
      startedAt: number
      endedAt: number
      reason: 'utterance-end' | 'speech-final' | 'manual'
    }
  | { type: 'error'; error: string }

start(config: MockInterviewVoiceConfig): Promise<void>
ask(text: string, options?: { preserveTranscript?: boolean }): Promise<void>
finalizeAnswer(): void
restartAnswer(): void
stop(options?: { saveRecording?: boolean }): Promise<SavedRecording | null>
subscribe(listener: (event: MockInterviewVoiceEvent) => void): () => void
```

接口约束：

- `start()` 幂等；重复调用不得创建第二个 capture 或第二个 Deepgram socket。
- `stop()` 幂等；`starting`、`speaking`、`listening` 任意阶段都可安全停止。
- `ask()` 负责完整的“关闭接收 → TTS → TTS 真正结束 → 开启接收”。页面不能自己拼这三个步骤。
- `finalizeAnswer()` 只允许一轮发出一次 `answer-final`。
- `restartAnswer()` 用于评估失败后“重新回答”，清空本轮 transcript 并重新进入 listening；不重新启动 capture/STT。
- `stop({ saveRecording: true })` 是正常结束面试路径；卸载、重置、启动失败使用 `false`。

## 6. Voice Session 内部状态与资源

`MockInterviewVoiceSession` 内部集中持有：

```text
Deepgram WebSocket
Tauri audio listeners
capture active flag
accepting audio flag
current sample rate
final transcript parts
interim transcript
answer started timestamp
endpoint finalize timer
runtime generation
answer generation
finalizing latch
stop promise
subscriber set
```

页面完成改造后应删除以下 runtime refs：

- `deepgramRef`
- `unlistenRef`
- `isListeningRef`
- `acceptingAudioRef`
- `finalTranscriptRef`

`MockInterview.tsx` 只保留业务层 refs，例如：

- `sessionRef`
- `abortRef`
- `finishingRef`
- 当前 question 的提交 single-flight guard

## 7. 语音轮次状态机

正常一轮：

```text
idle
  ↓ start
starting
  ↓ capture + STT ready
paused
  ↓ ask(question)
interviewer-speaking
  ↓ TTS process completed
listening
  ↓ first real transcript
candidate-speaking
  ↓ endpoint detected
finalizing
  ↓ emit answer-final
paused
  ↓ page evaluates and generates next question
interviewer-speaking
```

正常结束：

```text
paused / listening / interviewer-speaking
  ↓ stop
stopping
  ↓ stop TTS + disable audio + close STT + stop capture + save recording
idle
```

评估失败：

```text
answer-final
  ↓
paused
  ↓ evaluate failed
UI 显示：重试分析 / 重新回答

重试分析：复用同一 answer text，不重新听音
重新回答：restartAnswer() → listening
```

## 8. 回答结束检测策略

### 8.1 不另造 VAD

首版直接使用 `llm.ts` 已经提供的 Deepgram 事件：

```ts
'interim'
'final'
'speech-final'
'utterance-end'
```

现有连接参数已有：

```text
interim_results=true
utterance_end_ms=1000
vad_events=true
endpointing=...
```

所以 MVP 只需要正确聚合和使用边界，不需要自己分析 PCM 判断静音。

### 8.2 Transcript 聚合规则

`interim`：

- 只更新 UI 的 `interimTranscript`。
- 不加入最终文本。
- 如果已经 armed 一个 `speech-final` grace timer，而出现新的有效 interim，则取消 timer，说明用户继续说话。

`final`：

- 加入 `finalParts`。
- 对连续重复的 final 片段去重。
- 第一个有效 final/interim 到达时记录 `answerStartedAt`。

`speech-final`：

- 如果携带 `isFinal + text`，先按 final 规则聚合。
- 不立即提交。
- 若当前回答达到最小有效内容，启动 grace timer。

`utterance-end`：

- 优先级高于 `speech-final`。
- 如果已有有效最终文本，立即 finalize。
- 如果没有有效文本，不提交空回答。

### 8.3 Grace period

建议内部常量：

```ts
const SPEECH_FINAL_GRACE_MS = 900
```

行为：

```text
speech-final
  ↓
900ms 内出现新 interim/final？
  ├─ 是 → cancel finalize，继续听
  └─ 否 → finalize
```

该值只作为内部策略，不进入设置页，避免首版增加无价值配置。

### 8.4 最小有效回答

避免以下噪声直接触发评分：

```text
“嗯”
“呃”
“啊”
“yes”
```

建议纯 helper 判断：

- CJK：去标点/空白后至少 4 个有效字符。
- 非 CJK：至少 3 个有效 token。
- 允许用户点击“完成回答”覆盖自动阈值，但空文本仍不得提交。

### 8.5 At-most-once

每道 question 对应一个 `answerGeneration`。

任何 endpoint timer、WebSocket 迟到事件都必须携带/捕获当前 generation；如果 generation 已变化则忽略。

同一 generation 只能发出一次：

```ts
{ type: 'answer-final', ... }
```

这样可以防止：

- `speech-final` timer 与 `utterance-end` 同时提交。
- 用户点击“完成回答”的同时收到 `utterance-end`。
- 下一题开始后上一题的迟到 STT 再次触发提交。

## 9. TTS completion 重构

### 9.1 当前问题

当前 `speak_text` 启动系统进程后立即返回，前端靠：

```ts
question.text.length * ...
```

估算朗读时间。

这会导致：

- AI 还在说话时过早打开候选人 STT。
- AI 已经说完但仍处于等待状态。
- replay/stop 时更容易出现竞态。

### 9.2 新 contract

`invoke('speak_text')` 必须变成：

```text
spawn speech process
  ↓
等待该 generation 的 speech process 真正退出
  ↓
Promise resolve
```

`stop_speaking` 继续保持幂等，并允许在 `speak_text` 等待过程中取消。

### 9.3 Rust 实现建议

不要在 Mutex 锁内做阻塞 `wait()`。

建议把当前 `Option<Child>` 升级为带 generation 的状态：

```rust
struct SpeechState {
    generation: u64,
    child: Option<Child>,
}
```

流程：

1. 新 `speak_text` 开始前终止旧 child。
2. generation + 1。
3. spawn 新 child，保存到 `SpeechState`。
4. 当前调用记录自己的 generation。
5. 通过短周期 `try_wait()` 检查退出状态，每次只短暂持锁。
6. 如果 state generation 已变化，说明被新朗读或 `stop_speaking` 取消，旧调用直接结束。
7. child 正常退出后移除它并 resolve。

需要满足：

- 一个时刻最多一个 TTS child。
- 新问题朗读会终止旧朗读。
- `finishInterview/reset/unmount` 可以立即取消。
- 旧 `speak_text` 的完成不能把新一轮错误地切到 listening。

### 9.4 前端删除项

完成后必须删除：

```ts
const delay = Math.min(...)
await new Promise(resolve => window.setTimeout(resolve, delay))
```

VoiceSession 只使用：

```ts
await invoke('speak_text', ...)
```

作为“AI 朗读已经结束”的依据。

## 10. Deepgram 连接调整

### 10.1 使用实际采样率

当前 MockInterview 固定用 `16_000` 建 Deepgram，但原生 capture 会返回实际 sample rate。

新 VoiceSession 启动顺序：

```text
install Tauri listeners
  ↓
start_audio_capture
  ↓
读取返回的 sample_rate
  ↓
startDeepgramStream(sample_rate)
  ↓
voice runtime ready
```

capture 启动到 Deepgram ready 之间：

```text
acceptingAudio = false
```

所以不会丢失候选人回答；此时还没开始第一题。

同时监听 `audio-config`，如果后续 sample rate 发生变化，按 `copilotSession.ts` 已验证过的策略重建 Deepgram socket。

### 10.2 面试语言必须覆盖全局 STT language

当前 Deepgram URL 从全局 `settings.sttLanguage` 读取语言，但模拟面试自己有：

```ts
session.config.language
```

这可能出现“English 面试 + 中文 STT”的错误组合。

建议非破坏性扩展：

```ts
interface DeepgramStreamOptions {
  language?: string
  endpointingMs?: number
  utteranceEndMs?: number
}

startDeepgramStream(
  onTranscript,
  onError,
  sampleRate,
  onSocketChange,
  options?,
)
```

默认不传 options 时保持 Copilot 当前行为；MockInterview VoiceSession 显式传：

```ts
{ language: config.language }
```

重连时必须保存并复用相同 options，不能 reconnect 后退回全局语言。

### 10.3 不修改共享 STT 默认值

本次不要为了模拟面试直接更改 Copilot 使用的：

- endpointing 默认策略
- utterance end 默认策略
- model 默认值

Voice 模拟面试需要不同策略时，用 optional override，避免共享功能回归。

## 11. 页面集成设计

### 11.1 `startInterview`

目标流程：

```text
validate role
  ↓
buildEvidenceBrief
  ↓
buildInterviewPlan
  ↓
voice.start(config)        // voice mode only
  ↓
generate first question
  ↓
set business phase=speaking
  ↓
voice.ask(question.text)
  ↓
VoiceSession 自动切到 listening
```

如果 voice start 失败：

- 停止未完成的 capture/runtime。
- 页面 phase → `error`。
- 清楚显示麦克风权限、Deepgram key、网络或设备错误。
- 提供“切换到文本回答”路径，不做静默降级。

### 11.2 `submitAnswer` 参数化

当前：

```ts
submitAnswer()
```

改为：

```ts
submitAnswer(input?: {
  text?: string
  source?: 'voice' | 'text' | 'mixed'
  startedAt?: number
})
```

调用方式：

```text
Voice auto-final → submitAnswer({ text, source: 'voice', startedAt })
Text fallback     → submitAnswer()
```

函数内部必须从 `sessionRef.current` 读取最新 session，避免 VoiceSession subscription 捕获旧 React closure。

### 11.3 提交 single-flight

增加当前 question id guard，例如：

```text
submittingQuestionIdRef
```

规则：

- 同一个 question id 正在评估时，后续 auto-final/manual-final 直接忽略。
- 成功切到下一 question 后清空 guard。
- 评估失败时保留已捕获 answer，并允许“重试分析”。

### 11.4 自动下一题

现有：

```text
evaluateMockTurn
  ↓
decideNextAction
  ↓
generateFollowUpQuestion / generateQuestionForSlot
```

保持不变。

区别只在最后：

```ts
await voice.ask(nextQuestion.text)
```

代替页面自己 `speakQuestion()` + 手动提交循环。

### 11.5 结束面试

正常/提前结束统一：

```text
abort current AI request
  ↓
voice.stop({ saveRecording: true })
  ↓
generateMockReport
  ↓
saveInterview
```

`voice.stop()` 内部负责：

- `stop_speaking`
- 禁止继续送音频
- 清 endpoint timer
- close Deepgram
- unlisten Tauri events
- `stop_audio_capture`
- 可选 `save_audio_recording`

页面不再分别清理这些资源。

### 11.6 reset/unmount

使用：

```ts
voice.stop({ saveRecording: false })
```

并使所有旧 generation callback 自动失效。

## 12. Voice 模式 UI

### 12.1 Setup

保持已有岗位、公司、面试类型、难度、题数、语言、Resume/JD。

调整语音选项：

- `voiceInputEnabled` 默认改为 `true`，让“语音对话”成为主模式。
- `speechEnabled` 继续默认 `true`。
- 文本回答继续作为 fallback，不删除。

建议文案：

```text
回答方式
● 语音面试（推荐）
○ 文本回答

AI 朗读题目：开启/关闭
```

首版可继续复用现有 bool 数据结构，不必新增 persisted `conversationMode` 字段。

### 12.2 面试中 Voice Surface

语音模式不再以 textarea + 大“提交回答”按钮作为主视觉。

状态文案：

```text
interviewer-speaking → AI 面试官正在提问…
listening            → 请开始回答
candidate-speaking   → 正在聆听你…
finalizing           → 正在确认回答…
paused + evaluating  → 正在分析回答…
error                → 语音连接异常
```

显示内容：

- 当前问题。
- 当前业务进度（主问题 X / N、是否追问）。
- AI/候选人语音状态。
- 振幅动画；振幅来自 `audio-amplitude`，不是固定 CSS 假波形。
- final transcript。
- interim transcript 使用弱化样式紧跟在 final 后面。
- “完成回答”按钮作为 endpoint 失败的兜底。
- “重新播放问题”按钮。
- “结束面试”按钮。

### 12.3 Text fallback

当 `voiceInputEnabled=false`：

- 保留当前 textarea。
- 保留“提交回答”。
- `speechEnabled=true` 时仍可朗读问题。
- 不启动麦克风和 Deepgram。

这样可以在没有 STT key、麦克风权限或嘈杂环境下继续完成模拟面试。

### 12.4 Replay

Replay 必须：

```text
暂时 acceptingAudio=false
  ↓
朗读当前问题
  ↓
朗读真正结束
  ↓
恢复 listening
```

如果候选人已经有 transcript，replay 默认 `preserveTranscript=true`，不能清掉已说内容。

## 13. 错误与恢复策略

### 13.1 麦克风权限失败

- 不进入面试题生成循环。
- 明确提示需要麦克风权限。
- 可返回 setup 切文本模式。
- 必须清理可能已创建的 Deepgram/capture 资源。

### 13.2 Deepgram 首次连接失败

- 停止原生 capture。
- phase → error。
- 不开始第一题。

### 13.3 Deepgram 中途断线

现有 `llm.ts` 已具备 managed reconnect。

VoiceSession：

- 保留当前 transcript。
- 显示“正在重新连接语音识别”状态/notice。
- 不因为一次 socket close 自动结束整场面试。
- reconnect socket 必须继续使用当前 sample rate 和 interview language options。

### 13.4 长时间没有说话

首版最小策略：

- 不自动提交空回答。
- 保持 listening。
- 提供“重新播放问题”和“结束面试”。

后续 UX phase 可增加 10 秒提示、30 秒操作提示，但不要在 MVP 用超时自动跳题。

### 13.5 评估失败

已经捕获的回答不得丢失。

提供：

```text
重试分析  → 用同一 answer 再调用 evaluateMockTurn
重新回答  → voice.restartAnswer()
结束面试  → 正常生成已有 turns 的报告
```

### 13.6 用户提前结束

- 立即 cancel 当前 TTS/LLM。
- 不等待 endpoint timer。
- 保存整场已有录音。
- 已完成回答进入报告；当前未 finalize 的半句话默认不进入评分。

## 14. 数据与兼容性

### 14.1 `MockInterviewTurn.answer`

现有结构继续使用：

```ts
answer: {
  text: string
  source: 'text' | 'voice' | 'mixed'
  startedAt: number
  submittedAt: number
}
```

语音模式改进 timestamp 语义：

- `startedAt`：第一段有效候选人 transcript 的时间。
- `submittedAt`：VoiceSession finalize 的时间。

不再把 `question.createdAt` 当成语音回答开始时间。

### 14.2 History / detailsJson

首版保持：

```ts
version: 2
config
plan
coverage
turns
report
```

不需要数据库 migration。

如果后续要保存 endpoint reason、STT latency 等诊断数据，再单独升级 details version；本轮不要为了 runtime debug 改持久化 schema。

### 14.3 配置兼容

继续使用：

```text
voiceInputEnabled
speechEnabled
microphoneDevice
```

只改变默认交互，不删除字段，因此旧 History 可以继续读取。

## 15. 分阶段实施

## PR 1：TTS completion + STT options 基础合同

**目标**：先修复两个会直接影响语音轮转正确性的基础合同：真实 TTS 完成、MockInterview STT 语言/采样率可控。

### 改动

1. `src-tauri/src/speech.rs`
   - 引入 speech generation/state。
   - `speak_text` 等待当前 child 真正结束。
   - `stop_speaking` 保持幂等且可取消等待中的朗读。
   - 不在 Mutex 锁内阻塞 wait。

2. `src/lib/llm.ts`
   - 给 `startDeepgramStream` 增加 optional `DeepgramStreamOptions`。
   - options 至少支持 language；endpoint 参数可预留为 optional，但不改变默认值。
   - reconnect 保留 options。
   - 不破坏现有 Copilot caller。

3. `scripts/verify-copilot.mjs`
   - 验证不传 options 仍使用当前默认 STT 配置。
   - 验证传 language override 时 URL 使用 override。
   - 验证 reconnect 保留 override。

4. `scripts/verify-mock-interview.mjs`
   - 删除/替换对字符长度延时策略的依赖。
   - 增加“MockInterview 不再包含 question length TTS wait”的静态检查。

### 验收

- 长问题朗读时，前端 invoke 直到声音播放结束才 resolve。
- `stop_speaking` 可以中断朗读，等待中的 invoke 随后正常结束。
- 连续 replay 不会出现两个 TTS 同时播放。
- MockInterview 可显式使用 `config.language` 建 STT。
- Copilot 现有 STT 行为不变。

## PR 2：Voice Conversation Runtime

**目标**：把音频、STT、endpoint、录音生命周期从页面移入一个深 module。

### 新增

1. `src/lib/mockInterviewVoiceEndpoint.ts`
   - final/interim 聚合。
   - 重复 final 去重。
   - 最小有效回答判断。
   - speech-final grace decision。
   - utterance-end finalize decision。
   - 纯函数，可直接验证。

2. `src/lib/mockInterviewVoiceSession.ts`
   - permission。
   - Tauri audio listeners。
   - start/stop capture。
   - Deepgram start/reconnect socket replacement。
   - 实际 sample rate。
   - interview language override。
   - acceptingAudio gating。
   - TTS lifecycle。
   - answer generation 和 runtime generation。
   - finalize timer。
   - amplitude snapshot。
   - recording save。
   - subscribe/event 发布。

### 页面此 PR 暂不完全切换

可以先只接最小 harness/验证，不一次混入大量 JSX 改动。

### 验收

- `start` 连续调用只启动一个 runtime。
- AI speaking 时 microphone chunks 不发送给 Deepgram。
- TTS resolve 后才发送 microphone chunks。
- speech-final + 新 interim 会取消自动完成。
- utterance-end 只 finalize 一次。
- manual finalize 与 utterance-end 竞争时只发一次 answer-final。
- `stop` 连续调用安全。
- stop 后迟到 STT 不再更新 snapshot/提交。
- recording 正常返回保存路径。

## PR 3：MockInterview 自动轮转集成

**目标**：用户从开始到报告都可以不点击“提交回答”。

### `src/pages/MockInterview.tsx`

1. 创建/持有一个 VoiceSession 实例。
2. mount 时 subscribe，unmount 时 stop without save。
3. 删除页面里的 Deepgram/audio runtime refs 和 `startVoice/stopVoice/speakQuestion` 实现。
4. `startInterview` 在 voice mode 使用 `voice.start`。
5. 问题生成后使用 `voice.ask`。
6. 收到 `answer-final` 自动调用参数化 `submitAnswer`。
7. `submitAnswer` 使用 `sessionRef.current`。
8. 增加 question-level single-flight guard。
9. 评估成功后直接 `voice.ask(nextQuestion.text)`。
10. finish/reset 统一通过 VoiceSession cleanup。
11. 保留 text fallback 的 textarea + submit。
12. replay 改走 `voice.ask(question, { preserveTranscript: true })`。

### `src/lib/mockInterviewState.ts`

1. `voiceInputEnabled` 默认切到 `true`。
2. 不给业务 snapshot 加 Deepgram socket/timer 等 runtime 字段。
3. 如页面需要展示 voice phase，使用独立 `MockInterviewVoiceSnapshot`，不扩大持久化业务状态。

### 验收

完整 happy path：

```text
开始面试
→ 自动朗读第 1 题
→ 用户回答
→ 自动提交
→ 自动评分
→ 自动追问/下一题
→ 全部问题完成
→ 自动保存录音/报告
```

整个过程中不点击“提交回答”。

## PR 4：Voice UX、错误恢复、i18n 和回归

**目标**：把底层自动化变成用户可理解、可恢复的正式体验。

### `src/pages/MockInterview.tsx`

1. voice mode 使用状态化语音界面替代 textarea 主交互。
2. final/interim transcript 分层显示。
3. 接真实 amplitude 做 waveform/level 动画。
4. “完成回答”兜底。
5. “重新播放问题”。
6. 评估失败提供“重试分析 / 重新回答”。
7. Deepgram reconnect/voice error 给出可恢复 notice。
8. setup 明确语音为推荐模式，文本为 fallback。

### `src/i18n/translations.ts`

至少增加三种语言对应文案：

```text
mock.voice.mode
mock.voice.speaking
mock.voice.listening
mock.voice.candidateSpeaking
mock.voice.finalizing
mock.voice.processing
mock.voice.completeAnswer
mock.voice.reconnecting
mock.voice.retryEvaluation
mock.voice.restartAnswer
mock.voice.permissionError
mock.voice.sttError
mock.voice.textFallback
```

不要继续在页面增加新的硬编码中文语音状态。

### 验收

- zh-CN / zh-TW / en-US 三种语言没有缺 key。
- 用户能一眼区分“AI 正在说”“系统已经录音但没有听取回答”“正在听候选人”“正在分析”。
- STT/TTS 失败有明确恢复动作。
- text fallback 可完整完成一场面试。

## 16. 测试与验证计划

### 16.1 Pure endpoint tests

在 `scripts/verify-mock-interview.mjs` 或独立轻量验证脚本覆盖：

1. interim 不污染 final transcript。
2. final 正确累计。
3. 重复 final 不重复文本。
4. speech-final 不立即提交，而是 arm grace。
5. speech-final 后有新 interim 时取消 finalize。
6. utterance-end 有有效文本时 finalize。
7. utterance-end 空文本不 finalize。
8. 中文短 filler 不 finalize。
9. 英文短 filler 不 finalize。
10. manual finalize 可以完成有效文本。
11. 同一 answer generation 最多一次 finalize。

### 16.2 VoiceSession harness

通过 fake WebSocket / fake Tauri invoke-listen seam 验证：

1. start 只创建一个 socket/capture。
2. sample rate 使用 native 返回值。
3. language 使用 interview config。
4. speaking 阶段 chunk 被丢弃。
5. listening 阶段 chunk 被送入 socket。
6. socket replacement 后新 socket 继续接收。
7. stop 清 listener、timer、socket、capture。
8. stop 后 late transcript 被忽略。
9. stop 两次无异常。
10. start 失败会回滚已创建资源。

如果直接 mock Tauri runtime 成本过高，优先把 deterministic 状态和 endpoint 逻辑做成 pure helper；runtime 至少通过静态 wiring 检查 + 手工集成矩阵覆盖，不为了测试而引入大规模依赖注入框架。

### 16.3 Rust tests

`src-tauri/src/speech.rs`：

- 保留 language → voice mapping 测试。
- 为 generation/state helper 增加不依赖真实系统语音的状态测试。
- 真实 `/usr/bin/say`/SAPI completion 放入手工平台验证，不让 CI 依赖音频设备。

### 16.4 现有验证

每个 PR 至少运行：

```bash
npm run verify:mock
npm run verify:copilot
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

涉及 UI/i18n 的 PR 再运行：

```bash
npm run verify:ui-audit
```

### 16.5 手工场景矩阵

必须覆盖：

1. 中文语音面试，正常连续回答。
2. 英文语音面试，确认 STT 使用 English 而非全局中文配置。
3. 回答中自然停顿 0.5–1 秒后继续说，不应过早提交。
4. 明显结束回答后自动提交。
5. 点击“完成回答”与 endpoint 同时发生，只提交一次。
6. AI 朗读时说话，首版不应把 AI/候选人声音写入回答。
7. replay 当前问题后继续回答。
8. Deepgram 临时断线后恢复。
9. 评估 API 失败，保留回答并可重试。
10. 面试中途结束，生成部分报告并保存录音。
11. reset 后麦克风图标/系统录音状态真正停止。
12. 连续开始/结束/再开始，不残留旧 socket/listener。
13. 文本 fallback 完整跑通。
14. macOS TTS completion。
15. Windows TTS completion。

## 17. 回归风险与控制

### 风险 1：TTS await 与 stop 互相阻塞

控制：

- 不在锁内阻塞 wait。
- generation 区分旧/new speech。
- stop 幂等。

### 风险 2：speech-final 与 utterance-end 双提交

控制：

- answer generation。
- finalizing latch。
- question id submission guard。

需要 runtime 和页面两层防护，不能只依赖 React `busy`。

### 风险 3：STT 重复 final 导致回答重复

控制：

- finalParts 去重。
- 不把所有非-interim event 无脑 append。
- endpoint reducer 测试重复事件序列。

### 风险 4：AI TTS 被麦克风识别成候选人

控制：

- V1 明确禁止 barge-in。
- `interviewer-speaking` 时 `acceptingAudio=false`。
- TTS 真正结束后才启用。

### 风险 5：React stale closure 提交旧问题

控制：

- Voice event handler 读取 `sessionRef.current`。
- answer event 带 generation。
- 页面以 current question id 做 single-flight。

### 风险 6：共享 `llm.ts` 改动影响 Copilot

控制：

- 新 STT options 全部 optional。
- 默认 URL 行为保持原样。
- `verify:copilot` 增加 default + reconnect 检查。

### 风险 7：开始失败后麦克风仍占用

控制：

`start()` 采用 rollback 顺序：

```text
listener installed
capture started
Deepgram starting
任何一步失败
  ↓
close socket
unlisten
stop capture
reset state
throw
```

### 风险 8：页面卸载后迟到异步回调 setState

控制：

- VoiceSession runtime generation。
- unsubscribe。
- stop 时 generation 失效。
- 页面 abort AI request。

## 18. 代码删除清单

改造完成后，`MockInterview.tsx` 应删除/不再拥有：

```text
deepgramRef
unlistenRef
isListeningRef
acceptingAudioRef
finalTranscriptRef
startVoice
stopVoice
字符长度 TTS delay
直接 listen('audio-source-chunk')
直接 sendAudioChunk
直接 closeDeepgramStream
```

页面可以继续直接调用 Interview Engine，但音频细节全部进入 VoiceSession。

## 19. 完成定义（Definition of Done）

本功能只有同时满足以下条件才算完成：

- [ ] 默认模拟面试以语音回答启动，文本模式仍可选。
- [ ] 开始后无需点击“提交回答”即可完成整场面试。
- [ ] AI 朗读真实完成后才开始接收候选人回答。
- [ ] speech-final 的短暂停顿不会轻易截断长回答。
- [ ] utterance-end 可以自动结束有效回答。
- [ ] 自动结束与手动“完成回答”不会重复评分。
- [ ] AI speaking/evaluating 时不会把麦克风音频送给本轮 STT。
- [ ] Deepgram reconnect 后仍使用正确 sample rate 和 interview language。
- [ ] 下一题、追问、coverage、评分和最终报告逻辑保持现有行为。
- [ ] 整场录音仍能保存并在 History 中关联。
- [ ] 中途结束、reset、unmount 不残留 TTS/capture/socket/listener/timer。
- [ ] 评估失败不会丢失已经识别的回答。
- [ ] 三种语言的语音状态文案完整。
- [ ] `npm run verify:mock` 通过。
- [ ] `npm run verify:copilot` 通过。
- [ ] `npm run build` 通过。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 通过。

## 20. 推荐执行顺序

严格按以下顺序推进，不要先做 UI：

```text
1. 修 TTS completion contract
2. 给 Deepgram 增加非破坏性 options/reconnect 保留
3. 写并验证 pure endpoint reducer
4. 实现 VoiceSession start/ask/finalize/stop
5. 接入 MockInterview 自动 submit
6. 接自动下一题/追问
7. 删除页面旧 audio runtime
8. 加 Voice UI 状态和真实 amplitude
9. 补错误恢复/i18n
10. 跑完整自动验证 + 平台手工矩阵
```

原因：如果先改 UI，再补 TTS completion 和 endpoint at-most-once，语音状态会被底层竞态反复推翻；先锁定 runtime contract，可以让页面改造保持简单。

## 21. 后续 Phase：自然语音增强（不进入本计划 DoD）

完成上述 MVP 后，再评估：

### Barge-in

```text
AI speaking
  ↓
本地/服务端 VAD 检测候选人真实开口
  ↓
stop_speaking
  ↓
抑制扬声器回声
  ↓
切 listening
```

在没有可靠回声处理前，不建议仅凭麦克风振幅实现 barge-in。

### Streaming TTS

把：

```text
生成完整 question → OS TTS
```

进一步优化为：

```text
LLM 增量文本 → 句子切分 → streaming TTS
```

降低下一题等待感，但该优化不应该改变 Interview Engine 的 planner/policy/coverage 结构。

---

## 结论

这次改造的核心不是“给提交按钮加一个静音计时器”，而是把当前散落在 `MockInterview.tsx` 的音频生命周期抽成一个 **Voice Conversation Runtime**。

最终职责应稳定为：

```text
Interview Engine
负责：问什么、为什么追问、如何评分、什么时候结束

Voice Session
负责：什么时候说、什么时候听、用户何时说完、资源如何安全启动/停止

MockInterview Page
负责：连接两者并展示状态
```

按上述 seam 改造后，首版可以实现可靠的自动语音轮转；后续加入 barge-in、streaming TTS 或更高级 VAD 时，也不需要再次重写面试业务逻辑。
