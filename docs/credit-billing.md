# 积分计费与账号权限

本次变更对应 Notion「修改付费，计费功能」。桌面、Gateway 和 landing 必须一起升级。

## 商品与扣费

| 商品代码 | 支付金额 | 发放内容 |
| --- | --- | --- |
| `CREDITS_700` | ¥19.9 | 700 积分（单场应急包） |
| `CREDITS_3000` | ¥79 | 3,000 积分（标准包） |
| `CREDITS_11000` | ¥179 | 11,000 积分（大额备战包） |
| `PASS_WEEK_7D` | ¥59 | 2,800 积分（7天高强度冲刺卡） |
| `BYOK_LIFETIME` | ¥39 | 当前账号永久解锁自备 API Key，不附赠积分 |

购买的积分在支付验签或服务端主动查询确认成功后立即到账，永久有效，不创建新订阅周期。支付回调、订单幂等键和账号行锁继续防止重复发放；同一账号已有待支付 BYOK 订单时复用该订单，已解锁则拒绝再次购买。

余额只使用 `CREDITS`，一个积分等于 60,000 个整数单位。STT 每接收 1 毫秒音频扣 3 单位（1 分钟 STT 消耗 3 积分）；LLM 沿用原有 token 用量核算，每个计费 token 扣 60 单位（1,000 个 LLM token 消耗 1 积分）。请求仍先预留、再结算并释放未使用部分，STT 与 LLM 竞争同一钱包，按原有到期顺序分配。原始音频和 token 用量继续进入审计记录。

注册后完成邮箱验证并设置密码，账号首次激活时赠送 300 积分，有效期 30 天。重发邮件、重复提交、重置密码和再次登录均不重复发放。

## 桌面授权

每次启动在线恢复登录并读取账号权限；失败时显示登录或重试页。ACTIVE 且 eligible 的账号才挂载业务页面和副驾会话。浮窗通过主窗口同步授权状态，不单独轮换刷新凭据。

新安装默认云托管。升级时保留旧 BYOK 选择和已有密钥，未购买则提示锁定；不会自动改用云托管消费积分。自备密钥保存、测试、启用、流式和结构化 LLM、浏览器和原生实时 STT 均检查权限。已解锁 BYOK 不要求积分余额。

Apple 本地 STT 可与托管 LLM 一起选择，只要求登录，不消耗积分、无需 BYOK 解锁。退出登录或凭据失效会取消请求和采集，隐藏浮窗；迟到的授权响应不会恢复已退出的账号。

## API 与管理页

`/v1/me/entitlements`、`/account/subscription/context` 和管理员账号查询返回 `balances.CREDITS`、`credit_unit_scale: 60000`、`byok_unlocked`。商品返回 `kind`（`CREDITS` 或 `BYOK`）和 `credit_units`。购买页保留原有 URL，移除套餐周期、未来生效日期和 STT/LLM 分离余额。管理页按积分发放，向旧 quota-adjustments 路径提交 `metric: CREDITS` 及整数单位。

## 升级步骤

1. 备份 MySQL，停止接入新请求和支付写入；让旧 Gateway 完成或释放所有预留。确认 `SELECT COUNT(*) FROM quota_reservations WHERE state = 'ACTIVE'` 为 0 后停止旧 Gateway，防止迁移期间重新产生预留。
2. 通过现有 SQLx 启动迁移执行 `202609110005_credits_schema.sql` 与 `202609110006_credits_balances.sql`。第一份在任何表结构修改前拒绝存在 ACTIVE 预留的数据库。MySQL DDL 不具备整体事务性，若 DDL 中断，应检查备份和迁移记录后恢复，不能盲目重复执行。
3. 第二份在事务中把旧有效余额按 `STT_AUDIO_MS + LLM_TOKEN_UNITS × 60` 转为积分。有效付费余额（包括未来周期）立即生效并取消到期日；其他赠送和管理余额保留有效期。已消费、已过期的额度不补回。转换后的旧桶余额归零，保留历史订单、订阅和用量；`legacy:<bucket-id>` 防止重复转换。
4. 同步部署 Gateway、landing 和桌面构建，把 `PRICING_POLICY_VERSION` 更新为 `2026-09-credits-v2`，重启 Gateway 后再开放流量。旧未支付订单保留原金额和赠送量快照，后续成功支付发放对应永久积分。
5. 核对迁移余额、赠送有效期、商品目录和 BYOK 锁定状态，再以隔离账号验证支付确认与权限刷新。此变更不执行线上迁移、真实扣款、版本发布或部署。

## 验证命令

- `rtk npm run verify:account`：启动恢复、网络重试、授权拦截、BYOK 零余额调用、退出竞态、Apple 与旧设置。
- `rtk npm run verify:copilot`：现有副驾和实时采集生命周期回归。
- `rtk proxy node scripts/verify-gateway-mysql.mjs`：自动创建并删除隔离 MySQL 测试库；验证签名回调、重复订单、礼赠、迁移与并发扣费。使用本地服务配置，不迁移实际业务数据库。
- `rtk cargo test --manifest-path src-tauri/Cargo.toml --locked`：桌面原生回归。
- `rtk npm run build` 与 `rtk npm run landing:build`：类型检查及生产构建。

测试支付使用生成的测试签名和模拟上游，不代表已经完成真实支付宝支付或生产发布。
