# AI 工具订阅报告最终对抗性核验

## Checks performed

已完成以下只读检查，未修改任何文件、未委派子任务：

1. 完整阅读：
   - `outputs/.drafts/ai-tool-subscriptions-cited.md`
   - `outputs/.drafts/ai-tool-subscriptions-citation-verification.md`
   - `outputs/.drafts/ai-tool-subscriptions-research-assistants.md`
   - `outputs/.drafts/ai-tool-subscriptions-research-coding.md`
   - `outputs/.drafts/ai-tool-subscriptions-research-api.md`
   - `outputs/.drafts/ai-tool-subscriptions-research-governance.md`
   - `outputs/.drafts/ai-tool-subscriptions-research-project.md`

2. 直接抽查相关项目事实：
   - `server/src/payments.rs:42-68`：¥89/¥199、30/90 天、STT/LLM 配额。
   - `server/src/config.rs:101-109`：Volcengine 配置和默认 `gemini-3.7-flash`。
   - `server/src/llm.rs:263-300`：usage 估算、`max(total, input+output+reasoning)`、`FINAL/ESTIMATED`。
   - `src/lib/settingsStore.ts:42-106`：默认 BYOK、默认 Deepgram。
   - `src/lib/hostedAuth.ts:12-22`、`src/lib/readiness.ts:98-125`：独立 STT/LLM entitlement 与余额硬闸。
   - `docs/vendor_contract.md:7-45`：冻结商品、一次 Gemini smoke test、未完成的供应商/支付验证和生产门。
   - `docs/hosted_gateway_runbook.md:3,43,146-163`：pre-production、一次性支付、无自动续费、`PAYMENTS_ENABLED=false` 条件。
   - `docs/PRIVACY.md:5-35`：本地内容、上游转发、网关持久化范围和删除缺口。

3. 重新复算：
   - 低/中/高三档 STT、LLM 和代理总成本。
   - 100 小时 STT 示例。
   - ¥89/¥199 的单位配额比率、折扣和理论面试次数。
   - 2M/8M units 对 9,000 token/次的换算。

4. 核对：
   - 外部数字是否能追溯到研究笔记中的官方来源。
   - 表格所列 URL 是否实际覆盖该行全部精确数字。
   - 代理 SKU 与项目 Hosted SKU 是否混淆。
   - no-training、ZDR、驻留、SLA 是否被过度推广。
   - ¥89/¥199 是否被描述成已上线或已验证。
   - PDF 禁令是否被遵守。

---

## Correct

以下内容正确且已有足够证据：

- 三本账——员工助手、开发者编码席位、产品后端 API——划分正确，并对 Google/Microsoft 的有限权益例外作了合理限定。
- API 成本公式已避免把 cached input 与包含它的总 input 重复相加。
- Deepgram/Gemini 规划情景被明确标为代理情景，不是 Volcengine/`gemini-3.7-flash` 实际 COGS，也未声称供应商质量等价。
- 低/中/高三档代理成本、100 小时语音成本、¥89/¥199 配额比率、季包折扣和单双音源场次换算均正确。
- 网关 LLM units 的解释与 `server/src/llm.rs:263-300` 一致：使用 provider usage 时取 `max(total_tokens, input+output+reasoning)`，非正常完成时可能采用估算并标记 `ESTIMATED`。
- 默认 BYOK、默认 Deepgram、Hosted 使用 Volcengine/Gemini、独立 STT/LLM 配额桶等项目事实与本地源文件一致。
- “Rabbit 网关不持久化内容”没有被错误推广成 Volcengine/Gemini 上游 ZDR。
- 助手/编码席位不应被当作 RabbitInterview 最终用户生产后端容量的结论合理，并保留了“另有明确 API/合同”例外。
- spend cap 传播延迟、普通 PAYG 不自动获得 Scale Tier SLA、地区驻留承诺存在范围限制等边界陈述合理。
- 推荐保留 BYOK/Apple、避免过早预留容量和自动多供应商路由，与当前架构及尚未获得真实负载数据的状态一致。

### ¥89/¥199 的预生产边界

报告**没有**把 ¥89/¥199 表述成已上线或已验证价格，反而在多处明确限定：

- `ai-tool-subscriptions-cited.md:9`：不是已上线正式售价，也不是已验证毛利模型。
- `:19-20`：只能作为封闭试点候选商品，不能声称具备生产条件。
- `:291`：不宣传为已验证正式价。
- `:316`：生产门全部关闭后才转为正式商品。
- `:329-332`：正式定价未通过，支付阻止生产。
- `:357`：受控试点而非正式价格承诺。

