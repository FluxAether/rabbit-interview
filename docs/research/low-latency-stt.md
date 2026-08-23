# 低延迟 STT：模型、架构与业界主流方案

> 日期：2026-08-23  
> 范围：实时语音转写的**延迟架构**与**可选模型**。不改代码。  
> 不覆盖：断句/气泡提交（见 `stealth-transcript-sentence-segmentation.md`）、LLM 生成质量、音频采集本身。  
> 核验：官方文档 + 第三方同台基准 + 本仓库源码。厂商营销数字不当作 SLA。

## 结论

延迟最小的**不是换一个更贵的云模型**，而是换一种架构。

| 你要优化的是什么 | 最低延迟方案 | 数量级 |
|---|---|---|
| 模型把字吐出来（inference / transcript latency） | 本地流式 ASR：NVIDIA Parakeet / Nemotron（英）、FunASR Paraformer-zh-streaming（中） | 本地推理约 10–20ms；chunk 80–160ms |
| 云端字幕跟上说话（partial / TTFS） | Deepgram Nova-3、NVIDIA Nemotron、Soniox、AssemblyAI Universal Streaming | 独立同台 TTFS 中位约 220–280ms |
| 用户停嘴到系统确认「这句话完了」（EOT / TTCT） | 语义轮次检测：Deepgram Flux、AssemblyAI U3.5 Pro、OpenAI `semantic_vad` | Flux 默认 EOT p50 ~260ms；静音 VAD 通常 300–1500ms |
| 本产品（中英面试 Copilot） | **继续 Deepgram nova-3**，不换 Flux | 瓶颈是 endpointing 500ms + utterance-end 1500ms，不是 Nova-3 的 150–300ms 推理 |

业界 2026 年语音 Agent 的主流栈是：**流式 ASR（RNN-T / CTC / transducer，边说边出 interim）+ 模型内置语义 End-of-Turn**，而不是 Whisper 文件 API，也不是单纯把 `endpointing` 调小。

对本仓库：默认已经是这条云端路径里延迟最好、且支持 `zh-CN` 的那一档（`sttProvider: deepgram`，`sttModel: nova-3`）。Flux / Cartesia Ink-2 更快的是 **EOT**，但 Flux 官方语言表没有中文。换模型解决不了用户感知延迟——感知延迟被封口静音窗口吃掉了。

---

## 1. 先分清三种「延迟」

