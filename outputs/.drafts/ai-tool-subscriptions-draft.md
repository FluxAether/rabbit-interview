# 主流 AI 工具订阅与 RabbitInterview 分阶段方案

**研究基准日 / 价格访问日：2026-08-31**  
**币种口径：**除 RabbitInterview 候选商品外，公开价格均为官方美国页面或官方 API 文档所示 **USD 税前标价**；实际结账受地区、币种、VAT/GST、支付渠道、汇率、合同折扣与促销影响。文中 RabbitInterview 的 ¥89/¥199 来自当前预生产代码，**不是已上线正式售价**。

## 执行摘要

1. **必须分成三本账。**（a）员工使用的通用助手；（b）开发者使用的 AI 编程席位；（c）RabbitInterview 面向最终用户的 STT/LLM API。ChatGPT、Claude、Perplexity 等官方都明确订阅与 API 分账；Copilot、Cursor、Windsurf、Claude Code 等席位也不是可嵌入产品并转售的后端容量。[OpenAI billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) · [Anthropic billing](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console) · [Perplexity API billing](https://www.perplexity.ai/help-center/en/articles/10354847-api-payment-and-billing) · [Windsurf MSA](https://windsurf.com/MSA)
2. **对 RabbitInterview，最合适的不是“买一个无限订阅”，而是现有的混合架构：**保留 BYOK/Apple 入口；对需要开箱即用的用户提供 Rabbit Hosted Gateway；Hosted 使用独立生产 API 账户，并继续分别计量 `STT_AUDIO_MS` 与 `LLM_TOKEN_UNITS`。这复用现有代码 seam，避免把厂商密钥和成本强制集中到所有用户。
3. **当前 ¥89/月与 ¥199/季只适合封闭试点。**代码给出的配额分别是 15/50 小时 STT 与 2M/8M LLM units，购买为固定期限、一次性支付宝支付、无自动续费。由于真实 Volcengine 账单舍入、Gemini 取消/断流计费、至少 7 天对账、支付宝沙箱/退款/结算尚未完成，不能声称已验证毛利或生产就绪（`server/src/payments.rs`; `docs/vendor_contract.md`; `docs/hosted_gateway_runbook.md`）。
4. **先测量，再承诺。**试点期保留双配额硬闸和无自动续费；至少收集 P50/P95 单场源音频时长、双音源占比、每次生成输入/输出/推理 token、取消浪费、错误重试、支付退款与厂商发票。只有实际单位成本与 P95 毛利稳定后，才讨论自动续费、超额包或年度承诺。
5. **低价 API 不等于低总成本。**质量、实时延迟、语言/标点/说话人效果、限流、故障率、数据地域、保留政策和支持都会改变 TCO。本文成本情景只验证公式和量级，不宣称不同模型质量等价。

## 1. 先把市场上的“订阅”分清

| 类别 | 常见计费方式 | 代表例 | 实际买到什么 | 对 RabbitInterview 的含义 |
|---|---|---|---|---|
| 消费级通用助手 | 免费增值、约 $20/月主流个人档、$100–$200/月重度档、动态限额 | ChatGPT Plus $20 / Pro $200；Claude Pro $20 / Max $100/$200；Google AI Pro $19.99；Perplexity Pro $20 / Max $200 | 供一个人通过网页/桌面/移动端使用的功能与动态额度 | 可用于团队个人生产力，但**不能**支撑产品后端 |
| 商业/企业助手 | 按席位月付/年付；席位 + 共享 credits；企业询价 | ChatGPT Business $25 月付或 $20 年付月均；Claude Team $25/$20；M365 Copilot Enterprise $30 年约；Perplexity Enterprise Pro $40/月 | 受管工作区、身份、数据承诺、可能的超额池 | 仅在员工确实需要受管助手时采购；与生产 API 分账 |
| AI 编程席位 | 每开发者席位 + 动态额度/credits + 可选超额 | Copilot Pro $10、Business $19；Cursor Pro $20、Teams $40；Windsurf Pro $20；Claude Code 随 Claude 计划 | IDE/CLI 中的代码补全、agent、审查和组织策略 | 买给开发者，不得代理给 RabbitInterview 用户 |
| 开发者 API | 输入/输出 token、音频分钟/小时、字符、工具调用；预付或后付 | OpenAI、Anthropic、Gemini、Groq、Deepgram | 可嵌入应用的程序化调用，并受项目余额、RPM/TPM/并发及合同约束 | Hosted Gateway 的正确上游采购类别 |
| 预留/企业容量 | 最低期限、最低消费、PTU/Scale/Reserved Capacity、合同 SLA | OpenAI Scale Tier、Azure PTU、Google provisioned throughput、Deepgram Growth | 更稳定吞吐/价格或合同能力，同时承担闲置和锁定 | 真实 30–90 天负载稳定前不要买 |
| 聚合平台代理 | 上游模型价 + 平台费，或 BYOK 超额费 | OpenRouter PAYG 购买 credits 时 5.5% 平台费；BYOK 按当前规则计费 | 统一路由、模型覆盖与账单工具，但多一层故障/条款/费用 | 仅在多模型路由的运维收益被数据证明后考虑 |

**核心边界：**“包含 credits”“5×/20×”“无限补全”“extended agent limits”都不是跨产品货币，也不是固定 token 包。Claude/Gemini 有滚动窗口，Cursor/Windsurf 未公开可统一换算的固定请求量；GitHub 在 2026-06-01 后以 AI credits 为主，旧 premium requests 只适用于部分 legacy 年度个人计划。[Claude plans](https://support.claude.com/en/articles/11049762-choose-a-claude-plan) · [Gemini limits](https://support.google.com/gemini/answer/16275805?hl=en-gb&ref_topic=13194540) · [GitHub plans](https://docs.github.com/en/copilot/get-started/plans) · [Cursor pricing](https://cursor.com/docs/models-and-pricing) · [Windsurf quotas](https://docs.windsurf.com/windsurf/accounts/quota)

## 2. 通用助手：价格之外如何选择

### 2.1 公开档位快照

| 产品 | 个人主流 / 重度档 | 团队或企业公开入口 | 达限与超额 | API 是否包含 |
|---|---:|---:|---|---|
| ChatGPT | Plus $20/月；Pro $200/月 | Business Standard $25/月付或 $20/年付月均；Enterprise 询价 | 动态模型/功能限额；部分方案可购共享/flexible credits | 否；ChatGPT 与 API Platform 独立 |
| Claude | Pro $20/月或 $200/年；Max $100/$200/月 | Team Standard $25 月付或 $20 年付月均；Enterprise $20/席/月起并叠加 usage（合同代际需核对） | 5 小时滚动窗口及周限额；可启用 usage credits | 否；Console/API 单独付费 |
| Google AI | Pro $19.99/月；Ultra 5× $99.99、20× $199.99/月（美国页） | Workspace 中部分版本包含 Gemini；扩展项/Enterprise 依版本和地区 | 计算量、5 小时与周上限；部分产品可购 Google One AI credits | 指定消费 credits 不等于 Gemini API credits |
| Microsoft 365 Copilot | Personal/Family/Premium 美国年付 $99.99/$129.99/$199.99 | 完整 M365 Copilot Enterprise $30/用户/月（年约，需基础许可证） | 功能 credits/日月上限；agent 可能另走 Copilot Credits/PAYG | Azure OpenAI/Foundry 独立 |
| Perplexity | Pro $20/月；Max $200/月 | Enterprise Pro $40/月或 $400/年；Enterprise Max $325/月或 $3,250/年 | Computer credits 可补充；API credits 单独 | 否；API 无需 Pro |

来源：[OpenAI pricing](https://openai.com/chatgpt/pricing/) · [Anthropic pricing](https://www.anthropic.com/pricing) · [Gemini subscriptions](https://gemini.google/subscriptions/) · [Microsoft pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/enterprise) · [Perplexity pricing](https://www.perplexity.ai/enterprise/pricing)。所有数字均为 2026-08-31 时点公开价；地区结账和税费可能不同。

### 2.2 治理比个人价格更重要

- 个人方案通常只有用户级 opt-out 或有限管理；处理公司机密时，不应把个人账户当作商业工作区的等价替代品。
- OpenAI Business/Enterprise/API、Claude Team/Enterprise、GitHub Copilot Business/Enterprise 等商业路径通常默认不以客户内容训练；但 **no training 不等于 zero retention**。OpenAI API 的滥用监测日志默认可保留最多 30 天；Anthropic 的标准商业保留与 covered-model 例外也需逐端点核对。[OpenAI business data](https://openai.com/business-data/) · [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) · [Claude Code data use](https://code.claude.com/docs/en/data-usage)
- SSO、SCIM、RBAC、审计、DLP/eDiscovery、数据驻留和 SLA 并非“Enterprise”三个字自动全部包含。比如 ChatGPT Business 单独部署不含 SCIM；GitHub Copilot 审计日志不含本地客户端提示；OpenAI Compliance Platform 在线日志窗口为 30 天，长期历史需要持续拉取。[OpenAI SCIM](https://help.openai.com/en/articles/10011769-scim-integration-faq) · [OpenAI Compliance](https://help.openai.com/en/articles/9261474) · [GitHub audit](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/review-audit-logs)
- 数据驻留通常排除账户、账单、路由或部分系统元数据，且可能缩小模型范围或增加约 10% 成本。合同必须分列静态存储、推理、其他处理、日志、支持访问与子处理者，而不是只写“支持 EU/US residency”。[OpenAI residency](https://help.openai.com/en/articles/9903489-data-residency-for-chatgpt) · [GitHub residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/github-copilot-with-data-residency)

**RabbitInterview 内部建议：**早期团队只采购实际使用的少量个人开发/研究席位；一旦输入真实候选人简历、面试内容、客户代码或组织文档，就切到有 DPA、受管身份、默认不训练和可验证保留政策的商业工作区。不要为了尚未发生的企业销售提前购买全套 Enterprise。

## 3. AI 编程工具：按工作流选，不按“无限”选

| 工具 | 公开价格（税前 USD） | 当前额度口径 | 团队治理 | 主要锁定/误读 |
|---|---:|---|---|---|
| GitHub Copilot | Pro $10；Pro+ $39；Max $100；Business $19/席；Enterprise $39/席/月 | 个人 1,500/7,000/20,000 AI credits；组织常态 1,900/3,900 credits/席入共享池；1 credit=$0.01，模型按 token 消耗 | Business/Enterprise 有集中许可与策略；商业数据不训练 | 2026-09-01 前旧客户 3,000/7,000 是促销，不应进入稳态预算；Actions minutes 可另耗 |
| Cursor | Pro $20；Pro Plus $60；Ultra $200；Teams $40；Teams Premium $120/用户/月 | Tab completion 无限；agent 使用池未公开固定 token；Teams Premium 为 5× agent 用量 | Teams 有集中管理、Privacy Mode、SAML/OIDC；Enterprise 增 SCIM 等 | 第三方模型超额为 API list price + $0.25/1M Cursor Token Rate；用户池不可互转（Enterprise 另议） |
| Windsurf | Pro $20；Max $200；Teams $80 团队基础 + $40/full seat/月 | 2026 年为每日+每周 quota；新 Enterprise 使用 ACU，旧 credits 不可直接换算 | SSO 在 Enterprise；合同可能按代际不同 | quota、ACU、legacy credits 三套口径并存；MSA 仅内部业务使用且不可转许可 |
| Claude Code | Claude Pro $20；Max $100/$200；Team $25/$125 月付（年付档较低） | 与 Claude 共用五小时/周额度；可切 usage credits/API 继续 | Team/Enterprise 有集中管理；Enterprise 合同代际不同 | `ANTHROPIC_API_KEY` 可绕过订阅产生独立 API 费；倍数不是固定 token 包 |
| Gemini Code Assist | Standard $22.80 月付或 $19 年约月均；Enterprise $54/$45 | Agent/CLI 1,500/2,000 requests/用户/日，但一个 prompt 可触发多请求 | Standard 已含企业安全；Enterprise 增私有代码定制，至少 10 席 | 不能把“requests”直接与 GitHub credits 比；CLI API-key 路径另行 PAYG |

来源：[GitHub plans](https://docs.github.com/en/copilot/get-started/plans) · [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) · [Cursor team pricing](https://cursor.com/docs/account/teams/pricing) · [Windsurf usage](https://docs.windsurf.com/windsurf/accounts/usage) · [Claude Code costs](https://docs.anthropic.com/en/docs/claude-code/costs) · [Gemini Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)。

**项目建议：**默认先用一款最贴近现有 Git/GitHub 工作流、最低管理负担的席位，不同时订三款做“保险”。若团队主要在 GitHub 且需求是补全/审查，Copilot Business 的池化和价格最容易预算；若重度 agent 工作流实际节省时间，再用 2–4 周试验比较 Cursor/Claude Code/Windsurf。迁移触发条件应是每开发者节省时间、接受率、PR 周期和超额账单，而不是宣传的“×倍”。任何一款都不得用于 RabbitInterview 生产调用。

## 4. API 计费与可复算成本

### 4.1 代表性单位价格快照

| API / SKU | 用途 | 2026-08-31 官方标价 | 关键边界 |
|---|---|---:|---|
| Gemini 3.5 Flash Standard | 文本/多模态 | 至 2026-12-31：输入 $0.75、输出 $3.75、cached $0.075 / 1M tokens；2027-01-01 起 $1.50/$7.50/$0.15 | 当前为有明确截止日的促销价；显式缓存另计 token-hour storage |
| Gemini 2.5 Flash | 文本/多模态 | text/image/video 输入 $0.30，audio 输入 $1.00，输出 $2.50 / 1M | 与代码默认 `gemini-3.7-flash` 不同；不能把此价直接当 hosted 实际账单 |
| OpenAI `gpt-5.6-luna` | 文本生成 | 输入 $0.20、cached $0.02、输出 $1.20 / 1M | 仅成本示例，不表示与其他模型质量等价 |
| Anthropic Claude Sonnet 5 | 文本生成 | 输入 $2、5m cache write $2.50、hit $0.20、输出 $10 / 1M | cache write/read 与普通输入需分开 |
| Groq GPT OSS 120B | 文本生成 | 输入 $0.15、输出 $0.60 / 1M | 模型质量与 Hosted Gemini 不等价 |
| Groq Whisper V3 Turbo | STT | $0.04/audio hour | 每请求最低计费 10 秒，碎片化可显著抬价 |
| Deepgram Nova-3 mono streaming | 实时 STT | 促销 $0.0048/min；regular $0.0077/min | 促销页未给结束日，上线预算应看 regular 或双情景 |
| Deepgram Nova-3 mono pre-recorded | 离线 STT | $0.0043/min | 离线价不可直接替代实时体验 |

来源：[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) · [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) · [Groq models](https://console.groq.com/docs/models) · [Groq speech](https://console.groq.com/docs/speech-to-text) · [Deepgram pricing](https://deepgram.com/pricing)。

### 4.2 通用公式

```text
文本成本 = input_tokens / 1,000,000 × input_rate
         + cached_tokens / 1,000,000 × cache_rate
         + output_tokens / 1,000,000 × output_rate

语音成本 = billable_minutes × rate_per_minute
Groq 短片段计费秒数 = Σ max(片段实际秒数, 10)
```

缓存写入、缓存存储、reasoning tokens、工具调用、区域乘数、Batch/Flex/Priority 和重试应另加。供应商的余额或 spend cap 存在计量传播延迟，不能视为绝对零超支硬闸。[OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing) · [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) · [Groq spend limits](https://console.groq.com/docs/spend-limits)

### 4.3 RabbitInterview 低 / 中 / 高工作负载情景

为了不虚构业务量，采用三个**规划情景**，不是流量预测：

- 每场 60 分钟墙钟时间；STT 对 microphone 与 system audio 分别计量，因此双音源场次按 120 个 billable source-minutes（仓库冻结规则见 `docs/vendor_contract.md:9-13`）。
- 每场触发 15 次回答；每次 8,000 input + 1,000 output tokens；不计算缓存、reasoning、重试和取消浪费。
- 低/中/高分别为 10 / 100 / 1,000 场/月。
- STT 仅用公开 Deepgram streaming 价格展示量级；Hosted 实际是 Volcengine，公开证据不足，**不能由此推导 Hosted 毛利**。
- LLM 仅用 Gemini 3.5 Flash 公价展示；Hosted 默认代码模型是 `gemini-3.7-flash`，SKU/合同/账单未验证，故只是代理情景。

| 情景 | 场次/月 | 双音源 STT | LLM tokens（8:1 输入:输出） | Deepgram streaming 促销 / regular | Gemini 3.5 Flash 至 2026-12-31 / 2027 起 | 两项代理合计（促销组合 / 保守组合） |
|---|---:|---:|---:|---:|---:|---:|
| 低 | 10 | 1,200 min（20 source-h） | 1.35M（1.2M in + 0.15M out） | $5.76 / $9.24 | $1.4625 / $2.925 | $7.2225 / $12.165 |
| 中 | 100 | 12,000 min（200 source-h） | 13.5M（12M in + 1.5M out） | $57.60 / $92.40 | $14.625 / $29.25 | $72.225 / $121.65 |
| 高 | 1,000 | 120,000 min（2,000 source-h） | 135M（120M in + 15M out） | $576 / $924 | $146.25 / $292.50 | $722.25 / $1,216.50 |

复算示例（中情景）：`12,000 × $0.0048 = $57.60`；`12M × $0.75 + 1.5M × $3.75 = $14.625`。保守组合使用 Deepgram regular 与 Gemini 2027 已公布价格。**未计入**税、汇率、网关/监控、支付渠道、退款、并发容量、错误重试、缓存、推理 token、上游实际模型差异和支持成本。

### 4.4 语音供应商的表面价陷阱

同样 100 小时连续长音频：OpenAI `gpt-transcribe` 约 $27；Gemini Transcribe 官方混合估算约 $30；Groq Whisper V3 Turbo 约 $4；Deepgram Nova-3 mono streaming 促销/regular 为 $28.80/$46.20，pre-recorded 为 $25.80。它们不是等质量/等延迟/等语言能力的基准；Groq 若被拆成大量短于 10 秒的请求，还必须按每请求 10 秒重算。[OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Groq speech](https://console.groq.com/docs/speech-to-text) · [Deepgram pricing](https://deepgram.com/pricing)

## 5. RabbitInterview 当前方案的量化审视

当前未提交、预生产实现定义：

| 候选商品 | 一次性价格 / 期限 | STT 配额 | LLM 配额 | 套餐内含比率（不是供应商成本） |
|---|---:|---:|---:|---:|
| `PRO_MONTH` | ¥89 / 30 天 | 900 source-min = 15 source-h | 2M units | ¥5.93 / source-h；¥44.50 / 1M units |
| `PRO_QUARTER` | ¥199 / 90 天 | 3,000 source-min = 50 source-h | 8M units | ¥3.98 / source-h；¥24.88 / 1M units；¥66.33/月等效 |

在冻结的“双音源分别计量”规则下，60 分钟双音源面试会消耗 2 source-h：月包理论上只覆盖 7.5 场、季包 25 场；若只有单音源则分别 15/50 场。实际回答次数、音频断线和未使用余额会改变可用场数。

配额结构还有明显的不对称：季包价格只是月包的 2.236×，但 STT 为 3.333×、LLM 为 4×，相对月包的名义单位比率分别便宜约 32.9% 和 44.1%。这可以是刻意的季付激励，也可能造成高用量用户的 margin compression；必须用真实使用分布验证，而不是仅凭售价判断。

LLM `units` 在当前网关按实际 total tokens（含 reasoning 的较大口径）结算，并在 provider usage 缺失时估算（`server/src/llm.rs`）。所以把 2M/8M units 直接按公开 input/output token 价换成成本会丢失输入/输出结构、推理 token、估算误差和模型 SKU。按本文 8,000+1,000 token 的纯示例，2M/8M 约相当于 222/888 次回答，但这不是产品保证。

**结论：**双配额本身是正确的最小控制面；现在不应改成模糊统一 credits 或“无限”。先核验哪一桶在 P50/P95 用户中先耗尽，再决定是否调整配额、增加补充包或改变季包折扣。

## 6. 推荐方案：分阶段，而不是一次性押注

### 阶段 A：个人开发与内部验证（现在）

- 保留默认 BYOK 与 Apple 路径；团队成员自行承担其 API 账单，Rabbit 不承诺 Hosted 容量。
- 员工助手/编码工具最多各选一个主要席位；默认从最低满足工作流的计划开始，只有连续 2–4 周数据证明 agent 用量或管理需求不足时升级。
- 不购买 API 预留容量，不加聚合平台代理，不构建复杂多供应商自动路由。
- 为 BYOK 明示：需要厂商 **API key/账户**，ChatGPT Plus、Claude Pro、Gemini Advanced 等网页订阅不等同于 API credits；客户端长期 key 必须通过现有 secure storage 路径处理，不能写入日志或仓库。

**进入下一阶段的门：**真实 Hosted 上游 TLS/auth/断线测试通过；Gemini usage 与取消账单可对账；支付宝沙箱、回调、退款、重复通知与结算证据完整；生产 flags 仍由明确审批开启。

### 阶段 B：封闭 Hosted 付费试点

- 使用当前 `¥89/30 天` 与 `¥199/90 天` 作为**试点候选商品**，不宣传为已验证正式价；继续一次性、无自动续费。
- 保留 STT/LLM 两个 quota bucket、预占—结算、幂等和硬闸；上游账户另设日/月 spend alert 与预算缓冲，避免传播延迟造成意外超支。
- 至少运行 7 天、最好覆盖一个完整商品周期的对账：内部 accepted source duration 对 Volcengine invoice；Gemini input/output/reasoning/total 与 provider bill；取消、断流、重试单列。
- 运营看板最少记录：每场 source-minutes，单双音源，回答次数，input/output/reasoning tokens，估算 usage 比例，STT/LLM 配额先耗尽率，P50/P95 单用户成本，支付成功/退款/拒付，供应商 4xx/5xx 与限流。
- 隐私文案保持精确：Hosted 音频/上下文会经 Rabbit Gateway 转发给上游；“网关不持久化内容”不等于上游零保留。供应商条款、处理地域与子处理者需在生产前固定。

**调价门：**在税、支付、退款、重试和运维后，P95 cohort 仍达到内部目标毛利；否则调整配额或售价，不用平均用户补贴尾部重度用户。

### 阶段 C：公开发布与增长

- 只有支付与供应商 production gates 全部关闭后，才把试点商品转为正式商品；决定自动续费前先验证取消、退款、发票和消费者法流程。
- 若用户频繁只耗尽一桶，优先提供**单独 STT 或 LLM 补充包**，而不是统一 credits；统一 credits 只有在汇率、模型变价和双计量换算已经稳定时才值得引入。
- 当月负载稳定至少 30–90 天，且承诺价的节省明确高于闲置、迁移和锁定成本时，再询价 Reserved Capacity / provisioned throughput / Growth 合同。
- 需要多供应商容灾时，先维持薄适配层、供应商中立提示/评测集和可导出 usage；只有真实 RTO、供应商故障或模型覆盖证明有必要，才加入自动路由。避免为假设性退出搭建昂贵控制面。
- 企业客户出现后，再增加 DPA、SSO/SCIM、审计导出、保留/驻留选项和 SLA；不把消费级隐私设置包装成企业承诺。

## 7. 采购与上线决策矩阵

| 维度 | 最低可接受证据 | RabbitInterview 当前状态 | 决策 |
|---|---|---|---|
| 授权边界 | 官方确认 API 可用于嵌入产品；席位与 API 分账 | BYOK/Hosted 均走 API 路径 | **通过架构原则**；禁止用助手/编码席位代替 |
| 成本可复算 | SKU、输入/输出/音频单位、促销截止、税汇假设、真实 usage | 外部公开公式已建立；Hosted 实际 Volcengine/Gemini 账单未对齐 | **未通过正式定价** |
| 配额与滥用 | 独立硬闸、幂等、预占/结算、预算传播延迟缓冲 | 已有 STT/LLM buckets 和 reservation/settlement | **适合试点**，仍需真实账单 |
| 数据治理 | DPA、训练默认值、四类保留、地域、子处理者、删除流程 | Rabbit 文档说明不持久化内容，但上游端点政策尚需冻结 | **部分通过** |
| 支付 | 沙箱、签名、幂等、退款、对账、消费者取消 | 本地 fixture 有证据；支付宝沙箱/退款/结算未完成 | **阻止生产** |
| 可靠性 | 限流、并发、断线、取消、重试、SLA/支持 | fixture/编译不能代替供应商和账单证据 | **阻止 SLA 承诺** |
| 锁定与退出 | 提示/usage 导出、薄适配层、模型退役流程、承诺回收期 | BYOK + Hosted seam 已降低部分锁定 | **保持简单**；暂无需聚合平台 |

## 8. 风险、缺口与上线前问题

1. **价格时效：**Gemini 3.5 Flash 已公布 2027-01-01 调价；Deepgram streaming 促销无结束日。发布前必须重新抓取价页，并在配置/运营流程中保留价格版本。
2. **SKU 不匹配：**Hosted 代码默认 `gemini-3.7-flash`、STT 为 Volcengine；本文公开成本示例使用其他可核验 SKU，不能作为真实 COGS。
3. **真实语音成本未知：**双音源按 accepted source duration 累加，45 分钟墙钟可能接近 90 source-minutes；发票舍入和断线重连仍未验证。
4. **LLM 取消与估算：**流断开或 provider usage 缺失时会估算 tokens；实际厂商可能仍计费。必须分别追踪 FINAL/ESTIMATED 和取消后账单。
5. **质量与容量未基准：**最低单价模型可能在中文/英文混合、专有名词、实时延迟或并发上更差；需同一匿名测试集比较 WER/任务成功率、P50/P95 latency、错误率和成本。
6. **税务与支付：**公开 USD 税前价不含中国法人税务、汇率、跨境支付、支付宝费率、退款与拒付；CNY 售价不能直接与 USD API 标价相减得毛利。
7. **合同与隐私：**no-training、ZDR、驻留、SLA 必须落到具体产品/模型/端点/地区/合同。连接器、Web Search、日志和系统元数据可能在声明范围之外。
8. **员工工具重复采购：**ChatGPT/Claude/Gemini/Copilot/Cursor 多席位并购容易形成闲置。按月试用、每季度用接受率与节省时间裁撤，不以“模型覆盖”作为永久叠加理由。

## 最终建议

**采用“BYOK/Apple 免费入口 + Rabbit Hosted 按量上游 + 固定周期双配额商品”的混合方案，并把 Hosted 商品严格停留在封闭试点，直到生产门关闭。** 这是与现有代码最一致、改动最少且保留用户成本/隐私选择的方案。

具体执行顺序：

1. 维持 BYOK 默认，明确个人助手订阅不等于 API；
2. Hosted 上游只使用有嵌入授权的 API 账户，继续 STT/LLM 分账与硬闸；
3. 以 ¥89/¥199 做受控试点而非正式承诺，完成真实供应商与支付对账；
4. 用 P50/P95 单用户 COGS 与先耗尽桶决定配额/补充包；
5. 稳定 30–90 天后才评估年约、预留容量、自动续费或多供应商路由；
6. 企业需求真实出现时再补 DPA、SSO/SCIM、审计、驻留和 SLA。

这一路径没有引入新的计费抽象，也不要求替换现有 BYOK/Hosted seam；它把不可逆的合同和产品承诺推迟到数据足够时，同时保留最关键的安全、配额和支付闸门。

## 来源方法与限制

- 只采用供应商官方 HTML、帮助中心、开发文档和本地仓库证据；未抓取或解析 PDF。
- 价格、促销、额度和政策均为 2026-08-31 时间点快照；动态限额和企业合同不能由公开价页完全复算。
- 关键外部证据详见本草稿内联链接及四份研究笔记：
  - `outputs/.drafts/ai-tool-subscriptions-research-assistants.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-coding.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-api.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-governance.md`
- 项目事实详见 `outputs/.drafts/ai-tool-subscriptions-research-project.md` 及其列出的仓库文件。
- 本文不是法律、税务或采购报价意见；Enterprise、SLA、数据驻留和生产转售权应以签署的 Order Form/MSA/DPA 为准。