这一关键要求满足。

---

## FATAL

**无 FATAL 问题。**

---

## MAJOR

### MAJOR-01 — 精确价格表的直接引用不完整，且证据来源描述过强

**位置：**

- `outputs/.drafts/ai-tool-subscriptions-cited.md:47-57`
- `outputs/.drafts/ai-tool-subscriptions-cited.md:71-81`
- `outputs/.drafts/ai-tool-subscriptions-cited.md:6,367`
- `outputs/.drafts/ai-tool-subscriptions-research-assistants.md:45,95,99,105,134-136`

**证据：**

1. 通用助手表的 Microsoft 行同时给出个人版和 Enterprise 精确价格，但表后只引用 Microsoft Enterprise pricing URL；个人版 `$99.99/$129.99/$199.99` 的直接来源是研究笔记列出的 Microsoft individual pricing。
2. Perplexity 行给出 Enterprise Pro/Max 月付及年付精确价格，但表后仅列通用 pricing URL；研究笔记显示 Enterprise 年价来自独立的 organization/Enterprise Max Help Center 页面。
3. 编程工具表给出 Windsurf 精确席位价，但引用列表缺少研究笔记使用的 Windsurf Pricing 页面；仅列 usage 和 MSA。
4. Gemini Code Assist 给出 `$22.80/$19/$54/$45`，但引用只列 quotas 页面；价格来源实际是 `codeassist.google/products/business`。
5. 报告声称外部证据为研究笔记摘录的“官方 HTML、帮助中心和开发文档”。然而 assistants 研究笔记明确说明 Google 美国价格来自官方搜索索引，直接抓取页返回 TWD，且部分 403 页面使用官方搜索索引交叉核验。这不等同于已经读取并摘录稳定官方 HTML 正文。

这些数字在研究笔记中有来源线索，但发布稿当前的行级引用不足以让读者从所列 URL 直接核验全部数字；“均为官方 HTML 快照”的表述也超过了实际取证强度。

**最小修复：**

- 在通用助手表来源中补充：
  - Microsoft individual pricing；
  - Perplexity organization pricing Help Center；
  - Perplexity Enterprise Max Help Center。
- 在编程工具表来源中补充：
  - Windsurf Pricing；
  - Gemini Code Assist business pricing；
  - 如保留 Claude Team 精确价格，补充 Claude plan/team pricing 直接页面。
- 将 `:6` 和 `:367` 改为类似：
  > “外部事实对照研究笔记记录的官方 HTML/Help/Docs；少数地区化或受访问限制的价格仅由官方搜索索引交叉核验，已单独标明，发布前需在目标账户结账页复核。”
- 或者删去无法由当前列出 URL 直接支持的精确数字，只保留范围和不确定性。

---

### MAJOR-02 — DPA 的实施时点前后矛盾，可能把必要的上游数据处理审查错误推迟到企业客户出现之后

**位置：**

- `outputs/.drafts/ai-tool-subscriptions-cited.md:310`
- `outputs/.drafts/ai-tool-subscriptions-cited.md:322`
- `outputs/.drafts/ai-tool-subscriptions-cited.md:331`
- `docs/PRIVACY.md:17-23`
- `outputs/.drafts/ai-tool-subscriptions-research-governance.md` 第 1、2、4 节

**证据：**

- 阶段 B 会把面试音频、问题、简历及回答上下文经 Rabbit Gateway 转发给 Volcengine/Gemini。
- `:310` 要求生产前冻结端点、合同、处理地域和子处理者。
- 决策矩阵 `:331` 又把 DPA 列为数据治理的最低可接受证据。
- 但阶段 C 的 `:322` 写成“企业客户真实出现后，再增加 DPA、SSO/SCIM……”，容易被理解为消费用户的 Hosted 付费试点或公开发布可先没有适当的上游 DPA/数据处理条款。
- DPA/处理条款是否需要不能仅由客户是否为企业决定；至少必须在处理真实用户内容前，按采购实体、地区和角色完成适用性评审。

**最小修复：**

将 `:322` 拆开为两层：

> “在阶段 B 处理真实 Hosted 内容前，完成适用的上游 DPA/数据处理条款、子处理者、保留和地域评审。企业客户真实出现后，再增加面向企业客户的 DPA/附录、SSO/SCIM、审计导出、客户可选驻留和合同 SLA。”

同时在“进入阶段 B 的门”中明确加入：

> “适用的上游 DPA/数据处理条款和隐私评审已批准。”

---

