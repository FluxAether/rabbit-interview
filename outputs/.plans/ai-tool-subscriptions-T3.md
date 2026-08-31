# T3 — 模型与语音 API 计费

## Objective
截至 2026-08-31，研究面向应用后端的主流模型/语音 API 订阅与按量计费方式，并提供可复算的单位成本证据。

## Scope
优先覆盖 RabbitInterview 已相关的 OpenAI、Anthropic、Google Gemini、Groq、Deepgram；加入 OpenRouter/云平台代理或开源自托管仅作有用对照。关注按 token、分钟、请求、缓存、批处理、预付余额、承诺用量、免费层、用量上限与速率限制。

## Evidence
- 官方 API pricing、billing/credits、rate limits、batch/caching、服务条款。
- 逐项记录模型名、计价单位、输入/输出或音频单位、价格、发布日期/访问日及地域/税费限制。
- 明确 API 与消费订阅完全分账的证据；说明生产应用密钥和最终用户自带密钥的差异，但不提出最终架构。
- HTML/官方文档优先；不解析 PDF。失效或无法核验的 URL 放入 rejected sources。

## Deliverable
写入 `outputs/.drafts/ai-tool-subscriptions-research-api.md`：计费模式矩阵、项目相关单位价格、可复算示例公式、精确 URL、访问日期、来源接受/拒绝清单与不确定项。不要给 RabbitInterview 最终方案。
