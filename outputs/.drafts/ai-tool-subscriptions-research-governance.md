# Research: AI 工具订阅的治理、隐私与商业约束（截至 2026-08-31）

## Summary

跨供应商比较不能只看“不会训练”或席位单价：个人版、商业工作区、企业合同、第一方 API 与云平台托管 API 往往适用不同的数据条款、保留期、身份控制和 SLA。已核验资料显示，商业/企业产品普遍默认不以客户内容训练模型，但“零保留”、区域处理、完整审计和合同 SLA 通常是受资格、端点、模型、版本、地区或额外费用限制的能力，并非一句企业隐私承诺即可覆盖。

商业约束同样会改变真实成本：年付通常降低名义席位单价，却带来不可退款或剩余承诺责任；API 的按量成本可变，预留吞吐能提高可预测性但增加最低期限/闲置风险；区域端点在 OpenAI、Anthropic 与 GitHub Copilot 的已核验场景中均出现 10% 溢价或消耗乘数。本文提供采购与治理比较框架及已验证差异，不给 RabbitInterview 最终选型。

> 访问日期：2026-08-31。除特别说明外，链接均为供应商官方 HTML 页面。

## 治理比较框架

采购或安全评审应按下列顺序逐项核对，并把答案固定到**产品、套餐、身份类型、模型、端点、地区和合同版本**：

1. **数据用途**：输入、输出、上传文件、代码上下文、反馈、遥测分别是否用于训练；默认值是 opt-in 还是 opt-out；安全审查是否例外。
2. **数据生命周期**：滥用监测日志与应用状态分开；默认保留、管理员可选窗口、删除传播时延、法律保留、备份和第三方连接器边界。
3. **身份与权限**：SAML/OIDC SSO、SCIM/JIT、域捕获、基础管理员角色、细粒度 RBAC、服务账户/API 项目权限及离职回收。
4. **可观察性**：审计日志覆盖的是管理事件、提示/响应内容，还是两者；在线窗口、导出/API、SIEM/eDiscovery/DLP 支持及日志自身驻留。
5. **合同与可靠性**：公开 SLA 还是 order form/MSA；按模型/区域/服务层计算的分母；排除项；服务积分是否必须主动申领。
6. **主权边界**：静态存储、GPU 推理、CPU/路由/元数据分别在哪；连接器和第三方模型是否出区；可用模型是否缩减；区域化溢价。
7. **商业可预测性**：月付/年付、最低席位、按量超额、预算上限、最低消费、预留容量、取消时间、退款、税费、币种和区域价差。
8. **可退出性与锁定**：聊天/文件/审计导出，提示和工具调用的可移植性，专有 agent/connector/vector store，模型版本退役，云承诺与 Marketplace 绑定。

## Findings

### 1. 训练数据政策必须严格区分个人、商业工作区和 API（严重度：高）