### MAJOR-03 — “P95 毛利”指标方向错误，可能让定价门只验证高毛利尾部

**位置：**

- `outputs/.drafts/ai-tool-subscriptions-cited.md:23`
- `outputs/.drafts/ai-tool-subscriptions-cited.md:312`
- 对照 `:300-307` 的 P50/P95 单用户成本指标和 `:345-346` 的尾部重度用户风险

**证据：**

报告希望防止尾部重度用户导致亏损，但写成“目标 cohort 的 P95 毛利稳定”。如果按用户毛利分布计算，P95 毛利代表高毛利端，而不是高成本/低毛利端；即使大量重度用户亏损，P95 毛利仍可能很好。

后文“目标 P95 cohort”也没有定义是按成本、用量还是毛利排序，无法作为明确的调价门。

**最小修复：**

把两处统一改成：

> “只有目标 cohort 的 P95 单用户全量 COGS 及其对应毛利仍达到内部阈值后……”

或者明确使用低尾毛利：

> “只有目标 cohort 的 P5 单用户毛利仍达到内部阈值后……”

并注明样本窗口和最低样本量；不要继续使用未定义的“P95 毛利/P95 cohort”。

---

## MINOR

### MINOR-01 — 8M units 的近似值写法不准确

**位置：** `outputs/.drafts/ai-tool-subscriptions-cited.md:248-250`

**证据：**

```text
8,000,000 / 9,000 = 888.888...
```

按通常四舍五入，`≈ 889`；只有按“可完整执行的次数向下取整”才是 888。引用核验稿声称这是向下近似，但正式报告没有说明取整规则。

**最小修复：**

二选一：

- 改为 `≈ 889 次`；或
- 改为 `最多 888 次完整调用（向下取整）`。

---

### MINOR-02 — “Hosted 使用独立生产 API 账户”容易被误读为当前已存在并验证的生产账户

**位置：** `outputs/.drafts/ai-tool-subscriptions-cited.md:17`

**证据：**

本地代码只能证明存在 `GEMINI_API_KEY`、`VOLCENGINE_API_KEY` 配置接口；`docs/vendor_contract.md:30-45` 明确显示真实 Volcengine 凭证、账单对账和生产门尚未完成。当前句子处于方案描述中，但使用陈述语气“使用独立生产 API 账户”，与 pre-production 状态容易混淆。

**最小修复：**

改为：

> “正式 Hosted 应使用与开发/个人席位隔离的生产 API 账户；当前真实凭证、合同和账单验证尚未完成。”

---

### MINOR-03 — “¥199 / 3 months”应明确是 30 天月等效，不是三个自然月

**位置：** `outputs/.drafts/ai-tool-subscriptions-cited.md:197-211`

**证据：**

商品期限是固定 90 天，不必然等于三个自然月。结果 ¥66.33 对“每 30 天等效”是正确的，但公式写成 `/ 3 months` 可能被理解为自然月订阅价格。

**最小修复：**

改为：

```text
¥199 × 30 / 90 days = ¥66.33 / 30-day equivalent
```

表头相应写成“每 30 天等效”。

---

## single-source critical claims

以下关键声明主要依赖单一动态官方页面或单一合同页面；这不表示当前结论错误，但发布/采购前应优先复核：

1. **Gemini 3.5 Flash 促销价和 2027-01-01 调价**
   - 单一主证据：Gemini API Pricing。
   - 风险：直接影响所有 Gemini 代理情景，且有明确生效日期。

2. **Deepgram Nova-3 streaming 促销价及 regular 价**
   - 单一主证据：Deepgram Pricing。
   - 风险：促销无公开终止日。

3. **OpenAI `gpt-5.6-luna`、Claude Sonnet 5 等快速变化 SKU 单价**
   - 各自主要依赖一个官方模型价格页。
   - 风险：目前只用于示例，不影响 Hosted 实际 COGS，但容易过时。

4. **Windsurf “仅内部业务使用、不可转许可”授权边界**
   - 单一主证据：Windsurf MSA HTML。
   - 风险：是禁止把席位代理给最终用户的重要合同结论；最终仍以目标账户接受的合同版本和 Order Form 为准。

5. **OpenAI Scale Tier 99.9% SLA 和最少 30 天 token-unit 要求**
   - 单一主证据：OpenAI Scale Tier 页面。
   - 风险：结论仅用于防止把 Scale SLA 推广到 PAYG，范围限定正确。

