# OnCue 开源 / 闭源 / 开源商业路径

**日期：** 2026-09-04  
**对象：** 创始人决策，不是投放文案  
**产品：** OnCue（原 Rabbit Interview），Tauri 2 桌面面试 Copilot，`rabbit-interview` v0.15.0，MIT  
**结论一句话：** 做开源商业。客户端继续 MIT，钱只来自 Hosted 算力（¥89 / ¥199）。不要闭源，不要把隐身锁进付费墙，不要再卖一份 BYOK 软件季卡。

同日已有执行备忘 [`oncue-open-closed-gtm.md`](./oncue-open-closed-gtm.md)。本文是带验证置信度的创始人终稿：工作流核验过的主张优先，GTM 备忘只作落地细节，内部 2026-08 文档不当成活事实。

---

## 0. 怎么读这份报告

| 标签 | 含义 | 用法 |
|---|---|---|
| **核验** | 深度研究工作流 3 票对抗验证后存活（14 条，多数 3-0） | 可当事实写进方案 |
| **GTM** | 同日 GTM 备忘已引用、本次未再投 3 票 | 可执行，对外引用时标明来源 |
| **代码冻结** | 仓库当前实现 / 合同文档 | 商业数字以这里为准 |
| **内部未核** | 2026-08-27 / 08-31 报告、vendor 估算、检索笔记 | 不当牌价，不当 TAM |
| **已驳回** | 工作流 0-3 或 1-2 否决 | 禁止当事实 |

工作流 run `wf_61a93a45-93b`：110 个检索/核验 agent 完成，合成步骤因上下文崩溃跳过。本文用手把 14 条核验主张、11 条驳回主张、产品文档和 GTM 合成，不再重跑工作流。

**本仓库安全红线（全文有效）：**

- 不承诺完全隐身 / 面试官无感 / 100% undetectable
- 不承诺内容永不离开这台电脑（BYOK 仍把音频/简历发到用户自选供应商）
- 不承诺 Offer 返现
- Hosted 网关未过生产门；`PAYMENTS_ENABLED` 必须保持 false，直到 `docs/vendor_contract.md` 关完
- 落地页「扫码即用」在支付打开前是虚假广告

---

## 1. 产品是什么，现在卡在哪

### 1.1 实际交付

OnCue 是本机面试 Copilot，不是招聘方 ATS，也不是云端题库：

- Stealth Copilot：系统音频和/或麦克风 → STT → 结构化浮窗
- AI 模拟面试
- 简历对 JD 优化 + DOCX
- 本地 SQLite 历史
- 中英繁 i18n

架构：**本地优先 BYOK**。STT 走 Deepgram / Apple Speech / Gemini Live；LLM 走 Groq / OpenAI / Anthropic / Gemini。密钥在本机 `com.rabbitinterview.desktop` 数据目录。可选 Hosted：OIDC Authorization Code + PKCE，refresh 在系统钥匙串，access token 在内存。网关存账户/配额/订单，**不持久化音频、转写、提示、简历、模型回答**（`docs/vendor_contract.md`）。

隐身能力是 OS 捕获排除，不是军备：macOS `NSWindowSharingType::None`，Windows `WDA_EXCLUDEFROMCAPTURE`。系统音频：macOS 14.2+ AudioTee，Windows WASAPI loopback。README 已写：只在面试规则允许辅助工具时使用。

许可证今天就是 MIT（`LICENSE`，Copyright 2026 OnCue contributors）。MIT 一旦发出，不能事后对已经拿到源码的人收回。这是路径 B 的硬约束，不是偏好。

### 1.2 北极星

产品优化方案仍对：**新用户启动后 15 分钟内，听到系统音频，拿到第一条有用的现场建议。** 下载量、星标、投放不是北极星。

落地计划的可卖完成定义仍对：向导能证明听得到面试官；同一岗位能从简历走到模拟再走到 Copilot；仪表盘不被闲聊污染；有当前版本安装包和季卡购买路径；对外文案与设置页一致——保护有限，规则允许才用。第 1–3 条没过，不要投放。

### 1.3 必须先承认的内部冲突

仓库里同时存在四套互相打架的收费叙事。**商业冻结以代码为准**，其余在上线前改掉。

