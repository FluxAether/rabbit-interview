# Rabbit Interview 登录、注册、授权与订阅优化实施方案

- 状态：待评审
- 日期：2026-08-31
- 范围：官网入口、注册与密码设置、桌面端 OIDC/PKCE 授权、账号与套餐管理、支付宝固定期限额度包、支付回流、信任与无障碍
- 交付边界：本文件是实施方案；本轮不修改产品代码、不迁移数据、不执行真实支付

## 1. 结论

当前最大问题不是单个页面的视觉质量，而是跨官网、浏览器、邮箱、桌面端和支付渠道的连续性不足。用户必须理解多个技术边界，且任何服务异常、会话过期或支付确认延迟都会把用户留在没有恢复动作的页面。

推荐按以下顺序实施：

1. 先恢复 Gateway 可用性，并把所有远程失败改为可重试状态。
2. 再完善注册后回到桌面、授权重开与取消，避免五分钟静默等待。
3. 把账号与套餐从“AI 模型与 Key”中独立出来，并增加安全的一次性账号门户链接。
4. 让未登录用户也能看到真实价格、额度和一次性付费规则。
5. 修复支付回流恢复和“当前套餐/未来排期”语义。
6. 最后补齐信任、无障碍和运营指标。

不建议：

- 新建第二套网页登录认证系统。继续复用现有 OIDC、浏览器会话和一次性令牌能力。
- 把 30/90 天固定期限额度包描述为自动续费订阅。
- 在 Gateway 不可用时仅显示“稍后再试”，却不给重试、返回或诊断动作。
- 为本次优化引入新的状态库、请求库或分析 SDK。

## 2. 当前证据与验证边界

### 2.1 已验收截图

截图目录：outputs/product-design-audit-2026-08-31-auth-subscription/

1. 01-landing-entry.png：官网入口
2. 02-register-unavailable.png：注册服务不可用
3. 03-desktop-hosted-entry.png：桌面端云托管入口
4. 04-login-desktop-only.png：无桌面授权请求时的浏览器登录页
5. 05-subscription-unavailable.png：未建立会话且 Gateway 不可用时的订阅页

### 2.2 当前运行态

- Landing 监听 4174，根页和 /auth/register 返回 HTTP 200。
- Gateway 8787 当前没有监听，/account/register/context 无法建立连接。
- 桌面 Vite 1420 当前没有监听。
- 因此，本轮截图能够证明前端失败态，但不能证明完整注册、OIDC 回调、支付宝沙箱或真实额度发放成功。

### 2.3 当前代码态

工作区包含用户已有的未提交修改。本方案按当前源码快照编写，正式实施前必须在保留这些修改的前提下创建独立分支或明确提交边界。

关键事实：

- 官网和账号页使用两个不同的语言存储键，可能出现中文官网跳到英文账号页。
- 注册入口可以保留 OIDC request 片段，但注册邮件与密码设置完成后不继续原授权请求。
- 桌面端把交互式登录和会话恢复都表示为 restoring，并在五分钟内缺少重开和取消动作。
- /subscribe 的完整上下文依赖浏览器会话；未登录时价格和套餐也不可见。
- 支付回流在第一次刷新前就清除订单号，并只轮询约 15 秒。
- 后端按 ends_at 倒序选套餐，可能把未来排期显示成当前套餐。
- 额度发放本身已按 starts_at/ends_at 排期，问题主要在摘要查询与展示语义。

### 2.4 问题矩阵

