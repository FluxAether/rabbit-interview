# Deep Research Plan: 主流 AI 工具订阅方式与 RabbitInterview 选型

- **Slug:** `ai-tool-subscriptions`
- **Date:** 2026-08-31
- **Status:** Awaiting user approval; no evidence gathering has started.
- **Planned deliverables:**
  - `outputs/.drafts/ai-tool-subscriptions-draft.md`
  - `outputs/.drafts/ai-tool-subscriptions-cited.md`
  - `outputs/ai-tool-subscriptions.md`
  - `outputs/ai-tool-subscriptions.provenance.md`

## Key questions

1. 截至研究日，主流 AI 工具采用哪些订阅/计费模式：免费增值、个人月付/年付、团队席位、企业合同、按量 API、预付额度、用量封顶/超额计费、按功能或模型分层，以及云平台/聚合平台代理？
2. 代表性产品的官方计划、价格、额度、超限策略、API 是否另计、取消/退款及地区差异是什么？
3. 各模式在总拥有成本、用量可预测性、性能/模型覆盖、并发与限流、数据治理、供应商锁定、团队管理和扩展性上如何交叉比较？
4. “员工使用的 AI 席位订阅”与“产品内嵌模型所需的 API/平台计费”有什么边界，哪些消费级订阅明确不能作为生产应用后端？
5. RabbitInterview 当前实际使用了哪些 AI 集成、调用路径、密钥/用户授权方式和成本控制点？
6. 针对个人开发、早期小规模发布和增长后三个阶段，最合适的组合方案、迁移触发条件和风险控制是什么？

## Evidence needed

- 各厂商官方定价页、套餐说明、额度/公平使用政策、API 价格页、限流与服务条款；以可访问的 HTML/官方文档为主。
- 代表性范围（研究中按相关性收敛）：ChatGPT/OpenAI API、Claude/Anthropic API、Gemini/Google AI、Microsoft/GitHub Copilot、Perplexity，以及 Cursor/Windsurf 等主流 AI 开发工具；必要时加入模型聚合平台或开源自托管作为对照，不把营销知名度等同于项目适配度。
- RabbitInterview 仓库中的依赖、配置、模型调用、认证、状态管理及相关文档；不读取或记录任何真实密钥。
- 可复算的成本情景：低/中/高调用量，明确输入假设、计价单位、税费/汇率/地区价格缺口；不虚构真实业务用量。
- 关键结论至少由官方一手来源支撑；无法验证、已失效、仅有二手报道或地区不明的来源进入拒绝清单。

## Scale decision

**Decision: broad, multi-faceted survey — use 4 researcher subagents after approval.**

理由：本题同时跨越消费级订阅、团队/企业席位、开发者 API 计费、数据治理与项目内实际架构，且要求多元交叉比较和落地方案；预计明显超过 10 次检索/抓取。四条证据线可独立并行，主代理随后统一口径、复算成本并亲自综合。不会委派最终建议或报告写作。

## Task ledger

| ID | Owner | Task | Expected artifact | Status |
|---|---|---|---|---|
| T0 | Lead | 审批后检查仓库中的现有 AI 集成、调用与配置边界 | `outputs/.drafts/ai-tool-subscriptions-research-project.md` | Complete |
| T1 | Researcher 1 | 调研通用 AI 助手的个人/团队/企业订阅及 API 是否分离 | `outputs/.drafts/ai-tool-subscriptions-research-assistants.md` | Complete |
| T2 | Researcher 2 | 调研 AI 编程工具的席位、额度、超额与团队计划 | `outputs/.drafts/ai-tool-subscriptions-research-coding.md` | Complete |
| T3 | Researcher 3 | 调研模型 API、云平台/聚合平台的按量、预付、批处理与承诺用量模式 | `outputs/.drafts/ai-tool-subscriptions-research-api.md` | Complete |
| T4 | Researcher 4 | 调研隐私、数据使用、SLA、管理能力、地区/年度计费及订阅边界 | `outputs/.drafts/ai-tool-subscriptions-research-governance.md` | Complete |
| T5 | Lead | 汇总并复核统一比较维度，建立可复算成本情景 | `outputs/.drafts/ai-tool-subscriptions-draft.md` | In progress |
| T6 | Verifier | 为完整草稿逐项补充并验证引用 | `outputs/.drafts/ai-tool-subscriptions-cited.md` | Pending T5 |
| T7 | Reviewer | 检查不受支持的断言、逻辑缺口、单一来源关键结论和过度自信 | `outputs/.drafts/ai-tool-subscriptions-verification.md` | Pending T6 |
| T8 | Lead | 修复致命问题、核验磁盘文件并交付报告与 provenance | `outputs/ai-tool-subscriptions.md`; `.provenance.md` | Pending T7 |

## Verification log

| Check | Result | Notes |
|---|---|---|
| Plan written before evidence gathering | PASS | 本文件已创建；尚未搜索、抓取、派发研究或起草报告。 |
| Scale chosen before owner assignment | PASS | Scale decision 位于 task ledger 之前。 |
| Required artifact paths reserved | PASS | 计划、草稿、引用稿、最终稿及 provenance 路径已定义。 |
| Plan persisted via `memory_remember` | NOT AVAILABLE | 当前可见工具集中无 `memory_remember`，按降级规则继续。 |
| User approval | PASS | 用户于 2026-08-31 回复 “YEs”。 |
| Research wave | PASS WITH NOTES | 4 个 researcher 均完成；期间出现无活动提示，检查状态后引导其停止扩搜并完成报告。 |
| Research artifacts copied on disk | PASS | 4 个外部研究文件已从 managed artifacts 复制到规定路径，并另写项目证据笔记。 |
| PDF parsing restriction | PASS | 未抓取或解析 PDF；治理研究将一份 GitHub PDF 条款列为 rejected/not relied upon。 |
| Source reachability and claim mapping | IN PROGRESS | Verifier 将在草稿完成后逐 URL 与逐关键断言检查。 |
| Cost calculations reproducible | IN PROGRESS | API 研究提供公式；最终稿将只保留已注明单位与假设的情景。 |
| Required files exist on disk | PENDING | 交付前用磁盘检查验证。 |

## Decision log

- 2026-08-31 — 采用 `ai-tool-subscriptions` 作为短 slug。
- 2026-08-31 — 把“终端用户席位”和“产品内 API 用量”作为首要分界，避免将消费订阅误当作应用后端授权。
- 2026-08-31 — 比较以官方当前信息为主；价格是时点数据，报告将注明查询日期、币种、税费和地区限制。
- 2026-08-31 — 采用 4 条并行研究线；最终综合、项目适配判断和建议由 Lead 完成。
- 2026-08-31 — 未获批准前不收集证据、不派发 subagent、不写草稿。
- 2026-08-31 — 用户明确批准后启动 4 个 researcher；四条证据线均完成并写入规定 research 文件。
- 2026-08-31 — 项目检查发现 hosted 网关与支付宝商品处于当前未提交工作树且 runbook 标记 pre-production；最终报告不得把 ¥89/¥199 称为已上线价格。
- 2026-08-31 — 当前 production gate 未关闭，尤其 Volcengine 真实账单舍入、Gemini 取消后计费及支付宝沙箱/退款/对账；最终建议必须以试点和阶段门表达。
