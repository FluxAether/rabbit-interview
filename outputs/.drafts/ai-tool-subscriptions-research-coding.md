# Research: AI 编程工具订阅（截至 2026-08-31）

## Summary

主流 AI 编程订阅已从“固定月费 + 模糊无限”转向“席位费 + 动态/模型相关用量 + 可选超额”。GitHub Copilot 的公开计量最可核算（AI credit 固定为 $0.01，但各模型按 token 消耗）；Cursor 与 Windsurf 的席位价明确，却没有公开一个可跨模型比较的固定请求数；Claude Code 也以五小时/周窗口而非精确 token 配额描述订阅额度。

这些产品首先是供获授权开发者在 IDE、CLI 或厂商代理中使用的开发工具席位，不是可嵌入 RabbitInterview、向终端用户转售的生产模型 API。需要嵌入产品时，应另签模型 API/云平台协议并按 token/API 用量计费；不能把个人或团队席位额度当作应用后端容量。

**口径与访问日期：**价格均为公开美元标价、通常未含税，访问日期均为 **2026-08-31**；“年度”表示年度承诺的月均价，除非另注。企业合同价、区域价、税费和折扣需询价。

## Findings

### 1. 交叉比较表

| 工具/席位 | 公开价格 | 包含额度与“无限”的实际含义 | 超额/用尽后 | 团队、隐私与企业能力 | 是否可作为产品 API |
|---|---:|---|---|---|---|
| **GitHub Copilot Free / Student** | $0 | Free 有 2,000 次代码补全/月；两者均只有 Auto 模型和有限 AI credits，Student 的代码补全无限 | Free 需升级；具体免费 AI-credit 数在当前计划页未公开 | 仅个人；有组织席位者不符合 Free | **否**，是个人开发席位 |
| **Copilot Pro / Pro+ / Max** | $10 / $39 / $100 每月 | 月总 AI credits 分别 **1,500 / 7,000 / 20,000**（其中 base 1,000/3,900/10,000，flex 500/3,100/10,000）；付费计划代码补全和 next-edit 不计 credits、保持“无限” | 可升级，或启用额外预算；1 credit=$0.01，实际消耗按模型 token 价；额度每月 1 日 UTC 重置、不结转 | 个人计划无集中许可/策略/IP indemnity；个人交互数据可能用于训练，但可 opt out | **否**。Copilot SDK/BYOK 是单独的开发/集成路径，不能推定席位包含生产转售权 |
| **Copilot Business / Enterprise** | $19 / $39 每授权席位/月 | 常态每席位贡献 **1,900 / 3,900 credits** 到账单实体共享池；截至本日旧客户促销（2026-06-01 至 2026-09-01）为 3,000 / 7,000。补全与 next-edit 仍不计 credits | 池耗尽后，若允许超额则按模型 token 价折成 credits；否则阻断。额外用量默认开启，管理员需主动关闭；支持用户/成本中心/组织/企业预算 | Business 有集中管理/策略；Enterprise 需 GitHub Enterprise Cloud，增加优先模型及企业能力。两者客户数据不用于训练；数据驻留请求 credit 消耗加 10% | **否**，仍是开发者席位；官方扩展平台或 SDK 另有政策/认证/BYOK，不等于席位可转售 |
| **Cursor Pro / Pro Plus / Ultra** | $20 / $60 / $200 每月 | 两个池：Cursor Models 与 Other Models；均含无限 Tab completion、扩展 agent 限额、Bugbot、Cloud Agents。官方未给固定 token/请求数，不能把“included”写成无限 agent | 超出后按需继续，第三方模型按公开 API 价；也可升级。具体第一方模型按其 token rate | 个人 Privacy Mode 可启用，启用后不训练数据 | **否**，个人席位是交互开发工具 |
| **Cursor Teams Standard / Premium** | $40 / $120 每用户/月；免费 admin-only seat | Premium 为 Standard 的 **5× Agent 用量**；额度按用户、不在成员间转移、月度重置 | 按需用量默认开启，可设团队月度限额；第三方模型为公开 API 价 **另加 Cursor Token Rate $0.25/百万 tokens**；第一方模型免该附加费 | 集中账单/管理、分析、团队级 Privacy Mode、SAML/OIDC SSO、marketplace、Bugbot/Cloud agents | **否**；Terms/席位功能未授予将模型服务提供给产品终端用户的权利 |
| **Cursor Enterprise** | 询价 | 共享用量池；具体额度/折扣按合同 | 按合同；可做成员级 spend limit | 加 invoicing、SCIM、优先支持和高级安全控制；区域数据驻留对符合条件模型价格上浮 10% | **否**，除非另有明确书面产品/API 合同 |
| **Windsurf Free / Pro / Max** | $0 / $20 / $200 每月 | 2026-03 起采用每日 + 每周 quota；Free 为轻量 agent 额度，inline edits 和 Tab completions 无限；Pro/Max 的精确额度未公开，且任务复杂度、推理、模型影响消耗 | Free 等重置；Pro/Max 可买 extra usage，按所用模型 API list price/token；快速/高优先配置更贵 | 个人工具；公开定价未列企业治理 | **否** |
| **Windsurf Teams** | $80/月团队基础费 + $40/月每 full developer seat；flex seats 无限且不含完整开发额度 | 每 full seat 有独立 quota；每日/每周刷新。新 Teams 不含 SSO | 可买 extra usage，按 API list price；旧 $30/seat 计划 grandfathered | 集中账单；SSO 仅 Enterprise（旧付费 add-on 可保留） | **否** |
| **Windsurf Enterprise** | 询价 | 新企业合同以 **Agent Compute Units (ACUs)** 计量，数量按合同；旧企业可能仍按 credits。官方未公开 ACU 到 token/美元的固定换算 | 按合同；旧 credit 模式附加 1,000 pooled credits/$120，但不应套用于新 ACU 合同 | SAML/OIDC SSO、集中企业管理、专属支持/部署选项；MSA 规定仅内部业务使用、不可转许可/转让 | **否**，MSA 明确为内部业务使用；需另签可嵌入 API 协议 |
| **Claude Pro / Max 5× / Max 20×（含 Claude Code）** | Pro $20/月或 $200/年；Max $100 / $200 每月 | Claude 与 Claude Code 共用额度；Pro/Max 有滚动五小时 session limit + 固定周限额。5×/20× 是相对 Pro 的 session capacity，不是无限 token | 可显式启用 usage credits，按标准 API 费率；也可等重置或另用 Console API。环境变量 `ANTHROPIC_API_KEY` 会绕过订阅并产生 API 费 | 个人席位，无团队治理 | **否**；Pro 明确不含 Claude API，Console/API 单独付费 |
| **Claude Team Standard / Premium** | Standard $25 月付或 $20 年付；Premium $125 月付或 $100 年付；至少 2 人 | Standard 为 Pro 每 session 的 1.25×，Premium 6.25×；两者都有固定周限额，Claude Code 均包含；团队最多 150 席 | 管理员可启用 usage credits，以标准 API 费率继续，并设组织/个人上限 | 可混合席位、集中管理；Premium 面向重度使用者 | **否** |
| **Claude Enterprise** | 询价 | 新/自助 usage-based Enterprise 无每席位额度，按消费量/API rate；旧 seat-based 计划依合同及席位类型 | usage-based 直接按 API rate；seat-based 可启用 usage credits | 管理策略、使用分析、合规 API 等；具体席位模型随合同代际而异 | **否**；即使按 API rate 计量，Claude Code 席位/组织访问也不自动成为可转售 API |
| **Gemini Code Assist Standard / Enterprise** | Standard $22.80 月付或 $19 年度承诺/月；Enterprise $54 月付或 $45 年度承诺/月 | agent mode 与 Gemini CLI 合并：Standard **1,500 请求/用户/日**，Enterprise **2,000**；一次 prompt 可能触发多次 model request。另有一般 coding 请求 6,000/日、chat 类 960/日等配额 | 达日限后直到重置不可再用对应界面；Gemini CLI 也可改用 Gemini API key，转为 API PAYG | Standard 已含企业安全/IP indemnification；Enterprise 增私有代码定制与更多 Google Cloud 集成，至少 10 licenses；年度承诺仍按月收费 | **否**；API-key PAYG 是单独 API 计费路径 |

