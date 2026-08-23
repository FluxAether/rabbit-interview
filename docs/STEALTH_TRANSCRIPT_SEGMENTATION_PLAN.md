# 隐形助手转写断句实施计划

> 依据：[隐形助手实时转写断句研究](research/stealth-transcript-sentence-segmentation.md)
> 目标：面试官或候选人说一句、中间换气时，聊天记录只出现一条消息；完整问句仍能在 1–2s 内封口并触发回答。
> 原则：**不换 STT，不另写 VAD，复用模拟面试已有的 utterance 聚合。** 展示层和 LLM 调度必须用同一条封口文本。

## 1. 当前实现基线

隐形助手已经具备：

- `src/lib/llm.ts`：Deepgram / Gemini 共用 STT 门面，事件边界为 `interim | final | speech-final | utterance-end`。
- `src/lib/copilotSession.ts`：单一会话 host，系统音频和麦克风各一条 STT 流。
- `src/lib/interviewerTurnDetector.ts`：按文本完整度延迟问模型，并把「以及 / 然后」类续说拼回同一问题。
- `src/lib/mockInterviewVoiceEndpoint.ts`：`applyVoiceTranscriptEvent`、`joinTranscriptParts`、`isMinimumVoiceAnswer`、`SPEECH_FINAL_GRACE_MS = 900`。
- `src/lib/mockInterviewVoiceSession.ts`：`speech-final` 走 grace，`utterance-end` 才 finalize。
- `src/lib/copilotSessionState.ts`：`upsertMessage()` 按 `id` 更新。
- `scripts/verify-copilot.mjs`：Gemini 多段 `final` 合成一条消息；Deepgram 仍断言 `speech-final` 与 `utterance-end` 可区分。

当前真实交互仍然是：

```text
STT event
  ↓
is_final → 推进 finalParts
  ↓
speech-final 或 utterance-end
  ↓
joinTranscriptParts + 清空 buffer
  ↓
+ +messageSequence → 新气泡
  ↓
系统音频再走 scheduleInterviewerAnswer（另一套 180–700ms 合并）
```

故障点只有提交边界：`startDeepgram()` 把 `speech-final` 当成成句。Deepgram 默认 `endpointing=300`，换气就会新开消息。LLM 有时仍答一整句，聊天记录已经裂了。归档写 `snapshot.messages`，所以这是持久化断句。

目标交互：

```text
STT event
  ↓
开放 utterance（同一 openMessageId upsert）
  ↓
speech-final → 900ms grace（有新词就取消）
  ↓
utterance-end 或 grace 到期
  ↓
未完成则继续同一条；硬上限 3s 才封口
  ↓
封口文本写入 messages[]，系统音频才问 LLM
```

## 2. 范围与非目标

### 2.1 本轮必须完成

1. 系统音频（interviewer）和麦克风（me）使用同一套开放 utterance 状态机。
2. `speech-final` 不再立刻 `createChatMessage` 新 id。
3. 同一句在封口前只占用一条消息；`final` / interim 预览 upsert 同一 id。
4. 封口优先 `utterance-end`；`speech-final` 必须经过 grace。
5. 未完成问句（逗号、「以及 / 然后 / and / because」）延长同一条，不新开气泡。
6. 「另一个问题 / next question」即使紧挨上一句也新开气泡、新开回答。
7. LLM 只消费封口后的那条文本；取消「UI 两条、模型私下拼接」的双边界。
8. `last_word_end: -1` 的 Deepgram `UtteranceEnd` 在 STT 层丢掉。
9. 现有 Gemini 多段 `final` 合成一条的行为保持。
10. 归档后的历史与当场气泡一致。

### 2.2 明确保留

- 现有 STT 厂商与模型：Deepgram nova-3 / Gemini Live。
- 单一 Copilot session host、主页面 / 浮窗命令快照模型。
- echo 过滤（`isLikelyEcho`）、短确认不丢（<12 字）。
- `shouldInterruptForInterviewerContinuation`：气泡已封、人又补了一句时打断重答。
- 模拟面试 VoiceSession 的 finalize 语义；本轮不改评分、不改「一轮回答结束」。
- `CopilotPanel` 逐条渲染；不断句靠数据，不靠 CSS 合并。

### 2.3 首版不做

- 不上 Deepgram Flux（无中文）。
- 不换 AssemblyAI / OpenAI Realtime。
- 不在 Rust 侧做能量 VAD。
- 不按 `punctuate` 句号切气泡。
- 不把 grace / endpointing 做成设置项。
- 不回填历史会话。
- 不改模拟面试页面交互。
- 不把 LLM 的 180–700ms 延迟当成展示层修复。