| 问题 | 用户影响 | 根因 | 优先级 | 对应阶段 |
| --- | --- | --- | --- | --- |
| Gateway 8787 未运行 | 注册、授权上下文、套餐全部阻断 | 运行态和 Landing 前端未形成就绪门禁 | P0 | Phase 0 |
| 错误只有泛化文案 | 用户不知道是否可重试 | 远程上下文加载没有 retry 状态 | P0 | Phase 0 |
| 授权等待不可重开/取消 | 浏览器关闭后只能等待超时 | pendingLogin 没有公开恢复动作 | P0 | Phase 1 |
| 注册后不能继续原任务 | 邮件设置密码后漏斗中断 | 注册周期长于 OIDC request，且没有安全回桌面动作 | P0 | Phase 1 |
| 中文官网跳英文账号页 | 信任下降、理解成本增加 | Landing/Auth 使用不同语言键 | P1 | Phase 1 |
| 账号管理埋在 AI Key | 登录和套餐难发现 | 信息架构按技术配置而非用户任务组织 | P1 | Phase 2 |
| 浏览器会话过期后无管理入口 | 已登录桌面仍可能看不到套餐 | Desktop bearer 与 Browser cookie 缺少安全桥接 | P1 | Phase 2 |
| 未登录隐藏价格 | 注册前无法判断价值 | SubscriptionContext 401 使产品数组也不可见 | P1 | Phase 3 |
| “月度/季度”与一次性购买冲突 | 用户误解续费规则 | 展示名沿用订阅术语 | P1 | Phase 3 |
| 支付订单状态易丢失 | 用户可能重复付款或联系客服 | 过早清 URL、短轮询、无手动刷新 | P1 | Phase 4 |
| 未来排期被显示成当前套餐 | 账户信息事实错误 | 查询按最晚 ends_at 而非当前时间窗口 | P1 | Phase 4 |
| 焦点、目标尺寸和 busy 状态不足 | 键盘、低视力和移动用户受阻 | focus outline 被移除，小控件缺少最小尺寸 | P2 | Phase 5 |
| 法律与支持入口不足 | 支付信任和争议处理风险 | 支付上线门禁未包含公开政策 | P1 | Phase 5 |

## 3. 目标用户旅程

目标路径：

官网查看产品与价格
→ 创建账号
→ 邮件验证并设置密码
→ 一键回到 Rabbit Interview
→ 桌面端重新打开或继续授权
→ 浏览器登录、MFA、同意权限
→ 自动回到桌面并显示账号状态
→ 打开账号与套餐
→ 查看当前额度、当前周期、下一周期与累计有效期
→ 支付宝付款
→ 回流后显示待确认、已成功或已关闭
→ 桌面端自动或手动刷新额度

### 3.1 体验原则

- 每个跨端步骤都说明“当前在哪、下一步去哪、完成后会发生什么”。
- 每个等待态至少提供一个安全恢复动作。
- 登录、注册、授权、购买使用同一种语言和术语。
- 未登录不等于隐藏价格。
- 当前周期和未来排期必须分开展示。
- 支付成功以服务端验证为准，不以浏览器返回参数为准。
- BYOK 保持默认可用，不把云托管写成使用产品的前置条件。

## 4. 优先级总览

| 阶段 | 优先级 | 目标 | 规模 | 依赖 |
| --- | --- | --- | --- | --- |
| Phase 0 | P0 | Gateway 可达、错误可恢复 | S | 无 |
| Phase 1 | P0 | 注册与桌面授权连续性 | M | Phase 0 |
| Phase 2 | P1 | 账号与套餐信息架构、账号门户 | L | Phase 1 |
| Phase 3 | P1 | 公开价格与清晰购买规则 | M | Phase 0 |
| Phase 4 | P1 | 支付回流与周期语义正确 | M | Phase 2、支付宝沙箱 |
| Phase 5 | P2 | 信任、无障碍、指标与发布门槛 | S/M | Phase 0–4 |

规模仅表示相对改动量，不是工期承诺。

## 5. Phase 0：恢复服务与可恢复错误

### 5.1 目标

用户能够加载注册、登录和订阅上下文；当 Gateway 不可用时，页面在有限时间内失败，并提供明确重试。

### 5.2 最小实现

#### 运行与配置

- 使用现有 /healthz，不新增健康检查端点。
- 明确开发态拓扑：
  - Landing：http://127.0.0.1:4174
  - Gateway：http://127.0.0.1:8787
  - Desktop Vite：http://127.0.0.1:1420
- Landing 开发态在未配置 VITE_HOSTED_GATEWAY_URL 时默认访问 8787；生产态仍允许同源反向代理。
- Gateway 启动或 dotenv 变化后，按 runbook 验证监听、/healthz 和实际 303 跳转。
- 不读取、打印或记录任何密钥值。

#### 前端请求

- 在 landing/src/components/AuthPage.tsx 的 api 和 jsonApi 共用入口增加 10 秒超时，优先使用浏览器原生 AbortSignal.timeout。
- 保留 NETWORK_ERROR、RATE_LIMITED、INTERNAL_ERROR 等现有错误码映射。
- 使用已经存在但尚未呈现的 t.retry 文案。
- 注册、登录交互、订阅上下文加载失败时显示：
  - 发生了什么
  - “重试”
  - “返回 Rabbit Interview”或“返回首页”