| 来源 | 写的是什么 | 状态 |
|---|---|---|
| `server/src/payments.rs` + `docs/vendor_contract.md` | `PRO_MONTH` CNY 89 / 30 天 / 15h STT / 200 万 LLM units；`PRO_QUARTER` CNY 199 / 90 天 / 50h STT / 800 万 LLM units。一次性支付宝，无自动续费。注册不送额度。双音源分开计费。旧季卡不给 Hosted 额度。 | **代码冻结。采用这个。** |
| `docs/PRODUCT_LAUNCH_PLAN.md` | 免费 + 月卡 ¥79 + 季卡 ¥199 + 终身 ¥499；锁的是本地会话次数/时长 | 过时。不要再卖 BYOK 软件季卡。 |
| `docs/PRODUCT_OPTIMIZATION_PLAN.md` | 冻到 50 个付费用户：免费 10 分钟 Copilot + ¥199/$39 九十天 | 过时。不要用本地时长墙替代 Hosted 额度。 |
| `docs/TERMS.md`（2026-08-26） | 免费应用 + 九十天季卡用本地许可证去掉 Copilot 时长上限；第三方 API 自付 | **上线阻塞。** 必须改成与支付宝商品一致。 |
| 落地页 `PricingSection.tsx` | 双卡：OPEN-CORE / LOCAL vs OFFICIAL HOSTED；Hosted CTA `/subscribe`；徽章写死「扫码即用」 | 双轨 UI 已上，承诺超前。支付打开前必须改徽章。 |

**决议：** 只卖 Hosted 周期额度。BYOK 永远免费、功能完整。不要同时卖「软件季卡」和「算力季卡」——用户分不清买的是什么，客服会把两套规则缠在一起。

### 1.4 生产门仍开着

`docs/vendor_contract.md` 最近审阅 2026-08-30。已实现协议，未拿到真实供应商/支付宝证据：

1. 火山 TLS/鉴权、短/长/静音、断线、发票进位
2. Gemini 中途取消、断流用量、账单对账
3. 45 分钟双音源内部累计 vs 供应商发票
4. 支付宝沙箱双商品、重复通知、金额篡改、退款、结算
5. CSP 仍是 `gateway.example.com`；缺 7 天对账、隐私审查、生产 Resend、MySQL 备份演练

合成夹具和编译成功不是账单证据。`PAYMENTS_ENABLED` 在上述关闭前必须 false。

---

## 2. 市场：这不是「AI 面试市场」

### 2.1 品类分层

招聘方「AI Interview Market $1.5B–$2B」（HireVue / Eightfold / Greenhouse）**不是 OnCue 的 TAM**。那是企业采购，买方是 HR。OnCue 的买方是求职者，品类是 2023 年后长出来的灰色消费级 Copilot。

```
招聘方基础设施     HireVue / Eightfold / Greenhouse     企业采购，不是你的客户
海外全家桶 SaaS     Final Round AI / LockedIn AI         高价、云中转、隐身当卖点
海外单点/会议层     Interview Coder / Cluely             编码解题 vs 会议隐形
国内桌面套件       即答侠 / 面试狗                       中文、按次/月、隐身浮窗
开源/BYOK 原型     Cheating Daddy / Ecoute / OpenCluely  免费、丑、但会分流极客
OnCue              MIT 桌面 + 可选国内托管               本机数据，双轨收费
```

需求驱动（GTM，非核验规模数字）：远程一面普及；国内招聘季节性（秋招 8–10、春招 2–4，金三银四 / 金九银十）；Deepgram/OpenAI 要境外卡；SaaS 溢价把「干净工具」缺口留出来。

**没有核验过的 TAM / SAM / SOM。** 不要对外引用内部 2026-08-27 记分卡（「software $0, composite 4.45」）。秋招/春招的人数规模本次未核验，只当季节性日历用。

### 2.2 信任已经花掉了

品类正在被三件事惩罚：

1. **隐身军备竞赛。** Cluely 把「屏幕共享不可见」做成 $149.99/月 SKU（核验）。LockedIn 官网上写「100% undetectable」、无任务栏、对屏幕共享和监考不可见（核验）。谁把这个当卖点，谁就进入被平台、学校、雇主点名的队列。
2. **云端面试内容。** GTM 记录过 Cluely 约 8.3 万条泄露的第三方写作；不是 Cluely 官方事故页，但足以当行业风险案例：云端存面试内容会爆。融资以 TechCrunch 2025-06-20 a16z $15M A 轮为准（GTM）。
3. **计费不透明。** Final Round 官方价本次未能核验（两条博客互相矛盾，见 §8）。LockedIn 官方计划页不公布美元价（GTM）。国内即答侠用 Offer 奖学金做转化（核验，OnCue 禁止模仿）。

OnCue 的缝：本机数据 + MIT 可审计 + 不卖隐身 + 不自动续费 + 不承诺上岸。缝是窄的，但这是唯一还能讲的信任故事。

### 2.3 国内合规边界（不是律师意见）

**核验：**