### 2. 关键差异与采购时最容易误读之处

1. **GitHub 的旧“premium requests”已不是大多数客户的当前口径。** 2026-06-01 起主路径为 AI credits；只有已存在的年度 Pro/Pro+ 且留在 legacy request-based billing 的用户继续按 premium requests。比较时把旧“300/1,500 requests”与新 credits 并列，会制造错误等价。[GitHub plans](https://docs.github.com/en/copilot/get-started/plans)；[legacy billing](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests)

2. **Copilot 的 credits 是美元记账单位，不是固定请求数。** 1 credit=$0.01，但一次交互按输入、输出、缓存 token 及模型单价折算；昂贵推理模型更快耗尽。代码补全/next-edit 的“无限”只表示不计 AI credits，并不取消反滥用、容量或技术限制。代码审查还会额外耗 GitHub Actions minutes。[模型与计价](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)

3. **Cursor 的“无限”范围最窄且必须拆开写。** 官方明确无限的是 Tab completions；agent 只有“extended limits/usage pools”。Teams 的 Premium 是 5× Standard agent 用量，而不是 5×所有功能；第三方模型不仅按 API list price，还加 $0.25/百万 token 的 Cursor Token Rate。[Cursor models & pricing](https://cursor.com/docs/models-and-pricing)；[Teams pricing](https://cursor.com/docs/account/teams/pricing)

4. **Windsurf 当前文档存在品牌与计量迁移痕迹。** 官方 pricing/docs 页面在 2026 年将产品叙述为 Devin Desktop/Windsurf，并从 credits 迁到每日/每周 quota；新 Enterprise 又用 ACU，而 legacy Enterprise 仍有 credits。故不能把旧 1,000 credits/$120 推导为新计划超额价，也不能给 ACU 做未经官方确认的 token 换算。[Windsurf pricing](https://windsurf.com/pricing)；[quota migration](https://docs.windsurf.com/windsurf/accounts/quota)；[plans and usage](https://docs.windsurf.com/windsurf/accounts/usage)

5. **Claude 的倍数不是精确 token 包。** Pro、Max、Team 都同时受五小时与周窗口约束，实际可用量随消息长度、上下文、模型和功能变化；Max 20× 也不是“无限”。API key、Console credit 与 subscription 是不同账本，环境变量可能让开发者在不知情时改走 API 计费。[个人计划](https://support.claude.com/en/articles/11049762-choose-a-claude-plan)；[Claude Code Pro/Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)；[成本管理](https://docs.anthropic.com/en/docs/claude-code/costs)

6. **Gemini 的“请求”也不是 prompt。** Agent mode/CLI 的一个用户 prompt 可触发多次模型请求，因此 1,500/2,000 每日请求不可直接与 Copilot credits 或旧 premium requests 比。Enterprise 的主要增量是私有代码定制及 Cloud integrations，不是 Standard 缺少基础企业安全。[配额](https://developers.google.com/gemini-code-assist/resources/quotas)；[版本比较](https://docs.cloud.google.com/gemini/docs/codeassist/overview)

7. **池化差异会直接影响团队成本。** Copilot Business/Enterprise 和 Cursor Enterprise 支持组织池化；Cursor Teams 的额度按用户且不可转移；Claude Team 是席位窗口；Gemini 配额按用户/日。相同总席位下，少数重度用户会让非池化 Teams 方案更早买超额或升级高档席位。

8. **开发席位与生产 API 必须隔离。** Windsurf MSA 明确授予不可转许可、不可转让、仅内部业务使用的权利；Claude 明确 Pro 不含 API；Gemini CLI 的 API-key 模式另行 PAYG；GitHub 的 Copilot extensibility/SDK 有独立政策和 BYOK。除非合同书面授权，不应把任何上述席位代理成 RabbitInterview 的终端用户功能。[Windsurf MSA HTML](https://windsurf.com/MSA)；[Claude Pro](https://support.claude.com/en/articles/8325606-what-is-the-pro-plan)；[Gemini CLI](https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli)；[Copilot SDK BYOK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/byok)

### 3. 隐私与企业条款证据

- **GitHub：**Business/Enterprise 客户数据不用于模型训练；个人 Free/Pro/Pro+/Max 的交互数据可能被用于训练，但个人可 opt out。部分预览模型或特定模型（例如官方页面提示的 Claude Fable 5）有例外保留规则，管理员应逐模型审核。[Model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting)
- **Cursor：**Privacy Mode 对 Free/Pro 也可用，并可由团队/企业管理员强制；启用后 Cursor 不训练用户数据，并以技术和合同措施约束模型提供商。[Security](https://cursor.com/security)
- **Windsurf：**企业 MSA 表示未经事先书面同意不以 Customer Data 训练模型；某些需持久化的云功能（如 remote indexing、memories、reviews、knowledge base）可为提供服务而存储片段，安全风控命中也可能留存。[MSA](https://windsurf.com/MSA)
- **Claude：**Team/Enterprise 提供管理员席位、spend controls、Claude Code analytics 和 managed policy；新企业合规 API 可提供用量与客户内容的程序化审计能力。具体保留和数据处理仍应以订单/DPA 为准。[Anthropic business controls](https://www.anthropic.com/news/claude-code-on-team-and-enterprise)
- **Gemini：**Standard 已定位为企业级安全与合规并含代码建议 indemnification；Enterprise 再增加私有代码库定制。Enterprise 最少购买 10 席，年度折扣按月收费。[Overview](https://docs.cloud.google.com/gemini/docs/codeassist/overview)；[Setup](https://docs.cloud.google.com/gemini/docs/codeassist/set-up-gemini)

## Review findings

1. **high — `outputs/.plans/ai-tool-subscriptions-T2.md`：**若后续汇总仍使用 2025 年常见的 Copilot premium-request 表，将与 2026-06-01 后 AI-credit 主计量冲突；应只把 premium requests 标为 legacy annual Pro/Pro+ 例外。
2. **high — `outputs/.plans/ai-tool-subscriptions-T2.md`：**不得把 IDE/CLI 席位当 RabbitInterview 生产 API。Windsurf 企业条款明确 internal business use/non-sublicensable，Claude Pro 明确不含 API；其余席位也没有公开转售授权。
3. **medium — `outputs/.plans/ai-tool-subscriptions-T2.md`：**Windsurf 的 quota、ACU 与 legacy credits 三套口径并存，公开页面未给精确 quota 或 ACU 换算；任何统一“每月 prompts”数字都属于推测。
4. **medium — `outputs/.plans/ai-tool-subscriptions-T2.md`：**Cursor 未公开各个人/Teams usage pool 的精确 token 数；只能报告价格、相对倍数和超额公式，不能伪造可比额度。
5. **medium — `outputs/.plans/ai-tool-subscriptions-T2.md`：**GitHub 组织旧客户促销额度于 2026-09-01 截止；截至 2026-08-31 仍有效，但预算模型应使用常态 1,900/3,900 credits，而不是促销 3,000/7,000。
6. **low — `outputs/.plans/ai-tool-subscriptions-T2.md`：**Google Enterprise 至少 10 席；小团队不能按单席 Enterprise 标价直接估算初始合同总额。

## Sources

### Kept（均访问于 2026-08-31）

- [GitHub — Plans for GitHub Copilot](https://docs.github.com/en/copilot/get-started/plans) — 当前个人/组织席位价格与 AI credits 基准。
- [GitHub — Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals) — base/flex、重置、不结转和个人超额。
- [GitHub — Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises) — 池化、促销、默认超额与预算控制。
- [GitHub — Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) — token 到 credit 的计价及“无限补全”的边界。
- [GitHub — Model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting) — 训练、托管和特定模型例外。
- [GitHub — Legacy request billing](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests) — 限定旧年度订阅例外。
- [Cursor — Models & Pricing](https://cursor.com/docs/models-and-pricing) — 个人计划、双池、按需用量及 Token Rate。
- [Cursor — Team Pricing](https://cursor.com/docs/account/teams/pricing) — Teams 席位、5×、默认超额、Enterprise pool。
- [Cursor — Security](https://cursor.com/security) — Privacy Mode 与训练承诺。
- [Cursor — Terms of Service](https://cursor.com/terms-of-service) — 内容/usage-data 条款；公开文本未提供生产 API 转售授权。
- [Windsurf — Pricing](https://windsurf.com/pricing) — 当前 Free/Pro/Max/Team/Enterprise 标价与功能。
- [Windsurf — Quota-Based Usage](https://docs.windsurf.com/windsurf/accounts/quota) — 2026 quota 迁移、重置及 API-list-price extra usage。
- [Windsurf — Plans and Usage](https://docs.windsurf.com/windsurf/accounts/usage) — ACU 与 legacy credits 的区分。
- [Windsurf — MSA (HTML)](https://windsurf.com/MSA) — 内部使用、不可转许可及企业数据使用条款。
- [Anthropic — Choose a Claude plan](https://support.claude.com/en/articles/11049762-choose-a-claude-plan) — 个人价格与容量档。
- [Anthropic — Team plan](https://support.claude.com/en/articles/9266767-what-is-the-team-plan) — Standard/Premium 价格、倍数、人数上限。
- [Anthropic — Claude Code with Pro or Max](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan) — 共享额度、API credit 分流。
- [Anthropic — Claude Code with Team or Enterprise](https://support.claude.com/en/articles/11845131-use-claude-code-with-your-team-or-enterprise-plan) — 企业合同代际和 usage-based 行为。
- [Anthropic — Manage costs effectively](https://docs.anthropic.com/en/docs/claude-code/costs) — seat/API 两种计量与控制。
- [Google — Gemini Code Assist business pricing](https://codeassist.google/products/business) — Standard/Enterprise 月付与年度承诺价格。
- [Google — Quotas and limits](https://developers.google.com/gemini-code-assist/resources/quotas) — 每日请求配额及 agent/CLI 合并规则。
- [Google Cloud — Standard and Enterprise overview](https://docs.cloud.google.com/gemini/docs/codeassist/overview) — 功能、安全和定制差异。
- [Google Cloud — Setup](https://docs.cloud.google.com/gemini/docs/codeassist/set-up-gemini) — Enterprise 最少席位及订阅周期。

### Dropped / rejected

- `https://windsurf.com/docs/MSA.pdf` — **拒绝**：计划明确要求不解析 PDF；采用同内容 HTML `https://windsurf.com/MSA`。
- `https://windsurf.com/docs/pilot.pdf` — **拒绝**：PDF 且为 pilot 条款，不代表当前通用商用计划。
- 第三方博客 `agentcode.ai`、`continuumcode.ai`、`websites2know.com` — **拒绝**：价格可由 Google 官方页面直接确认，无需二手推导。
- GitHub 普通平台价格页 `https://github.com/pricing` — **拒绝**：是 GitHub 仓库托管计划，不是 Copilot 席位。
- Google Gemini Enterprise（通用企业助手）quota/overage 文档 — **拒绝**：不是 Gemini Code Assist，产品口径不同。
- Hugging Face Team/Enterprise 文档 — **拒绝**：超出本研究的 AI 编程助手范围。
- Windsurf California privacy notice — **拒绝**：消费者隐私披露不能替代产品计划的数据处理与企业合同条款。

## Gaps / residual risks

- **Cursor 精确额度未公开：**个人 Cursor Models/Other Models 以及 Teams Standard 的绝对 included token 值无法从公开官方页面确认；只能在实际结账/管理后台或销售报价中核验。
- **Windsurf 精确 quota 与 ACU 换算未公开：**无法可靠给出每日/每周绝对额度，也无法把 ACU 换成 tokens、prompts 或美元。需要索取当前订单表和 ACU rate card。
- **企业价与合同权利：**Cursor Enterprise、Windsurf Enterprise、Claude Enterprise 均询价；数据保留、赔偿、部署区域和嵌入/转售权最终以 Order Form、MSA/DPA 为准。
- **GitHub 临界日期风险：**本报告访问日正处于组织客户促销最后一天附近；2026-09-01 后应重新抓取页面，确认促销终止时区及自助购买暂停状态。
- **动态模型价格：**Copilot、Cursor 和 Windsurf 的超额成本取决于模型/token 清单，可能频繁更新；此报告刻意不复制长模型价表，避免很快失效。
- **“无限”仍受合理使用/容量限制：**官方资料足以确认哪些计费单位不扣减，但不足以证明不存在反滥用、并发或服务容量限制。
- **不提供 RabbitInterview 最终选型：**依任务要求，本报告只整理证据，不作最终方案或供应商推荐。
