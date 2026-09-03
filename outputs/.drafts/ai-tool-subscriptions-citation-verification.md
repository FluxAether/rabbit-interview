# AI 工具订阅报告 — 引用与主张核验

## 1. 核验范围与证据等级

| 项目 | 结果 |
|---|---|
| 草稿 | 已完整读取 `outputs/.drafts/ai-tool-subscriptions-draft.md` |
| 支持研究 | 已读取 assistants、coding、api、governance、project 五份研究笔记 |
| 项目源证据抽查 | 已抽查 `server/src/payments.rs`、`server/src/llm.rs`、`server/src/config.rs`、`docs/vendor_contract.md`、`docs/hosted_gateway_runbook.md`、`docs/PRIVACY.md` |
| 官方 URL 实时访问 | **未执行；工具无联网能力** |
| 内部研究产物交叉核验 | **已执行** |
| PDF | **未解析；所有 PDF 证据均按研究约束拒绝** |

## 2. 已纠正、移除或限定的声明

1. **纠正助手订阅/API 边界。**  
   原草稿容易被理解为所有 Google/Microsoft 助手权益都绝对不包含任何 API。候选稿改为：
   - OpenAI、Anthropic、Perplexity有明确分账证据；
   - Google/Microsoft 可能有指定消费 credits、Cloud credits 或窄范围 licensed APIs；
   - 这些不能推广为通用 Gemini API、Azure OpenAI 或 Foundry 后端容量。  
   证据：`ai-tool-subscriptions-research-assistants.md`“API 边界”及残余风险 3–4。

2. **纠正文本成本公式。**  
   原公式写成 `input_tokens + cached_tokens`，若 cached tokens 已包含于 input total，可能重复计费。候选稿改为 `uncached_input_tokens + cached_input_tokens + output_tokens`。  
   证据：`ai-tool-subscriptions-research-api.md`“可复算公式与示例”。

3. **限定“价格为当前官方价”。**  
   改为“研究笔记在 2026-08-31 记录的官方页面快照”；明确本 verifier 未实时重开 URL，不能保证发布或采购时价格未变。

4. **限定 Claude Enterprise 价格。**  
   改为公开自助方案基价 `$20/席/月 + usage at API rates`、年付；销售协助、旧 seat-based 合同和其他合同代际可能不同。  
   证据：assistants 与 coding 两份研究笔记的 Claude Enterprise 行。

5. **限定开发席位的生产授权结论。**  
   不再笼统声称所有工具在所有合同下“绝对禁止”嵌入；改为“公开席位证据本身不足以授予产品后端或转售权，除非另有明确 API/合同”。Windsurf MSA 的内部业务使用和不可转许可仍是直接证据。

6. **限定 Hosted 实际模型验证状态。**  
   补充说明 Gemini 已有一次真实流式协议 smoke test，但取消、断流和账单尚未对账；避免把“没有账单验证”误写成“完全没有真实调用验证”。  
   证据：`docs/vendor_contract.md:19-39`。

7. **限定代理成本情景。**  
   明确 Deepgram Monolingual 与 Gemini 3.5 Flash 只用于算术代理，项目 Hosted 实际为 Volcengine 与默认 `gemini-3.7-flash`；不能用于推导毛利、质量或生产 SKU 成本。

8. **纠正“免费入口”措辞。**  
   原最终建议中的“BYOK/Apple 免费入口”改为“无 Rabbit Hosted 收费入口”。BYOK 上游 API 仍可能由用户付费，不能泛称免费。

9. **限定套餐内单位价格。**  
   明确 ¥5.93/source-hour、¥44.50/1M units 等只是用同一商品价格分别除以两个配额桶的“内含比率”，不能相加或视作供应商成本。

10. **移除未有项目证据支持的支付拒付指标。**  
    运营看板保留支付成功、失败和退款；没有把信用卡式“拒付”作为当前支付宝实现已有事实。

11. **限定完整商品周期建议。**  
    仓库明确门槛是至少七天对账；“最好覆盖完整商品周期”保留为推荐，不写成已存在的硬性生产要求。

12. **限定 10% 地域成本说法。**  
    改为 OpenAI、Anthropic、GitHub 各自已核验的具体 uplift/multiplier 示例，不再暗示所有供应商和所有驻留方案都统一加价 10%。

## 3. 未支持声明处理结果

以下声明没有足够证据作为确定事实，已从候选稿移除或改为明确的未知项：

- 官方 URL 在成稿时仍实时显示完全相同价格、促销和额度；
- ¥89/¥199 已验证毛利或已可公开生产售卖；
- Deepgram/Gemini 代理情景等于 Volcengine/`gemini-3.7-flash` 实际 COGS；
- 不同模型或 STT 服务质量、延迟和语言能力等价；
- Rabbit Gateway 不持久化内容意味着上游 ZDR；
- BYOK API 使用没有成本；
- Cursor/Windsurf/Claude 的“×倍”可换算为固定 token 或 prompt 数；
- spend cap 能保证绝对实时零超支；
- 普通 PAYG 或带有 Enterprise 名称的产品自动包含固定公开 SLA；
- 所有开发席位在任何可能的单独合同下都绝对不能嵌入；候选稿只对公开席位授权作出边界结论。