## 3. 设计原则

1. **识别结果 ≠ 成句。** `is_final` 只锁片段；`speech_final` 只表示停顿；封口是客户端状态。
2. **一条开放 utterance。** 未封口时只有一个 `openMessageId`；封口后才允许下一个 id。
3. **复用，不重写 buffer。** Copilot 改用 `applyVoiceTranscriptEvent` / `joinTranscriptParts` / `isMinimumVoiceAnswer`，不要在 `copilotSession.ts` 再写一套 `finalParts`。
4. **展示和 LLM 同一封口点。** `scheduleInterviewerAnswer` 只在封口时调用，入参就是那条消息文本。
5. **麦克风和系统音频同一套规则。** 候选人换气也不能切成两条 `me`。
6. **Deepgram 参数可调，但不能替代状态机。** 只改 `endpointing` 数字，`speech-final` 仍会建消息。

## 4. 目标模块结构

```text
llm.ts
  Deepgram / Gemini events
  drop UtteranceEnd when last_word_end === -1
        │
        ▼
copilotSession.ts  (per audio source)
  VoiceEndpointState          复用 mockInterviewVoiceEndpoint
  openMessageId
  openedAt
  commitTimer                 speech-final grace
  hardCapTimer                未完成句 3s 上限
        │
        ├─ upsert message     开放期间
        └─ seal message       utterance-end / grace / hard cap
                │
                ▼
        scheduleInterviewerAnswer(sealedText)   仅 system
        snapshot.messages → 归档
```

不新增页面、不新增设置、不新增 Rust 命令。

## 5. 开放 utterance 状态

每个音频源（`system` | `microphone`）替换现有 `TranscriptState`：

```ts
interface CopilotUtteranceState {
  endpoint: VoiceEndpointState
  openMessageId: number | null
  openedAt: number | null
  lastSealedText: string
  lastSealedAt: number
  commitTimer: ReturnType<typeof setTimeout> | null
  hardCapTimer: ReturnType<typeof setTimeout> | null
}
```

常量（内部，不进设置页）：

```ts
SPEECH_FINAL_GRACE_MS = 900                 // 已有，直接 import
UTTERANCE_HARD_CAP_MS = 3_000               // = INTERVIEWER_CONTINUATION_WINDOW_MS
INCOMPLETE_EXTEND_MS = 700                  // = INTERVIEWER_COMMIT_DELAY_MS.incompletePrompt
SEAL_DEDUP_MS = 2_000                       // 现有 lastFinal 去重窗口
```

会话 start / stop / 换采样率重建 socket 时，两个 source 都 reset：清 timer、清 `openMessageId`、`createVoiceEndpointState()`。

## 6. 事件规则

入口仍是 `startDeepgram()` 的 `onTranscript`。先 `applyVoiceTranscriptEvent`，再按下面决策。`isCurrent(sessionId)` 失败的事件全部丢弃。

### 6.1 interim

- 只更新开放气泡预览。没有 `openMessageId` 时分配一个，`transition({ type: 'message' })` upsert。
- 不把 interim 写入最终 `finalParts`（已由 `applyVoiceTranscriptEvent` 保证）。
- 若已有 grace / 未完成延长 timer，有效 interim 取消这些 timer，保留 hard cap。
- 预览文本：`joinTranscriptParts([...finalParts, interim])`。中文片段之间不要插空格（现成 `joinTranscriptParts`）。

### 6.2 final / is_final

- 推进 `endpoint.finalParts`。
- upsert 同一 `openMessageId`，文本为 `transcriptFromEndpointState(endpoint)`。
- 有效 final 同样取消 grace / 未完成延长，保留 hard cap。
- 去重继续用 `appendFinalPart`，不要只比 last element 相等。

### 6.3 speech-final

- **禁止**清空 buffer、**禁止** `++messageSequence`、**禁止**问 LLM。
- 若当前文本满足 `isMinimumVoiceAnswer`，启动 900ms grace。
- grace 回调里调用 `trySeal(source, 'speech-final')`。
- 若文本未达最小有效长度，只 upsert，不开 grace。

### 6.4 utterance-end

- 优先于 grace：立刻 `trySeal(source, 'utterance-end')`。
- 空文本不封口、不建空气泡。现有「空 utterance-end 仍 `scheduleInterviewerAnswer('', ...)`」删除；没有开放文本时这是 no-op。
- Deepgram 若带 `last_word_end: -1`，`llm.ts` 不向 Copilot 发这个事件。

### 6.5 trySeal

