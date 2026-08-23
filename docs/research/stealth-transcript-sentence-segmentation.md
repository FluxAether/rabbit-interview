# 隐形助手实时转写断句研究

> 日期：2026-08-22  
> 范围：隐形助手（Stealth Copilot）语音转写的**展示断句**与**落库断句**。不改代码。  
> 不覆盖：模拟面试评分、LLM 生成质量、音频采集本身。  
> 核验：官方文档 + 本仓库源码。同类会议产品（Otter / Fireflies）没有公开数值阈值，不当作可复现依据。

## 结论

一句话被拆成两条，不是 STT 把字听错了，是 Copilot 把 Deepgram 的 **停顿信号** 当成了 **成句信号**。

推荐方案：**继续用现有 Deepgram nova-3 / Gemini Live，不换厂商、不另写 VAD、不上 Flux。** 把隐形助手的消息提交改成模拟面试已经在用的「缓冲 + grace + utterance-end」，并让同一句在封口前只占用一条消息。LLM 侧现有的问题合并可以保留，但聊天记录必须跟它用同一条已提交文本。

只改 `endpointing` 数字不够：当前只要 `speech-final` 就会 `createChatMessage` 新 id。

---

## 1. 当前系统实际路径

音频 → `src/lib/llm.ts` STT WebSocket → `CopilotSessionHost.startDeepgram()` → 每条 `speech-final` / `utterance-end` 新建一条 `messages[]` → `CopilotPanel` 按消息画气泡 → 归档写 `snapshot.messages`。

### 1.1 Deepgram（默认）

连接参数在 `openDeepgramSocket()`（`src/lib/llm.ts`）：

| 参数 | 当前值 | 来源 |
|---|---|---|
| `interim_results` | `true` | 固定 |
| `smart_format` / `punctuate` | `true` | 固定 |
| `endpointing` | 默认 `300`；`language=multi` 时 `100` | `sttLanguage === 'multi' ? 100 : 300` |
| `utterance_end_ms` | `1000` | 固定默认 |
| `vad_events` | `true` | 固定 |
| `language` | 设置项，默认 `zh-CN` | `settings.sttLanguage` |
| `model` | 设置项，默认 `nova-3` | `settings.sttModel` |

Deepgram 三个标志不是一回事（官方定义，见 §5）：

| 标志 | 官方含义 | 能不能当「一句话结束」 |
|---|---|---|
| `is_final` | 这一小段音频的识别结果锁死了 | 不能。长句会连续出多段 `is_final` |
| `speech_final` | VAD 听到了设定时长的静音 | 不能。思考停顿、换气、中文分句停顿都会触发 |
| `UtteranceEnd` | 词与词时间戳出现配置时长的空隙 | 更接近「说话人停了」，官方明确：即使后面其实还在继续也会触发 |

当前 Copilot 提交点（`src/lib/copilotSession.ts` `startDeepgram`）：

```ts
if (event.isFinal && event.text) transcript.finalParts.push(event.text)
if (event.boundary !== 'speech-final' && event.boundary !== 'utterance-end') return
const text = joinTranscriptParts(transcript.finalParts) || event.text.trim()
transcript.finalParts = []
this.transition({ type: 'message', message: createChatMessage(
  -(sessionId * 1_000_000 + ++this.messageSequence), ...
)})
```

所以 300ms 静音就会：

1. 清空 buffer
2. 用新 id 插一条 interviewer / me 消息
3. 后半句再来时变成第二条

`upsertMessage()` 只按 `id` 更新（`src/lib/copilotSessionState.ts`）。提交时每次 `++this.messageSequence`，同一句无法长回第一条气泡。面板是 `messages.map` 逐条渲染，历史归档也写 `snapshot.messages`，所以这是**持久化断句**，不是 CSS。