- 《生成式人工智能服务管理暂行办法》（国家网信办等 2023 年 7 月 10 日令第 15 号，8 月 15 日施行）只适用于利用生成式 AI **向境内公众提供** 文本/图片/音频/视频生成服务；企业内部/学校/科研机构自用、不向境内公众提供的，明确不在范围。来源：https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm
- 具有舆论属性或社会动员能力的生成式服务，要做安全评估，并按算法推荐规定做算法备案/变更/注销。本办法本身**不点名** ICP 或 B25。
- 2024-04-02 网信办公开：已按本办法开展生成式服务备案，并公布已备案服务。https://www.cac.gov.cn/2024-04-02/c_1713729983803145.htm

**已驳回，禁止当事实：**

- 「只要开国内 Hosted 网关，OnCue 就法定是生成式服务提供者」（1-2）
- 「已上线应用必须显著公示上游模型名和备案号」（1-2）
- 「B25 信息服务业务覆盖 Hosted 面试建议/简历/账号门户」（0-3）
- 「B25 枚举类型把 Hosted 映射进经营性 ICP」（0-3）

**GTM 补充（需律师，不当前提）：**

- 纯 BYOK 桌面 + 用户自选境外 API，更像工具分发，不像典型生成式服务提供者。
- Hosted 网关若向境内用户提供 Gemini 生成，OnCue 更接近服务提供者：用户协议、输入保护、违法内容处置。调用已备案基座模型**不自动豁免**应用层义务。
- 网信办 2026-05-13：截至 2026-04-30，868 个生成式服务备案、530 个 App/功能登记。用火山已备案模型比自训短，仍要应用层披露；**不能把境外 Gemini 装成已备案国内服务。**
- 广东通管局：在自有网站/App 卖自有商品服务，不自动等于 B25。ICP 备案 ≠ 经营性 ICP 许可。
- 检索笔记（低置信）：鹅来面 OfferGoose 已展示 沪ICP备2021026665号 与网信算备号，说明「隐身 + 托管」竞品有人在走备案。不当 OnCue 的法律结论。

**闸门：** 律师书面判断之前，不对大陆用户开支付宝。若只能走境外 Gemini、无法公示国内已备案模型，则大陆只分发 BYOK 安装包，Hosted 限境外用户。

---

## 3. 竞品：活牌价 vs 营销谎言

### 3.1 核验过的活牌价（2026-09-04）

| 产品 | 结构 | 数字 | 票 |
|---|---|---|---|
| **Cluely** | Starter Free；Pro 月付；Pro + Undetectability | Pro **$19.99/月**；Pro+隐身 **$149.99/月**（Pro 的 7.5 倍）。标题「Pro from $11.99/mo」不在月卡上，像年付。无试用/退款/国内价。 | 3-0 |
| **Cluely 卖点** | 屏幕共享隐身是付费 SKU，不是默认 | 「Undetectable during screen share」「Completely hidden to meeting screen sharing software」；对比表有 Undetectability 行；独立页 `/undetectability` | 2-1 |
| **HireMe / 即答侠 专业版** | 月 / 季 | **¥129/月** 或 **¥289/季**（约 25% off，主推）。无限 Copilot、模拟、简历、报告、支持。 | 3-0 |
| **HireMe 基础版** | 月 / 季 | **¥69/月** 或 **¥159/季**（约 23% off）。无限模拟 + 完整简历；Copilot **每月 5 场 × 30 分钟**。 | 2-1 |
| **HireMe Offer 奖学金** | 仅付费用户 | 入职字节/阿里/腾讯/华为/美团可申请全额退充值；微信 LUCIANSPACE + Offer + 入职证明。 | 3-0 |
| **面试狗 套餐** | 官方文档 2025-02-17 | 不限次服务包 **¥666/月、¥999/两月、¥1,299/季**，有效期内不加收。https://docs.interviewdog.cn/docs/ding-jia | 3-0 |
| **面试狗 散买** | 无套餐 | 面试（现场辅助）**¥0.50–¥1.00/分钟**，钱包越大折扣越大。 | 2-1 |
| **cheating-daddy** | 无付费档 | 免费 GPL-3.0 Electron 浮窗，BYOK Gemini。2026-09-03：5,589 star、957 fork、155 未关 issue；2025-05-28 创建，最近推送 2026-07-23 v0.8.0，未归档。 | 3-0 |
| **LockedIn 营销** | 对比页 | 「100% undetectable」、无任务栏、无浏览器痕迹、对屏幕共享和监考不可见；指控 Final Round 桌面留任务栏图标。https://www.lockedinai.com/compare/lockedinai-vs-finalroundai-vs-final-round-ai | 3-0 |

来源：https://cluely.com/pricing ；https://interviewasssistant.com/zh/pricing ；https://docs.interviewdog.cn/docs/ding-jia ；https://github.com/sohzm/cheating-daddy 。

### 3.2 已驳回，不要写进对外材料

