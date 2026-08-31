# 通用 AI 助手订阅证据报告（T1）

**基准日：** 2026-08-31  
**访问日期：** 2026-08-31  
**范围：** ChatGPT、Claude、Gemini、Microsoft Copilot、Perplexity 的个人、团队/商业和企业方案；开发者 API 仅用于划清计费边界。  
**口径：** 表内公开价格均为官方美国页面显示的 USD 标价（除非另注），税费通常另计；结账价、币种、税务处理和可售性受国家、付款渠道及合同影响。“更高/最高/近乎无限”等均不是无条件无限用量。

## 摘要

五家厂商都把面向人的助手订阅与面向应用的开发者 API 作为不同计费产品；尤其 OpenAI、Anthropic 和 Perplexity有官方文字明确说明订阅不含 API 使用。Google AI 与 Microsoft 365 Copilot 虽可能附带面向特定产品的 AI credits、Cloud credits 或 agent 权益，但这些不能概括成通用 API credits，开发者调用仍走 Google Cloud/AI Studio、Azure/Foundry 等独立计量。

公开个人方案的典型价格带从约 $20/月（ChatGPT Plus、Claude Pro、Google AI Pro、Perplexity Pro）到 $200/月（ChatGPT Pro、Claude Max 20x、Google AI Ultra 20x、Perplexity Max）；组织方案的价格结构差异更大，有按席位固定费、基础席位加 API 费、共享 credits/超额费以及询价合同。精确限额普遍会随模型、功能、请求复杂度和系统负载变化，因此采购比较不应把“x 倍用量”换算成固定消息数。

## 比较表