官方对客户端的正确用法是：把每段 `is_final` 拼进 buffer，等到 `speech_final` 再把 buffer 当一段完整 utterance；**不要单独拿 `speech_final` 当全文**。[Understand Endpointing and Interim Results](https://developers.deepgram.com/docs/understand-endpointing-interim-results)

当前代码已经在拼 `finalParts`，但拼完立刻封口并换 id，等于把官方「utterance 完成」误当成「想法完成」。

### 1.2 和模拟面试的差别

`mockInterviewVoiceSession` 已经按 `docs/MOCK_INTERVIEW_VOICE_IMPLEMENTATION_PLAN.md` §8 做对了：

- `speech-final` **不立刻提交**
- 启动 `SPEECH_FINAL_GRACE_MS = 900`
- 期间有新 interim/final 就取消
- 真正结束优先看 `utterance-end`
- 空文本不 finalize
- 同一 answer generation 最多一次 finalize

隐形助手没有这条 grace。LLM 倒是有一层 `interviewerTurnDetector`：`speech-final` 后按文本完整度等 180–700ms 再问模型，遇到「以及 / 然后 / 逗号结尾」会把下一截拼回去。所以用户看到的是两条气泡，模型有时仍答一整句。**展示层和回答层用了两套边界。**

`STEALTH_COPILOT_REFACTOR_PLAN.md` PR4 写过「使用 Deepgram 已有 final/utterance 信号合并问题；不另写 VAD」——合并只进了 LLM 调度，没进消息列表。

### 1.3 Gemini Live

Gemini 不发 `speech-final`。路径：

- setup：`silenceDurationMs: 1500`，`endOfSpeechSensitivity: END_SENSITIVITY_LOW`，`prefixPaddingMs: 20`
- `inputTranscription` 当 `final` 累积
- 每条 final 后重启 `GEMINI_UTTERANCE_END_MS = 1500` 定时器，到期补一条空的 `utterance-end`
- 代码注释：转写与 `turnComplete` 无顺序保证

这条路径相对不容易在句中切开（1.5s 静音才合成边界），但仍是静音启发式。用户默认 `sttProvider: 'deepgram'`，主诉应对齐 Deepgram。Gemini 官方也写了：`silenceDurationMs` 设到 100–200ms「会把一句切成多段小音频碎片」。当前 1500ms 已经在官方建议区间之上。[Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

---

## 2. 同类产品怎么做

行业里不是「找一个更准的句号模型」，而是把「识别结果」和「这句话能不能封口」拆开。封口有四层，越往下越不像被 300ms 换气切开。

### A. 声学静音（VAD / endpointing）

| 产品 | 机制 | 官方默认 / 建议 | 中文 |
|---|---|---|---|
| Deepgram nova-3 | `endpointing` → `speech_final` | 短句 chatbot **10ms**；对话里想法中间会停 → **300–500ms** | nova-3 支持 `zh` / `zh-CN` / `zh-Hans` / `zh-TW` / `zh-Hant` / `zh-HK`。`language=multi` **不含中文** |
| OpenAI Realtime `server_vad` | 按静音切块 | 文档示例 `silence_duration_ms: 500`。「更短则更快出轮次」 | 该页无语言说明 |
| Gemini Live | `silenceDurationMs` + `endOfSpeechSensitivity` | 内部默认约 **800ms**；建议 **500–800ms**；100–200ms 会切碎一句话 | 转写语言从模型响应推断；本仓库显式传 `zh-Hans` / `zh-Hant` |
| Azure Speech | `Speech_SegmentationSilenceTimeoutMs` | 典型默认 **500ms**，范围 100–5000。过低会把一句拆成多条 | 该页无 zh 专用阈值 |
| Google Cloud STT v2 | `SPEECH_ACTIVITY_BEGIN/END` + `voice_activity_timeout` | 超时必须 >500ms 且 <60s；按音频字节计时，不是墙钟 | 该页无中文说明 |
| Web Speech API | `continuous` + `onend` | 浏览器自己的静音切段；`interimResults` 只是草稿 | 实现因浏览器而异 |

快，适合 IVR / 短确认。面试官边想边说时，这就是当前故障模式。

Deepgram 自己也写了：任何「人说完了」的判定都是启发式，「detecting when a speaker has finished speaking or completed their thought is very difficult」。日记类产品要允许长停顿；点餐类可以几个词就处理。[Understanding End of Speech Detection](https://developers.deepgram.com/docs/understanding-end-of-speech-detection)

### B. 词间隙 / utterance-end

- Deepgram `utterance_end_ms`：看词时间戳，不看敲门、电话铃、街噪。官方下限 **1000ms**：「小于 1000ms 没有任何收益」，因为 interim 大约每秒一次。
- 官方组合用法（Endpointing 和 UtteranceEnd 同时开，二者独立）：
  1. 收到 `speech_final=true` 就进入「可能说完」；后面的 UtteranceEnd 可忽略
  2. 只有 UtteranceEnd、前面没有 `speech_final` 时，用最后一次转写继续处理
  3. 完整文本 = 这段里所有 `is_final` 的拼接，不是最后一片 `speech_final`
  4. `last_word_end: -1` 的 UtteranceEnd 丢掉，避免重复
- 官方警告：**UtteranceEnd 会在检测到 gap 时触发，即使后面其实还在继续。** 「This can make it less ideal for voice agent applications where you want to wait for truly complete utterances。」要等真正说完，应在客户端加语义完整性，而不是只信服务端 gap。[Utterance End](https://developers.deepgram.com/docs/utterance-end)

### C. 缓冲 + grace + 未完成则续写

模拟面试已经是这个模型。Azure 文档用序列号举例：用户念 `ABC-123-4567` 中间停顿，若静音阈值太低会被拆成多条，应把 `SegmentationSilenceTimeoutMs` 提到 2000ms。[How to recognize speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-recognize-speech)

会议转写（Otter / Fireflies 一类）按说话人段落长文本，而不是每个停顿一个气泡；官方不公开数值阈值，且允许事后人工合并。会议产品和面试 Copilot 的差别是：会议可以事后改段落，Copilot 的气泡一旦写出就会进历史，也会干扰「这是不是新问题」。

### D. 语义结束（model-based end of turn）

| 产品 | 做法 | 对中文面试 |
|---|---|---|
| OpenAI Realtime `semantic_vad` | 「Chunks the audio when the model believes based on the words said by the user that they have completed their utterance。」概率低就等到超时；「ummm...」多等，肯定句少等。`eagerness=low` 出更大块 | 要换 Realtime 转写栈。该页无中文专项 |
| AssemblyAI Universal Streaming | 「detects the end of a turn using the transcript rather than silence alone。」`end_of_turn_confidence_threshold`（默认 0.4）+ `min_turn_silence`（400ms）语义收口；`max_turn_silence`（1280ms）声学兜底。同一 `turn_order` 的 `Turn` **覆盖不是追加**：「Render the latest transcript; do not append。」沉思/复杂谈话官方 conservative 预设：置信度 0.7、min 800ms、max 3600ms。把置信度设成 0 会「在每个 `min_turn_silence` 停顿处切开，包括句中思考空隙」——官方不建议 | 可做，但是换 STT。该页只称 multilingual，未单列中文 |
| Deepgram Flux | `EagerEndOfTurn` 草稿、`TurnResumed` 取消、`EndOfTurn` 高置信封口。「Avoid committing to a reply until EndOfTurn。」 | **不支持中文。** `flux-general-multi` 只有英西法德印俄葡日意荷。[Models & Languages](https://developers.deepgram.com/docs/models-languages-overview) |
| Azure `Speech_SegmentationStrategy=Semantic` | 主要在句末标点（`.` `?`）处分段，用来解决短暂停顿误切。明确：**只适合连续识别（听写/字幕），不应用于 interactive scenarios**；且「isn't available for all languages and locales」 | 交互式 Copilot 官方排除；中文是否在支持列表未在该页给出 |

语义 EOT 是「不把一句话切成两句」的最强方案，但 Flux 不能用，换 OpenAI / AssemblyAI 超出这次断句问题。Azure 语义切分官方不给交互场景用。

### 官方推荐的 Deepgram 触发规则（nova-3 现状）

同时开 Endpointing 和 UtteranceEnd 时，用 §2.B 的四条。面试场景还要再加一条官方留给客户端的逻辑：文本语义未完成时，不要封口。

---

## 3. 推荐方案

**在现有 nova-3 上做客户端 utterance 状态机，对齐模拟面试，并补上「同一句同一条消息」。**

不换 STT。不引入 Flux。不新写 PCM VAD。不把标点模型做成新服务。不把 Azure 语义切分搬过来（官方排除 interactive）。

### 3.1 一条开放 utterance（必须做）

每个音频源（system / microphone）维持：

- `openMessageId`：当前还没封口的气泡
- `finalParts`：已锁定片段
- `interimTranscript`：预览
- `commitTimer`：`speech-final` grace
- 封口后才清 buffer、清 id

事件规则直接复用 `mockInterviewVoiceEndpoint` + grace，并接上已有的 `interviewerTurnDetector`：

1. `interim`：只更新开放气泡的预览，不新开消息，不落最终文本。已有 grace 时，新 interim 取消 timer。
2. `final` / `is_final`：推进 `finalParts`（用现成 `appendFinalPart` / `joinTranscriptParts`），用同一个 `openMessageId` upsert 气泡。
3. `speech-final`：不封口；若文本已达最小有效长度（复用 `isMinimumVoiceAnswer`），启动 ~900ms grace。期间有新 interim/final 就取消。
4. `utterance-end`：优先封口。空文本不封口。`last_word_end: -1` 这类重复事件在 STT 层丢掉（当前 `llm.ts` 没解析 `last_word_end`，落地时一并处理）。
5. grace 到期或 utterance-end 时，用现成的 `isLikelyIncompleteInterviewPrompt`：逗号 / 「以及、然后、and、because」等视为未完成，**延长等待、继续写同一条**，不要新气泡。
6. 硬上限（建议 2.5–3s，对应已有 `INTERVIEWER_CONTINUATION_WINDOW_MS = 3000`）到期才允许把未完成句封口，避免永远挂着。
7. 下一句若命中 `NEW_QUESTION_START_PATTERN`（「另一个问题 / next question」），即使窗口内也不合并。

LLM 的 `scheduleInterviewerAnswer` 继续用，但入参必须是**封口后的那条文本**，不要在 UI 已经切成两条之后再私下拼接。续说打断回答（`shouldInterruptForInterviewerContinuation`）可以留：那是「气泡已封、人又补了一句」的路径，不是句中切开。

麦克风（`me`）用同一套状态机，避免候选人换气也被切成两条。

### 3.2 参数微调（可和 3.1 一起，不必先做）

中文面试官停顿长于英文短句 chatbot：

- `endpointing`：zh 从 300 提到 **400–500**。Deepgram 给「想法中间会停」的建议就是这个区间。`language=multi` 的 100ms 是给 code-switch 的，而且 nova-3 `multi` **不含中文**，不要拿来当中文面试默认值。
- `utterance_end_ms`：1000 → **1500**。官方最小值就是 1000，面试再短没有意义。
- Gemini `GEMINI_UTTERANCE_END_MS`：已是 1500，可与 Deepgram 对齐，不必单独发明一套。`END_SENSITIVITY_LOW` 已是偏保守收口，保留。

这些只降低误触发，**不能替代 3.1**。只改数字，`speech-final` 仍会新开消息。

对照 AssemblyAI 给「沉思/复杂谈话」的 conservative 预设（min 800 / max 3600）：我们用 900ms grace + 3s 硬上限，落在同一数量级，不必换厂商就能拿到近似行为。

### 3.3 明确不做

- 不上 Deepgram Flux：官方语言表没有中文。
- 不换 AssemblyAI / OpenAI Realtime：能买到语义 EOT，但要重做钥匙、账单、重连、校验，和这次断句无关。
- 不在 Rust 侧做能量 VAD：STT 事件已经够用，模拟面试计划写过「不另造 VAD」。
- 不按 `punctuate` 的句号切气泡：中文实时标点会在停顿处乱打句号，会把错切写死。Azure 自己也把语义切分排除出 interactive。
- 不把 grace / endpointing 做成设置项：模拟面试计划已经否过，内部常量即可。
- 不回填历史会话：只修当前会话的提交边界。
- 不把 LLM 的 180–700ms 延迟当成展示层修复：那只能让模型少答半句，气泡已经裂了。

### 3.4 建议落地顺序

1. Copilot 提交改成「开放 utterance + upsert 同一 id」，`speech-final` 走 grace。麦克风和系统音频同一套。优先复用 `applyVoiceTranscriptEvent`，不要再写一套 buffer。
2. 封口条件接上现有 incomplete / complete prompt 判断；LLM 只消费封口文本。
3. 需要时再把 zh endpointing / utterance_end_ms 调到 400–500 / 1500。
4. 语义 EOT 留给以后：Flux 支持中文，或产品决定换 STT。

---

## 4. 验收

用真实中文面试口吻，而不是朗读稿：

1. 「请介绍一下你上一个项目，\<换气\> 尤其是你负责的模块。」→ 一条 interviewer 消息，不能两条。
2. 「你怎么看，以及」停 0.5–1s 再「这个方案的风险？」→ 一条。
3. 完整问句结束后 1–2s 内仍应封口并触发回答；不能为了不断句把首字建议拖到不可用。
4. 「另一个问题：…」即使紧挨着上一句，也要新气泡、新回答。
5. 候选人麦克风同样：一句答完中间换气，不能切成两条 me。
6. 归档后的历史与当场气泡一致。
7. `scripts/verify-copilot.mjs` 现有 speech-final / utterance-end 断言要改成：speech-final 不单独成消息；utterance-end 或 grace 到期才成消息；同一 utterance 重复 final 只 upsert。现有「speech-final 和 utterance-end 保持可区分」的断言仍然有效，但**可区分 ≠ 两者都立刻建消息**。

---

## 5. 来源

### 本仓库

- `src/lib/llm.ts`：`openDeepgramSocket`、`GEMINI_UTTERANCE_END_MS`、`attachGeminiHandlers`
- `src/lib/copilotSession.ts`：`startDeepgram` 提交点、`scheduleInterviewerAnswer`
- `src/lib/copilotSessionState.ts`：`upsertMessage` 按 id
- `src/lib/interviewerTurnDetector.ts`：incomplete / continuation / new-question
- `src/lib/mockInterviewVoiceEndpoint.ts`：`SPEECH_FINAL_GRACE_MS = 900`
- `src/lib/mockInterviewVoiceSession.ts`：grace + utterance-end finalize
- `docs/MOCK_INTERVIEW_VOICE_IMPLEMENTATION_PLAN.md` §8
- `docs/STEALTH_COPILOT_REFACTOR_PLAN.md` PR4

### 官方文档

- Deepgram [Understand Endpointing and Interim Results](https://developers.deepgram.com/docs/understand-endpointing-interim-results)：`is_final` vs `speech_final`；「Do not use `speech_final: true` alone to capture full transcripts」；对话建议 endpointing 300–500ms
- Deepgram [Understanding End of Speech Detection](https://developers.deepgram.com/docs/understanding-end-of-speech-detection)：Endpointing 与 UtteranceEnd 独立；组合触发规则；「any approach … is a heuristic one」
- Deepgram [Utterance End](https://developers.deepgram.com/docs/utterance-end)：最小值 1000ms；「fires based on detecting a gap even if it determines that speech is continuing」；不适合要等完整想法的 voice agent
- Deepgram [Flux Eager EOT](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot)：草稿 / 取消 / 高置信封口
- Deepgram [Models & Languages](https://developers.deepgram.com/docs/models-languages-overview)：Flux 无中文；nova-3 `multi` 无中文；nova-3 有 `zh` / `zh-CN` / `zh-TW` / `zh-HK`
- OpenAI [Realtime VAD](https://developers.openai.com/api/docs/guides/realtime-vad)：`server_vad` vs `semantic_vad`；`eagerness`
- AssemblyAI [Optimizing accuracy and latency](https://www.assemblyai.com/docs/streaming/getting-started/optimizing-accuracy-and-latency)：transcript 驱动 EOT；conservative 预设
- AssemblyAI [Message sequence](https://www.assemblyai.com/docs/streaming/message-sequence)：同一 `turn_order` 覆盖不追加
- Gemini [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)：`silenceDurationMs` 100–200ms 会切碎一句话；建议 500–800ms
- Azure [How to recognize speech](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-recognize-speech)：静音超时过低会拆句；语义切分不用于 interactive
- Google Cloud [Voice activity events](https://docs.cloud.google.com/speech-to-text/docs/voice-activity-events)：`SPEECH_ACTIVITY_END` 是 VAD 事件，不是语义成句