- 重试只重新获取当前上下文，不刷新整页，不清空已经输入的表单数据。
- busy 状态把按钮文字改为实际动作，例如“正在创建账号…”而不是仅降低透明度。

### 5.3 涉及文件

- landing/src/components/AuthPage.tsx
- landing/src/locales/authContent.ts
- landing/src/App.tsx
- docs/hosted_gateway_runbook.md
- scripts/verify-copilot.mjs

### 5.4 验收标准

- Gateway 正常时，注册、登录交互和订阅上下文均能在 10 秒内进入成功或明确业务状态。
- Gateway 停止时，页面在 10 秒内显示网络错误和可操作的重试按钮。
- Gateway 恢复后，不刷新整页即可重试成功。
- 429、401、500 和网络断开呈现不同的用户文案。
- 页面不显示 Rust、JavaScript 或 fetch 原始异常。

### 5.5 回归检查

- 扩展 scripts/verify-copilot.mjs，确认共享请求层存在超时和 retry 动作。
- 手动关闭/启动 Gateway，验证失败与恢复。
- npm run landing:build
- npm run verify:copilot

### 5.6 回滚

该阶段不改协议和数据。若请求超时造成兼容问题，只回滚超时参数，保留重试 UI。

## 6. Phase 1：注册与桌面授权连续性

### 6.1 目标

用户从桌面发起登录后，即使选择注册、切换到邮箱、浏览器被关闭或授权超时，也能知道下一步，并能安全地重开或取消。

### 6.2 桌面端授权状态

当前 restoring 同时表示启动恢复和交互式授权，建议拆成：

- restoring：应用启动时恢复安全存储中的会话
- signed-out：没有有效会话
- authorizing：浏览器授权正在进行
- signed-in：已登录并加载额度
- error：可恢复错误

在 authorizing 状态显示：

- “已在浏览器打开登录”
- “完成登录或注册后会自动返回”
- “重新打开浏览器”
- “取消”

实现要点：

- PendingLogin 保存 authorize URL。
- 新增 reopenHostedSignIn，仅重新打开同一个仍有效的授权请求。
- 新增 cancelHostedSignIn，清除 timeout、pendingLogin，并回到 signed-out。
- 五分钟超时后显示“授权已过期”，主动作是“重新登录”，而不是原始英文错误。
- PKCE verifier、state、nonce、issuer 校验和回调 allowlist 保持不变。

### 6.3 注册与密码设置完成

不建议把短期 OIDC request secret 放进 24 小时有效的注册邮件，也不建议长期存进 localStorage。

推荐的安全最小方案：

1. 注册页明确提示“设置密码后返回桌面应用继续登录”。
2. 密码保存成功页增加“打开 Rabbit Interview”主按钮。
3. 增加一个无敏感参数的 allowlist 深链：
   - rabbitinterview://auth/resume
4. Tauri 只接受 callback、logout 和 resume 三种路径。
5. 收到 resume 时：
   - 若原授权仍有效，重新打开原 authorize URL。
   - 若已超时，桌面端显示“重新登录”并创建新的 PKCE 请求。

该方案不会把 access token、authorization code 或 request secret 放入 resume URL。

### 6.4 语言连续性

- 官网跳转注册、订阅时显式携带 lang。
- AuthPage 同时兼容现有 rabbit-auth-lang 和官网 rabbit-landing-lang，并把 zh 映射为 zh-CN。
- 用户在账号页切换语言后，同步回官网语言偏好。
- 桌面端 ui_locales 保持从应用设置读取。

### 6.5 涉及文件

- src/lib/hostedAuth.ts
- src/pages/Settings.tsx
- src-tauri/src/lib.rs
- landing/src/App.tsx
- landing/src/components/AuthPage.tsx
- landing/src/locales/authContent.ts
- src/i18n/translations.ts
- scripts/verify-copilot.mjs

### 6.6 验收标准

