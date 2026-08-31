# RabbitInterview 项目证据笔记

- **检查日期：** 2026-08-31
- **范围：** 当前工作树（含未提交改动），只记录仓库可验证事实；不把预生产实现当作已上线能力。

## 1. 当前产品边界

1. RabbitInterview 是 Tauri 2 + React 19 的 macOS/Windows 桌面面试辅助工具；README 把现有模式描述为 BYOK，并要求 Deepgram STT 以及 Groq/OpenAI/Anthropic/Gemini 中至少一个 LLM 密钥（`README.md:1-25`）。
2. BYOK 模式下，应用直接请求厂商：Anthropic `v1/messages`、Gemini `streamGenerateContent`、Groq/OpenAI 兼容 chat-completions；hosted 模式则改为请求 Rabbit 网关的 `/v1/llm/answers`，并支持通过稳定 request ID 取消（`src/lib/llm.ts:223-367`）。所以个人 ChatGPT/Claude/Gemini 网页订阅不能替代这里的 API 账户或 hosted 网关。
3. 可配置密钥类型是 Groq、OpenAI、Anthropic、Gemini 和 Deepgram；`keyStore` 负责迁移旧存储、加密保存并清理旧 keychain 数据（`src/lib/keyStore.ts:11-95`）。默认访问模式仍是 `byok`，默认 STT 是 Deepgram（`src/lib/settingsStore.ts:42-56,85-106`）。
4. README 当前声明 BYOK/Apple 无需 Rabbit 账号；hosted 使用 OIDC Authorization Code + PKCE，refresh token 存 OS secure store、access token 仅在内存（`README.md:92-100`；`src/lib/hostedAuth.ts:1-18,145-240`）。

## 2. 当前工作树中的 hosted 方案

1. Hosted LLM 已固定为服务端 Gemini，hosted STT 固定为 Volcengine BigModel；配置项分别是 `GEMINI_API_KEY/GEMINI_HOSTED_MODEL` 与 `VOLCENGINE_API_KEY/VOLCENGINE_RESOURCE_ID`（`server/src/config.rs:22-46,91-120`）。默认模型字符串为 `gemini-3.7-flash`，但这只是代码配置，不是本研究对公开价格或生产可售性的证明。
2. Hosted entitlement 同时暴露 `STT_AUDIO_MS` 与 `LLM_TOKEN_UNITS`，并分别检查可用余额；余额不足会阻止开始相应功能（`src/lib/hostedAuth.ts:12-22`；`src/lib/readiness.ts:98-125`）。这证明项目已经采用“分开计量”，而不是模糊统一积分。
3. 网关路由涵盖 entitlement、STT session/WebSocket、LLM SSE、账户配额调整、OIDC 与支付（`server/src/lib.rs:234-252`）。数据库以配额桶、预占、结算、usage 与 pricing-policy version 记录权威用量（`server/migrations/202608290001_core.sql`；`server/src/entitlement.rs`）。
4. 隐私文档的目标行为是：hosted 音频经 Rabbit 网关转发至 Volcengine，生成所需问题与上下文经网关转发至 Gemini；网关不持久化音频、转写、prompt、简历或回答，但会保存账户、配额、支付、订阅和安全元数据（`docs/PRIVACY.md:5-27`）。

## 3. 当前预生产商品实现

`server/src/payments.rs:30-65` 当前硬编码两个一次性支付宝商品：

| 商品 | 价格 | 有效期 | STT 配额 | LLM 配额 | 算术换算 |
|---|---:|---:|---:|---:|---:|
| `PRO_MONTH` | ¥89 | 30 天 | 54,000,000 ms | 2,000,000 units | 900 分钟 = 15 小时；¥5.93/含配额小时（仅套餐比率，非厂商成本） |
| `PRO_QUARTER` | ¥199 | 90 天 | 180,000,000 ms | 8,000,000 units | 3,000 分钟 = 50 小时；¥3.98/含配额小时；¥66.33/月等效 |

- 购买是固定期限、一次性支付，不自动续费；提前续期从已有 paid-through 之后开始，避免未来周期额度提前消费（`landing/src/locales/authContent.ts:324-348,457-480`；`docs/hosted_gateway_runbook.md:146-163`）。
- 支付数据模型支持订单、幂等事件和 subscription period；支付渠道当前限定 Alipay/CNY（`server/migrations/202608300003_payments.sql:1-62`）。
- 这些文件在检查时含未提交/未跟踪改动，且 runbook 明确状态为 **pre-production**，不能称为已上线价格或已验证商业模型。

## 4. 尚未关闭的生产门

`docs/vendor_contract.md:30-45` 明确记录：

- 尚未用真实 Volcengine 凭证验证 TLS/auth、短/长/静音音频、各种断线与发票舍入；
- 尚未验证 Gemini 生成中取消、流断开时 usage 与实际账单对账；
- 需要先批准内部计量与厂商计量允许差异、完成至少 7 天对账；
- 在支付宝沙箱证据、商户/回调域名、退款、隐私和结算对账完成前，生产必须保持 `PAYMENTS_ENABLED=false`。

因此，任何利润率结论或“¥89/¥199 已可正式售卖”的表述目前都不受仓库证据支持。旧方案文档中的供应商成本估算只能视为待重新核验的假设，不能用作本报告的当前官方价格证据。

## 5. 对最终决策的直接含义

1. 必须把**团队成员使用的 AI 工具席位**与**RabbitInterview 面向用户的模型/语音 API 成本**分成两个预算池；前者不能向产品提供合法的生产调用额度。
2. 最小风险架构是保留 BYOK/Apple 免费路径，同时把需要开箱即用体验的用户放在 hosted 网关；这与现有代码 seam 一致，无需改成单一供应商客户端。
3. Hosted 上游应采用 API 按量/预付账户并设置供应商与网关双重预算上限；不应购买 ChatGPT Plus、Claude Pro、Gemini 个人版、Copilot/Cursor 席位来支撑用户请求。
4. 产品收费宜继续维持“固定周期 + 分离 STT/LLM 配额 + 无自动续费”的 MVP，直到真实账单证明毛利、退款和取消语义，再考虑自动续费、统一 credits 或无限套餐。
5. 当前两个商品可作为封闭试点候选，不应在完成生产门前承诺为正式价格；尤其要以 P50/P95 实际每场音频时长、双音源计费、每次回答 input/output/reasoning tokens 和取消浪费重算。

## 6. 本地来源接受/拒绝

### 接受

- `README.md`
- `src/lib/llm.ts`
- `src/lib/keyStore.ts`
- `src/lib/settingsStore.ts`
- `src/lib/hostedAuth.ts`
- `src/lib/readiness.ts`
- `server/src/config.rs`
- `server/src/lib.rs`
- `server/src/payments.rs`
- `server/src/entitlement.rs`
- `server/migrations/202608290001_core.sql`
- `server/migrations/202608300003_payments.sql`
- `landing/src/components/AuthPage.tsx`
- `landing/src/locales/authContent.ts`
- `docs/PRIVACY.md`
- `docs/vendor_contract.md`
- `docs/hosted_gateway_runbook.md`
- `docs/volcano_gateway_billing_implementation_plan.md`

### 拒绝作为当前价格证据

- `docs/cloud_stt_llm_subscription_proposal.md` 中未重新核验的厂商成本和毛利估算：属于内部方案假设，不是当前厂商一手定价。
- 代码中的模型默认值：只证明实现意图，不证明公开可售性、价格、SLA 或生产支持。