```text
text = transcriptFromEndpointState(endpoint)
若空或不满足 isMinimumVoiceAnswer → return
若 text === lastSealedText 且 2s 内 → return（去重）
若 source === system 且 isLikelyEcho(text) → 丢弃本 utterance，reset，不建消息

若 isLikelyIncompleteInterviewPrompt(text)
   且 now - openedAt < 3000
   且 不是 NEW_QUESTION_START_PATTERN
   → 再等 700ms（可被新词取消）；到期或碰到 hard cap 才真正封口
否则真正封口
```

真正封口：

1. 取消该 source 全部 timer。
2. 用最终文本 upsert 现有 `openMessageId`（若还没有 id 则此刻分配）。
3. `openMessageId = null`，`endpoint = createVoiceEndpointState()`，记下 `lastSealedText/At`。
4. microphone：更新 `recentMicrophoneText/At`。
5. system：`scheduleInterviewerAnswer(sessionId, sealedText, boundary)`。
   - `utterance-end` 延迟仍为 0。
   - 此时文本已是完整句，`getInterviewerCommitDelay` 走 complete/long/short 即可；不再靠它修补裂开的气泡。

### 6.6 新问题 vs 续说

封口之后才谈「下一句」：

- 下一句命中 `NEW_QUESTION_START_PATTERN` → 新 `openMessageId`，新回答。不要并进上一条。
- 下一句命中 `CONTINUATION_START_PATTERN` 或上一句未完成，且距上一封口 < 3s → 这是已有 `shouldInterruptForInterviewerContinuation` 路径：打断进行中的 LLM，把两段问句拼成一次新回答。聊天上表现为**第二条 interviewer 消息**（因为上一句已经封口）。不要为了「看起来像一句」把已封口消息改写掉——用户已经看到上一条。
- 开放期间的续说（grace 未到、hard cap 未到）一律写回同一 `openMessageId`，这才是本次要修的「一句变两句」。

### 6.7 hard cap

开放 utterance 在第一条有效 final/interim 时启动 3s hard cap。到期强制 `trySeal(..., 'speech-final')`，即使文本仍像未完成。避免永远挂着导致不回答。

stop / fail / 换 socket 时清 hard cap；未封口文本：

- `stop`：若已有最小有效文本，立刻封口再归档，保证历史完整。
- 未达最小有效长度：丢弃，不写空气泡。

## 7. LLM 调度收口

当前 `scheduleInterviewerAnswer` 会把多次 `speech-final` 片段 `join(' ')` 后再问模型。状态机上线后：

- 每次调用的 `text` 已经是一条封口 utterance。
- 保留函数，因为续说打断（§6.6 第二条）仍需要 pending 合并。
- 删除「空 utterance-end 也 schedule」分支。
- 不要在封口前用 `pendingInterviewerQuestion` 当展示文本；`snapshot.question` 继续在 `flushPendingInterviewerAnswer` 时更新，来源改为封口文本。

麦克风不触发 LLM，只落 `me` 消息。行为与现在一致。

## 8. STT 层小改动

`src/lib/llm.ts` `attachDeepgramHandlers`：

```ts
if (data.type === 'UtteranceEnd' && data.last_word_end === -1) return
```

其它 Deepgram / Gemini 事件形状不变。`TranscriptBoundary` 四值保持，验证脚本里「可区分 ≠ 两者都立刻建消息」。

可选、与状态机同一 PR 或紧随其后：

| 参数 | 现在 | 改为 | 原因 |
|---|---|---|---|
| zh / zh-CN / zh-TW 的 `endpointing` | 300 | 500 | Deepgram 给「想法中间会停」的区间是 300–500 |
| `utterance_end_ms` | 1000 | 1500 | 官方最小值 1000，面试再短无收益 |
| `language=multi` 的 endpointing | 100 | 保持 100 | code-switch 官方值；nova-3 multi 不含中文，不是中文面试默认 |
| Gemini `GEMINI_UTTERANCE_END_MS` | 1500 | 不动 | 已对齐 |
| `END_SENSITIVITY_LOW` | 已设 | 不动 | 偏保守收口 |

只改这一表、不做 §6，**不能**关单。Copilot 必须通过 per-session `DeepgramStreamOptions` 覆盖默认值，避免误改模拟面试共享默认（模拟面试计划 §10.3：不修改共享 STT 默认值）。推荐：Copilot `startDeepgramStream(..., { endpointingMs, utteranceEndMs })` 显式传入；`openDeepgramSocket` 的全局默认保持 300 / 1000，让 mock interview 自己的 options 继续覆盖。

## 9. UI

不改 `CopilotPanel` 布局。开放 utterance 期间同一气泡文本变长，用户会看到句子在原地长，而不是连续冒出两条。interim 预览与 final 共用一个气泡即可，不必加「正在听…」新状态。

