# Research: 模型与语音 API 计费（截至 2026-08-31）

## Summary

主流后端 AI API 不是“买一个月度聊天订阅即可无限调用”：OpenAI 与 Anthropic 均明确把消费端订阅和开发者 API 分账；Gemini API、Groq、Deepgram也以项目/组织及 API 凭证下的实际用量计费。当前主要计量轴为文本/音频 token、音频分钟、TTS 字符和工具请求；缓存、Batch/Flex、预付余额、用量层级与并发/速率限制会显著改变实际账单。

本报告只给出可复算证据及边界，不为 RabbitInterview 选择最终供应商或密钥架构。所有金额均为官方页面所列美元标价，访问日期为 **2026-08-31**；除非来源明确说明，均不含税、汇率、支付渠道费用和合同折扣。

## Findings

1. **高影响：消费订阅与 API 权益不可互换。** OpenAI 明确说明 ChatGPT 与 API Platform 是两套计费系统，付费 API 需单独添加支付方式；Anthropic 也明确说明 Pro/Max/Team/Enterprise 订阅不包含 Claude Console/API。后端自动化应按 API 用量单独核算，而不能把个人订阅当作生产调用额度。[OpenAI billing boundary](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)；[Anthropic billing boundary](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console)
2. **高影响：同一服务的“标准、缓存、批量、优先、地域”不是同价。** OpenAI 的 cached input 通常显著低于普通 input，Batch 对输入/输出减 50%；Anthropic cache write 为基础输入价的 1.25×（5 分钟）或 2×（1 小时），命中为 0.1×，Batch 再减 50%且可与缓存叠加；Gemini Batch/Flex 通常为 Standard 的 50%，Priority 反而溢价；Groq 缓存命中和 Batch 均减 50%，但两项不叠加。[OpenAI pricing](https://developers.openai.com/api/docs/pricing)；[Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)；[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)；[Groq caching](https://console.groq.com/docs/prompt-caching)；[Groq batch](https://console.groq.com/docs/batch)
3. **高影响：语音服务计量单位并不统一。** OpenAI 和 Deepgram 给出按音频分钟估算/计价，Groq Whisper 按音频小时且不足 10 秒仍按 10 秒计费，Gemini 新语音模型本质按音频/文本 token 计费并给出分钟折算；Deepgram TTS 则按 1,000 字符。比较时必须先统一成每分钟、每小时或每百万 token，不能直接比较表面数字。[OpenAI pricing](https://developers.openai.com/api/docs/pricing)；[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)；[Groq speech](https://console.groq.com/docs/speech-to-text)；[Deepgram pricing](https://deepgram.com/pricing)
4. **中影响：余额上限不等于可靠硬闸。** OpenAI 预付余额耗尽和硬 spend limit 的执行都有传播延迟，可能形成少量超额；Gemini 明示计费管线约 10 分钟，长任务可能越过余额/项目 cap；Groq spend tracking 延迟 10–15 分钟；Deepgram 无余额且无 overage agreement 时返回 402。预算控制应把这些延迟视为残余风险，而非假设零超支。[OpenAI prepaid](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing)；[OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits)；[Gemini billing](https://ai.google.dev/gemini-api/docs/billing)；[Groq spend limits](https://console.groq.com/docs/spend-limits)；[Deepgram errors](https://developers.deepgram.com/docs/errors)
5. **中影响：速率/并发通常作用于组织或项目，而不是单把 key。** OpenAI、Anthropic 和 Groq 随消费/支付历史提升 usage tier；Groq 限制按 organization；Gemini 的层级、cap 与速率受 billing account/project 约束；Deepgram 并发按 project，增加 key 或项目绕限不增加合规容量且可能违反条款。[OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits)；[Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits)；[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)；[Groq rate limits](https://console.groq.com/docs/rate-limits)；[Deepgram rate limits](https://developers.deepgram.com/reference/api-rate-limits)

## 计费模式矩阵

| 供应商 | 默认 API 付款方式 | 核心计量 | 免费/试用 | 缓存与批量 | 用量/速率控制 | 预付、承诺或代理 |
|---|---|---|---|---|---|---|
| OpenAI | 新 API 账户预付；部分账户月结/自动扣款 | 输入、cached input、cache write、输出 token；语音分钟/token；工具请求/存储 | 免费资格与模型限额依地域/账户；不能据公开页假定生产免费额度 | Batch 输入/输出 50% 折扣；模型表分列 cached input | 组织获批月度 usage limit 与自设 org/project hard limit 分开；RPM/TPM 随 tier | 预付最低 $5，购买 credit 1 年过期且不退款；Scale Tier/Reserved Capacity 需另议；地域处理对符合条件的新模型 +10% |
| Anthropic | 多数 Console 组织预付 usage credits；销售签约可月结 | 输入、输出、cache write/read token；工具调用及会话运行时等 | 新用户可能有少量测试 credit，数额非公开固定承诺 | 5m write 1.25×、1h write 2×、hit 0.1×；Batch 输入/输出 50%且可叠加缓存 | Start/Build/Scale 月 cap 为 $500/$1,000/$200,000；另有 RPM/ITPM/OTPM | AWS/Azure Marketplace 用 CCU（月结、后付、$0.01/CCU）；Claude 4.6+ US-only 1.1× |
| Google Gemini Developer API | Free；Paid 先 Prepay，满足历史/层级后可能可选 Postpay | 输入、输出（含 thinking）、cached token 与缓存存储时长；语音 token；grounding 请求 | 选定模型免费 token；免费层内容可用于改进产品，Paid 不用于改进 | Batch/Flex 通常 50%；显式缓存另计 reduced token 与 token-hour storage | Tier 1/2/3 billing caps $250/$2,000/$20k–$100k；滚动 10 分钟 spend-rate limit $10/$200/$200 | 2026-03-23 起新 AI Studio 用户可能被要求预付；Enterprise 可议 provisioned throughput/量价折扣 |
| Groq | Developer PAYG，月末或递进阈值扣款 | LLM 输入/输出 token；STT 音频小时；TTS 字符 | Free tier 有较低限制，不能视为生产容量 | 自动缓存命中输入减 50%；Batch 减 50%，两者不叠加 | Developer 模型级 RPM/TPM/ASH；付费可设组织级月 spend limit | 后付；新用户累计 $1/$10/$100/$500/$1,000 触发递进账单 |
| Deepgram | PAYG credit；Growth 年度预付 | STT 分钟、TTS 字符、Voice Agent websocket 分钟、Intelligence token | PAYG 标称 $200 free credit | Growth 年预付 $4k+，按实际用量抵扣，最高约省 20%；无通用 Batch 折扣证据 | 按 project 并发；PAYG/Growth 固定默认并发，Enterprise 可申请提升 | 信用卡购买 credit 不过期；促销 credit 注册后 1 年过期；企业 credit 合同期末过期 |
| OpenRouter（对照） | 购买 gateway credits 或 BYOK | 上游模型 token 价；平台/购 credit 费用；BYOK 超额费 | Free 方案约 25+ free models、50 req/day | 转发上游缓存能力；统一网关本身不等于固定折扣 | key 可设日/周/月 credit limit；免费模型另有限速 | PAYG 平台费 5.5%；BYOK 每月前 $25,000 list-price inference 免费，之后 5%；Enterprise 条款另议 |

> OpenRouter 的当前官方 Pricing 页把 PAYG “Platform Fees”列为 5.5%，FAQ 说明这是购买 credits 时的费用而不是每次推理加价；BYOK 免费额度按**上游标价推理成本**而非请求数计。其旧博客曾写“每月 100 万次 BYOK 请求免费”，已在 2026-08 更新为旧政策，故不能继续使用。[OpenRouter pricing](https://openrouter.ai/pricing)；[OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok)

## 项目相关单位价格快照

下表为官方页面在访问日显示的、便于面试转写与回答生成复算的代表 SKU。模型发布日若官方价格页没有列出，则标为“价格页未载”；这里不以第三方发布日期填补。

| 供应商 / SKU | 用途 | 单位价格（USD） | 发布/促销时间信息 | 精确来源 |
|---|---|---:|---|---|
| OpenAI `gpt-5.6-luna`，short context Standard | 文本生成 | 输入 $0.20；cached $0.02；cache write $0.25；输出 $1.20 / 1M tokens | 发布日价格页未载 | [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI `gpt-5.6-terra`，short context Standard | 文本生成 | 输入 $2.00；cached $0.20；cache write $2.50；输出 $12.00 / 1M | 发布日价格页未载 | [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI `gpt-transcribe` | 离线转写 | 估算 $0.0045/min | 发布日价格页未载 | [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI `gpt-4o-mini-transcribe` | 离线转写 | 输入 $1.25、输出 $5.00 / 1M；估算 $0.003/min | 发布日价格页未载 | [pricing](https://developers.openai.com/api/docs/pricing) |
| OpenAI `gpt-live-transcribe` | 实时转写 | $0.017/min | 发布日价格页未载 | [pricing](https://developers.openai.com/api/docs/pricing) |
| Anthropic Claude Sonnet 5 | 文本生成 | 输入 $2；5m write $2.50；1h write $4；hit $0.20；输出 $10 / MTok | 原称截至 2026-08-31 的 introductory price，现已转为标准价 | [pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| Anthropic Claude Haiku 4.5 | 低成本文本生成 | 输入 $1；5m write $1.25；1h write $2；hit $0.10；输出 $5 / MTok | 发布日价格页未载 | [pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| Gemini 3.5 Flash Standard（价格页首个 Flash 档） | 多模态/文本 | 2026-12-31 前输入 $0.75、输出 $3.75、cached $0.075 / 1M；缓存存储 $0.50 / 1M token-hour | 当前促销至 2026-12-31；2027-01-01 起分别 $1.50/$7.50/$0.15，存储 $1.00 | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 2.5 Flash | 多模态/文本 | text/image/video 输入 $0.30；audio 输入 $1.00；输出 $2.50 / 1M | 发布日价格页未载 | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini Live Transcribe | 实时 STT | audio 输入约 $0.005/min + text 输出约 $0.004/min；混合约 $0.009/min | 发布日价格页未载；估算假设 25 audio token/s、175 text token/min | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini Transcribe | 离线 STT | audio 输入约 $0.003/min + text 输出约 $0.002/min；混合约 $0.005/min | 发布日价格页未载；同上为官方估算 | [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Groq `openai/gpt-oss-120b` | 文本生成 | 输入 $0.15、输出 $0.60 / 1M | 发布日价格页未载 | [models](https://console.groq.com/docs/models) |
| Groq `openai/gpt-oss-20b` | 文本生成 | 输入 $0.075、输出 $0.30 / 1M | 发布日价格页未载 | [models](https://console.groq.com/docs/models) |
| Groq `whisper-large-v3-turbo` | STT | $0.04/audio hour（约 $0.000667/min） | 发布日价格页未载；每请求最低计费 10 秒 | [models](https://console.groq.com/docs/models)；[speech](https://console.groq.com/docs/speech-to-text) |
| Groq `whisper-large-v3` | STT/翻译 | $0.111/audio hour（约 $0.00185/min） | 发布日价格页未载；每请求最低计费 10 秒 | [models](https://console.groq.com/docs/models)；[speech](https://console.groq.com/docs/speech-to-text) |
| Deepgram Nova-3 Monolingual streaming PAYG | 实时 STT | 当前 $0.0048/min；regular $0.0077/min | 官方标为 limited-time promotional，未给终止日 | [pricing](https://deepgram.com/pricing) |
| Deepgram Nova-3 Multilingual streaming PAYG | 实时多语 STT | 当前 $0.0058/min；regular $0.0092/min | 官方标为 limited-time promotional，未给终止日 | [pricing](https://deepgram.com/pricing) |
| Deepgram Nova-3 Monolingual pre-recorded PAYG | 离线 STT | $0.0043/min | 发布日价格页未载 | [pricing](https://deepgram.com/pricing) |
| Deepgram Aura-2 PAYG | TTS | $0.030/1k characters | 发布日价格页未载 | [pricing](https://deepgram.com/pricing) |

## 可复算公式与示例

### 通用公式

- 文本：`cost = input_tokens / 1,000,000 × input_rate + cached_tokens / 1,000,000 × cache_rate + output_tokens / 1,000,000 × output_rate`
- Anthropic 首次缓存写入需把写入 token 从普通输入中分离：`cost = uncached_input × base + cache_write × write_rate + cache_read × hit_rate + output × output_rate`（各 token 数再除以 1M）。
- Batch：若供应商明确 50% 折扣，`batch_cost = eligible_standard_cost × 0.5`；但 Groq cache 与 Batch 不叠加。Gemini 显式缓存还需另加 `cached_tokens / 1M × storage_rate × TTL_hours`。
- 分钟语音：`cost = billable_minutes × rate_per_minute + add_on_minutes × add_on_rate`。
- Groq 小片段：`billable_seconds_per_request = max(actual_seconds, 10)`，`cost = Σ billable_seconds / 3600 × hourly_rate`。
- TTS：`cost = characters / 1,000 × rate_per_1k_characters`。

### 示例 A：一次回答生成

假设每次请求有 8,000 个输入 token、1,000 个输出 token，无缓存：

- OpenAI `gpt-5.6-luna`：`8,000/1M×$0.20 + 1,000/1M×$1.20 = $0.0016 + $0.0012 = $0.0028/次`。
- Claude Sonnet 5：`8,000/1M×$2 + 1,000/1M×$10 = $0.016 + $0.010 = $0.026/次`。
- Groq GPT OSS 120B：`8,000/1M×$0.15 + 1,000/1M×$0.60 = $0.0012 + $0.0006 = $0.0018/次`。

这些只比较计费，不代表质量、延迟或能力等价。

### 示例 B：重复上下文缓存

Claude Sonnet 5 有 100,000 token 固定上下文，首次 5 分钟 cache write，随后命中 9 次，忽略其他 token：

- 不缓存 10 次：`100,000×10/1M×$2 = $2.00`。
- 缓存：`100,000/1M×$2.50 + 100,000×9/1M×$0.20 = $0.25 + $0.18 = $0.43`。
- 该段上下文节省：`$2.00 - $0.43 = $1.57`。TTL 内是否真实命中仍取决于请求结构和时序。

### 示例 C：100 小时面试转写

`100 h × 60 = 6,000 min`：

- OpenAI `gpt-transcribe`：`6,000×$0.0045 = $27.00`。
- Gemini Transcribe 官方混合估算：`6,000×$0.005 ≈ $30.00`。
- Groq Whisper V3 Turbo（连续长音频，无碎片最低计费损失）：`100×$0.04 = $4.00`。
- Deepgram Nova-3 Monolingual streaming 当前促销：`6,000×$0.0048 = $28.80`；regular 为 `$46.20`。
- Deepgram Nova-3 Monolingual pre-recorded：`6,000×$0.0043 = $25.80`。

若 100 小时被拆成大量少于 10 秒的 Groq 请求，必须按每请求 10 秒重新计算，不能沿用 $4.00。

### 示例 D：Gemini 缓存 token-hour

若按 Gemini 3.5 Flash 促销价显式缓存 1M token、TTL 2 小时，并命中一次：

`storage = 1×2×$0.50 = $1.00`；`cache read = 1×$0.075 = $0.075`；合计 `$1.075`，另加非缓存输入与输出费用。单次复用可能比直接再次输入 `$0.75` 更贵，说明 Gemini 显式缓存要结合 TTL 与复用次数核算。

## 生产密钥与最终用户 BYOK：仅陈述差异

| 维度 | 应用后端持有生产 key | 最终用户自带 key（BYOK） |
|---|---|---|
| 账单主体 | 应用方项目/组织汇总承担；可集中议价、Batch、监控 | 通常由最终用户的供应商账户承担上游推理费；若经过 OpenRouter，还可能产生 gateway/BYOK 费 |
| 速率与余额 | 所有用户共享组织/project RPM、TPM、并发、余额和 spend cap | 每个用户受自己的账户层级、地域、余额和供应商条款影响；可用模型与失败形态不一致 |
| 凭证风险 | 长期 secret 必须仅存服务端并隔离项目/环境 | 应用需接收、存储或转发第三方 secret，扩大信任边界；部分语音商提供短期 token 避免暴露长期 key |
| 计量/支持 | 单一账单便于统一单位成本与支持责任 | 成本归属更分散，但故障排查跨用户账户；上游 BYOK 用量可能默认不计入 gateway budget |
| 可验证官方例 | OpenAI org/project limits；Gemini project/billing account；Deepgram project | OpenRouter 明确支持 provider keys；Deepgram 建议不可信客户端用临时 token，默认 TTL 30 秒、最长 1 小时 |

Deepgram 的官方安全边界很具体：普通长期 API key 若直接放在客户端会暴露，应由服务端代理；实时客户端可由服务端用 member key 换临时 token。[Deepgram token auth](https://developers.deepgram.com/guides/fundamentals/token-based-authentication) 这只是凭证机制证据，不构成 RabbitInterview 架构结论。

## 地域、税费与条款边界

- OpenAI 符合条件且 2026-03-05 之后发布的模型使用 regional processing 加价 10%；Amazon Bedrock 上的 OpenAI 定价可能不同。[OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- Anthropic 第一方 Claude 4.6+ 选择 `inference_geo: "us"` 为 1.1×；Bedrock/Google Cloud 区域端点定价独立，Marketplace 税由 AWS/Azure 处理。[Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- Gemini 免费层并非所有国家可用，免费层不可用地域需启用 billing；具体可用地域与税费需按结算账户核验。[Gemini troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)
- Deepgram 速率限制按北美、欧洲、澳大利亚区域分别列示；定价页确认 EU endpoint，但没有在公开表中给出统一税费结论。[Deepgram rate limits](https://developers.deepgram.com/reference/api-rate-limits)
- OpenAI API credits 当前仅以 USD 购买；本地税、信用卡汇兑和 App Store 消费订阅价格不适用于 API 单价表。[OpenAI multi-currency](https://help.openai.com/en/articles/10421635-multi-currency-billing-faq)

## Sources

### Kept（官方、一手、可复核）

- [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing) — 模型、语音、工具、缓存、地域价格主证据。
- [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing) — 最低充值、过期、自动充值及余额延迟。
- [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits) / [spend limits](https://developers.openai.com/api/docs/guides/spend-limits) — tier、硬限额及传播延迟。
- [OpenAI ChatGPT/API billing separation](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) — 分账一手声明。
- [Anthropic Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) — 模型、缓存、Batch、地域和 Marketplace 价格。
- [Anthropic API payment](https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage) / [subscription separation](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console) — 预付/月结及分账。
- [Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits) — 月 spend cap 与 tier。
- [Gemini Pricing](https://ai.google.dev/gemini-api/docs/pricing) — token、语音、缓存、Batch/Flex/Priority 及促销价。
- [Gemini Billing](https://ai.google.dev/gemini-api/docs/billing) / [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — Prepay/Postpay、cap、速率与超额延迟。
- [Groq models](https://console.groq.com/docs/models), [speech](https://console.groq.com/docs/speech-to-text), [billing FAQ](https://console.groq.com/docs/billing-faqs), [spend limits](https://console.groq.com/docs/spend-limits), [cache](https://console.groq.com/docs/prompt-caching), [batch](https://console.groq.com/docs/batch) — 单价、最低音频计费、后付、限额、折扣叠加规则。
- [Deepgram Pricing](https://deepgram.com/pricing), [projects/credits](https://developers.deepgram.com/guides/deep-dives/managing-projects), [rate limits](https://developers.deepgram.com/reference/api-rate-limits), [temporary tokens](https://developers.deepgram.com/guides/fundamentals/token-based-authentication) — PAYG/Growth、信用过期、并发与客户端凭证边界。
- [OpenRouter Pricing](https://openrouter.ai/pricing), [BYOK](https://openrouter.ai/docs/guides/overview/auth/byok), [limits](https://openrouter.ai/docs/api_reference/limits) — 网关对照的费用、BYOK 和 key 限额。

### Dropped / rejected

- `https://groq.com/blog/batch-processing-with-groqcloud-for-ai-inference-workloads/` — 历史促销博客同时出现 25% 与“截至四月底 50%”；当前 Groq Docs 已明确固定 50%，故不用旧文定价。
- `https://openrouter.ai/blog/announcements/1-million-free-byok-requests-per-month/` — 页面自身注明 2026-08 政策已改，旧“100 万请求”口径被当前 list-price allowance 替代。
- Folding Sky、ToolColumn、smeuse 等关于 ChatGPT/API 分账的第三方文章 — 官方 OpenAI 与 Anthropic 帮助中心已直接回答，第三方冗余。
- 搜索结果中的多语言 Anthropic status/model-card 页面与畸形 query URL — 与计费无直接关系或 URL 不稳定。
- 各供应商价格 PDF — 按任务要求不解析；本报告全部采用 HTML/官方文档。

## Gaps / 不确定项

- **价格页未提供统一发布日期。** 多数 SKU 只可确认访问日现价，不能从同页可靠给出模型首发日；需发布审计时应再查各供应商官方 changelog，并把“模型发布日期”和“价格生效日”分开。
- **动态促销风险。** Deepgram streaming 促销没有结束日；Gemini 3.5 Flash 当前价明确只到 2026-12-31；OpenAI GPT-5.6 Sol（本报告未用于复算）是至少到 2026-11-21 的促销价。上线前需重新抓取价格页。
- **税费/币种。** 除 Marketplace 税务归属和 OpenAI API credits 仅 USD 外，公开价页不足以计算特定法人、国家、VAT/GST、信用卡汇率或预扣税。
- **免费额度并非 SLA。** Gemini/Deepgram 有明确免费入口，但模型可用性、地域、数据使用和限速不同；OpenAI/Anthropic 的测试 credit 数额并非稳定公开承诺。
- **合同价不可公开复算。** Enterprise、Scale Tier、Reserved Capacity、provisioned throughput、Deepgram Growth $4K+ 和各类 volume commitment 的最终折扣依合同。
- **token 化差异。** 同一文本在不同供应商/模型 tokenizer 下 token 数不同；Anthropic 还说明 Claude 4.7+ tokenizer 对同一文本约多 30%（实际依内容变化）。严谨预算必须用真实请求 usage 字段，而非只套相同 token 数。

## Review findings

- **high — `outputs/.plans/ai-tool-subscriptions-T3.md`：** 消费订阅不可作为后端 API 权益；OpenAI 与 Anthropic 官方均要求 API 单独计费。
- **high — `outputs/.plans/ai-tool-subscriptions-T3.md`：** 语音报价横跨 token/minute/hour/character，且 Groq 有每请求 10 秒最低计费；若不统一单位会产生数量级误判。
- **medium — `outputs/.plans/ai-tool-subscriptions-T3.md`：** 供应商 spend cap/余额闸均可能因计量传播延迟而小幅超额，不应被描述为绝对实时硬上限。
- **medium — `outputs/.plans/ai-tool-subscriptions-T3.md`：** 价格具有促销和生效期；Gemini 2027-01-01 涨价、Deepgram 未注明结束日的 streaming 促销需要在实现/发布前复核。

## Residual risks

- 官方价格和模型目录在访问日后可无通知更新，报告是时间点快照。
- 未进行真实账户结算或发票验证；地域税、合同折扣、信用卡费用只能由具体账户确认。
- 未以 RabbitInterview 的真实音频时长、并发、语言组合、上下文/输出 token 分布做 workload benchmark；示例只验证公式可复算，不表示最终月成本。
- 未评价模型准确率、延迟、服务可用性或数据处理条款，低单价不等于总拥有成本更低。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "报告在 Review findings 中对 outputs/.plans/ai-tool-subscriptions-T3.md 给出 high/medium 级别的具体计费边界、单位换算、限额延迟和促销时效发现，并在 Residual risks 中列明剩余风险。"
    }
  ],
  "changedFiles": [
    "/Users/thomas/.pi/agent/sessions/--Volumes-aiiltti-Project-orca-ai-rabbit-interview-main-3--/subagent-artifacts/outputs/74629718-a093-411d-9500-43d9fae2fe17/outputs/.drafts/ai-tool-subscriptions-research-api.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "focused official-source web research and full-page fetches",
      "result": "passed",
      "summary": "核验 OpenAI、Anthropic、Gemini、Groq、Deepgram 与 OpenRouter 官方定价、billing、rate-limit、cache/batch 页面。"
    }
  ],
  "validationOutput": [
    "已包含计费模式矩阵、代表单位价格、四组可复算公式/示例、API 与消费订阅分账证据、生产 key/BYOK 差异、精确 URL、访问日期、接受/拒绝来源及不确定项。",
    "所有核心价格证据来自官方 HTML/文档，未采用 PDF 或第三方报价。"
  ],
  "residualRisks": [
    "官方价格在 2026-08-31 后可能变化；促销价需上线前复核。",
    "税费、合同折扣与真实 workload tokenization 仍需具体账户和实测确认。"
  ],
  "noStagedFiles": true,
  "diffSummary": "新增一份截至 2026-08-31 的模型与语音 API 计费证据报告，无产品代码修改。",
  "reviewFindings": [
    "high: outputs/.plans/ai-tool-subscriptions-T3.md - OpenAI/Anthropic 消费订阅不包含后端 API，用量必须单独计费。",
    "high: outputs/.plans/ai-tool-subscriptions-T3.md - 语音供应商单位和最低计费粒度不同，必须统一后再比较。",
    "medium: outputs/.plans/ai-tool-subscriptions-T3.md - spend limit 存在传播延迟与小幅超额风险。",
    "medium: outputs/.plans/ai-tool-subscriptions-T3.md - Gemini/Deepgram 等促销价存在明确或未明确的到期风险。"
  ],
  "manualNotes": "本报告不提出 RabbitInterview 最终供应商或密钥架构；示例仅用于验证价格公式。"
}
```