6. **项目默认 `gemini-3.7-flash` 及一次真实 smoke test**
   - 默认值由 `server/src/config.rs:108-109` 和 `docs/vendor_contract.md:9` 交叉支持；
   - 实际 smoke test 的结果主要由 `docs/vendor_contract.md:21` 单一内部记录支持。
   - 风险：不能证明正式 SKU 单价、合同支持或长期生产可售性。

7. **Rabbit 商品价格和配额**
   - 有 `server/src/payments.rs:51-67`、`docs/vendor_contract.md:12-14`、runbook 三处一致记录，因此不是纯单源；
   - 但三者都属于同一预生产实现，不能充当市场验证或毛利验证。

核心架构建议——席位/API 分账、保留 BYOK/Apple、Hosted 双配额、先对账后正式定价——由多份外部研究和多个本地文件共同支持，不是建立在单一供应商价格页上。

---

## residual unverified items

1. 本轮及前一轮 citation verification 均未实时打开官方 URL；无法确认 2026-08-31 之后价格、促销、额度和条款是否变化。
2. Google 美国价格的部分证据来自官方搜索索引而非稳定正文；目标国家、目标账户和实际付款渠道的结账价未核验。
3. 未核验任何目标采购实体的 Order Form、MSA、DPA、税务、VAT/GST、汇率或合同折扣。
4. Volcengine 真实 TLS/auth、短/长/静音音频、断线、请求 ID、错误映射和发票舍入仍未完成。
5. Gemini 取消、断流、`FINAL/ESTIMATED` 与厂商账单对账仍未完成。
6. 支付宝沙箱、公开 webhook、重复通知、退款、商户/回调域名和结算对账仍未完成。
7. 未获得 `gemini-3.7-flash` 和 Volcengine 实际 Hosted 合同单价，因此代理成本不能用于验证 ¥89/¥199 毛利。
8. 未建立真实 workload 的 token、source-duration、取消浪费、重试、P95 成本和低尾毛利分布。
9. 未完成中英混合、专有名词、WER、P50/P95 延迟、并发和故障恢复基准。
10. 上游内容保留、处理地域、子处理者和适用 DPA 尚未按最终端点/合同冻结。
11. 本次为只读审阅，没有运行构建、Rust 测试或供应商验证脚本；报告的项目事实来自静态源文件检查。

---

## PDF status

**符合 no-PDF 规则。**

- 本次未打开、抓取、读取或解析任何 PDF。
- 五份研究笔记均明确拒绝 Anthropic List Prices PDF、Windsurf MSA PDF、GitHub 产品条款 PDF 等来源。
- Windsurf 授权结论使用官方 HTML MSA。
- 未发现正式报告中存在只能由 PDF 支撑的核心声明。

---

## Lead remediation record

Reviewer 初始 verdict 为 **BLOCK**。Lead 已在 `outputs/.drafts/ai-tool-subscriptions-revised.md` 应用全部最小修复：

| Finding | 修复 |
|---|---|
| MAJOR-01 | 补 Microsoft individual、Perplexity organization/Enterprise Max、Windsurf Pricing、Claude plans/Team、Gemini Code Assist pricing 直接链接；把证据口径改为官方 HTML/Help/Docs + 少数官方搜索索引，并在地区价表后明示。 |
| MAJOR-02 | 将适用上游 DPA/数据处理、子处理者、保留、地域和隐私评审移到进入阶段 B 之前；阶段 C 仅增加面向企业客户的合同/治理能力。 |
| MAJOR-03 | 把“P95 毛利/P95 cohort”改为“P95 单用户全量 COGS 及其对应毛利”，并要求预先约定样本窗口和最低样本量。 |
| MINOR-01 | 8M/9k 改为约 889 次。 |
| MINOR-02 | 明确正式 Hosted **应**使用隔离的生产 API 账户，当前真实凭证、合同和账单验证未完成。 |
| MINOR-03 | 90 天套餐改为“每 30 天等效”，公式改为 `¥199 × 30 / 90 days`。 |

最终磁盘核验及精确命中/缺失检查记录在 provenance；本文件保留 reviewer 原始发现，供审计。

## final merge verdict

# **PASS WITH NOTES AFTER REMEDIATION**

- 无 FATAL。
- 3 个 MAJOR 与 3 个 MINOR 均已在 revised candidate 修复。
- 残留 notes 仍成立：官方 URL 未在 reviewer 阶段实时重开；动态价格/合同、Volcengine/Gemini 真实账单、支付宝生产证据及工作负载基准仍未验证。
- 该结论允许发布**研究报告**，不允许把 ¥89/¥199 或 Hosted Gateway 描述为生产就绪。