- **OpenAI**：个人 ChatGPT 内容可能用于训练，用户可在 Data Controls 或隐私门户关闭；关闭后仅影响新对话。ChatGPT Business/Enterprise/Edu/Healthcare/Teachers 与 API 默认不训练，组织需明确 opt-in 才共享 API 数据。不能把个人版 opt-out 误写成企业版默认值，也不能把企业承诺反推到个人账户。[数据用途](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/)；[商业数据承诺](https://openai.com/business-data/)
- **Anthropic**：Free/Pro/Max 用户可选择是否允许训练；允许时，新/恢复的聊天与 Claude Code 会话保留期可达五年，不允许时为 30 天。Team、Enterprise、API 和第三方云平台适用商业政策，默认不以代码或提示训练，除非组织明确参加数据改进项目。[消费者政策更新](https://www.anthropic.com/news/updates-to-our-consumer-terms)；[Claude Code 数据用途](https://code.claude.com/docs/en/data-usage)
- **Google Gemini**：消费者 Gemini 在 Keep Activity 开启时可用于改进模型并接受人工审查；关闭后未来聊天通常保留 72 小时用于服务与安全，不用于训练（主动反馈除外），已由人工审查的数据可保留最多三年。具有 Workspace 企业级保护的 Gemini 内容不经人工审查，也不在未经许可时用于域外生成式模型训练。[消费者 Privacy Hub](https://support.google.com/gemini/answer/13594961?hl=en)；[Workspace Privacy Hub](https://knowledge.workspace.google.com/admin/generative-ai/generative-ai-in-google-workspace-privacy-hub)
- **GitHub Copilot**：自 2026-04-24 起，Free/Pro/Pro+/Max 的交互数据可能用于训练，个人可退出；Business/Enterprise 数据不用于训练。模型托管页同时揭示模型级例外：多数已列模型有 ZDR/不训练承诺，但特定 Claude covered model 可保留提示和输出最多 30 天用于安全分类且需企业管理员启用。[个人策略](https://docs.github.com/copilot/how-tos/manage-your-account/managing-copilot-policies-as-an-individual-subscriber)；[模型托管与数据边界](https://docs.github.com/en/copilot/reference/ai-models/model-hosting)
- **Cursor**：Privacy Mode 可由个人或团队/企业管理员启用，启用后 Cursor 表示不训练数据；新团队成员继承团队设置。但公开安全页未给出足以统一断言所有模型/功能保留期的端点级矩阵，故应按具体模型和功能再核验。[Cursor Security](https://cursor.com/security)

**治理结论**：禁止员工用个人订阅处理公司机密不能仅靠培训；应通过受管工作区、域策略与身份回收实施。任何“no training”声明都不等于“no retention”或“无人可在安全事件中审查”。

### 2. “零数据保留”不是全产品保证，应用状态和安全日志必须拆开看（严重度：高）

- OpenAI API 默认滥用监测日志可能含提示/响应并保留最多 30 天；ZDR/Modified Abuse Monitoring 需资格审核及附加要求。即使批准 ZDR，`conversations`、threads、files、fine-tuning、batches 等有状态能力可能不合格或保留至删除；Responses 的 `store`、后台模式等也有专门规则。[OpenAI API 数据控制](https://developers.openai.com/api/docs/guides/your-data)
- Anthropic Claude Code 商业标准保留期为 30 天；企业 ZDR 需符合资格并由客户团队按组织启用，不是标准 Enterprise 自动包含。自 2026-06-09 起，covered models 即便原工作区使用 ZDR，也要求有限 30 天保留与受控安全审查；不同直连/API/Bedrock/Google/Azure 部署由不同主体保存数据。[Claude Code 数据用途](https://code.claude.com/docs/en/data-usage)；[Covered Models 保留规则](https://support.claude.com/en/articles/15425996-data-retention-practices-for-covered-models)
- Google Workspace 的保留按表面不同：Gemini in Workspace 提示/响应可由管理员设置 90 天至无限期；Gemini app 通常可选 3、18、36 个月，默认 18 个月，或关闭历史（仍可能保存最多 72 小时）；Gemini Notebook 的会话提示/响应不在会话结束后保留，上传文件和 notebook 则走 Workspace 删除规则。[Workspace Privacy Hub](https://knowledge.workspace.google.com/admin/generative-ai/generative-ai-in-google-workspace-privacy-hub)
- Microsoft 365 Copilot 将提示、响应与引用作为交互内容存储，并可由 Purview 施加保留、删除、eDiscovery 与 legal hold。后台 Exchange 隐藏文件夹和定时任务意味着 UI 不可见不代表已永久删除；删除流程通常还有 1–7 天任务周期，并可能被诉讼/保留策略暂停。[Copilot 隐私](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-privacy)；[Purview 保留机制](https://learn.microsoft.com/en-us/purview/retention-policies-copilot)
- Perplexity Chat Completions API 宣称严格 ZDR，仅收集不含提示/响应内容的计费元数据；Enterprise DPA 则规定服务终止后 30 天内删除/返还个人数据（法律义务例外），这两项对应不同产品边界。[API 隐私与安全](https://docs.perplexity.ai/docs/resources/privacy-security)；[DPA](https://www.perplexity.ai/hub/legal/dpa)

**治理结论**：保留登记表至少需四列：客户内容、应用状态、滥用/安全日志、计费/系统元数据；同时记录删除触发器和例外。

### 3. 企业管理员能力不等价，尤其审计“有日志”不代表有提示内容（严重度：高）

| 供应商/产品 | 已核验身份与权限 | 已核验审计/合规边界 |
|---|---|---|
| OpenAI ChatGPT Enterprise/Edu | SAML SSO、SCIM、域验证；自定义 RBAC 适用于 Enterprise/Edu/Healthcare/Teachers。ChatGPT Business 单独部署不含 SCIM。 | Compliance Platform 面向 Enterprise/Edu；不可变日志平台在线保留 30 天，长期历史需持续拉取。 |
| Anthropic Claude Enterprise | SSO、SCIM/JIT、RBAC、域捕获、IP allowlist、网络控制。 | Enterprise 才有 audit logs/Compliance API；手动导出覆盖过去 180 天，下载链接 24 小时有效；CMK 场景需改用 Compliance API。 |
| Google Workspace Gemini | 继承 Workspace 身份、用户/设备上下文、现有权限、DLP/IRM；功能是否可用取决于 Workspace edition。 | Gemini 使用与 Drive 文件访问可进 Reports API/安全调查工具；高级调查工具仅特定版本。 |
| Microsoft 365 Copilot | 继承 Entra/M365 身份、SharePoint/OneDrive 权限、Purview sensitivity labels、DLP 与租户管理。 | Purview 可记录提示、响应、引用内容并支持 Audit/eDiscovery/retention；具体能力取决于底层订阅/Purview 许可。 |
| GitHub Copilot Business/Enterprise | 可使用 Copilot-only enterprise；SAML SSO、SCIM managed users/team assignment，避免必然购买 GitHub Enterprise 席位，但一旦用户加入组织可能消耗 GHE 许可。 | Copilot audit log 覆盖设置、许可和 GitHub 网站 agent 事件，默认 180 天；**不含本地客户端提示**，需客户自建 hook/遥测。 |
| Perplexity Enterprise | SSO、SCIM、管理员/成员角色及文件共享控制。 | 官方企业页声称 audit logs；公开 DPA 支持有条件的合规审计，但精细日志事件、公开保留窗口未充分核验。 |
| Cursor | Privacy Mode 可由管理员强制，公开安全页说明最小权限/MFA及合规认证。 | 本轮未在官方 HTML 中核验到完整 SCIM/RBAC/提示级审计矩阵；不可仅凭“Enterprise”名称推定。 |

来源：[OpenAI SCIM](https://help.openai.com/en/articles/10011769-scim-integration-faq)、[OpenAI Compliance Platform](https://help.openai.com/en/articles/9261474)、[OpenAI RBAC](https://help-lb.openai.com/en/articles/11750701-role-based-access-controls-for-chatgpt-enterprise)、[Anthropic Enterprise](https://www.anthropic.com/enterprise)、[Anthropic audit logs](https://support.anthropic.com/en/articles/9970975-how-to-access-audit-logs)、[Google Gemini 安全控制](https://workspace.google.com/blog/ai-and-machine-learning/enterprise-security-controls-google-workspace-gemini)、[Microsoft 数据保护架构](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture-data-protection-auditing)、[GitHub Copilot-only enterprise](https://docs.github.com/en/copilot/concepts/about-enterprise-accounts-for-copilot-business)、[GitHub 审计](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/review-audit-logs)、[Perplexity 用户管理](https://www.perplexity.ai/help-center/en/articles/11187370-managing-users-and-access-control)。

### 4. 数据驻留通常只覆盖“范围内客户内容”，不自动约束元数据、所有处理或连接器（严重度：高）

- OpenAI 对符合资格的 ChatGPT Enterprise/Edu 与 API 提供多地区静态存储；支持地区还可选择 GPU inference residency。官方明确排除账户、计费、使用统计等 system data，且身份验证、路由、部分 CPU 处理与第三方 Apps/MCP/Web Search 可能在区外。ChatGPT Enterprise/Edu 的 residency 无额外费用；API 对 2026-03-05 后发布且合格的模型收取 10% uplift，非美国地区还要求相应滥用监测控制和修订。[ChatGPT residency](https://help.openai.com/en/articles/9903489-data-residency-for-chatgpt)；[API data controls](https://developers.openai.com/api/docs/guides/your-data)
- Anthropic 企业页面列出 US-only inference、CMK 和网络控制；Claude 4.6+ 第一方 API 的 `inference_geo: "us"` 对各 token 类别使用 1.1x 乘数。Bedrock、Vertex AI、Microsoft Foundry 有各自驻留、认证、计费与合同边界，迁移到云市场可能利用既有云承诺，但也加深云锁定。[Anthropic Enterprise](https://www.anthropic.com/enterprise)；[Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Google Workspace 表示可将 Gemini in Workspace 数据处理限制在美国或欧盟，并可使用 Data Regions、DLP 与客户端加密；但应以具体 Workspace edition 和功能支持表为准。[Workspace AI privacy](https://workspace.google.com/security/ai-privacy/)
- Microsoft 365 Copilot 自 2024-03-01 起纳入产品条款驻留承诺；ADR 和 Multi-Geo 对合格租户/全体用户许可、PDL 和迁移有前置条件。EU 用户受 EU Data Boundary 保护；其他地区的查询可能在美国、欧盟或其他地区处理。[Copilot residency](https://learn.microsoft.com/en-us/microsoft-365/enterprise/m365-dr-service-copilot?view=o365-worldwide)
- GitHub Enterprise Cloud with data residency 可强制 Copilot 推理、提示、响应、日志和遥测留在指定区域，但只显示合格模型，且请求消耗有 10% 增幅。[GitHub Copilot residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/github-copilot-with-data-residency)

**治理结论**：合同中应分别写 storage residency、inference residency、其他处理、支持访问、日志和子处理者；营销页的“data residency”不足以满足全处理本地化。

### 5. 公开 SLA 远少于“enterprise-grade”表述，服务积分也不是停机赔偿（严重度：中高）

- OpenAI 公布的 Scale Tier 面向 Enterprise、每 token unit 最少购买 30 天，提供 99.9% uptime SLA 与延迟 SLA；PAYG 公共 API 页面不能据此推定同样保证。若 uptime 与 latency 同时违反，仅取两者较高的积分。[OpenAI Scale Tier](https://openai.com/api-scale-tier/)
- Google Vertex AI SLA 按 Covered Service 区分 99%、99.5%、99.9% SLO；不达标积分为相关服务月费的 10%/25%/最高 50%，客户须在符合资格后 30 天内向支持提交请求和识别信息，否则失权。[Vertex AI SLA](https://cloud.google.com/vertex-ai/sla)
- Microsoft 365 Copilot 的资料确认受 DPA/Product Terms 与 M365 服务边界保护，但本轮未核验到一份可把 Copilot 助手单独映射到固定公开 uptime 百分比和积分表的官方 HTML。应以客户 Product Terms、Online Services SLA 和所购许可为准，不能从“enterprise data protection”推导 SLA。[Enterprise Data Protection](https://learn.microsoft.com/en-us/microsoft-365/copilot/enterprise-data-protection)
- Anthropic、Perplexity、Cursor、GitHub Copilot 的本轮官方 HTML 证据不足以证明所有订阅层都有统一公开 uptime SLA；企业采购应要求 sales/order form 明示计算分母、区域/模型范围、排除项、申领期限与积分上限，未写即标记 **custom/contact sales / unknown**。

### 6. 年付折扣换取承诺，取消通常只阻止续费而不返还当期（严重度：中高）

- **ChatGPT Business**：Standard 为月付 $25/人/月或年付 $20/人/月；Premium 为 $125 或 $100；至少 2 席。未用席位不可退款，减席下周期生效；自助 Business 仅银行卡，不支持发票/ACH/PO，需发票应联系 Enterprise/Education sales。VAT/Tax ID 按地区处理，价格可能因国家/币种不同。API 与 Business 分开计费且额度不互通。[Business billing](https://help.openai.com/en/articles/8792536-manage-billing-on-the-chatgpt-team-subscription-plan)；[Business FAQ](https://help.openai.com/en/articles/8542115-chatgpt-business-faq)
- **Claude Enterprise**：官方定价页截至访问日给出 $20/席/月加 API 费率用量、按年计费，并提供 self-serve 或 sales-assisted；高级安全能力包括 SCIM、审计、RBAC、自定义保留。由于按量叠加席位，年付并不等于总成本固定。[Claude pricing](https://www.anthropic.com/pricing?t=)
- **Google Workspace/Gemini**：Flexible Plan 可随时增减并按天比例计费；Annual/Fixed-Term 名义单价较低，但只能续约时减席，提前取消仍须承担剩余承诺余额。[Workspace with Gemini billing](https://knowledge.workspace.google.com/admin/generative-ai/workspace-with-gemini/how-google-workspace-with-gemini-billing-works)
- **GitHub Copilot**：Business/Enterprise 按月席位；新增席位按剩余周期比例收费，移除/取消通常到周期末停止计费且未用时间不退款。AI credits 超出共享池后按量收费，管理员可设用户、成本中心、组织和企业预算；区域合规请求增加 10% credit multiplier。[Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)；[组织/企业计费](https://docs.github.com/en/copilot/concepts/billing/organizations-and-enterprises)
- **OpenAI 商业合同/API**：费用通常不可退；minimum commitment 通常不可取消；续约、自动续费和减量通知以 order form 为准，默认要求下个续期前至少 30 天通知；税费不含在 fees 中，价格页变更通常发布 14 天后生效。[OpenAI Services Agreement](https://openai.com/policies/services-agreement/)
- **Azure OpenAI**：PAYG 适合波动负载；PTU 为稳定吞吐与成本提供月/年预留，但闲置仍按容量计费。页面报价仅为估算，实际币种、汇率、协议和地区会变化。[Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service)

**治理结论**：比较表应至少同时展示“基础席位、包含用量、超额单价、区域乘数、最低期限、最低席位、可退性、税前/税后”。仅年化席位价会系统性低估 agent/API 密集使用和区域合规成本。

### 7. 锁定风险来自工作流与治理状态，不只来自模型 API（严重度：中）

1. **数据/知识锁定**：聊天、Projects/Spaces、vector stores、企业搜索索引和连接器权限映射未必能等价导出。即使支持导出内容，也可能不含模型配置、审计关联和 agent state。
2. **身份锁定**：域捕获、受管账户迁移、SCIM 分组和自定义角色切换供应商时需重建；OpenAI 还明确警告 tenant-wide SCIM 与产品级 SCIM 冲突及错误迁移可能造成账户/历史分裂。
3. **治理锁定**：Microsoft Copilot 的价值与 Purview/SharePoint/Entra 深度绑定；Gemini 与 Workspace DLP/Vault/Data Regions 绑定；GitHub Copilot 与 GitHub 企业身份、仓库和 credits 绑定。已有生态可减少首期治理工作，却提高迁出成本。
4. **商业锁定**：年付/固定期限、最低消费、Scale Tier/PTU 和 AWS/Azure Marketplace commit 会把架构选择转为财务承诺。
5. **模型锁定与政策漂移**：模型退役、端点不支持 ZDR/驻留、covered model 新增保留要求、预览功能不在 SLA 内都会迫使重构。GitHub 2026 年模型托管页已显示同一 Copilot 产品内不同模型有不同保留政策。

**最低缓解措施**：保留供应商中立的提示模板、测试集和模型适配层；把聊天/文件/审计定期导出到自有存储；把身份组作为 IdP 真源；对模型版本和数据政策设变更监控；年度承诺前以真实 30–90 天用量做基线。是否值得构建复杂多供应商路由应由实际迁移/RTO 需求决定，不能为假设性退出过度设计。

## 已验证差异速览

| 维度 | 个人订阅典型状态 | 商业/团队典型状态 | 企业/受管状态 | 开发者 API 典型状态 |
|---|---|---|---|---|
| 训练 | 常为可退出或依设置；反馈/安全可例外 | 主流供应商多为默认不训练 | 默认不训练并有合同/DPA | 付费 API多默认不训练；免费层和反馈需另核验 |
| 保留 | 历史、训练选择强相关 | 通常固定默认窗口 | 可自定义但未必到 0 | 滥用日志与应用状态按端点分开；ZDR 常需资格 |
| SSO/SCIM/RBAC | 无 | SSO 常见，SCIM/RBAC未必齐全 | 通常齐全但版本有差异 | 项目/组织 IAM 不等于员工助手 SCIM |
| 审计 | 很少 | 管理事件常见 | Compliance API/SIEM/eDiscovery 较常见 | 请求内容日志可能与 ZDR 冲突 |
| SLA | 通常无合同 SLA | 不应默认推定 | order form/MSA 或特定服务层 | PAYG 与预留/Scale SLA需分开 |
| 驻留 | 通常无保证 | 有限 | 多为资格/地区/功能约束 | 常有区域端点、模型限制和约 10% 溢价 |
| 成本 | 固定订阅但公平使用 | 席位+可能超额 | 年承诺+询价/按量 | PAYG波动；预留提高可预测性但有闲置风险 |

## Sources

### Kept（官方 HTML）

- [OpenAI — How your data is used to improve model performance](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/) — 明确个人与商业/API 的训练默认值。
- [OpenAI — Business data privacy, security, and compliance](https://openai.com/business-data/) — 商业数据、训练、身份与驻留总览。
- [OpenAI — Data controls in the API platform](https://developers.openai.com/api/docs/guides/your-data) — 端点级保留、ZDR、应用状态和区域限制的关键证据。
- [OpenAI — ChatGPT data/inference residency](https://help.openai.com/en/articles/9903489-data-residency-for-chatgpt) — 驻留范围与排除项。
- [OpenAI — Compliance Platform](https://help.openai.com/en/articles/9261474) — 日志能力及 30 天窗口。
- [OpenAI — Services Agreement](https://openai.com/policies/services-agreement/) — 企业期限、退款、税费、最低承诺和价格变更。
- [OpenAI — Scale Tier](https://openai.com/api-scale-tier/) — 公开 99.9%/延迟 SLA 与最低 30 天购买。
- [Anthropic — Consumer policy update](https://www.anthropic.com/news/updates-to-our-consumer-terms) — 消费者训练选择与 5 年/30 天保留差异。
- [Anthropic — Claude Code data usage](https://code.claude.com/docs/en/data-usage) — 商业/个人训练与保留、ZDR资格、本地缓存。
- [Anthropic — Covered Models retention](https://support.claude.com/en/articles/15425996-data-retention-practices-for-covered-models) — ZDR 的模型级安全保留例外。
- [Anthropic — Enterprise](https://www.anthropic.com/enterprise) — SSO/SCIM/RBAC/审计/CMK/US inference 和多云交付。
- [Anthropic — Audit logs](https://support.anthropic.com/en/articles/9970975-how-to-access-audit-logs) — 180 天导出范围和 CMK 限制。
- [Anthropic — Pricing](https://www.anthropic.com/pricing?t=) — 企业席位、年付及用量叠加。
- [Google — Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961?hl=en) — 消费者人工审查、训练、72 小时和 3 年保留。
- [Google Workspace — Generative AI Privacy Hub](https://knowledge.workspace.google.com/admin/generative-ai/generative-ai-in-google-workspace-privacy-hub) — 工作区训练限制与分产品保留。
- [Google Workspace — Gemini billing](https://knowledge.workspace.google.com/admin/generative-ai/workspace-with-gemini/how-google-workspace-with-gemini-billing-works) — flexible 与 annual commitment 的取消责任。
- [Google Cloud — Vertex AI SLA](https://cloud.google.com/vertex-ai/sla) — SLO、积分档位和申领要求。
- [Microsoft — M365 Copilot privacy](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-privacy) — 不训练、内容存储、Purview 与驻留。
- [Microsoft — Retention for Copilot](https://learn.microsoft.com/en-us/purview/retention-policies-copilot) — 隐藏邮箱、legal hold 和删除传播机制。
- [Microsoft — Copilot data residency](https://learn.microsoft.com/en-us/microsoft-365/enterprise/m365-dr-service-copilot?view=o365-worldwide) — ADR/Multi-Geo 前置条件及处理地域。
- [GitHub — Model hosting](https://docs.github.com/en/copilot/reference/ai-models/model-hosting) — Business/Enterprise 不训练及模型提供商级 ZDR/例外。
- [GitHub — Reviewing Copilot audit logs](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/review-audit-logs) — 180 天日志及本地提示缺口。
- [GitHub — Copilot billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/organizations-and-enterprises) — 席位、credits、超额和预算控制。
- [GitHub — Copilot with data residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/github-copilot-with-data-residency) — 区域推理、模型限制和 10% multiplier。
- [Perplexity — API Privacy & Security](https://docs.perplexity.ai/docs/resources/privacy-security) — Chat Completions API ZDR 与计费元数据边界。
- [Perplexity — DPA](https://www.perplexity.ai/hub/legal/dpa) — 企业个人数据处理、审计与终止删除义务。
- [Cursor — Security](https://cursor.com/security) — Privacy Mode、认证和官方安全认证范围。
- [Azure — OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service) — PAYG/PTU、预留与地区/币种报价限制。

### Rejected / not relied upon

- **Anthropic List Prices PDF、GitHub Copilot Product Specific Terms PDF、Anthropic legal-industry PDF** — 计划明确要求 HTML 优先且不解析 PDF；本轮按父级指导停止 PDF 取证，相关结论改用官方 HTML。PDF parsing blocked / intentionally not performed。
- **AgentModeAI “Enterprise AI vendor SLA + uptime comparison 2026”** — 非供应商官方来源，且包含无法由本轮官方 HTML 逐项印证的统一 SLA 推断，未用于结论。
- **ConductAtlas 对 Claude Terms 的摘要** — 第三方合同分析；未用于证据。
- **archive.ph 的 Anthropic 条款快照** — 非当前官方主站 URL，且可能滞后；商业/取消结论仅采用当前官方可核验页面，未依赖该快照。
- **搜索结果中重复的地区化 Google Workspace 页面及 GitHub `enterprise-cloud@latest` 镜像** — 内容重复，保留一个规范 URL。
- **Cursor 文档搜索中无关语言指南/@-symbols 页面** — 搜索摘要误命中、与治理主题无关。

## 争议与未知项

1. **未来日期页面的变更风险**：GitHub 在 2026-08-28 公告了 9 月后的计费/数据保留变化；本报告截止 8 月 31，不把尚未生效的行为写成当前事实。采购前应在生效日后重新核验。
2. **统一 SLA 不可得**：Anthropic、GitHub Copilot、Perplexity、Cursor 以及普通 OpenAI PAYG 的统一公开 uptime/latency SLA 未由官方 HTML 充分确认；标记为 `custom/contact sales` 或 `unknown`，不得估算。
3. **Cursor 企业矩阵不足**：官方安全页能证明 Privacy Mode 和若干认证，但本轮未核验 SCIM、细粒度 RBAC、提示级审计、驻留和固定保留窗的完整公开矩阵。
4. **Perplexity 细节冲突/不足**：企业营销页曾出现附件 1 天与博客 7 天的描述，可能涉及不同功能或版本；未据此形成统一保留结论。应要求 sales 以合同和当前管理员文档确认 thread attachments、Spaces 和搜索历史分别的窗口。
5. **税费/地区差异**：可确认供应商普遍按账单地址、VAT/Tax ID、Marketplace 或本地币种处理，但无法列出所有国家最终含税价；报价必须按采购实体和地区在 checkout/合同中验证。
6. **审计覆盖动态变化**：日志 API 和事件类别快速扩充，尤其 agent/connector/本地 CLI 活动。上线前应以真实租户生成测试事件，验证 SIEM 可见性与删除事件。
7. **云转售合同链**：同一 Claude/OpenAI 模型经 Bedrock、Vertex 或 Azure 使用时，数据处理者、SLA、价格、驻留和支持责任可能转移；需同时审阅模型供应商与云平台条款。

## Residual risks

- 高：将“默认不训练”误当成 ZDR，可能导致敏感提示在安全日志或有状态端点保留。
- 高：仅凭企业营销页声称的驻留做合规判断，可能遗漏元数据、CPU 路由、第三方连接器和跨区支持访问。
- 高：GitHub Copilot 本地客户端提示不在标准审计日志中，无法仅靠平台日志完成提示级调查。
- 中高：年付、固定期限、最低消费和预留吞吐降低单价但可能形成不可退款的闲置承诺。
- 中：模型级政策和价格快速变化，采购时点与部署时点之间可能出现 ZDR、驻留、计费或可用模型漂移。

## Review findings

- **high — `outputs/.plans/ai-tool-subscriptions-T4.md`（证据边界）**：个人、团队/商业、企业和 API 政策不能合并；本报告已按产品层级拆分，并标注模型/端点例外。
- **high — `outputs/.drafts/ai-tool-subscriptions-research-governance.md`（保留误读风险）**：no-training、ZDR、应用状态和审计/安全日志是四个不同命题；比较框架已强制分列。
- **high — `outputs/.drafts/ai-tool-subscriptions-research-governance.md`（审计缺口）**：GitHub Copilot 官方日志不含本地客户端提示，若要求提示级审计需另行采集。
- **medium — `outputs/.drafts/ai-tool-subscriptions-research-governance.md`（商业可预测性）**：区域化多见约 10% 增幅，年付/预留容量同时引入闲置与退出成本。
- **no blockers**：所需治理框架、已验证差异、精确 URL、访问日期、接受/拒绝来源及未知项均已写入指定草稿路径；未解析 PDF，未给 RabbitInterview 最终方案。