- 点击桌面“登录”后，按钮不会在五分钟内变成无解释的禁用态。
- 用户可以重新打开同一个授权页，也可以取消。
- 浏览器被关闭后，桌面端仍能恢复操作。
- 注册邮件设置密码完成后，可一键唤起桌面应用。
- resume 深链不接受任意 host、path、query 中的 token 或外部 URL。
- state、nonce、issuer、PKCE 和回调校验的现有测试继续通过。
- 中文官网进入注册、授权、订阅均保持中文。

### 6.7 回归检查

- src-tauri/src/lib.rs 增加 resume 接受与恶意路径拒绝测试。
- scripts/verify-copilot.mjs 增加 authorizing、reopen、cancel 和语言连续性断言。
- npm run build
- npm run landing:build
- npm run verify:copilot
- cargo test --manifest-path src-tauri/Cargo.toml

## 7. Phase 2：账号与套餐信息架构

### 7.1 目标

用户无需理解“AI 模型与 Key”即可找到登录状态、额度、套餐、账号安全和退出登录。

### 7.2 桌面 Settings

新增独立的“账号与套餐”标签，复用现有 Settings 的卡片、按钮和 CSS 变量，不创建新的设置框架。

展示顺序：

1. 账号
   - 邮箱
   - 登录状态
   - 登录、退出
2. 云托管额度
   - STT 剩余分钟
   - AI token 余额
   - 刷新时间
3. 套餐周期
   - 当前额度包
   - 当前周期起止
   - 下一排期周期
   - 累计有效期至
4. 管理
   - 管理套餐
   - 刷新额度
   - 账号安全
5. 说明
   - 本地应用许可证与云托管额度是两件事
   - BYOK 无需购买云托管额度

“AI 模型与 Key”仅保留 BYOK/Hosted 的访问方式选择和 provider 配置，不再承担账号管理。

### 7.3 Entitlement 协议

扩展现有 /v1/me/entitlements 响应，不新增重复的“我的账号”接口。

建议字段：

    {
      "account_id": "...",
      "email": "user@example.com",
      "status": "ACTIVE",
      "balances": {
        "STT_AUDIO_MS": 3600000,
        "LLM_TOKEN_UNITS": 1000000
      },
      "subscription": {
        "current_period": {
          "product_code": "PRO_MONTH",
          "starts_at": "...",
          "ends_at": "..."
        },
        "next_period": null,
        "paid_through": "..."
      },
      "subscription_url": "https://..."
    }

实现原则：

- current_period：starts_at <= now 且 ends_at > now。
- next_period：starts_at > now 中 starts_at 最早的一条。
- paid_through：所有未结束周期中最大的 ends_at。
- 一次查询取回未结束周期，按 starts_at 升序，在 Rust 中派生摘要，避免三次数据库往返。
- 不修改已经正确按 valid_from/valid_until 发放的 quota bucket。

### 7.4 安全账号门户

当前桌面端能持有 bearer token，但浏览器 /subscribe 依赖 cookie。为避免让用户重新造一个网页登录入口，增加一次性门户链接。

推荐流程：

1. 已登录桌面调用 POST /v1/me/account-portal。
2. Gateway 创建 5 分钟有效、单次使用的随机 PORTAL token，只存哈希。
3. 返回 landing URL，token 放在 fragment 中：
   - https://landing.example/auth/portal#token=...
4. Landing 立即从 fragment 读取 token、清除地址栏，并同源 POST /account/portal。
5. Gateway 校验 token、Origin/Sec-Fetch-Site、账号状态和单次使用，建立现有浏览器会话。
6. 浏览器跳转 /subscribe。

约束：

- 不把桌面 access token 放入 URL。
- PORTAL token 不能用于 OIDC token endpoint。
- token 使用后立即作废。
- 账号停用时拒绝建立会话。
- 复用 oidc_action_tokens 表和哈希逻辑，仅扩展 kind CHECK 允许 PORTAL。

### 7.5 涉及文件

- src/pages/Settings.tsx
- src/lib/hostedAuth.ts
- src/i18n/translations.ts
- server/src/protocol.rs
- server/src/lib.rs
- server/src/oidc.rs
- 新的最小数据库迁移：扩展 oidc_action_tokens.kind
- server/tests/mysql_oidc.rs
- scripts/verify-copilot.mjs

### 7.6 验收标准