混在一起比，数字没有意义。Deepgram 官方把流式延迟拆成两类；AssemblyAI 再拆成 emission 与 TTCT。[Measuring STT Latency](https://developers.deepgram.com/docs/measuring-streaming-latency) · [AssemblyAI Streaming Benchmarks](https://www.assemblyai.com/docs/streaming/benchmarks)

| 指标 | 测什么 | 谁在乎 | 谁决定上限 |
|---|---|---|---|
| Transcript / emission latency | 一个字说完到 API 吐出这个字 | 字幕、面试官气泡预览 | 模型 + 网络。Nova-3 官方 150–300ms 服务端、200–500ms 客户端 |
| TTFS（Time To Final Segment） | 一段话说完到收到**最终**片段 | Pipecat 同台基准用这个 | 模型 + 厂商默认 VAD |
| EOT / TTCT | 说话人停嘴到系统判定「轮次结束」 | 语音 Agent、Copilot 触发 LLM | **静音阈值或语义 EOT**，通常比模型推理大一个数量级 |

Whisper 文件 API、Gemini / GPT 的「录音完再转」不是低延迟 STT。OpenAI 自己也把 Realtime 转写和 Whisper 批处理分开；Pipecat 上 `gpt-realtime-whisper` TTFS 中位 740ms，`gpt-4o-transcribe` 637ms，比 Nova-3 的 247ms 慢一倍以上。[Pipecat stt-benchmark](https://github.com/pipecat-ai/stt-benchmark)

Gemini Live 在本仓库里是当 STT 用的（`inputTranscription` + 客户端 1500ms 合成 `utterance-end`），不是专用 ASR。Google 官方写：`silenceDurationMs` 100–200ms「会把一句切成多段」；建议 500–800ms；内部默认约 800ms。[Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

---

## 2. 延迟最小的架构（按物理下限）

流式识别的下限 ≈ **chunk 时长 + 推理 + 网络 RTT**。做不到「chunk 还没到就出字」。

### 2.1 本地流式 ASR：推理下限

NVIDIA Nemotron ASR Streaming（cache-aware FastConformer-RNNT）官方可选 chunk：

```
supported_streaming_latencies_ms = {13: 1120, 6: 560, 1: 160, 0: 80}
```

80ms lookahead 是公开文档里能点名的最低流式配置。[Hugging Face `nemotron-speech-streaming-en-0.6b`](https://huggingface.co/docs/transformers/main/model_doc/nemotron_asr_streaming) · [NVIDIA Speech NIM](https://docs.nvidia.com/nim/speech/latest/asr/)

Riva / Parakeet CTC 低延迟档 `chunk_size=0.16`（160ms）。NVIDIA ASR NIM 在单流、160ms chunk 下给出过约 12ms 平均 / ~10ms p50 的**服务端推理**数字——这是 GPU 算完这一块的时间，不含采集、不含「人停了没」。Mandarin 走 Parakeet CTC 中文变体，不是 Nemotron 英文专用档。

中文本地流式的工业默认是 FunASR `paraformer-zh-streaming`：

- `chunk_size = [0, 10, 5]` → 显示粒度 10×60ms = **600ms**，lookahead 5×60ms = **300ms**，合计约 900ms 才出一块稳定字
- `[0, 8, 4]` → 480ms + 240ms

官方注释原文：「实时显示粒度 `10*60=600ms`，lookahead `5*60=300ms`」。[FunASR tutorial](https://github.com/modelscope/FunASR/blob/main/docs/tutorial/README.md) · [paraformer-zh-streaming](https://huggingface.co/funasr/paraformer-zh-streaming)

SenseVoice / Fun-ASR-Nano 是**离线**快（10 秒音频约 70ms 量级），不是边说边出。不要拿离线 RTF 当流式延迟。

**这一档最快，但要本机 GPU、要自己做 VAD / 断句 / 重连 / 中英切换。** 本仓库是 Tauri 桌面应用，技术上能跑，产品上等于新造一套 STT 栈。

### 2.2 云端流式 ASR：字幕延迟下限

独立同台（Pipecat，1000 条 `smart-turn-data-v3.1`，TTFS = 说到完 → 收到 final segment）：

| Vendor | Model | TTFS 中位 | TTFS p95 | WER mean |
|---|---|---|---|---|
| NVIDIA | Nemotron 3.0 ASR (en) | **221ms** | 238ms | 1.90% |
| Deepgram | nova-3-general | **247ms** | 298ms | 1.71% |
| Soniox | stt-rt-v4 | 249ms | 281ms | 1.25% |
| AssemblyAI | universal-streaming-english | 256ms | 362ms | 3.49% |
| Soniox | stt-rt-v5 | 260ms | 305ms | 1.34% |
| ElevenLabs | scribe_v2_realtime | 281ms | 348ms | 3.16% |
| AssemblyAI | universal-3-5-pro | 282ms | 354ms | 1.44% |
| Cartesia | ink-2 | 299ms | 328ms | 1.47% |
| Speechmatics | — | 495ms | 676ms | 1.40% |
| OpenAI | gpt-4o-transcribe | 637ms | 965ms | 3.24% |
| OpenAI | gpt-realtime-whisper | 740ms | 878ms | 2.92% |
| Google | latest-long | 878ms | 1155ms | 2.84% |
| Azure | — | 1016ms | 1345ms | 1.21% |
| AWS | — | 1136ms | 1527ms | 1.68% |

来源：[pipecat-ai/stt-benchmark README](https://github.com/pipecat-ai/stt-benchmark)（数据集是英文对话，**不能外推中文 WER**）。

Deepgram 自己测 Nova-3：服务端转录 150–300ms，客户端含网络 200–500ms。Flux 另报 EOT p50 ~260ms（这是停嘴到 `EndOfTurn`，不是出字速度）。[Measuring STT Latency](https://developers.deepgram.com/docs/measuring-streaming-latency) · [Flux Nova-3 migration](https://developers.deepgram.com/docs/flux/nova-3-migration)

AssemblyAI 官方（英文）：Universal Streaming emission p50 **317ms** / p90 597ms；TTCT p50 **649ms**。U3.5 Pro Streaming TTCT p50 **568ms**（它出的是 segment partial，官方说标准 emission 指标不适用）。[Streaming Benchmarks](https://www.assemblyai.com/docs/streaming/benchmarks)

云端这一档的物理下限大概就是 **200ms 出字**。再往下挤，要么上本地 GPU，要么厂商在赌 VAD（误切上升）。

### 2.3 语义 EOT：Agent 延迟下限

2025–2026 语音 Agent 把「听写」和「这句话能不能交给 LLM」拆开。主流四家：

| 产品 | 机制 | 官方延迟 | 中文 |
|---|---|---|---|
| Deepgram **Flux** | 模型内置 `StartOfTurn` / `EagerEndOfTurn` / `TurnResumed` / `EndOfTurn` | EOT p50 ~260ms；Eager 再提前约 150–250ms，LLM 调用 +50–70% | `flux-general-en` 仅英；`flux-general-multi` = 英西法德印俄葡日意荷。**无中文**。[Models & Languages](https://developers.deepgram.com/docs/models-languages-overview) |
| AssemblyAI **Universal-3.5 Pro** | transcript 驱动 EOT：`end_of_turn_confidence_threshold` + `min_turn_silence` / `max_turn_silence` | TTCT p50 568ms；沉思场景官方 conservative 预设 0.7 / 800 / 3600 | U3.5 Pro 语言表含 **ZH**。[Universal Streaming](https://www.assemblyai.com/docs/speech-to-text/universal-streaming) |
| OpenAI Realtime `semantic_vad` | 按「话是否说完」的模型判断切块；`eagerness=low` 出更大块 | 无固定 ms；Pipecat 上对应转写 637–740ms | 该页无中文专项 |
| Cartesia **Ink-2** | 语义 endpoint | 自称 TTFT 0.1s；Pipecat TTFS 299ms，p99 1584ms 有长尾 | 文档 language enum 目前是 `en` |

Nova-3 **没有**内置 turn detection。Deepgram 自己把 Nova-3 定位成「会议 / 字幕 / 多说话人」，Flux 定位成「实时 Agent」。[Models & Languages](https://developers.deepgram.com/docs/models-languages-overview)

Azure `Speech_SegmentationStrategy=Semantic` 官方写明：**只适合连续识别（听写/字幕），不用于 interactive**。不要搬到 Copilot。

---

## 3. 业界主流方案（2026）

按产品形态，不是按「哪个 WER 最低」。

### A. 语音 Agent / Copilot（主流）

**流式 STT + 语义 EOT + 投机 LLM。**

代表：Flux + EagerEndOfTurn、AssemblyAI U3.5 Pro、OpenAI Realtime `semantic_vad`、Pipecat Smart Turn。

流水线：

1. 麦克风 PCM → WebSocket 流式 ASR（interim 给 UI）
2. 语义 EOT（不是 300ms 静音）决定何时把整段交给 LLM
3. 可选 Eager：中等置信就开始生成，`TurnResumed` 就取消

这是 LiveKit / Pipecat / Deepgram Voice Agent 文档里的默认叙事。本仓库的隐形助手属于这一类，但 EOT 仍是 Deepgram 的 `endpointing` + `utterance_end_ms` + 客户端 grace，不是 Flux。

### B. 会议字幕 / 面试记录（主流）

**流式 ASR + 保守静音 endpointing + 说话人分段。** 允许事后合并。Otter / Fireflies / 本仓库的「气泡历史」更接近这个。

代表：Deepgram Nova-3、AssemblyAI 流式、Google Chirp 3 streaming。

Deepgram 给对话场景的 `endpointing` 建议是 **300–500ms**（想法中间会停）；chatbot 短确认才用 10ms。[Understand Endpointing](https://developers.deepgram.com/docs/understand-endpointing-interim-results)

### C. 本地 / 端侧（低延迟上限、高工程成本）

**cache-aware transducer + 小 chunk。**

- 英文：NVIDIA Parakeet CTC / Nemotron Streaming，80–160ms chunk
- 中文：FunASR Paraformer-zh-streaming；工业上常 2pass（流式出字 + 离线重打分）
- 端侧小模型：Sherpa-ONNX / SenseVoice 小尺寸，延迟看设备，不是云 SLA

### D. 明确不是低延迟主流

- Whisper 文件 API、Groq Whisper、本地 Whisper large：batch
- 纯能量 VAD 切段再丢给离线 ASR：第一段就要等 VAD + 整段推理
- 把标点模型的句号当气泡边界：中文实时标点会在换气处打句号

---

## 4. 对照本仓库

当前路径（源码，2026-08-23）：

| 项 | 值 | 位置 |
|---|---|---|
| 默认供应商 | `deepgram` | `src/lib/settingsStore.ts` `DEFAULT_SETTINGS` |
| 默认模型 | `nova-3` | 同上 |
| 默认语言 | `zh-CN` | 同上；Nova-3 官方支持 `zh` / `zh-CN` / `zh-Hans` / `zh-TW` / `zh-HK` |
| 备选 | Gemini Live `gemini-3.5-live-translate-preview` | 当 STT 用，不是专用 ASR |
| Socket `endpointing` | 默认 300；`language=multi` 时 100 | `openDeepgramSocket()` |
| Socket `utterance_end_ms` | 默认 1000 | 同上 |
| Copilot 覆盖 | `COPILOT_ENDPOINTING_MS = 500`，`COPILOT_UTTERANCE_END_MS = 1500` | `src/lib/copilotSession.ts` |
| Gemini 合成边界 | `GEMINI_UTTERANCE_END_MS = 1500` | `src/lib/llm.ts` |

Nova-3 出字已经在云端第一梯队（Pipecat 247ms，官方 150–300ms）。用户觉得「慢」或「一句切两句」，主因是：

1. **EOT 窗口**：Copilot 500ms endpointing + 1500ms utterance-end + 未完成句再延长，远大于 247ms 推理
2. **静音 ≠ 成句**：`speech_final` 是 VAD 静音，不是语义结束（见断句研究）

`language=multi` 的 100ms endpointing 不能当中文面试默认：Nova-3 的 `multi` **不含中文**（英西法德印俄葡日意荷）。

### 若只谈「延迟最小」且必须中英

优先级（不改代码，只排序）：

1. **保持 nova-3 + 客户端 utterance 状态机**（已在断句方案里）。这是延迟和中文同时成立的点。
2. 真要语义 EOT 且要中文：评估 AssemblyAI U3.5 Pro Streaming（语言表有 ZH，TTCT 568ms），代价是换钥匙、重连、校验、账单。
3. 不要上 Flux：官方无中文。
4. 不要为了延迟切 Gemini Live：VAD 建议 500–800ms，本仓库还叠了 1500ms 合成 utterance-end。
5. 本地 FunASR / Parakeet 只在「可接受自建 GPU + 自建断句」时才有推理优势；对 Tauri 面试助手不是当前最短路径。

参数微调（不能替代状态机）：中文面试 `endpointing` 400–500、`utterance_end_ms` 1500——Deepgram 给「想法中间会停」的区间，也是 Copilot 已经采用的值。再短会回到「换气切句」。

---

## 5. 来源

### 本仓库

- `src/lib/llm.ts`：`openDeepgramSocket`、`GEMINI_UTTERANCE_END_MS`
- `src/lib/settingsStore.ts`：`sttProvider` / `sttModel` / `sttLanguage` 默认
- `src/lib/copilotSession.ts`：`COPILOT_ENDPOINTING_MS` / `COPILOT_UTTERANCE_END_MS`
- `docs/research/stealth-transcript-sentence-segmentation.md`：断句与 EOT 误用

### 官方 / 同台基准

- Deepgram [Measuring STT Latency](https://developers.deepgram.com/docs/measuring-streaming-latency)：Nova-3 150–300ms 服务端、200–500ms 客户端；Flux EOT 100–500ms
- Deepgram [Models & Languages](https://developers.deepgram.com/docs/models-languages-overview)：Flux 无中文；Nova-3 有 `zh-CN`；`multi` 无中文
- Deepgram [Flux Nova-3 migration](https://developers.deepgram.com/docs/flux/nova-3-migration)：EOT p50 ~260ms；EagerEndOfTurn
- Deepgram [Flux configuration](https://developers.deepgram.com/docs/flux/configuration)：`eot_threshold` 默认 0.7；`eot_timeout_ms` 默认 5000
- AssemblyAI [Streaming Benchmarks](https://www.assemblyai.com/docs/streaming/benchmarks)：emission / TTCT
- AssemblyAI [Universal Streaming](https://www.assemblyai.com/docs/speech-to-text/universal-streaming)：U3.5 Pro 含 ZH
- [pipecat-ai/stt-benchmark](https://github.com/pipecat-ai/stt-benchmark)：TTFS 同台表
- NVIDIA [Nemotron ASR Streaming](https://huggingface.co/docs/transformers/main/model_doc/nemotron_asr_streaming)：80 / 160 / 560 / 1120ms chunk
- FunASR [tutorial](https://github.com/modelscope/FunASR/blob/main/docs/tutorial/README.md)：`[0,10,5]` = 600ms + 300ms
- Gemini [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)：`silenceDurationMs` 建议 500–800ms