| 主张 | 票 | 备注 |
|---|---|---|
| Final Round Interview CoPilot「无永久免费档；10 分钟试用然后年 $25/月、季 $60/月、月 $90/月」 | 0-3 | 源页 https://www.finalroundai.com/blog/final-round-ai-pricing |
| Final Round 年/季 3 天全额退、月付不退、$180 季是 4–8 周默认 | 0-3 | 同上 |
| Stealth Mode 只在 Pro 和 God Mode | 0-3 | 同上 |
| LockedIn $54.99/月无限 vs Final Round $150/月（便宜 63%） | 0-3 | 对比文不是官方价 |
| cheating-daddy「始终置顶点击穿透，把屏幕+面试官音频送给 Gemini 2.0 Flash Live，带 Interview/Sales/… 档案」 | 0-3 | 许可证和星标仍核验；功能描述未过 |
| GitLab 升级路径是单发行版许可证密钥解锁；CE/EE 已于 12.3（2020-09-22）合并 | 0-3 | 三档 open-core 本身核验，单二进制解锁路径驳回 |

**Final Round 的正确写法：** 工作流驳回的是 `/blog/final-round-ai-pricing`。GTM 另引产品介绍页 `$25 / $60 / $90` 月等价、年 $300 / 季 $180 现金、10 分钟试用，并注明另一篇博客写月 $148。对外只用介绍页数字并标明矛盾，不当核验牌价。

### 3.3 GTM 引用、未再核验的竞品细节

仅作地图，不当报价单：

- LastRound：Free 15 credits/月；Starter $19 / Professional $49 / Ultimate $99；1 credit/分钟。https://lastroundai.com/pricing
- HireMe 免费档（抓取，不在 14 条里）：每月 3 次模拟、1 次简历、1×30 分钟 Copilot；按次低至 ¥9。官方 `/zh/pricing` 未见 BYOK/隐身承诺。
- Interview Coder：二手转述 $0 / $299/月 / $799 终身；独立评测提到检测与不退款。官网 HTML 本次抽不出结账页。
- Ecoute：MIT、Windows + 虚拟声卡原型。
- LockedIn：官方计划文结构已看到（General 无桌面隐身，Pro/Credit 才有），不公布美元价。

### 3.4 学什么，不学什么

**所有能赚钱的闭源产品，墙的都是现场辅助。** 模拟和简历是获客，Copilot 分钟才是收银机。OnCue 可以对齐「墙的是算力」，但墙的位置必须是官方 STT/LLM 分钟，不是隐身 API，也不是本机编译权。

不要学：

- LockedIn / LastRound 的积分燃烧（用户算不清一场面试多少钱）
- Final Round 的自动续费 + 月价是年价 5–6 倍（品类信任已经差）
- HireMe 的 Offer 返现（核验存在；产品纪律禁止）
- Cluely 把「完全隐藏」写成 SKU 名（核验存在；OnCue 禁止承诺）
- cheating-daddy 的 unfair advantage 文案（GPL-3.0 占住了「免费隐身」心智；OnCue 不要去抢这顶帽子）

价格锚：国内 Hosted 季卡 ¥199，低于即答侠专业季卡 ¥289，也低于面试狗 ¥1,299 季包；月卡 ¥89 落在即答侠基础月卡 ¥69 和专业月卡 ¥129 之间。海外对标 Cluely Pro $19.99，不要去碰 $149.99 隐身档。

---

## 4. OnCue 特色：真差异 vs 假差异

### 4.1 真的（可演示、可审计）

| 能力 | 为什么是差异 | 竞品对照 |
|---|---|---|
| MIT 桌面客户端 | 用户能读音频管线、捕获排除、本地库。这是「不是又一个云端偷听」的唯一证据。 | Cluely / Final Round / 即答侠闭源；cheating-daddy 是 GPL-3.0，不能当 MIT 开源核心再许可 |
| 本机 SQLite + BYOK | 面试内容默认不过 OnCue 服务器。网关合同写明不存音频/转写/提示/简历/回答。 | 云中转全家桶把内容放供应商；Cluely 泄露叙事伤的就是这个 |
| 系统音频是一等公民 | macOS AudioTee / Windows WASAPI。北极星是 15 分钟内听到面试官。 | 很多原型只做麦克风或要虚拟声卡（Ecoute） |
| 岗位工作区三件套 | 同一份简历 + JD → 优化、模拟、实战。落地计划阶段 2 的产品纪律。 | 即答侠偏题库/次数；Interview Coder 偏编码解题 |
| 一次性支付宝、无自动续费 | 代码已冻。求职是 4–12 周脉冲，不是订阅习惯。 | Final Round 年/月价差（未核验细节，结构常见）；Cluely 月付 |
| 诚实文案纪律 | 保护有限；规则允许才用；不保证上岸。 | LockedIn 100% undetectable；HireMe Offer 奖学金 |