- 用户在 Settings 一级导航中能找到“账号与套餐”。
- 桌面端显示邮箱、额度、当前周期、下一周期和累计有效期。
- 原始技术异常不直接显示给用户。
- 从桌面点击“管理套餐”可在未预先拥有浏览器 cookie 时打开已登录的 /subscribe。
- portal token 重放、过期、跨站提交和停用账号均被拒绝。
- BYOK 选择和现有 provider key 不被清空或迁移。

### 7.7 回归检查

- Gateway 集成测试覆盖 portal token 单次使用、过期和会话建立。
- Gateway 集成测试覆盖当前周期、未来周期、累计 paid_through。
- npm run build
- npm run verify:copilot
- cargo test --manifest-path server/Cargo.toml

## 8. Phase 3：公开价格、术语与购买入口

### 8.1 目标

用户在注册或登录前即可理解价格、期限、额度、BYOK 替代方案和不自动续费规则。

### 8.2 SubscriptionContext

把 /account/subscription/context 从“未登录即 401”改为可公开读取的分层响应。支付创建接口仍严格要求浏览器会话与 CSRF。

建议结构：

    {
      "authenticated": false,
      "payments_enabled": true,
      "products": [
        {
          "code": "PRO_MONTH",
          "price_minor": 2900,
          "currency": "CNY",
          "duration_days": 30,
          "stt_ms": 3600000,
          "llm_units": 1000000
        }
      ],
      "account": null,
      "csrf": null
    }

登录后 account 和 csrf 才存在。

这样不需要增加一个只返回同一产品数组的新端点，也不会放宽付款接口。

### 8.3 页面内容

未登录状态也展示：

- 30 天额度包
- 90 天额度包
- 人民币价格
- STT 分钟
- AI token 额度
- 一次性付款、不自动续费
- 提前购买会排在当前周期之后
- BYOK 不需要购买

未登录时购买按钮改为：

- “从 Rabbit Interview 登录后购买”
- 若未安装，提供下载入口
- 注册仍是次级动作，不把注册伪装成直接购买

术语建议：

- “Pro 月度套餐” → “Pro 30 天额度包”
- “Pro 季度套餐” → “Pro 90 天额度包”
- “订阅”作为页面分类可保留，但所有交易文案必须明确“一次性购买、不自动续费”
- “LLM 单位” → “AI token 额度”，并配说明“实际消耗随模型和回答长度变化”

产品 code 暂不改名，避免无价值的数据迁移和支付兼容风险。

### 8.4 官网入口

- 桌面导航增加“登录/账号”或“账号与套餐”，链接 /subscribe。
- 注册按钮在手机宽度下可见，不再被 hidden sm:inline-flex 完全隐藏。
- 订阅/价格入口在移动导航中可见。
- 官网进入账号页时携带语言。

### 8.5 涉及文件

- server/src/protocol.rs
- server/src/oidc.rs
- landing/src/App.tsx
- landing/src/components/AuthPage.tsx
- landing/src/locales/content.ts
- landing/src/locales/authContent.ts
- server/tests/mysql_oidc.rs
- scripts/verify-copilot.mjs

### 8.6 验收标准

- 无浏览器会话访问 /subscribe 仍能看到完整产品、价格和购买规则。
- 未登录无法创建支付订单。
- 登录后 CTA 变为支付宝支付。
- 任何页面都不暗示自动续费。
- 手机宽度能找到账号、注册和价格入口。

## 9. Phase 4：支付回流和周期语义

### 9.1 目标

支付宝返回、异步通知延迟、页面刷新或短暂断网都不会让用户丢失订单状态；当前套餐不会被未来排期覆盖。

### 9.2 浏览器订单恢复

当前问题：

- out_trade_no 在第一次 refresh 成功前就从地址栏清除。
- 只轮询 10 次、每次 1.5 秒，约 15 秒后停止。
- 停止后没有“刷新支付状态”动作。

最小修复：

1. 验证 out_trade_no 格式。
2. 立即保存到 sessionStorage，键名带 Rabbit Interview 命名空间。
3. 首次状态请求完成后再清理 URL。
4. 页面重载时优先从 sessionStorage 恢复。
5. 轮询节奏改为 0、2、5、10、20、30 秒。
6. 页面不可见时暂停；重新可见时立即查询一次。
7. 60 秒后停止自动轮询，保留“刷新支付状态”按钮。
8. PAID 或 CLOSED 后清除 sessionStorage。
9. 到达 expires_at 仍为 PENDING 时显示“订单已过期，可重新下单”。