| 厂商 / 方案 | 客群与公开价格 | 周期、地区与税费 | 额度性质 / 达限后 | 管理与数据使用 | API 边界 |
|---|---|---|---|---|---|
| **ChatGPT Plus / Pro** | 个人；Plus **$20/月**，Pro **$200/月** | 个人方案月付；本地价格、应用商店价格及税费可能不同 | 模型和功能有动态限额；符合条件的账户可在包含额度耗尽后购买 ChatGPT flexible-usage credits；无余额时等待重置、换模型/功能或升级 | 个人内容可能用于训练，但用户可关闭训练；Temporary Chat 不用于训练并按官方规则删除 | ChatGPT 账单与 API Platform 账单分离；ChatGPT credits **不是 API credits** |
| **ChatGPT Business** | 团队自助；Standard **$25/席/月（月付）** 或 **$20/席/月（年付）**；Premium **$125/月付** 或 **$100/月（年付）** | 按席位；发票、PO、ACH、净账期等通常需合同方案 | 席位先消耗包含限额；工作区可选购共享 credits 续用，耗尽则高级功能暂停/阻塞 | 集中管理；组织数据默认不用于模型训练 | 官方明确 Business 与 API Platform 分开，**不含 API usage** |
| **ChatGPT Enterprise** | 大型组织；**询价** | 通常年约，具体最低承诺、币种、credits 与超额条款见 Order Form | 新式 flexible pricing 使用合同共享 credits，可设 RBAC、告警和 overage；耗尽且未启用超额时高级功能暂停 | SSO/SCIM、企业控制；组织输入输出默认不训练 | API 为独立产品/账单，除非合同明确另购，不能视为包含 |
| **Claude Pro** | 个人；**$20/月** 或 **$200/年（折合约 $17/月）** | 月付或年付；标价不含适用税，地区本币价可能不同 | 至少为 Free 每 5 小时会话用量的 5x，并另有周限额；达到限额可等待、升级，或开启 usage credits 按标准 API 费率续用 | 个人方案训练为 opt-out；包含 Claude Code，但网页/桌面/移动/Code 共用额度池 | 付费 Claude 订阅不含 Console/API；转用 API credits 会独立收费 |
| **Claude Max 5x / 20x** | 个人；**$100/月 / $200/月** | 官方说明 Max 月付；定价页功能矩阵一度显示月/年，正文则明确两档均月付，故以正文为准 | 每 5 小时会话约为 Pro 的 5x/20x，另有周/月/模型限制；可启用 usage credits | 优先访问与较高输出限额；个人数据训练可退出 | 同上，API/Console 独立 |
| **Claude Team** | 2–150 人；Standard **$25/席/月（月付）** 或 **$20/席/月（年付）**；Premium **$125/$100** | 月付或年付；税另计 | Standard 高于 Pro，Premium 为 Standard 的 5x；达到限额可按可用规则处理 | 集中账单、SSO、连接器管理；内容默认不训练 | 订阅与 API/Console 是独立产品 |
| **Claude Enterprise** | 自助基础价 **$20/席/月 + 按 API rates 计量使用**；年付；销售协助可询价 | 年约；费用随模型与任务扩展 | 消耗式计费，可设用户/组织 spend limits | Team 能力加 SCIM、审计、细粒度 RBAC、保留策略、IP allowlist；默认不训练 | 这里的“usage at API rates”是 Enterprise 方案自身合同计量，不等于附送可用于任意开发应用的 API credits；Console/API 权限仍应按合同核实 |
| **Google AI Plus / Pro / Ultra** | 个人 Google 账户；美国公开页可核验 Pro **$19.99/月**；Ultra 5x **$99.99/月**、20x **$199.99/月**。Plus 价格强烈地区化，本次未可靠取得美国结账价 | 仅个人、自主管理且通常须 18+；覆盖国家与功能因地区而异。Pro 官方帮助称可选月/年，但年价须在账户结账页确认 | Gemini 按计算量计数，5 小时重置并有周上限；Plus/Pro 分别约 Free 的 2x/4x，Ultra 为 Pro 的 5x/20x；达限可退回 Flash-Lite、等待/升级；Pro/Ultra 可买 Google One AI credits 用于受支持的 Gemini/Flow/Antigravity | 个人 Google 条款与隐私控制适用；家庭共享权益不等于每位成员独立额度/购买权 | Google One AI credits 是指定消费产品 credits；Pro 另含每月 $10 Google Cloud credits（Ultra 数额按档位），不能推断为无限或通用 Gemini API 调用额度 |
| **Google Workspace / Gemini 商业与企业** | Gemini 高级能力已包含于若干 Workspace Business/Enterprise 版；AI Expanded Access 为符合条件版本的附加项，**本地币种与期限决定价格**；Enterprise 销售方案依合同 | Flexible 或 annual/fixed-term；地区、版本和迁移状态影响名称与可售性 | 各 Workspace 功能有按日/月的独立限制；附加项扩大量级，不是单一消息池 | Admin Console 集中管理；企业级数据保护随 Workspace 条款 | Workspace/AI Expanded Access 权益不等于 Google Cloud Vertex AI / Gemini API credits；须单独启用和计费 |
| **Microsoft 365 Personal / Family / Premium** | 个人/家庭；美国年付 **$99.99 / $129.99 / $199.99** | 自动续费；地区页面会显示不同币种和价格。Family/Premium 最多 6 人，但 AI 权益仅订阅所有者 | Personal/Family 各 60 AI credits/月用于指定 M365/Windows 功能；Premium 为更高/“extensive”限额，另有按功能日/月上限；达限时相关 AI 功能受限直至重置 | 消费账户控制；不是工作团队管理方案 | M365 AI credits 不是 Azure OpenAI/Foundry API credits；Azure 模型按 token 或预置吞吐独立收费 |
| **Microsoft 365 Copilot Business** | Business Premium with Copilot **$32/用户/月（年付）**；Business Standard with Copilot **$23.50**；Copilot Business add-on 标价 $21，**2026-07-01 至 12-31 首年促销 $18** | 年度承诺；最多 300 用户；add-on 需符合条件的 M365 基础许可证 | 包含型功能与 agent/扩展计量并存；具体取决于许可证 | 商业管理、身份与合规随 M365 套件 | Copilot Studio PAYG、Azure AI/Foundry 及其他 API/agent meters 分开；不得把席位费视为 API 包月 |
| **Microsoft 365 Copilot Enterprise** | Copilot Chat 对符合条件 M365/Entra 用户可无附加费；完整 Microsoft 365 Copilot **$30/用户/月（年付）**，且需符合条件的基础许可证 | 年约；最终价格以地区结账/合同为准 | 完整许可证包含多项 agent 使用；无完整许可证时，访问租户共享数据的 agent 可按 Copilot Credits 计量；预付用尽且无 PAYG 时停止，连接 Azure PAYG 则继续收费 | EDP、管理、合规、分析等依许可证 | Microsoft 365 Copilot APIs 对持完整许可证的用户在官方列明范围内可无额外费，但 Azure OpenAI/Foundry 和 Copilot Studio 的其他 meter 仍是独立服务；不能泛化为任意 API credits |
| **Perplexity Pro / Max** | 个人；Pro **$20/月**；Max **$200/月**（官方 pricing 页） | 具体年付优惠及本币税价应以账户结账为准，本次未从稳定官方 HTML 完整核验 | Pro 无固定每月 Computer credits（新用户可能有一次性 4,000）；Max 每月 10,000 Computer credits；可自动补充，Max 默认每账期额外消费上限 $200、可调高 | Consumer Free/Pro/Max 的 AI data retention 默认开启，可在设置退出训练；退出只影响之后收集的数据 | API 无需 Pro，按 PAYG 另购；**API Credits 与 Computer Credits 分开** |
| **Perplexity Enterprise Pro / Max** | Pro **$40/席/月** 或 **$400/席/年**；Max **$325/月** 或 **$3,250/年** | 按席位；年付/发票条件见组织设置或销售合同 | Enterprise Pro 每月 500 Computer credits；Max 15,000（促销 bonus 会过期且不应计入常态额度）；可混配席位 | 组织管理、协作；Enterprise 查询不用于训练，文件默认仅保留 7 天，并可有更强保留控制 | Enterprise Pro 官方明确不含 API access；API Platform 另行购买 credits/PAYG |

