# Provenance: 主流 AI 工具订阅与 RabbitInterview 分阶段方案

- **Date / evidence cutoff:** 2026-08-31
- **Slug:** `ai-tool-subscriptions`
- **Plan:** `outputs/.plans/ai-tool-subscriptions.md`
- **Final:** `outputs/ai-tool-subscriptions.md`
- **Verification:** **PASS WITH NOTES**

## Artifacts

### Research

- `outputs/.drafts/ai-tool-subscriptions-research-assistants.md` — 通用助手个人/团队/企业订阅及 API 边界。
- `outputs/.drafts/ai-tool-subscriptions-research-coding.md` — Copilot、Cursor、Windsurf、Claude Code、Gemini Code Assist 席位与计量。
- `outputs/.drafts/ai-tool-subscriptions-research-api.md` — 模型/STT API 单价、付款方式、限流、公式与复算示例。
- `outputs/.drafts/ai-tool-subscriptions-research-governance.md` — 训练、保留、身份、审计、驻留、SLA、合同与锁定。
- `outputs/.drafts/ai-tool-subscriptions-research-project.md` — RabbitInterview BYOK/Hosted、计量、支付和生产门的本地证据。

### Synthesis and review

- `outputs/.drafts/ai-tool-subscriptions-draft.md` — Lead 原始综合稿。
- `outputs/.drafts/ai-tool-subscriptions-cited.md` — verifier 纠正后的引用稿。
- `outputs/.drafts/ai-tool-subscriptions-citation-verification.md` — 引用映射、计算检查及 `PASS WITH NOTES` 记录。
- `outputs/.drafts/ai-tool-subscriptions-verification.md` — reviewer 对抗性审阅、初始 `BLOCK` 及 Lead remediation record。
- `outputs/.drafts/ai-tool-subscriptions-revised.md` — 修复后终稿候选，已复制为 final。

## Method

1. 用户于 2026-08-31 明确批准计划。
2. 四个 `researcher` 分别完成助手、编码工具、API、治理证据线；Lead 独立检查仓库项目事实。
3. Lead 统一席位/API/Hosted 三本账，构造明确假设、单位和公式的低/中/高规划情景。
4. Citation verifier 对草稿、五份研究笔记和关键仓库文件交叉核验，修正缓存输入公式、API 权益边界、BYOK“免费”措辞、代理 SKU/实际 Hosted SKU 混淆等问题，结论为 `PASS WITH NOTES`。
5. 在 cited 文件确认落盘后，reviewer 做对抗性审阅：无 FATAL，初始发现 3 MAJOR + 3 MINOR，因此 `BLOCK`。
6. Lead 修复全部发现，并用定向 `rg`、`wc`、`stat`、`cmp` 和定向读取验证磁盘内容。

## Key remediation

| Finding | Resolution |
|---|---|
| MAJOR-01 — 精确价格直接引用不完整，来源口径过强 | 补 Microsoft individual、Perplexity organization/Enterprise Max、Windsurf Pricing、Claude plans/Team、Gemini Code Assist pricing；明示少数地区价仅由官方搜索索引交叉核验。 |
| MAJOR-02 — DPA 被含混推迟到企业阶段 | 把适用上游 DPA/数据处理、子处理者、保留、地域和隐私评审移到进入阶段 B 之前；阶段 C 只增加面向企业客户的合同与治理能力。 |
| MAJOR-03 — “P95 毛利”看错分布尾部 | 改为目标 cohort 的 P95 单用户全量 COGS 及其对应毛利，并要求预先约定样本窗口和最低样本量。 |
| MINOR-01 — 8M/9k 近似 | 改为约 889 次。 |
| MINOR-02 — 生产 API 账户措辞 | 改为正式 Hosted 应使用隔离生产账户，同时明确当前真实凭证、合同和账单验证未完成。 |
| MINOR-03 — 90 天等效口径 | 改为 `¥199 × 30 / 90 days = ¥66.33 / 30-day equivalent`。 |

## Source policy

- 核心证据仅使用供应商官方 HTML、Help、Docs、官方搜索索引和本地仓库文件；未使用第三方价格比较站支撑关键断言。
- **未抓取或解析 PDF。** Anthropic List Prices PDF、Windsurf MSA PDF、GitHub 产品条款 PDF 等均被拒绝；保留结论由官方 HTML 支撑。
- 价格和政策是 2026-08-31 的时间点快照。部分 Google 美国地区价或受访问限制页面仅由官方搜索索引交叉核验，已在终稿标记。
- Verifier/reviewer 阶段没有实时重新打开所有官方 URL；正式采购或发布前必须按目标国家、账户、付款渠道与合同重新核验。

## Calculation verification

已复算并通过：

- 每场 15 次 × (8,000 input + 1,000 output) = 135,000 tokens。
- 10/100/1,000 场的 STT source-minutes、LLM tokens、Deepgram/Gemini 代理成本及合计。
- 100 小时语音示例：OpenAI、Gemini、Groq、Deepgram。
- ¥89/¥199 的 source-hour 和 1M-unit 内含比率、每 30 天等效。
- 季包相对月包的价格/配额倍数及约 32.9%/44.1% 名义单位折扣。
- 60 分钟双音源理论场数与 2M/8M units 对 9k-token 示例的数量级。

这些计算使用 Deepgram/Gemini 公开 SKU 作**代理情景**；Rabbit Hosted 实际是 Volcengine + 默认 `gemini-3.7-flash`，因此不得把它们当作 Hosted COGS 或毛利证据。

## Verification status

**PASS WITH NOTES**

报告本身可发布；以下生产检查仍未完成，并阻止把 Hosted 或 ¥89/¥199 描述为生产就绪：

- Volcengine 真实 TLS/auth、音频/断线行为、请求 ID、错误映射及发票舍入。
- Gemini 取消、断流、`FINAL/ESTIMATED` usage 与真实账单对账。
- 至少 7 天内部计量对供应商账单核对；真实 P95 COGS/低尾毛利和质量/延迟基准。
- 支付宝沙箱、公开 webhook、重复通知、退款、商户/回调域名与结算对账。
- 最终端点/合同的 DPA、保留、处理地域、子处理者、SLA、税务和目标采购实体条款。

## Process notes

- `memory_remember` 不在可见工具集中；计划与 decision log 仅落盘。
- 四个 research lanes 曾出现无活动提示，状态检查与 steer 后全部成功完成。
- Reviewer 的原始 `BLOCK` 保留在 verification 文件中，修复记录附于其末尾，避免覆盖审计轨迹。
- 当前工作树包含用户已有的大量未提交改动；本研究仅写入 `outputs/.plans/` 与 `outputs/.drafts/` 及两个最终输出文件，未回滚或覆盖其他用户文件。