不新增前端轮询库。

### 9.3 状态设计

- PENDING：支付宝确认中；显示订单创建时间、到期时间、自动刷新说明和手动刷新。
- PAID：已验证；显示新增额度、当前/下一周期以及累计有效期。
- CLOSED：订单已关闭，没有发放额度；提供重新购买。
- PROVIDER_UNAVAILABLE：保留订单号，提示稍后刷新，不让用户重复付款。

### 9.4 后端周期摘要

把现有 ORDER BY ends_at DESC LIMIT 1 改为 SubscriptionOverview 语义：

- 当前周期按 starts_at <= now < ends_at 选取。
- 下一周期按 starts_at > now、starts_at ASC 选取。
- paid_through 使用 MAX(ends_at)。
- 早续费仍按现有 MAX(ends_at) 追加，不改变额度发放顺序。

### 9.5 涉及文件

- landing/src/components/AuthPage.tsx
- landing/src/locales/authContent.ts
- server/src/payments.rs
- server/src/protocol.rs
- server/src/oidc.rs
- server/src/lib.rs
- server/tests/mysql_oidc.rs
- server/src/payments.rs 内现有 payment 测试

### 9.6 验收标准

- 支付返回后立刻刷新页面仍能恢复订单。
- 支付确认延迟超过 15 秒时，用户仍可手动刷新。
- Provider 暂时不可用不会清除订单，也不会自动创建第二笔订单。
- 支付成功只在 Gateway 验证 provider 结果或异步通知后出现。
- 提前购买 90 天额度包时，当前页面仍显示正在生效的 30 天包，并单独显示下一周期。
- paid_through 显示所有已支付排期的最晚结束时间。

### 9.7 支付专项验证

必须使用支付宝沙箱或受控适配器验证：

1. 正常付款。
2. 用户取消。
3. return 先到、notify 后到。
4. notify 先到、return 后到。
5. provider query 暂时失败。
6. 同一 notify 重放。
7. 同一 Idempotency-Key 重放。
8. 提前续费两次。

未完成以上验证前，不得宣称真实支付链路完成。

## 10. Phase 5：信任、无障碍与运营指标

### 10.1 无障碍

这是风险修复，不宣称完整 WCAG 合规。

- inputClass 不再使用只有 focus:outline-none 的样式；增加清晰的 focus-visible ring。
- 语言切换按钮至少 44×44 CSS 像素。
- 所有 busy 状态改变按钮文字，并保留 aria-busy。
- 错误出现后把焦点移动到错误摘要；错误摘要与具体字段关联。
- MFA 和支付状态使用 aria-live，但避免重复朗读整个页面。
- 200% 缩放时卡片不裁切，按钮不重叠。
- 320px 宽度下注册、账号、价格和返回动作仍可见。
- “允许/拒绝”不能只靠位置表达风险差异。

### 10.2 信任

支付上线前必须提供经过确认的：

- 隐私政策
- 服务条款
- 退款/额度争议规则
- 联系支持方式
- 支付主体与币种
- 一次性付款、不自动续费说明

现有 docs/PRIVACY.md 可以作为来源，但不能直接把未经审核的仓库文档当成已发布法律页面。

### 10.3 指标

当前仓库没有产品分析 SDK。先使用现有 Gateway tracing 和数据库事实，不增加第三方追踪依赖。

建议统计：

| 指标 | 计算 |
| --- | --- |
| 授权完成率 | 成功发出 token 的 authorization / 创建的 authorization |
| 注册完成率 | 使用 INVITE token 完成密码设置 / 注册请求 |
| 授权超时率 | 过期且未换 token 的 authorization / 创建的 authorization |
| 支付完成率 | PAID order / created order |
| 支付待确认超时率 | 创建 60 秒后仍 PENDING / created order |
| 早续费比例 | 支付时存在未来 starts_at 的订单 / PAID order |

隐私要求：

- 日志不写邮箱、密码、access token、refresh token、PORTAL token 或完整订单号。
- 必须关联时使用内部不可逆标识或现有 account_id，并遵守日志留存规则。
- 先收集 7 天基线，再设置业务目标，避免凭空承诺转化率。

### 10.4 验收标准