## 关键发现

1. **“订阅 credit”不是跨产品货币。** OpenAI 的 ChatGPT credits、Google One AI credits、Microsoft 365 AI/Copilot Credits 和 Perplexity Computer Credits 都只适用于各自列明的助手功能；至少 OpenAI 和 Perplexity还直接标注它们不是 API credits。采购和成本模型必须为助手席位与应用 API 建立两条预算线。[OpenAI billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) · [Anthropic API separation](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console) · [Perplexity API billing](https://www.perplexity.ai/help-center/en/articles/10354847-api-payment-and-billing)

2. **固定月费通常只买到“包含限额”，不是固定消息数或绝对无限。** Claude 明确按五小时滚动窗口、周限额、对话复杂度和模型共同计量；Gemini 也改用计算量并设置五小时与周上限；Microsoft 按功能分 credits/日限额；OpenAI 的所谓 unlimited/virtually unlimited 仍受 abuse guardrails 和模型额度约束。[Claude pricing](https://www.anthropic.com/pricing) · [Gemini limits](https://support.google.com/gemini/answer/16275805?hl=en-gb&ref_topic=13194540) · [Microsoft limits](https://support.microsoft.com/en-us/microsoft-365-copilot/ai-credits-and-limits-for-microsoft-365-subscriptions) · [OpenAI rate card](https://help.openai.com/en/articles/11481834)

3. **组织方案正在从纯席位费转向席位 + 消耗混合。** ChatGPT Business 可在席位包含额后用共享 credits；Claude Enterprise 是 $20/席/月再按 API rates 消耗；Microsoft 的 agent/tenant grounding 可走 Copilot Credits/PAYG；Perplexity 将 Computer 与 API credits 分开。预算比较必须包含超额停止行为、自动充值和 spend cap，而不只比较席位标价。[OpenAI flexible pricing](https://help.openai.com/en/articles/11487671) · [Claude pricing](https://www.anthropic.com/pricing) · [Microsoft cost considerations](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/cost-considerations) · [Perplexity credits](https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity)

4. **团队/企业的数据承诺明显强于默认消费账户。** OpenAI Business/Enterprise/API 默认不训练；Claude Team/Enterprise 默认不训练；Perplexity Enterprise 永不用于训练，而其消费方案默认开启但可退出。个人账户不应被当作敏感公司资料的等价替代品。[OpenAI business data](https://openai.com/business-data/) · [Claude pricing](https://www.anthropic.com/pricing) · [Perplexity data collection](https://www.perplexity.ai/help-center/en/articles/11564572-data-collection-at-perplexity.html)

5. **取消不等于退款。** ChatGPT、Claude 和 Google 均允许取消后使用至当期结束，但一般不自动退还已支付周期；当地消费者法、误购窗口和 App Store 渠道可能例外。Microsoft 商业促销明确给出 7 天按比例退款窗口，但一般条款仍需按购买渠道核实。[OpenAI cancellation](https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-plus-or-chatgpt-pro-subscription) · [Claude pricing / billing FAQ](https://www.anthropic.com/pricing) · [Gemini subscriptions](https://gemini.google/subscriptions/) · [Microsoft business pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)

6. **地区化是实质变量而非脚注。** Google 抓取页本次按网络地区返回新台币价，而美国搜索索引返回美元价；Microsoft 同一路径在不同 locale 显示 USD/CAD/NZD；Anthropic明确当地币种、税含/不含可能不同。因此本表美元只能用于同地区粗比，不能作为最终采购报价。

## 取消、退款、超限与数据承诺速查

| 厂商 | 取消 / 退款 | 超限 | 数据训练默认值（本报告范围） |
|---|---|---|---|
| OpenAI | 至少提前 24 小时取消以免续费；取消不自动退款；误购通常须在 14 天内申请，EU/UK/Turkey 等依法有特殊权利；Apple 退款找 Apple | 等待重置、受支持功能购买 credits；组织池耗尽且无 overage 时暂停/阻塞 | 个人可能训练、可 opt-out；Business/Enterprise/API 默认不训练 |
| Anthropic | 随时取消、当期末生效，建议至少提前 24 小时；通常不退款，EEA/UK 14 天撤回权等例外 | 等待、升级，或付费方案打开 usage credits 按 API rates 继续 | 个人 opt-out；Team/Enterprise 默认不训练 |
| Google | 可随时取消；当期剩余时间通常不退，法律另有规定除外 | Gemini 可回退 Flash-Lite或等待/升级；Pro/Ultra 可购买受支持产品 AI credits | 消费与 Workspace 使用不同条款；本次未找到足以压缩为单一“默认训练/不训练”结论的同页官方声明，须按账户类型查 Gemini Privacy Hub / Workspace terms |
| Microsoft | 消费订阅自动续费并按账户/商店规则取消；商业 2026 促销有 7 天按比例退款窗口 | 功能限额重置；企业 credits 用尽则停止，或 Azure PAYG 自动超额 | 依 Consumer / Commercial Data Protection 及租户配置；本次不把复杂条款简化成全产品单一默认值 |
| Perplexity | 升级/迁移时官方说明可按未用时间产生抵扣；普通取消退款的统一官方规则本次未完整核验 | Computer credits 可购买/auto-refill；API PAYG 独立 | Consumer 默认 retention 开启、可退出后续训练；Enterprise 永不训练 |

## 来源清单

### 接受（官方 HTML / Help / Docs）

- [OpenAI — ChatGPT pricing](https://openai.com/chatgpt/pricing/) — 当前个人、Business、Enterprise 方案入口与计费周期。
- [OpenAI — What is ChatGPT Business?](https://help.openai.com/en/articles/8792828) — Business 席位价格、API 明确分离、支付能力边界。
- [OpenAI — Flexible pricing](https://help.openai.com/en/articles/11487671) — Business/Enterprise credits、达限与有效期。
- [OpenAI — Managing ChatGPT and API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) — 两套账单的直接证据。
- [OpenAI — Using Credits for Flexible Usage](https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-plus-pro) — 明确 ChatGPT credits 非 API credits。
- [OpenAI — Data use](https://openai.com/policies/how-your-data-is-used-to-improve-model-performance/) — 个人可退出、商业默认不训练。
- [OpenAI — Cancellation](https://help.openai.com/en/articles/7232927-how-do-i-cancel-my-chatgpt-plus-or-chatgpt-pro-subscription) 与 [refund](https://help.openai.com/en/articles/7232895) — 取消、渠道和退款例外。
- [Anthropic — Plans & Pricing](https://www.anthropic.com/pricing) — 个人/Team/Enterprise 价格、用量、税、训练、取消与 API 标价；本次成功抓取全文。
- [Anthropic — Paid plan vs API](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-claude-pro-why-do-i-have-to-pay-separately-for-api-usage-on-console) — API 不包含的直接证据。
- [Anthropic — Use Claude Code with Pro/Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan) — 共用额度池与切换 API 后收费。
- [Google — Gemini subscriptions](https://gemini.google/subscriptions/) 与 [Google One AI plans](https://one.google.com/about/google-ai-plans/) — 当前个人档位、地区与额度倍数。
- [Google — Gemini limits](https://support.google.com/gemini/answer/16275805?hl=en-gb&ref_topic=13194540) — 五小时/周限制及回退行为。
- [Google — Purchase AI credits](https://support.google.com/googleone/answer/17103110?hl=en) — credits 适用范围和可售限制。
- [Google Workspace — Compare AI expansion add-ons](https://knowledge.workspace.google.com/admin/getting-started/editions/compare-google-ai-expansion-add-ons) — 商业附加项与按功能限制。
- [Microsoft — Individual pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/individuals) — 美国个人年价与 Family AI 不共享。
- [Microsoft — Business pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing) — 商业捆绑、add-on、促销与前置许可证。
- [Microsoft — Enterprise pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/enterprise) — $30、Copilot Chat、metered agents。
- [Microsoft — AI credits and limits](https://support.microsoft.com/en-us/microsoft-365-copilot/ai-credits-and-limits-for-microsoft-365-subscriptions) — 消费 credits 与功能限额。
- [Microsoft — Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) — API/模型独立 token 或 PTU 计费。
- [Perplexity — Pricing](https://www.perplexity.ai/enterprise/pricing) — 个人 Pro/Max 当前月价。
- [Perplexity — Enterprise organization pricing](https://www.perplexity.ai/help-center/en/articles/10352988-creating-a-new-organization) — Enterprise Pro 月/年席位价。
- [Perplexity — Enterprise Max](https://www.perplexity.ai/help-center/en/articles/12310544-what-is-enterprise-max.html) — Enterprise Max 月/年价格和升级抵扣。
- [Perplexity — API billing](https://www.perplexity.ai/help-center/en/articles/10354847-api-payment-and-billing) — API 独立、无需 Pro。
- [Perplexity — Credits](https://www.perplexity.ai/help-center/en/articles/13838041-how-credits-work-on-perplexity) — Computer credits 数量、购买和 cap。
- [Perplexity — Data collection](https://www.perplexity.ai/help-center/en/articles/11564572-data-collection-at-perplexity.html) — 消费 opt-out 与 Enterprise 不训练。

### 拒绝 / 未采用

- **Anthropic List Prices PDF（2026-05-12、2026-05-27）** — 计划明确要求不解析 PDF；且当前 HTML pricing 已提供更新资料。
- **重复 locale / alias 页面**（如 OpenAI `/ChatGPT/pricing` 大小写别名、Perplexity `.html` 别名、Microsoft `pricing-new`）— 与规范 URL 内容重复，避免重复计权。
- **Google Workspace Blog 的 AI Ultra for Business 发布文** — 历史产品发布内容；2026-07 后名称/迁移已变化，以当前 Help 页面为准。
- **Google AI Ultra Access 旧版说明** — 记录了 2026-07-07 的迁移，不能作为当前普遍可售方案价格；仅用于识别名称变化，未进入价格表。
- **Microsoft 普通 M365 Business pricing 页面** — 自动访问被阻挡且不是 Copilot 专项价格的必要证据。
- **任何第三方比较站、新闻报道、论坛帖子** — 官方资料足以支撑核心结论，未采用。
- **搜索摘要中无法在稳定官方 HTML/Help 正文复核的年价或促销价** — 不写入确定价格，列为不确定项。

## 仍不确定与残余风险

1. **高（价格时效）：** 这些页面会按登录状态、IP/locale、实验组和促销实时变化；Google 抓取直接返回 TWD，而搜索索引返回 USD。正式采购前应在目标国家、目标账户和目标付款渠道截图结账页，并向企业销售取得 Order Form。
2. **高（额度不可直接比较）：** 五家均可按模型、功能、计算复杂度或公平使用动态调整额度，公开的 2x/5x/20x 不是跨厂商共同单位，无法可靠换算“每美元消息数”。
3. **中（Google API 边界）：** Google AI Pro 当前官方帮助列出每月 $10 Google Cloud credits，Ultra 也可能有按档位 Cloud credits；这些是有限云抵扣而不是消费订阅直接包含的通用 Gemini API 配额。具体可抵扣 SKU、到期和地区资格需在目标账户 Benefits/Cloud Billing 核验。
4. **中（Microsoft 权益交叉）：** 完整 M365 Copilot 许可证可能覆盖特定 Copilot APIs/agents，但 Azure OpenAI、Foundry、Copilot Studio BYOM 与其他 meters 仍独立。实际架构需逐 API 对照 Microsoft cost-considerations 表，不能用“API 全含/全不含”概括。
5. **中（Claude 页面内部差异）：** Claude pricing 的 Max 正文称两档均月付，但功能矩阵显示个人付费方案支持 monthly and annual；本报告采用更具体的正文，年付可售性应在账户结账页复核。
6. **中（退款）：** Google、Microsoft 和 Perplexity 的退款权利高度依购买渠道和司法辖区；本次没有得到可覆盖所有地区/产品的单一官方规则，不能据表推断退款资格。
7. **低（Perplexity 年价）：** 当前稳定官方摘要足以核验个人月价，但未完整核验 Pro/Max 个人年付价，因此有意不列；Enterprise 月/年价有 Help Center 直接证据。

## Review findings

- **info — `outputs/.plans/ai-tool-subscriptions-T1.md`:** 目标要求的五家助手、个人/团队/企业、API 边界、额度、取消退款、数据承诺及来源接受/拒绝清单均已覆盖。
- **warning — 本报告比较表 Google 行：** 地区动态定价导致抓取 locale 与美国索引不一致；已明确限定美元口径并保留结账核验风险。
- **warning — 本报告比较表 Microsoft 行：** 特定 M365 Copilot APIs 可随完整许可证包含，不能把 Microsoft 简化成所有 API 均另收费；报告已按产品边界限定。
- **no blocker:** 未发现阻止提交研究报告的问题。

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "完整证据报告已写入指定 draft 路径；Review findings 按 info/warning/no blocker 标注，并在‘仍不确定与残余风险’中按高/中/低严重性记录风险。"
    }
  ],
  "changedFiles": [
    "/Users/thomas/.pi/agent/sessions/--Volumes-aiiltti-Project-orca-ai-rabbit-interview-main-3--/subagent-artifacts/outputs/74629718-a093-411d-9500-43d9fae2fe17/outputs/.drafts/ai-tool-subscriptions-research-assistants.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "read outputs/.plans/ai-tool-subscriptions-T1.md",
      "result": "passed",
      "summary": "读取并按目标、证据和交付要求执行。"
    },
    {
      "command": "focused official-source web research and selected full-page fetches",
      "result": "passed",
      "summary": "检索五家官方 pricing/help/docs；Anthropic、Gemini、Microsoft 页面取得正文，部分 403 页面以官方搜索索引内容交叉核验。"
    },
    {
      "command": "write evidence report to authoritative draft path",
      "result": "passed",
      "summary": "报告成功写入运行时指定绝对路径。"
    }
  ],
  "validationOutput": [
    "覆盖 ChatGPT、Claude、Gemini、Microsoft Copilot、Perplexity。",
    "包含比较表、关键发现、精确 URL、访问日期、接受/拒绝来源和不确定项。",
    "明确区分助手订阅 credits、特定产品 credits 与开发者 API 计费。"
  ],
  "residualRisks": [
    "高：地区、登录态和促销会改变价格与可售性，采购前须核验目标账户结账页/Order Form。",
    "高：动态公平使用和按计算量限额无法换算为跨厂商统一消息数。",
    "中：Google Cloud credits 与 Microsoft 特定 licensed APIs 形成有限例外，不能用简单的‘所有 API 均不含’概括。",
    "中：部分退款和年付可售性只能在目标地区、渠道与账户中最终确认。"
  ],
  "noStagedFiles": true,
  "diffSummary": "新增一份截至 2026-08-31 的五家通用 AI 助手订阅官方证据报告；未修改项目源代码。",
  "reviewFindings": [
    "warning: ai-tool-subscriptions-research-assistants.md (Google comparison row) - dynamic locale pricing requires checkout verification",
    "warning: ai-tool-subscriptions-research-assistants.md (Microsoft comparison row) - licensed Copilot API inclusions are narrow exceptions and must be checked per API",
    "no blockers"
  ],
  "manualNotes": "遵循计划要求未提出 RabbitInterview 最终选型建议；PDF 来源已明确拒绝。"
}
```