### 4.2 假的（不要当卖点）

- 「内容永不离开这台电脑」——BYOK 仍发到 Deepgram/OpenAI/Anthropic/Gemini。只能说：OnCue 服务器不存，供应商是用户选的。
- 「完全隐身」——OS 排除不是反检测。会议软件、监考、摄像头、焦点行为都能露出。Cluely 把这句话卖 $149.99，OnCue 更不能说。
- 「开源所以更强隐身」——开源让人复制捕获排除，也会让人审计你没做进程伪装。这是信任资产，不是军备资产。
- 内部延迟 1.0–1.8s（2026-08 报告）——不是 2026-09 复测，对外禁止。

### 4.3 弱项（必须当面讲）

- Hosted 未过生产门，落地页已经长得像能买。
- 向导/会话身份/仪表盘噪音是落地计划阶段 0–1，没过就投放会录一堆垃圾会话。
- cheating-daddy 5.5k star 已经占住极客「免费隐身」心智；OnCue 去抢 GPL 产品的 GitHub 叙事会输。
- 国内 Hosted 用 Gemini 3.7 Flash：境外模型 + 境内收费是合规最大单点。火山 STT 相对好备案，LLM 不是。
- 双音源分开计费，用户不懂就会觉得「一场面试扣了两份分钟」。落地页必须写明。
- 单位经济未核验。内部估 ~¥1.25 / 45 分钟（火山 ASR + DeepSeek/Qwen）只是备忘；当前代码 Hosted LLM 是 Gemini，不是 DeepSeek。火山流式 ASR 文档页无公开每分钟价。

检索笔记（低置信，只作 COGS 下界，不是发票）：

- Deepgram Nova-3 流式约 $0.0048–$0.0077/分钟（~$0.22–$0.35 / 45 分钟）
- Groq whisper-large-v3-turbo $0.04/小时
- Gemini 3.5 Transcribe Live 混合约 $0.009/分钟
- DeepSeek V4 Flash 未命中缓存输入 $0.22/$0.44、输出 $0.66/$1.32 每百万 token（美元；低峰半价）

GTM 估算：PRO_QUARTER 50h STT 若打满，STT+LLM 可能到 ¥60–100；双音源可能刺穿。P95 COGS 超过定价 40% 时：不加额度、不开自动续费、不加无限档。¥89 / ¥199 只是试点价。

---

## 5. 三条路：每条怎么做，为什么默认不是 A 或 B

### 5.1 总表

| | A 纯开源 | B 闭源商业 | C 开源商业（默认） |
|---|---|---|---|
| 许可证 | 继续 MIT，无付费墙 | 新代码专有；GitHub 私有或 source-available | 客户端 MIT；网关专有但不藏「有网关」这个事实 |
| 钱从哪来 | 捐赠、支持合同、以后的公证包 | 试用后季卡/订阅；Lemon Squeezy / Paddle / 微信+兑换码 | Hosted 分钟（已实现）+ 以后可选公证包（Yaak） |
| 获客 | GitHub、V2EX、HN | 小红书/B 站隐身演示、投放 | MIT 获客 + Hosted 变现；渠道按信任分层 |
| 选它的条件 | 只做作品集，或 Hosted 合规被律师挡住 | 以后做企业反监考套件——不是 0.15 的 OnCue | 默认。代码、落地页、许可证已经长这样 |
| 失败模式 | cheating-daddy 已占免费隐身心智；没有 SLA 就没有客单价 | MIT 已经发出；闭源会重演 Cal.com 2026-04 的 HN 反噬 | Hosted 成本和合规炸 → 关掉支付，退回纯 MIT |

**核验的开源商业参照：** GitLab 三档 open-core——Free 开源不收费，Premium / Ultimate source-available 收费，自管和 SaaS 同名分档。https://handbook.gitlab.com/handbook/marketing/brand-and-product-marketing/product-and-solution-marketing/tiers/

**不要抄 GitLab 的哪一点：** 已驳回「单发行版许可证密钥解锁」。OnCue 更不该抄 CE 砍 SSO——钱来自算力和运维，不是把 `WDA_EXCLUDEFROMCAPTURE` 藏进企业版。

### 5.2 路径 A — 纯开源，怎么做

**做什么**

1. 公开仓库、issue、PR、GitHub Releases、`SHA256SUMS.txt`、`latest.json`。
2. README 一条 10 分钟 BYOK 路径：语言 → 一个 LLM Key → STT → 10 秒系统音频测试。
3. 版本号与 `package.json` 0.15.0 对齐，结束「GitHub latest 是旧版」的分发事故。
4. 欢迎 PR：转写、语言包、会议兼容。**不接受「更强反检测」类 PR。**
5. 不要账号、不要支付宝、不要 SLA。支持走 GitHub issue。
6. 可选以后：公证安装包付费下载，源码仍可编译（Yaak）。现在不做。