- 键盘可以完成注册、登录、MFA、授权和购买前流程。
- 关键控件有可见焦点。
- 支付页在 CTA 附近显示付款与退款规则。
- Gateway 能按状态统计漏斗，不记录敏感值。

## 11. API 与数据变更汇总

| 变更 | 类型 | 兼容策略 |
| --- | --- | --- |
| EntitlementResponse 增加 email、subscription | 向后兼容响应扩展 | 旧客户端忽略新字段 |
| SubscriptionContext 增加 authenticated，账号字段可空 | 行为与响应变更 | 同时更新 landing 与集成测试 |
| POST /v1/me/account-portal | 新增 bearer API | 仅登录桌面可调用 |
| POST /account/portal | 新增同源兑换 API | 一次性 token、严格来源校验 |
| oidc_action_tokens.kind 增加 PORTAL | 数据迁移 | 先迁移再发布 Gateway |
| SubscriptionSummary → SubscriptionOverview | 内部协议扩展 | 保留 paid_through 语义 |
| rabbitinterview://auth/resume | 深链 allowlist 扩展 | 不改变 callback/logout |

迁移顺序：

1. 先发布数据库 CHECK 扩展。
2. 再发布兼容新旧客户端的 Gateway。
3. 再发布 Landing。
4. 最后发布 Desktop。

## 12. 原子 PR 拆分

### PR 1：Gateway 可达与错误恢复

- 开发态 Gateway 地址
- 10 秒超时
- retry UI
- runbook
- 不改协议

### PR 2：授权状态与注册回桌面

- authorizing 状态
- reopen/cancel
- resume 深链
- 语言连续性

### PR 3：账号与套餐 Settings

- 独立标签
- EntitlementResponse 扩展
- Current/next/paid-through 展示
- 不含 portal token

### PR 4：安全账号门户

- PORTAL token 迁移
- account-portal API
- 浏览器会话兑换
- 重放、过期、跨站测试

### PR 5：公开价格与术语

- 未登录 SubscriptionContext
- 价格卡
- 官网移动入口
- 固定期限额度包文案

### PR 6：支付恢复与周期语义

- sessionStorage 恢复
- 有界轮询与手动刷新
- 当前/未来周期查询
- 支付沙箱回归

### PR 7：信任、无障碍与指标

- focus、target size、aria-live
- 法律与支持链接
- Gateway 指标

每个 PR 应能独立回滚，不混入无关格式化或重构。

## 13. 风险与控制

| 风险 | 级别 | 控制 |
| --- | --- | --- |
| 深链扩大攻击面 | 高 | 严格 host/path allowlist；resume 不带敏感参数；新增拒绝测试 |
| Portal token 被泄露或重放 | 高 | fragment、5 分钟 TTL、哈希存储、单次使用、同源 POST |
| 公开 context 意外放宽支付 | 高 | 只有产品公开；创建订单仍要求 cookie、CSRF 和 ACTIVE 账号 |
| 当前/未来周期改变既有展示 | 中 | 先加覆盖早续费的集成测试，再改查询 |
| 支付轮询造成 provider 压力 | 中 | 有界退避、页面隐藏暂停、60 秒停止 |
| 未提交工作被覆盖 | 高 | 独立分支；只触碰计划列出的文件；实施前复核 diff |
| 法律文案不完整 | 高 | 支付上线门禁；不发布占位政策 |
| 指标收集引入隐私问题 | 中 | 不加第三方 SDK；不记录邮箱和 token |

## 14. 完整验收矩阵

### 新用户

- 从桌面进入浏览器。
- 选择注册。
- 接收邮件并设置密码。
- 打开桌面。
- 重新打开/继续授权。
- 完成登录、MFA 和同意。
- 桌面显示账号和额度。

### 已有用户

- 正常登录。
- 密码错误。
- MFA 错误与恢复码。
- 拒绝授权。
- 授权请求过期。
- 浏览器关闭后重开。
- 主动取消。

### 账号门户

- 浏览器无会话时从桌面打开。
- token 重放。
- token 过期。
- 跨站 POST。
- 账号停用。

### 订阅

- 未登录查看价格。
- 登录查看余额和周期。
- Payments disabled。
- BYOK 说明。
- 当前周期与下一周期。

### 支付

- 正常、取消、延迟、断网、刷新、重复通知、重复 idempotency。
- 30 天包后提前购买 90 天包。