**候选稿中未保留其他无来源支撑的重大确定性事实。**

## 4. 单一来源的关键声明

以下重大数字或政策目前主要依赖一个官方页面在研究笔记中的快照，发布前应优先实时复核：

| 声明 | 当前内部证据 | 风险 |
|---|---|---|
| Gemini 3.5 Flash 至 2026-12-31 促销价及 2027-01-01 调价 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) | 高：未来价格与促销日期直接影响情景 |
| Deepgram Nova-3 streaming 促销及 regular 价格 | [Deepgram pricing](https://deepgram.com/pricing) | 高：促销没有结束日 |
| OpenAI `gpt-5.6-luna` 单价 | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) | 中：只用于示例，但模型表可能快速变化 |
| Claude Sonnet 5 单价 | [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) | 中：只用于示例，模型价格可能更新 |
| Windsurf MSA 内部业务使用、不可转许可边界 | [Windsurf MSA](https://windsurf.com/MSA) | 高：授权结论最终仍受目标合同版本影响 |
| OpenRouter 5.5% credit 购买平台费与 BYOK allowance | [OpenRouter pricing](https://openrouter.ai/pricing) 和 BYOK 文档 | 中：平台政策曾发生迁移 |
| Rabbit 商品金额和配额 | `server/src/payments.rs:30-65`、`docs/vendor_contract.md:7-18` | 中：内部有双源，但均属同一预生产实现，不是市场报价 |
| Hosted 默认 `gemini-3.7-flash` | `server/src/config.rs:91-120`、`docs/vendor_contract.md` | 高：只证明配置意图和一次协议 smoke test，不证明正式 SKU 价格或长期可售性 |

## 5. 计算核验

| 计算 | 结果 |
|---|---|
| 每场 LLM tokens | `15 × (8,000 + 1,000) = 135,000`，正确 |
| 10/100/1,000 场 LLM | 1.35M / 13.5M / 135M，正确 |
| 双音源 STT | 每场 `60 × 2 = 120 source-min`；低/中/高为 1,200 / 12,000 / 120,000 分钟，正确 |
| Deepgram 促销 | 低/中/高为 $5.76 / $57.60 / $576，正确 |
| Deepgram regular | 低/中/高为 $9.24 / $92.40 / $924，正确 |
| Gemini 2026 代理成本 | $1.4625 / $14.625 / $146.25，正确 |
| Gemini 2027 代理成本 | $2.925 / $29.25 / $292.50，正确 |
| 代理合计 | $7.2225/$12.165；$72.225/$121.65；$722.25/$1,216.50，全部正确 |
| 100 小时语音示例 | OpenAI $27、Gemini ≈$30、Groq $4、Deepgram $28.80/$46.20/$25.80，正确 |
| 月包 STT 内含比率 | `89/15 = 5.9333`，正确 |
| 季包 STT 内含比率 | `199/50 = 3.98`，正确 |
| 月/季 LLM 内含比率 | `89/2 = 44.50`；`199/8 = 24.875`，正确 |
| 季包月均 | `199/3 = 66.33`，正确 |
| 季包价格倍数 | `199/89 = 2.236×`，正确 |
| STT/LLM 配额倍数 | 3.333× / 4×，正确 |
| STT/LLM 名义单位折扣 | 约 32.9% / 44.1%，正确 |
| 双音源理论面试数 | 月包 7.5、季包 25；单音源 15/50，正确 |
| 2M/8M units 对 9k-token 示例 | 约 222/888 次；8M 精确商为 888.89，候选稿使用向下近似并明确不是保证 |

## 6. PDF 限制状态

**通过。**

- 本次未抓取、读取或解析任何 PDF。
- 研究笔记明确拒绝 Anthropic List Prices PDF、Windsurf MSA PDF、GitHub 产品条款 PDF 和其他 PDF。
- Windsurf 授权结论使用官方 HTML `https://windsurf.com/MSA`。
- 候选稿没有依赖 PDF 才能成立的核心声明。

## 7. 推荐验证状态

# **PASS WITH NOTES**

理由：

- 所有保留的重大价格、额度、政策、公式、项目事实和建议边界，都能在五份研究笔记、其官方链接记录或抽查的仓库源文件中找到对应证据。
- 原草稿中的重复计费公式、过宽 API 分账表述、“免费入口”、代理 SKU 与实际 Hosted COGS 混淆等问题已在候选稿中纠正或限定。
- 不评为无条件 PASS，是因为本 verifier 无法实时重开官方 URL；若干高影响价格和促销又依赖单个动态官方页面。
- 正式发布或采购前，必须实时复核 Gemini、Deepgram、GitHub 计费迁移、OpenRouter 费用、目标地区结账价，以及目标合同的嵌入、保留、驻留和 SLA 条款。
- RabbitInterview 的生产发布仍被 Volcengine、Gemini 账单对账和支付宝生产门阻挡；这不阻止本研究报告发布，但阻止把候选商品描述为生产就绪。