**什么时候选**

- 只想当作品集 / 开源履历。
- 律师判断境内 Hosted 走不通，又不想做境外-only 网关。
- 生产门长期关不上，宁可关掉支付也不要假「扫码即用」。

**为什么不是默认**

cheating-daddy 已经是免费 GPL 隐身 overlay，5.5k star。纯 MIT 没有差异化收入，也没有客服预算去教用户申请 Deepgram Key。A 是 C 的退路，不是第一选择。

### 5.3 路径 B — 闭源商业，怎么做

**如果硬做，清单是**

1. **新代码**改专有许可证；已经 MIT 发出的提交无法收回。双许可在 MIT 已授予之后基本不可行（FOSSA / Heather Meeker；GTM）。
2. GitHub 私有或 source-available。落地页去掉 View GitHub。
3. 20 分钟试用后季卡。墙现场辅助。Lemon Squeezy / Paddle 走海外；国内微信+兑换码。
4. 营销学即答侠：隐身浮窗、低延迟、上岸。这会直接撞上 OnCue 自己的文案红线。
5. 2026 最近似参照：Cal.com 2026-04-14 以「安全」为由关闭生产代码，留下 MIT Cal.diy——HN 反噬是 OnCue 闭源后的杀伤标准。https://cal.com/blog/cal-com-goes-closed-source-why

**为什么现在不要做**

- MIT 已经在 `LICENSE` 里。闭源新提交救不回已经 clone 的人，只会让 GitHub 叙事崩掉。
- 落地页已经写了 View GitHub + MIT。
- Cluely 泄露叙事 + Final Round 计费不透明已经把品类信任花光。闭源云中转是逆风。
- 隐身当付费 SKU 会被开源克隆成「免费隐身」（cheating-daddy 已在做）。
- 不要用 BSL/SSPL/FSL 防 AWS：Sentry FSL 明确拒绝 open-core；2026 年 Elastic / Redis/Valkey / HashiCorp/OpenTofu 潮说明改许可证是最后手段，且会分叉。OnCue 没有 AWS 在抢的数据平面。

B 只在一种未来有意义：做成企业反监考/培训机构套件，买方变成公司。那是另一个产品，不是 0.15 的求职季卡。

### 5.4 路径 C — 开源商业，怎么做（默认）

**不是** GitLab 式「砍功能进付费档」。  
**是** 下列参照的组合：

| 参照 | 学 | 不学 |
|---|---|---|
| Yaak | MIT 客户端，收公证安装包/更新便利，不收核心能力 | 现在就向编译权收费 |
| Ollama | 跑得本机免费，卖托管分钟 | 把模型锁死 |
| Obsidian | 本地永远免费，云同步可选 | 把核心笔记功能做成付费墙 |
| Plausible | 可自托管；不要把 MIT 客户端改 AGPL 来「防托管」 | AGPL 恐吓 |
| PostHog | 先托管赚钱，再 open-core | 一上来就企业 SSO 档 |
| 早期 Sentry | OSS 获客，托管收钱 | 后期 FSL / 否定 open-core |
| GitLab | 三档命名清楚 | 把隐身/捕获排除放进 Ultimate |

**OnCue 切开（必须保持）**

```
MIT 开源          桌面客户端、音频、隐身窗口、模拟、简历、BYOK
专有但不藏源码     网关：OIDC、支付宝、配额、火山/Gemini 密钥
收费              Hosted 周期额度（已实现）
以后可加          公证安装包的付费通道 / 优先支持（Yaak 模式）
永远不收费        源码编译权、BYOK、本地历史、捕获排除 API 调用
```

**SKU 冻结（采用代码，废弃 08 月文档）**

| 方案 | 价格 | 权限 |
|---|---|---|
| 开源 / BYOK | ¥0 | 完整客户端；自备 Key；本地数据；GitHub 自行编译 |
| Pro 月卡 | ¥89 / 30 天 | 15h 托管 STT + 200 万 LLM units；支付宝；无自动续费 |
| Pro 季卡（主推） | ¥199 / 90 天 | 50h STT + 800 万 LLM units |

规则：

- 新账号无额度（代码已如此）。邀请码最多送 30 分钟 STT，不当公开免费档。
- BYOK 功能完整免费。不要再设 Copilot 10 分钟软件墙。
- 双音源（系统 + 麦）分开计费，落地页必须写。
- 旧本地季卡 ≠ Hosted 额度。
- 不要终身买断、不要积分、不要 SSO 企业版、不要白标、不要 Offer 返现。
- 第二条收入优先级：Hosted 加油包（5h STT，等季卡打满数据）→ 公证包付费下载（仅当 Windows SmartScreen 挡住转化）→ 团队席位（先有 50 个个人付费）。