浮窗和主页面吃同一 snapshot，无需双改。

## 10. 数据与兼容

- `CopilotMessage` 字段不变：`id/role/source/text/createdAt`。
- 开放期间多次 upsert 同一 id：`createdAt` 保持首次时间，只改 `text`。
- 历史表、评分（`scoreCopilotSession`）、导出不改 schema。
- 旧归档里已经裂开的消息不迁移。

## 11. 分阶段实施

### PR 1：STT 去重 + Copilot 开放 utterance（必须先合）

改动：

1. `src/lib/llm.ts`：忽略 `last_word_end === -1` 的 `UtteranceEnd`。
2. `src/lib/copilotSession.ts`：
   - 删除自管 `TranscriptState.finalParts` 推进。
   - 每 source 持有 `CopilotUtteranceState`。
   - `onTranscript` 改走 §6。
   - `stop` / `fail` / 重建 socket 时封口或丢弃（§6.7）。
3. 从 `mockInterviewVoiceEndpoint.ts` import `applyVoiceTranscriptEvent`、`createVoiceEndpointState`、`transcriptFromEndpointState`、`isMinimumVoiceAnswer`、`SPEECH_FINAL_GRACE_MS`。
4. 从 `interviewerTurnDetector.ts` 使用 `isLikelyIncompleteInterviewPrompt` 和 `NEW_QUESTION_START_PATTERN`（若 pattern 未 export，就地 export，不要复制一份正则）。

验收：

- `speech-final` 后 900ms 内再来 final/interim → 仍然一条消息。
- `utterance-end` 有有效文本 → 封口一条。
- 空 `utterance-end` → 无新消息。
- Gemini 现有「多 final + 1.5s 静音 = 一条」用例继续绿。
- 模拟面试 `verify-mock-interview.mjs` 仍绿（共享 endpoint helper 行为不变）。

### PR 2：未完成延长 + LLM 只吃封口文本

改动：

1. `trySeal` 接上 incomplete / hard cap / new-question（§6.5–6.7）。
2. `scheduleInterviewerAnswer` 只从 seal 调用；删除空 utterance-end 调度。
3. 续说打断路径保持，但拼接来源改为「已封口上一条 + 新封口这一条」，不再收集未封口碎片。

验收：

- 「你怎么看，以及」+ 0.8s + 「这个方案的风险？」→ 一条 interviewer，一次 LLM。
- 「请介绍一下你上一个项目。」完整句 → 约 1s 内封口并开始生成。
- 「另一个问题：为什么离职？」→ 新气泡、新回答，不打断成续说。
- 已有 `getInterviewerCommitDelay` / `shouldInterruptForInterviewerContinuation` 单测仍成立；补「seal 后才 schedule」的 host 级断言。

### PR 3：中文 endpoint 参数（可选，可与 PR 2 同 PR）

改动：

1. Copilot `startDeepgramStream` 对非 `multi` 语言传 `endpointingMs: 500`、`utteranceEndMs: 1500`。
2. 全局 `openDeepgramSocket` 默认值不动，避免模拟面试回归。
3. `verify-copilot.mjs` 里「fixed-language STT uses stable endpoint detection」从断言 URL `endpointing=300` 改为断言 Copilot 显式 options 后的 500 / 1500；保留「per-session options override」那条。

验收：

- 无 options 的共享默认仍 300 / 1000（mock 路径）。
- Copilot 启动的 socket URL 含 `endpointing=500&utterance_end_ms=1500`。
- `language=multi` 仍 100。

## 12. 测试与验证

### 12.1 纯函数

已有 `verify-mock-interview.mjs` 覆盖 `applyVoiceTranscriptEvent`，不要分叉。Copilot 新增 host 级用例，用现成 `loadTypeScriptModule(CopilotSessionHost)` harness（`scripts/verify-copilot.mjs` 已有 Gemini 段）：

1. `final` + `speech-final` + 100ms + `final` + `utterance-end` → 1 条消息，文本拼接。
2. `speech-final` 后 900ms 无新词 → 1 条消息（grace 到期封口）。
3. `speech-final` 后 200ms 新 interim → grace 取消，暂不封口。
4. 空 `utterance-end` → 0 条。
5. 未完成「你负责什么，以及」+ 800ms + 续句 → 1 条。
6. 未完成句撑满 3s hard cap → 1 条（强制封口）。
7. 封口后再来「下一个问题，…」→ 第 2 条。
8. 麦克风 source 走 1 和 2，role 为 `me`。
9. echo 命中 → 不建 interviewer 消息。
10. 重复相同文本 2s 内 → 仍 1 条。
11. `UtteranceEnd last_word_end: -1` → 不进 onTranscript。

