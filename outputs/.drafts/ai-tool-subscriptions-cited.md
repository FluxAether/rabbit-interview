# 主流 AI 工具订阅与 RabbitInterview 分阶段方案

**研究基准日 / 原始价格访问日：2026-08-31**  
**证据核验状态：**

- **内部已核验：**本文中的价格、额度、政策、公式和外部产品边界，已逐项对照五份研究笔记所摘录的官方 HTML、帮助中心和开发文档；RabbitInterview 项目事实已对照项目研究笔记及相关仓库文件。
- **未实时复核：**本次 citation verification 没有联网抓取能力，因而没有在成稿时重新打开官方 URL。所有外部事实都是 **2026-08-31 的研究快照**，不是对链接当前仍显示相同内容的实时保证。
- **币种口径：**除 RabbitInterview 候选商品外，公开价格均为研究笔记记录的官方美国页面或官方 API 文档所示 **USD 税前标价**。实际结账受地区、币种、VAT/GST、支付渠道、汇率、合同折扣和促销影响。
- **项目价格边界：**RabbitInterview 的 ¥89/¥199 来自当前预生产代码和文档，**不是已上线正式售价，也不是已验证毛利模型**。

## 执行摘要

1. **必须分成三本账。**  
   第一是员工使用的通用助手，第二是开发者使用的 AI 编程席位，第三是 RabbitInterview 面向最终用户调用的 STT/LLM API。OpenAI、Anthropic 和 Perplexity 明确说明助手订阅与开发者 API 分账；Google 和 Microsoft 的部分消费 credits 或已授权 API 权益只适用于指定产品，不能概括为通用后端容量。[OpenAI billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) · [Anthropic billing](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console) · [Perplexity API billing](https://www.perplexity.ai/help-center/en/articles/10354847-api-payment-and-billing)

2. **RabbitInterview 不需要寻找所谓“一个无限订阅”。**  
   与当前实现最一致的方案，是保留 BYOK 和 Apple 本地路径，并为需要开箱即用体验的用户提供 Rabbit Hosted Gateway。Hosted 使用独立生产 API 账户，继续分别计量 `STT_AUDIO_MS` 和 `LLM_TOKEN_UNITS`。这复用现有代码 seam，也避免把上游成本和供应商凭证强制集中到所有用户。

3. **¥89/30 天和 ¥199/90 天目前只能作为封闭试点候选商品。**  
   代码中的配额分别是 15/50 source-hours STT 与 2M/8M LLM units；购买为一次性支付宝支付，无自动续费。虽然已有本地协议 fixture，且 Gemini 曾完成一次真实流式协议 smoke test，但 Volcengine 真实发票舍入、Gemini 取消及断流账单、至少七天对账，以及支付宝沙箱、退款和结算证据仍未完成（`server/src/payments.rs:30-65`；`docs/vendor_contract.md:5-45`；`docs/hosted_gateway_runbook.md:146-178`）。因此不能声称商品已具备生产条件或已验证毛利。

4. **先测量，再承诺。**  
   试点期应保留双配额硬闸和无自动续费，收集 P50/P95 单用户 source-duration、单双音源比例、每次生成的 input/output/reasoning tokens、估算 usage 占比、取消浪费、错误重试、支付退款和供应商发票。只有实际单位成本及目标 cohort 的 P95 毛利稳定后，才讨论自动续费、补充包、年约或预留容量。

5. **低 API 单价不等于低总成本。**  
   语言准确率、实时延迟、标点与专有名词效果、限流、并发、断线恢复、数据地域、保留政策和支持都会改变 TCO。本文成本情景只验证公式和数量级，不宣称不同模型或 STT 服务质量等价。

## 1. 先把市场上的“订阅”分清

| 类别 | 常见计费方式 | 代表例 | 实际买到什么 | 对 RabbitInterview 的含义 |
|---|---|---|---|---|
| 消费级通用助手 | 免费增值；约 $20/月主流个人档；$100–$200/月重度档；动态限额 | ChatGPT Plus $20 / Pro $200；Claude Pro $20 / Max $100/$200；Google AI Pro $19.99；Perplexity Pro $20 / Max $200 | 供个人通过网页、桌面或移动端使用的功能和动态额度 | 可用于个人生产力；订阅本身不能支撑产品后端 |
| 商业/企业助手 | 按席位月付或年付；席位加共享 credits；企业询价 | ChatGPT Business Standard $25 月付或 $20 年付月均；Claude Team Standard $25/$20；M365 Copilot Enterprise $30 年约；Perplexity Enterprise Pro $40/月 | 受管工作区、身份管理、商业数据承诺以及可能的超额池 | 仅在员工确实需要受管助手时采购；与生产 API 分账 |
| AI 编程席位 | 每开发者席位 + 动态 credits/quota + 可选超额 | Copilot Pro $10、Business $19；Cursor Pro $20、Teams $40；Windsurf Pro $20；Claude Code 随相应 Claude 计划 | IDE/CLI 中的补全、agent、审查和组织策略 | 买给获授权开发者；席位本身不构成面向最终用户的后端授权 |
| 开发者 API | 输入/输出 token、音频分钟/小时、字符、工具调用；预付或后付 | OpenAI、Anthropic、Gemini、Groq、Deepgram | 可嵌入应用的程序化调用，并受余额、RPM/TPM、并发和合同约束 | Hosted Gateway 正确的上游采购类别 |
| 预留/企业容量 | 最低期限、最低消费、PTU、Scale Tier、Reserved Capacity | OpenAI Scale Tier、Azure PTU、Google provisioned throughput、Deepgram Growth | 更稳定的吞吐、价格或合同能力，同时承担闲置和锁定风险 | 真实负载稳定 30–90 天前不要购买 |
| 聚合平台代理 | 上游模型费 + 平台费，或 BYOK 超额费 | OpenRouter PAYG 购买 credits 时收取 5.5% 平台费；BYOK 有单独规则 | 统一路由、模型覆盖和账单工具，同时增加一层费用、故障与条款边界 | 只有多模型运维收益被实际数据证明后再考虑 |

OpenRouter 的 5.5% 是研究时官方 Pricing 页列出的 credit 购买平台费，不应错误理解为每次推理再加 5.5%；BYOK 则按其当前 list-price allowance 和超额规则计算。[OpenRouter pricing](https://openrouter.ai/pricing) · [OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok)

**核心边界：**“包含 credits”“5×/20×”“无限补全”“extended agent limits”都不是跨产品货币，也不是固定 token 包。Claude 和 Gemini 有滚动或按计算量窗口；Cursor、Windsurf 未公开可统一换算的固定请求量；GitHub 自 2026-06-01 起以 AI credits 为主，旧 premium requests 只适用于部分 legacy 年度个人计划。[Claude plans](https://support.claude.com/en/articles/11049762-choose-a-claude-plan) · [Gemini limits](https://support.google.com/gemini/answer/16275805?hl=en-gb&ref_topic=13194540) · [GitHub plans](https://docs.github.com/en/copilot/get-started/plans) · [Cursor pricing](https://cursor.com/docs/models-and-pricing) · [Windsurf quotas](https://docs.windsurf.com/windsurf/accounts/quota)

## 2. 通用助手：价格之外如何选择

### 2.1 公开档位快照

下表为研究笔记在 2026-08-31 记录的官方页面快照；本次 verifier 未实时重开价格页。

| 产品 | 个人主流 / 重度档 | 团队或企业公开入口 | 达限与超额边界 | API 是否包含 |
|---|---:|---:|---|---|
| ChatGPT | Plus $20/月；Pro $200/月 | Business Standard $25/月付或 $20/年付月均；Enterprise 询价 | 模型和功能有动态限额；部分计划可购买 ChatGPT flexible-usage credits | 否；ChatGPT 与 API Platform 独立 |
| Claude | Pro $20/月或 $200/年；Max $100/$200/月 | Team Standard $25 月付或 $20 年付月均；公开自助 Enterprise 基价为 $20/席/月并按 API rates 叠加 usage、年付；销售协助和旧合同可能不同 | 五小时滚动窗口及周限额；可按支持情况启用 usage credits | 否；Claude 订阅与 Console/API 独立 |
| Google AI | Pro $19.99/月；Ultra 5× $99.99、20× $199.99/月（研究时美国页） | Workspace 的若干版本包含 Gemini；扩展项和 Enterprise 依版本、地区及合同 | 按计算量、五小时和周上限；部分消费产品可购买 Google One AI credits | 指定消费 credits 或有限 Cloud credits 不等于无限或通用 Gemini API 容量 |
| Microsoft 365 Copilot | Personal/Family/Premium 美国年付 $99.99/$129.99/$199.99 | 完整 M365 Copilot Enterprise $30/用户/月，年约且需符合条件的基础许可证 | 功能 credits、日/月上限和 agent meters 并存 | 特定 licensed Copilot APIs 可能有有限包含范围；Azure OpenAI/Foundry 等仍独立 |
| Perplexity | Pro $20/月；Max $200/月 | Enterprise Pro $40/月或 $400/年；Enterprise Max $325/月或 $3,250/年 | Computer credits 可按规则补充；API credits 单独 | 否；API 无需 Pro，且 API Credits 与 Computer Credits 分开 |

来源：[OpenAI pricing](https://openai.com/chatgpt/pricing/) · [Anthropic pricing](https://www.anthropic.com/pricing) · [Gemini subscriptions](https://gemini.google/subscriptions/) · [Microsoft enterprise pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/enterprise) · [Perplexity pricing](https://www.perplexity.ai/enterprise/pricing)

这些价格只能用于相同地区的粗略比较。Google、Microsoft 等页面会随 locale、登录状态和促销返回不同价格；正式采购必须在目标国家、目标账户和付款渠道核验结账页或 Order Form。

### 2.2 治理比个人席位价格更重要

- 个人方案通常只有用户级 opt-out 或有限管理能力，不应被视为商业工作区的等价替代品。
- OpenAI Business/Enterprise/API、Claude Team/Enterprise、GitHub Copilot Business/Enterprise 等商业路径通常默认不以客户内容训练模型；但 **no training 不等于 zero data retention**。OpenAI API 默认滥用监测日志可能包含提示或响应并保留最多 30 天；Anthropic 的商业标准保留期、ZDR 资格及 covered-model 例外也必须按具体模型和端点核对。[OpenAI business data](https://openai.com/business-data/) · [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) · [Claude Code data use](https://code.claude.com/docs/en/data-usage) · [Anthropic covered models](https://support.claude.com/en/articles/15425996-data-retention-practices-for-covered-models)
- SSO、SCIM、RBAC、审计、DLP/eDiscovery、数据驻留和 SLA 并不会因为产品名含有 Enterprise 就自动全部具备。ChatGPT Business 单独部署不含 SCIM；GitHub Copilot 的标准审计日志不包含本地客户端提示；OpenAI Compliance Platform 在线日志窗口为 30 天，长期历史需要持续拉取。[OpenAI SCIM](https://help.openai.com/en/articles/10011769-scim-integration-faq) · [OpenAI Compliance](https://help.openai.com/en/articles/9261474) · [GitHub audit](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/review-audit-logs)
- 数据驻留通常只覆盖定义范围内的客户内容，并可能排除账户、账单、路由、系统元数据、连接器或部分 CPU 处理。已核验的特定例子包括 OpenAI 合格 API 区域处理约 10% uplift、Anthropic 某些 US-only inference 1.1×、GitHub Copilot data-residency 请求 10% credit multiplier；不能把这一数字推广到所有产品。[OpenAI residency](https://help.openai.com/en/articles/9903489-data-residency-for-chatgpt) · [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data) · [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [GitHub residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/github-copilot-with-data-residency)
- 普通 PAYG 或企业营销语句不自动构成固定 uptime SLA。比如 OpenAI 公开的 99.9% uptime 与延迟 SLA 证据适用于 Scale Tier，并要求至少购买 30 天 token units；不能反推到普通 PAYG。[OpenAI Scale Tier](https://openai.com/api-scale-tier/)

**RabbitInterview 内部建议：**早期只采购实际使用的少量个人开发或研究席位。一旦员工需要输入真实候选人简历、面试内容、客户代码或组织文档，应使用带 DPA、受管身份、默认不训练和可验证保留政策的商业工作区。企业需求尚未出现时，不提前购买完整 Enterprise 控制面。

## 3. AI 编程工具：按工作流选，不按“无限”选

| 工具 | 研究快照公开价格（税前 USD） | 当前额度口径 | 团队治理 | 主要误读与边界 |
|---|---:|---|---|---|
| GitHub Copilot | Pro $10；Pro+ $39；Max $100；Business $19/席；Enterprise $39/席/月 | 个人 1,500/7,000/20,000 AI credits；组织常态 1,900/3,900 credits/席进入共享池；1 credit=$0.01，模型按 token 价格消耗 | Business/Enterprise 有集中许可和策略；商业数据不用于训练 | 2026-09-01 前旧组织客户 3,000/7,000 是促销值，不应进入稳态预算；代码审查还可能消耗 Actions minutes |
| Cursor | Pro $20；Pro Plus $60；Ultra $200；Teams $40；Teams Premium $120/用户/月 | Tab completion 无限；agent 使用池没有公开固定 token 数；Teams Premium 为 Standard 的 5× agent 用量 | Teams 有集中管理、Privacy Mode、SAML/OIDC；Enterprise 增加 SCIM 等能力 | Teams 第三方模型超额为 API list price 加 $0.25/1M Cursor Tokens；普通 Teams 用户池不可互转，Enterprise 另议 |
| Windsurf | Pro $20；Max $200；Teams 为 $80/月团队基础费加 $40/full seat/月 | 2026 年采用每日加每周 quota；新 Enterprise 使用 ACU，旧 credits 不能直接换算 | 新 Teams 不含 SSO；SSO 位于 Enterprise，旧 add-on 可能例外 | quota、ACU 和 legacy credits 三套口径并存；MSA 的公开授权为内部业务使用、不可转许可 |
| Claude Code | Claude Pro $20；Max $100/$200；Team Standard/Premium 月付 $25/$125，年付月均 $20/$100 | 与 Claude 共用五小时和周额度；可显式启用 usage credits 或 API 继续 | Team/Enterprise 有集中管理；企业合同代际不同 | `ANTHROPIC_API_KEY` 会绕过订阅并产生独立 API 费；倍数不是固定 token 包 |
| Gemini Code Assist | Standard $22.80 月付或 $19 年约月均；Enterprise $54/$45 | Agent/CLI 合并为 1,500/2,000 requests/用户/日；一个 prompt 可能触发多次请求 | Standard 已包含基础企业安全；Enterprise 增加私有代码定制，至少购买 10 席 | 不能把 requests 直接与 GitHub credits 比；CLI API-key 路径另走 Gemini API PAYG |

来源：[GitHub plans](https://docs.github.com/en/copilot/get-started/plans) · [GitHub models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) · [Cursor models and pricing](https://cursor.com/docs/models-and-pricing) · [Cursor team pricing](https://cursor.com/docs/account/teams/pricing) · [Windsurf usage](https://docs.windsurf.com/windsurf/accounts/usage) · [Windsurf MSA](https://windsurf.com/MSA) · [Claude Code costs](https://docs.anthropic.com/en/docs/claude-code/costs) · [Gemini Code Assist quotas](https://developers.google.com/gemini-code-assist/resources/quotas)

**项目建议：**

- 默认先使用一款最贴近现有 Git/GitHub 工作流、管理负担最低的工具，不同时订三款作为“保险”。
- 若团队主要在 GitHub 且需求集中于补全和审查，Copilot Business 的共享池和公开 credit 公式较容易预算；这不代表其 agent 质量必然优于其他工具。
- 只有真实 2–4 周试验显示重度 agent 工作流能显著节省时间，才比较 Cursor、Claude Code 或 Windsurf 的升级方案。
- 迁移或升级触发条件应是每开发者节省时间、建议接受率、PR 周期、失败率和超额账单，而不是宣传中的“×倍”。
- 上述任一开发席位都不得被当作 RabbitInterview 生产调用容量。除非另有明确 API 和嵌入授权合同，公开席位证据不足以支持向最终用户代理或转售。

## 4. API 计费与可复算成本

### 4.1 代表性单位价格快照

以下 SKU 和价格均是研究笔记在 2026-08-31 从官方页面记录的单源时间点快照；本次没有实时重开链接。

| API / SKU | 用途 | 研究快照官方标价 | 关键边界 |
|---|---|---:|---|
| Gemini 3.5 Flash Standard | 文本/多模态 | 至 2026-12-31：输入 $0.75、输出 $3.75、cached input $0.075 / 1M tokens；2027-01-01 起 $1.50/$7.50/$0.15 | 有明确截止日的促销价；显式缓存另计 token-hour storage |
| Gemini 2.5 Flash | 文本/多模态 | text/image/video 输入 $0.30，audio 输入 $1.00，输出 $2.50 / 1M tokens | 与项目默认 `gemini-3.7-flash` 不同，不能当作 Hosted 实际账单 |
| OpenAI `gpt-5.6-luna` | 文本生成 | 输入 $0.20、cached input $0.02、输出 $1.20 / 1M tokens | 只用于价格公式示例，不表示质量等价或项目采用 |
| Anthropic Claude Sonnet 5 | 文本生成 | 输入 $2、5 分钟 cache write $2.50、cache hit $0.20、输出 $10 / 1M tokens | cache write/read 与普通输入必须分开 |
| Groq GPT OSS 120B | 文本生成 | 输入 $0.15、输出 $0.60 / 1M tokens | 价格低不表示与 Hosted Gemini 质量或功能相同 |
| Groq Whisper V3 Turbo | STT | $0.04/audio hour | 每请求最低计费 10 秒；短片段会显著抬高有效价格 |
| Deepgram Nova-3 Monolingual streaming | 实时 STT | 促销 $0.0048/min；regular $0.0077/min | 促销页未给结束日；上线预算应使用 regular 或双情景 |
| Deepgram Nova-3 Monolingual pre-recorded | 离线 STT | $0.0043/min | 离线价格不能直接替代实时体验 |

来源：[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) · [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) · [Groq models](https://console.groq.com/docs/models) · [Groq speech](https://console.groq.com/docs/speech-to-text) · [Deepgram pricing](https://deepgram.com/pricing)

### 4.2 通用公式

缓存 token 通常是输入 token 的一个分类，不能与包含它的总输入重复相加。应使用分离后的字段：

```text
文本成本 =
    uncached_input_tokens / 1,000,000 × input_rate
  + cached_input_tokens   / 1,000,000 × cache_rate
  + output_tokens         / 1,000,000 × output_rate

语音成本 = billable_minutes × rate_per_minute

Groq 短片段计费秒数 =
  Σ max(每个请求的实际音频秒数, 10)
```

Anthropic cache write、Gemini 显式缓存存储、reasoning/thinking tokens、工具调用、地域乘数、Batch/Flex/Priority、失败重试和取消后仍被上游计费的部分需要单列。

供应商余额或 spend cap 不能被视为绝对实时的零超支硬闸：OpenAI 预付和 spend-limit 执行可能有传播延迟，Gemini 的计费管线约有分钟级延迟，Groq spend tracking 也可能延迟。[OpenAI prepaid billing](https://help.openai.com/en/articles/8264644-what-is-prepaid-billing) · [OpenAI spend limits](https://developers.openai.com/api/docs/guides/spend-limits) · [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) · [Groq spend limits](https://console.groq.com/docs/spend-limits)

### 4.3 RabbitInterview 低 / 中 / 高规划情景

下列数字是**规划情景，不是流量预测、报价或毛利模型**：

- 每场墙钟时间 60 分钟。
- 麦克风和 system audio 分别计量；若两路均完整 accepted，按 120 billable source-minutes。项目冻结规则见 `docs/vendor_contract.md:7-13`。
- 每场触发 15 次回答；每次假设 8,000 input + 1,000 output tokens。
- 不计算缓存、reasoning、失败重试、取消浪费或 tokenizer 差异。
- 低、中、高分别为 10、100、1,000 场/月。
- STT 只用 Deepgram Nova-3 Monolingual streaming 公价展示量级；项目 Hosted 实际使用 Volcengine，因此不能由此推导 Hosted COGS。
- LLM 只用 Gemini 3.5 Flash 公价展示；项目代码默认 `gemini-3.7-flash`，且实际合同和账单没有核验，所以只是代理情景。

| 情景 | 场次/月 | 双音源 STT | LLM tokens | Deepgram streaming 促销 / regular | Gemini 3.5 Flash 2026 促销 / 2027 已公告价 | 两项代理合计：促销组合 / 保守组合 |
|---|---:|---:|---:|---:|---:|---:|
| 低 | 10 | 1,200 min（20 source-h） | 1.35M（1.2M input + 0.15M output） | $5.76 / $9.24 | $1.4625 / $2.925 | $7.2225 / $12.165 |
| 中 | 100 | 12,000 min（200 source-h） | 13.5M（12M input + 1.5M output） | $57.60 / $92.40 | $14.625 / $29.25 | $72.225 / $121.65 |
| 高 | 1,000 | 120,000 min（2,000 source-h） | 135M（120M input + 15M output） | $576 / $924 | $146.25 / $292.50 | $722.25 / $1,216.50 |

中情景复算：

```text
STT 促销 = 12,000 × $0.0048 = $57.60
STT regular = 12,000 × $0.0077 = $92.40

LLM 2026 =
  12 × $0.75 + 1.5 × $3.75
  = $9.00 + $5.625
  = $14.625

LLM 2027 =
  12 × $1.50 + 1.5 × $7.50
  = $18.00 + $11.25
  = $29.25
```

“保守组合”只是将 Deepgram regular 与 Gemini 已公告的 2027 价格组合，并不表示二者一定在同一合同周期同时适用。全部情景均未计税、汇率、网关与监控、支付渠道、退款、并发容量、错误重试、缓存、reasoning tokens、真实 Hosted SKU 差异和人工支持。

### 4.4 语音供应商的表面价陷阱

同样按 100 小时连续长音频、即 6,000 分钟复算：

- OpenAI `gpt-transcribe`：`6,000 × $0.0045 = $27.00`
- Gemini Transcribe 官方混合估算：`6,000 × $0.005 ≈ $30.00`
- Groq Whisper V3 Turbo：`100 × $0.04 = $4.00`
- Deepgram Nova-3 Monolingual streaming：促销 `6,000 × $0.0048 = $28.80`；regular `6,000 × $0.0077 = $46.20`
- Deepgram Nova-3 Monolingual pre-recorded：`6,000 × $0.0043 = $25.80`

来源：[OpenAI pricing](https://developers.openai.com/api/docs/pricing) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Groq speech](https://console.groq.com/docs/speech-to-text) · [Deepgram pricing](https://deepgram.com/pricing)

这些不是等质量、等语言能力、等实时性或等 SLA 的基准。Groq 的 $4 仅适用于没有大量短片段最低计费损失的情形；若音频拆成许多不足 10 秒的请求，必须逐请求按 10 秒重算。

## 5. RabbitInterview 当前方案的量化审视

### 5.1 当前预生产候选商品

`server/src/payments.rs:30-65` 和 `docs/vendor_contract.md:7-18` 定义：

| 候选商品 | 一次性价格 / 期限 | STT 配额 | LLM 配额 | 套餐内含比率 |
|---|---:|---:|---:|---:|
| `PRO_MONTH` | ¥89 / 30 天 | 900 source-min = 15 source-h | 2M units | ¥5.93 / source-h；¥44.50 / 1M units |
| `PRO_QUARTER` | ¥199 / 90 天 | 3,000 source-min = 50 source-h | 8M units | ¥3.98 / source-h；¥24.88 / 1M units；¥66.33/月等效 |

这些“内含比率”只是分别用同一商品价格除以每个配额桶，不是供应商成本，也不能把 STT 和 LLM 两个比率相加来推导收入分配或毛利。

复算：

```text
¥89 / 15 h = ¥5.9333 / source-h
¥199 / 50 h = ¥3.98 / source-h

¥89 / 2M = ¥44.50 / 1M units
¥199 / 8M = ¥24.875 / 1M units

¥199 / 3 months = ¥66.33 / month equivalent
```

在“双音源分别按 accepted source duration 计量”的冻结规则下，一场 60 分钟、两路都完整 accepted 的面试消耗 120 source-minutes，即 2 source-hours：

- 月包 STT 额度等价于 7.5 场这种双音源 60 分钟面试；
- 季包等价于 25 场；
- 若只有一路完整音源，则分别等价于 15 场和 50 场。

这是理论配额换算，不是可用场次保证；断线、accepted duration、面试长度、配额到期和未使用余额都会改变结果。

### 5.2 季包折扣不对称

相对月包：

```text
价格倍数 = 199 / 89 = 2.236×

STT 配额倍数 = 50 / 15 = 3.333×
LLM 配额倍数 = 8 / 2 = 4×

STT 名义单位比率折扣
= 1 - (199/50) / (89/15)
≈ 32.9%

LLM 名义单位比率折扣
= 1 - (199/8) / (89/2)
≈ 44.1%
```

这可能是刻意的季付激励，也可能让高用量用户造成 margin compression。仓库没有真实账单证据足以判断哪一种，因此必须用使用分布和供应商发票验证。

### 5.3 LLM units 不能直接等同于某一种公开 token 成本

当前网关在 provider usage 存在时，按 `max(total_tokens, input + output + reasoning)` 结算；usage 缺失时，用输入估算值和输出字符估算 token，并标为 `ESTIMATED`（`server/src/llm.rs:250-310`）。

因此，2M/8M units 不能直接乘某个公开 input 或 output 单价：

- input/output/reasoning 价格结构不同；
- `total_tokens` 与分项口径可能随 provider 定义变化；
- 取消、断流时会发生估算；
- 项目默认模型与本文公开代理 SKU 不同。

若纯粹采用本文示例的每次 8,000 input + 1,000 output、忽略 reasoning：

```text
2,000,000 / 9,000 ≈ 222 次
8,000,000 / 9,000 ≈ 888 次
```

这只是数量级换算，不是产品保证。

### 5.4 已有能力与尚未关闭的门

内部仓库证据表明：

- 默认访问模式仍为 BYOK，默认 STT 为 Deepgram（`src/lib/settingsStore.ts:42-56,85-106`）。
- Hosted LLM 固定走服务端 Gemini，Hosted STT 固定走 Volcengine BigModel；默认模型配置字符串为 `gemini-3.7-flash`（`server/src/config.rs:22-46,91-120`）。
- Entitlement 分别暴露 `STT_AUDIO_MS` 和 `LLM_TOKEN_UNITS`，并在余额不足时阻止对应功能（`src/lib/hostedAuth.ts:12-22`；`src/lib/readiness.ts:98-125`）。
- 网关不持久化音频、转写、prompt、简历或回答，但会保存账户、配额、支付、订阅、安全和计量元数据（`docs/PRIVACY.md:5-35`）。这只描述 Rabbit Gateway，不代表 Volcengine 或 Gemini 为零保留。
- Gemini 协议已有一次真实流式 smoke test和本地 SSE fixtures，但取消后 usage、断流及账单对账仍未验证（`docs/vendor_contract.md:19-39`）。
- Volcengine 真实凭证下的 TLS/auth、短/长/静音音频、断线和发票舍入仍未验证。
- 支付仅有本地 RSA2 和数据库 fixture 证据；支付宝沙箱、公开 webhook、退款和结算尚未完成。
- `PAYMENTS_ENABLED=false` 必须保持到生产门关闭（`docs/vendor_contract.md:41-45`）。

**结论：**双配额是当前最小且可解释的控制面。现在不应改成模糊统一 credits 或“无限”套餐。先观察哪一桶在 P50/P95 用户中先耗尽，再决定调配额、调价或增加单独补充包。

## 6. 推荐方案：分阶段而不是一次性押注

### 阶段 A：个人开发与内部验证

- 保留默认 BYOK 和 Apple 路径；这表示无需购买 Rabbit Hosted 商品，不表示第三方 BYOK API 本身免费。
- 员工助手和编码工具各最多选择一个主要席位，从满足工作流的最低档开始。
- 只有连续 2–4 周数据证明 agent 使用量或治理需求不足时才升级。
- 不购买 API 预留容量，不增加聚合平台代理，不构建复杂多供应商自动路由。
- 向 BYOK 用户明确说明：需要供应商的 **API key/账户**；ChatGPT Plus、Claude Pro 或其他网页助手订阅一般不能替代开发者 API。
- 客户端长期 key 必须继续走现有 secure-storage 路径，不能进入日志或仓库。

**进入阶段 B 的门：**

1. Volcengine 真实 TLS/auth、短/长/静音音频和断线测试通过；
2. Gemini final/estimated usage、取消和断流账单可以对账；
3. 支付宝沙箱、签名、回调、重复通知、退款和结算证据完整；
4. 内部与供应商计量差异阈值获得批准；
5. production flags 仍由明确审批开启。

### 阶段 B：封闭 Hosted 付费试点

- 将 ¥89/30 天和 ¥199/90 天仅作为**试点候选商品**，不宣传为已验证正式价。
- 继续一次性支付、无自动续费。
- 保留 STT/LLM 两个 quota bucket、预占—结算、幂等与硬闸。
- 上游账户另设日/月 spend alerts 和预算缓冲，以覆盖计量传播延迟。
- 至少运行七天对账；若要验证完整到期、续期和未使用余额行为，最好覆盖一个完整商品周期。
- 对账至少包括：
  - 内部 accepted source duration 对 Volcengine invoice；
  - Gemini input/output/reasoning/total 对 provider bill；
  - `FINAL` 与 `ESTIMATED` 分开；
  - 取消、断流和重试单列。
- 运营看板至少记录：
  - 每场 source-minutes 和单双音源；
  - 回答次数；
  - input/output/reasoning tokens；
  - usage 估算比例；
  - STT/LLM 哪一桶先耗尽；
  - P50/P95 单用户成本；
  - 支付成功、失败和退款；
  - 供应商 4xx/5xx、限流与连接中断。
- 隐私文案必须保持精确：Hosted 内容经过 Rabbit Gateway 转发给上游；“Rabbit 网关不持久化内容”不等于上游零保留。生产前应冻结具体端点、合同、处理地域和子处理者。

**调价门：**在税、汇率、支付、退款、重试、运维和支持成本计入后，目标 P95 cohort 仍达到内部目标毛利；否则调整配额或售价，不用平均用户补贴尾部重度用户。

### 阶段 C：公开发布与增长

- 只有支付和供应商 production gates 全部关闭后，才把试点候选商品转为正式商品。
- 决定自动续费前，先完成取消、退款、发票、到期提醒及适用消费者法流程评审。
- 若用户经常只耗尽一个配额桶，优先提供单独 STT 或 LLM 补充包，而不是统一 credits。
- 只有在模型价格、两桶换算和价格版本控制稳定后，才考虑统一 credits。
- 当月负载稳定至少 30–90 天，且承诺折扣明确高于闲置、迁移和锁定成本时，再询价 Reserved Capacity、provisioned throughput 或 Growth 合同。
- 多供应商容灾先保留薄适配层、供应商中立提示、评测集和可导出 usage；只有实际 RTO、供应商故障或模型覆盖要求证明有必要，才增加自动路由。
- 企业客户真实出现后，再增加 DPA、SSO/SCIM、审计导出、保留/驻留选项和 SLA，不把消费级隐私设置包装成企业承诺。

## 7. 采购与上线决策矩阵

| 维度 | 最低可接受证据 | RabbitInterview 当前状态 | 决策 |
|---|---|---|---|
| 授权边界 | 官方 API 或合同明确允许应用嵌入；席位与 API 分账 | BYOK/Hosted 均走 API 路径 | **架构原则通过**；禁止以助手或编码席位代替生产 API |
| 成本可复算 | 已确认 SKU、输入/输出/音频单位、促销截止、税汇假设和真实 usage | 外部代理公式已建立；Hosted 实际 Volcengine/Gemini 账单未对齐 | **未通过正式定价** |
| 配额与滥用 | 独立硬闸、幂等、预占/结算和预算延迟缓冲 | 已有 STT/LLM buckets 及 reservation/settlement | **适合封闭试点**；仍需真实账单 |
| 数据治理 | DPA、训练默认值、内容/应用状态/安全日志/系统元数据保留、地域和删除流程 | Rabbit 文档说明网关不持久化内容；上游端点政策仍需冻结 | **部分通过** |
| 支付 | 沙箱、签名、幂等、退款、对账和消费者取消流程 | 本地 fixture 有证据；支付宝沙箱、退款和结算未完成 | **阻止生产** |
| 可靠性 | 限流、并发、断线、取消、重试和 SLA/支持边界 | fixture 和一次 smoke test 不能代替完整供应商及账单证据 | **阻止 SLA 承诺** |
| 锁定与退出 | 提示与 usage 导出、薄适配层、模型退役流程和承诺回收期 | BYOK + Hosted seam 已降低部分锁定 | **保持简单**；当前无需聚合平台 |

## 8. 主要风险与上线前问题

1. **价格时效：**Gemini 3.5 Flash 的研究快照列出 2027-01-01 调价；Deepgram streaming 促销无结束日。发布或签约前必须重新抓取价页，并记录价格版本。
2. **Hosted SKU 不匹配：**项目默认 `gemini-3.7-flash`，STT 为 Volcengine；本文代理情景使用 Gemini 3.5 Flash 和 Deepgram，不能作为真实 COGS。
3. **语音成本未知：**双音源按 accepted source duration 相加；45 分钟墙钟的完整双音源可能接近 90 source-minutes，但断线、丢帧和供应商舍入仍需真实发票验证。
4. **LLM 取消和估算：**流断开或 provider usage 缺失时会使用估算 units；厂商仍可能对已产生的 token 计费。必须分别追踪 `FINAL`、`ESTIMATED` 和取消后账单。
5. **质量与容量未基准：**最低价模型可能在中英混合、专有名词、实时延迟或并发上更差。需用同一匿名测试集比较任务成功率、适用的 WER 指标、P50/P95 latency、错误率和成本。
6. **税务和支付：**公开 USD 税前价不包含特定采购实体的税、汇率、跨境支付、支付宝费率和退款成本。不能把 CNY 售价直接减去 USD API 标价后称为毛利。
7. **合同和隐私：**no-training、ZDR、驻留和 SLA 必须落到具体产品、模型、端点、地区和合同。连接器、Web Search、日志、应用状态和系统元数据可能不在同一承诺范围。
8. **员工工具重复采购：**ChatGPT、Claude、Gemini、Copilot、Cursor 等多席位并购容易形成闲置。应按月试验并按季度用接受率、节省时间和实际使用裁撤，而不是以“模型覆盖”为永久叠加理由。

## 最终建议

采用：

> **BYOK / Apple 无 Rabbit Hosted 收费入口 + Rabbit Hosted 按量采购上游 API + 固定周期、分离 STT/LLM 配额的候选商品。Hosted 在生产门关闭前仅限封闭试点。**

执行顺序：

1. 维持 BYOK 默认，明确助手订阅不等于通用 API；
2. Hosted 上游只使用有应用嵌入授权的 API 账户，继续 STT/LLM 分账与硬闸；
3. 以 ¥89/¥199 做受控试点，而不是正式价格承诺；
4. 完成 Volcengine、Gemini 和支付宝真实对账；
5. 用 P50/P95 单用户 COGS 及先耗尽桶决定配额、售价和补充包；
6. 负载稳定 30–90 天后才评估年约、预留容量、自动续费或自动多供应商路由；
7. 企业需求真实出现时再补 DPA、SSO/SCIM、审计、驻留和 SLA。

该路径不需要引入新的统一计费抽象，也不要求替换现有 BYOK/Hosted seam；它把不可逆的合同和产品承诺推迟到有真实数据时，同时保留必要的凭证安全、配额、支付和隐私闸门。

## 来源方法与限制

- 外部证据只采用研究笔记中记录的供应商官方 HTML、帮助中心和开发文档；没有使用第三方价格比较站作为核心证据。
- 本次 verifier 对研究产物做了内部交叉核验，但**没有实时联网复核官方 URL**。
- 没有抓取或解析 PDF。研究过程中遇到的 Anthropic List Prices PDF、Windsurf MSA PDF、GitHub 产品条款 PDF 等均被拒绝；可用结论改由官方 HTML 支撑。
- 五份支持研究笔记：
  - `outputs/.drafts/ai-tool-subscriptions-research-assistants.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-coding.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-api.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-governance.md`
  - `outputs/.drafts/ai-tool-subscriptions-research-project.md`
- 本文不是法律、税务或正式采购报价意见。Enterprise、SLA、数据驻留、嵌入和生产转售权最终应以目标采购实体签署的 Order Form、MSA 和 DPA 为准。