**不要双许可，不要为了防托管改 BSL。** 不要 CLA，除非真的要改许可（现在不要）。

---

## 6. 营销：讲什么，在哪讲，何时开量

### 6.1 三根柱子（只讲能演示的）

1. **听得见。** 30 秒：会议在响，浮窗出要点，任务栏无异常。结尾加「规则允许才用」。
2. **数据在哪。** 对比 Cluely 云端风险：BYOK 密钥在本机；Hosted 网关不存音频/转写。不说「永不离开设备」。
3. **算得清。** ¥199 / 90 天 / 50h，一次性，不续费。对比即答侠 ¥129/月、Cluely $19.99 以及 $149.99 隐身档。一场面试大概扣多少分钟，双音源怎么算，写在定价卡上。

### 6.2 禁止句

- 完全隐身 / 面试官无感 / 100% undetectable / Completely hidden
- 保证上岸 / Offer 返还 / 奖学金
- 内容永不离开这台电脑
- 伪造用户数、星标、成功率
- Hosted 未开、安装包未签时的付费投放
- 英文市场用 cheating-daddy 那套 unfair advantage。改用：privacy-first meeting copilot for interviews where tools are allowed

### 6.3 渠道顺序

1. **先信任：** V2EX / 即刻 / 少数派 / HN Show HN。讲 MIT + BYOK + 系统音频原理。
2. **再季节：** 秋招前 30 天，小红书 / B 站。讲权限怎么开、Key 怎么申请、支付宝怎么开通。
3. **搜索页：** `macOS 系统音频 面试助手`、`BYOK 面试 Copilot`。不要买「隐身面试作弊」。

开源运营便宜且必要：README 写清 Hosted 网关是独立服务，密钥和计费不在桌面仓库。Releases 与 0.15.0 对齐。

### 6.4 落地页现在就要改的三件事（先于投放）

1. Hosted 卡写上 ¥89 / ¥199、额度、无续费、双音源计费。
2. 去掉「扫码即用」，在 `PAYMENTS_ENABLED=true` 之前改成「即将开放」或只留邀请。
3. TERMS 从「本地季卡锁 Copilot 时长」改成支付宝商品。PRIVACY 与「网关不存音频」对齐，同时写明 BYOK 会发到用户供应商。

---

## 7. 这个季度（2026-09-04 起 90 天）

北极星不变。下载量不是 KPI。

**Week 1–2 产品诚实**

- 落地页价格/额度/计费口径与 `payments.rs` 对齐。
- 重写 TERMS。
- 向导：一个 LLM Key **或** Hosted 登录 + 10 秒系统音频测试。测试不过不显示就绪。
- 会话必须有职位；闲聊不进仪表盘次数、不打分（落地计划阶段 0，没做完不要对外）。

**Week 3–4 生产门 + 分发**

- 按 vendor contract 关：支付宝沙箱双商品、重复通知、金额篡改、提前续费；火山/Gemini 发票对账；CSP 换成真网关；Resend；备份；隐私审查；7 天对账。
- macOS 公证、Windows 签名。做不到就下载页写风险，不要装成商店应用。
- Tauri 2 updater 用 Ed25519；签名校验不能关；私钥丢失 = 无法更新已装客户端。GitHub Releases `latest.json` 是支持的通道。
- **境内 Hosted 闸门：** 律师书面判断。通不过 → 大陆只卖/送 BYOK 安装包。

**Week 5–8 小范围卖**

- 邀请制 Hosted，目标 **20 个真实付费**，不是投放。
- 记：激活失败原因、STT 分钟、退款、是否改回 BYOK、双音源是否导致客诉。
- 内容三条：B 站系统音频原理、小红书 Key 申请、V2EX MIT 帖。

**Week 9–12 决定是否扩**

- 付费用户 P95 成本可控、退款低、首次建议成功率可接受 → 开公开支付宝。
- Hosted 合规或成本炸 → 关支付，退回路径 A，网关留作内部。这是计划内退路，不是失败叙事。

杀伤标准：新用户 15 分钟内听不到系统音频；仪表盘被闲聊污染；生产门未关就对公收款；文案出现隐身军备或 Offer。

---

## 8. 局限与未决