### 无障碍与响应式

- 仅键盘。
- 200% 缩放。
- 320px、768px、1512px 宽度。
- 中文、繁体中文、英文。
- 屏幕阅读器检查错误、busy、支付状态。

## 15. Definition of Done

代码检查：

- 所有变更能追溯到本方案中的一项问题。
- 不新增无必要依赖或通用抽象。
- 不输出技术堆栈错误或敏感值。
- 数据迁移可向前执行，发布顺序已记录。

自动验证：

- npm run build
- npm run landing:build
- npm run verify:copilot
- cargo test --manifest-path server/Cargo.toml
- cargo test --manifest-path src-tauri/Cargo.toml

真实链路验证：

- Gateway /healthz 和 303 跳转
- 测试邮箱注册与密码设置
- 桌面 OIDC/PKCE 回调
- MFA 与授权拒绝
- 账号门户单次 token
- 支付宝沙箱 return/notify/query
- 桌面额度刷新

发布结论必须区分：

- 源码检查
- 自动测试
- 浏览器/桌面实测
- 支付沙箱
- 生产发布

任何较低层级的证据都不能替代更高层级。

## 16. Figma 审计板内容规范

目标文件：

https://www.figma.com/design/aTTHOeFHflxIjy1o08L0yr

文件名：

Rabbit Interview — 登录、注册、授权与订阅审计

布局：

- Design file，不使用 FigJam。
- 一个主 Section，标题“Rabbit Interview — 登录 / 注册 / 授权 / 订阅审计”。
- 五张截图按真实流程从左到右放在同一行。
- 每张卡宽 720px，卡与卡之间 200px。
- 截图保持原始比例，不裁切、不拉伸。
- 每张截图下方放：状态、做得好的、主要问题、推荐动作、证据边界。
- 下方第二个 Section 放 6 个实施阶段和依赖。

### 卡 1：官网入口

- 状态：视觉成熟，转化入口不完整
- 做得好的：品牌、下载主任务、隐私定位清楚
- 主要问题：缺少明确登录/账号入口；价格依赖登录；手机注册入口隐藏；语言偏好不连续
- 推荐动作：增加账号与套餐入口、公开价格、移动注册入口、统一语言参数
- 优先级：P1

### 卡 2：注册不可用

- 状态：阻断
- 做得好的：表单层级和安全预期清楚
- 主要问题：Gateway 不可用时只显示泛化错误；没有重试；无法知道服务是否恢复
- 推荐动作：修复 8787 运行态、10 秒超时、原位重试、状态文案
- 优先级：P0

### 卡 3：桌面云托管入口

- 状态：能力存在，入口埋藏
- 做得好的：BYOK 与云托管选择已在同一处
- 主要问题：账号能力被埋在 AI 模型与 Key；原始 JS 错误可见；登录等待无法重开/取消
- 推荐动作：新增账号与套餐标签、authorizing 状态、错误码映射
- 优先级：P0/P1

### 卡 4：浏览器登录仅桌面发起

- 状态：安全边界合理，恢复路径不足
- 做得好的：不会在缺少 OIDC request 时伪造登录
- 主要问题：注册后必须靠用户记住回桌面；缺少已安装用户的继续动作；语言可能切到英文
- 推荐动作：resume 深链、桌面重开/取消、语言连续性
- 优先级：P0

### 卡 5：订阅不可用

- 状态：规则解释存在，购买决策被阻断
- 做得好的：BYOK、固定期限、无自动续费已有说明
- 主要问题：未登录隐藏真实价格；错误无重试；“月度/季度订阅”与一次性 30/90 天包冲突；支付回流不可恢复
- 推荐动作：公开产品上下文、重命名展示、账号门户、订单恢复、当前/未来周期分离
- 优先级：P1

### 路线图区

- Phase 0：服务与错误恢复
- Phase 1：注册与授权连续性
- Phase 2：账号与套餐、门户
- Phase 3：公开价格与术语
- Phase 4：支付与周期语义
- Phase 5：信任、无障碍、指标

Figma 当前状态：

- 文件已创建。
- 五张截图已在本地验收并准备好。
- 由于 Figma Starter 方案触发 MCP 工具调用上限，截图和标注尚未写入画布。
- 恢复配额后，应按本节规范一次性完成上传、结构检查和最终截图验证。