改现有源码断言：

```js
// 旧：Copilot accumulates Gemini ... until utterance boundary
// 仍有效，但不要再暗示 speech-final 立刻建消息
session.includes('applyVoiceTranscriptEvent')
session.includes('openMessageId')
```

`event.boundary !== 'speech-final' && event.boundary !== 'utterance-end'` 这条字符串断言在 PR 1 后会失败，删掉或改成断言 `trySeal` / grace。

### 12.2 现有验证

```bash
npm run verify:copilot
node scripts/verify-mock-interview.mjs
```

Gemini 乱序 `turnComplete` 合成一条的用例必须继续绿。

### 12.3 手工矩阵（Deepgram nova-3 + zh-CN）

| 场景 | 期望 |
|---|---|
| 「请介绍一下你上一个项目，」换气「尤其是你负责的模块。」 | 1 条 interviewer，1 次回答 |
| 「你怎么看，以及」停 0.5–1s「这个方案的风险？」 | 1 条 |
| 完整问句后安静 | 1–2s 内封口并出首字建议 |
| 「另一个问题：为什么离开上一家？」紧挨上一句 | 新气泡、新回答 |
| 候选人一句中间换气 | 1 条 me |
| 系统音频回放 AI 回答 | 不出现 interviewer 回声气泡 |
| 停会话时半句仍在 grace 内 | 有有效文本则进历史一条；太短则丢弃 |
| 浮窗与主页面 | 同一条消息，不双份 |

不把源码检查或 `verify:copilot` 绿当成真机完成。

## 13. 风险与控制

| 风险 | 控制 |
|---|---|
| grace 把完整问句拖慢 | 完整句（句号/问号或 complete prompt）grace 仍 900ms，加上 utterance-end 通常更快；完整句不要走 700ms incomplete 延长 |
| 未完成判断误伤短句「好的。」 | `isMinimumVoiceAnswer` + 句末 `。.!！?` 视为 complete；「好的」这类短确认现有 <12 字 echo 规则不丢，但可以封口 |
| speech-final 与 utterance-end 双封口 | `trySeal` 以 `openMessageId == null` / lastSealed 去重；at-most-once |
| 共享 `applyVoiceTranscriptEvent` 改坏模拟面试 | 本轮不改该 helper 语义；只增 Copilot 调用。改之前先跑 mock verify |
| Copilot 显式 endpointing 影响 mock | 只经 `startDeepgramStream` options 传入；全局默认不动 |
| 开放气泡 upsert 导致滚动跳动 | 同一 id 更新，面板已按 id 渲染；保持 `createdAt` 稳定 |
| stop 时未封口丢失 | stop 前对有最小文本的开放 utterance 强制封口 |
| 中文标点被 STT 打成句号导致过早 complete | 不以标点为唯一 complete 条件；incomplete ending 优先于句号。`是吗，以及` 仍未完成 |

## 14. 代码删除 / 替换清单

PR 1 完成后，`copilotSession.ts` 不应再出现：

- 本地 `TranscriptState { finalParts, lastFinal, lastFinalAt }` 的 `finalParts.push`
- `if (event.boundary !== 'speech-final' && event.boundary !== 'utterance-end') return` 后立刻 `createChatMessage` + 清空 `finalParts`
- 空 utterance-end 调用 `scheduleInterviewerAnswer(sessionId, '', ...)`

保留：

- `createChatMessage`
- `upsertMessage`（靠同一 id 长回气泡）
- `scheduleInterviewerAnswer` / continuation interrupt
- `isLikelyEcho`

## 15. 完成定义

1. 中文面试口吻下，一句中换气不再裂成两条 interviewer / me。
2. 完整问句 1–2s 内封口并开始生成；首字建议不因防裂句而明显变慢。
3. 明确「下一个问题」仍新开一轮。
4. 当场气泡与归档一致。
5. `npm run verify:copilot` 与 `node scripts/verify-mock-interview.mjs` 通过。
6. 真机 Deepgram zh-CN 手工矩阵跑完，而不是只靠源码断言。

## 16. 推荐执行顺序

1. PR 1 状态机（关单的最小改动）。
2. PR 2 未完成延长 + LLM 封口对齐。
3. PR 3 参数（500 / 1500），可并进 PR 2。
4. 真机矩阵；若仍切句，先加 incomplete 词表，再考虑把 grace 从 900 调到 1100。不要先换 STT。

后续不进本计划 DoD：Flux 中文、语义 EOT、设置页旋钮。