1. Final Round 结账页本次未抽出。产品介绍页与另一博客价矛盾。工作流驳回了 `/blog/final-round-ai-pricing` 的具体数字。
2. Interview Coder $299/$799 为竞品转述。
3. LockedIn 官方不公布美元价。$54.99 只在对比文。
4. Cluely 8.3 万泄露不是官方事故页。
5. 招聘方 AI 面试市场规模 ≠ Copilot TAM。本次无核验 TAM/SAM/SOM。
6. Sensei AI、秋招/春招人数、面试狗 2026 是否改价，未进入 14 条核验。
7. 延迟数字来自旧内部报告。
8. 单位经济：内部 ¥1.25/场与当前 Gemini Hosted LLM 不一致；火山无公开单价；45 分钟双音源对账未做。
9. B25/ICP 不是已核验的硬分类。要律师，不要产品经理读目录页。
10. 本仓库 Hosted 仍是预生产。任何对外「扫码即用」在支付开关打开前都是虚假广告。
11. 2026-08-27 竞品记分卡、2026-08-31 订阅备忘只作快照，已用 2026-09-04 活牌价覆盖其过时数字（例如旧 HireMe ¥49/¥79）。

---

## 9. 一页纸（可单独转发）

**做开源商业，不要做闭源，也不要做空开源。**

- 客户端继续 MIT。这是对抗「云端偷听面试」的唯一可信故事。
- 钱只来自 Hosted 算力（¥89 / ¥199，一次性支付宝）。BYOK 永远免费。
- 隐身、模拟、简历不要做付费墙。付费墙架在官方 STT/LLM 分钟上。
- 营销只讲听得见、提纲在、数据在哪、规则允许。不讲隐身军备和 Offer。
- Hosted 生产门没关、安装包没签之前，不投放。落地页先把价格、额度、双音源和 TERMS 写对。
- 境内 Hosted 先问律师。Gemini 不能装成已备案国内模型。问不过就只分发 MIT 客户端。
- 成本或合规炸了，按路径 A 退：关支付，开源还在。

---

## 10. 来源

### 核验主键

1. https://cluely.com/pricing — Cluely 月卡与隐身 SKU
2. https://www.lockedinai.com/compare/lockedinai-vs-finalroundai-vs-final-round-ai — LockedIn 隐身营销
3. https://github.com/sohzm/cheating-daddy — GPL-3.0、星标、无付费档
4. https://interviewasssistant.com/zh/pricing — 即答侠基础/专业/Offer 奖学金
5. https://docs.interviewdog.cn/docs/ding-jia — 面试狗套餐与按分钟
6. https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm — 令第 15 号
7. https://www.cac.gov.cn/2024-04-02/c_1713729983803145.htm — 生成式备案公示启动
8. https://handbook.gitlab.com/handbook/marketing/brand-and-product-marketing/product-and-solution-marketing/tiers/ — GitLab 三档

### 产品与合同

9. [LICENSE](../LICENSE) — MIT
10. [README.md](../README.md) — BYOK、音频、规则允许声明
11. [docs/vendor_contract.md](../docs/vendor_contract.md) — SKU 冻结与生产门
12. [docs/PRODUCT_LAUNCH_PLAN.md](../docs/PRODUCT_LAUNCH_PLAN.md) — 产品纪律（收费表过时）
13. [docs/PRODUCT_OPTIMIZATION_PLAN.md](../docs/PRODUCT_OPTIMIZATION_PLAN.md) — 北极星（收费表过时）
14. [docs/TERMS.md](../docs/TERMS.md) — 上线前必须改
15. `server/src/payments.rs` — `PRO_MONTH` 8900 / `PRO_QUARTER` 19900
16. `landing/src/components/PricingSection.tsx` — 双轨 UI、「扫码即用」

### 同日备忘

17. [outputs/oncue-open-closed-gtm.md](./oncue-open-closed-gtm.md) — 执行备忘（渠道、90 天、来源 1–39）
18. [outputs/oncue-open-closed-gtm.provenance.md](./oncue-open-closed-gtm.provenance.md) — GTM 出处

### GTM 引用、未再 3 票的键

19. https://lastroundai.com/pricing
20. https://www.finalroundai.com/blog/what-is-final-round-ai — 介绍页价格（与他文矛盾）
21. https://techcrunch.com — Cluely a16z $15M（2025-06-20）
22. https://cal.com/blog/cal-com-goes-closed-source-why
23. https://open.sentry.io/licensing/
24. https://www.cac.gov.cn — 2026-05-13 备案汇总（868 / 530）
25. 广东通管局 B25 指南（自有商品不自动等于 B25）
26. https://v2.tauri.app/plugin/updater/ — Ed25519，签名不能关

### 明确不采用

- https://www.finalroundai.com/blog/final-round-ai-pricing 的具体价（工作流 0-3）
- NextMSC 等「AI Interview Market $1.5B」当 OnCue TAM
- 2026-08-27 `outputs/rabbit-interview-competitor-analysis.md` 加权记分卡
- 旧 HireMe ¥49/¥79
- Cluely 8.3 万泄露博客当官方事故
- 检索笔记中的 Deepgram/Groq/Gemini/DeepSeek 单价当 Hosted 发票
