# OnCue 竞品、市场与开源/闭源商业路径

- **Slug:** `oncue-open-closed-gtm`
- **Topic:** 分析 OnCue（仓库名 RabbitInterview）相对主流面试 Copilot 的位置，评估开源、闭源、开源商业三条路径，并给出可执行营销与收费方案
- **Date:** 2026-09-04
- **Artifact Type:** Research brief with inline citations
- **Product snapshot:** desktop `0.15.0`，MIT，落地页双轨 BYOK + Hosted，网关预生产

---

## 1. 结论先讲

**默认路径：保持 MIT 开源客户端，卖托管推理，不改闭源，也不做“把隐身锁进企业版”的 open-core。**

这不是口号，是现有代码、许可和品类结构共同决定的：

1. 客户端已经是 MIT，版权声明写明允许复制、修改、再分发和出售。[LICENSE](../LICENSE)
2. 仓库已经在做第二条收入线：支付宝一次性买 `PRO_MONTH` / `PRO_QUARTER`，换火山 STT + Gemini 额度，而不是锁客户端功能。[server/src/payments.rs](../server/src/payments.rs) · [docs/vendor_contract.md](../docs/vendor_contract.md)
3. 这个品类里，用户真正付钱的是**上场 90 分钟听得见、答得出**。模拟面试和简历优化是获客与热身，不是定价锚点。[docs/research/copilot-vs-suite.md](../docs/research/copilot-vs-suite.md)
4. 海外闭源 SaaS 用高月费、积分、自动续费和“完全隐身”换收入，同时换来退款投诉和数据泄露。OnCue 的差异化是**本机数据 + 自备 Key + 可选国内托管**，不是再做一个更便宜的 Final Round。
5. 纯闭源现在做不到：MIT 副本已经发出去。纯捐赠养不活公证、网关和客服。把隐身做成付费墙，会被 Cheating Daddy / OpenCluely 这类 GPL/开源克隆直接拆掉，也和本产品条款冲突。

一句话产品：**系统音频听面试官，浮窗只给你看。Key 可以是你的，也可以扫支付宝用官方算力。面试内容默认不进 Rabbit 数据库。** 落地页已经这么写。[landing/src/locales/content.ts](../landing/src/locales/content.ts)

下面分四块：产品事实、竞品、市场、三条路径怎么做。

---

## 2. 本产品现在是什么

对外品牌 **OnCue**，包标识 `com.rabbitinterview.desktop`，GitHub 仓库 `thomas92118/rabbit-interview`，安装包仍叫 RabbitInterview。[src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) · [landing/src/locales/content.ts](../landing/src/locales/content.ts)

### 2.1 能力

| 模块 | 现状 | 商业角色 |
|---|---|---|
| 隐形助手 / Stealth Copilot | 系统音频 + 可选麦克风，流式转写，结构化回答，OS 级窗口排除（macOS `NSWindowSharingType::None`，Windows `WDA_EXCLUDEFROMCAPTURE`） | **付费理由** |
| 模拟面试 | 按岗位出题、语音轮次、评分报告 | 热身与激活，不是主商品 |
| 简历优化 | 对 JD 改简历，导出 DOCX | 上场上下文，不是主商品 |
| 历史 | 本地 SQLite 会话、录音、复盘 | 留存，不单独卖 |

本机实测已经用脚投票：隐形助手有会话，模拟面试和简历工作区接近空转。套件叙事会把购买时刻（面试前 30 分钟）做成准备日历。[docs/research/copilot-vs-suite.md](../docs/research/copilot-vs-suite.md)

技术栈：Tauri 2 + Rust + React 19。macOS 14.2+ 用 AudioTee sidecar 抓系统音频；Windows 用 WASAPI loopback。STT 可选 Deepgram / Gemini Live / Apple；LLM 可选 Groq / OpenAI / Anthropic / Gemini。[README.md](../README.md)

### 2.2 已经存在的双轨，不是规划

文档和代码已经分叉成两套账，对外方案必须按**代码冻结口径**讲，不要再把 2026-08 的“只卖本机季卡、不建后端”当成现状。

| 轨道 | 谁付钱 | 数据去哪 | 现在能不能卖 |
|---|---|---|---|
| **BYOK** | 用户直接付给 Deepgram / Groq / OpenAI 等 | 音频和文本从本机直连供应商；Rabbit 不经手 | 能发安装包。软件本身 MIT 免费 |
| **Hosted** | 用户付给 OnCue，OnCue 付给火山 / Gemini | 音频经网关到火山；问答经网关到 Gemini；网关不持久化音频、转写、简历、答案 | **还不能卖。** `HOSTED_STT_ENABLED` / `HOSTED_LLM_ENABLED` / `PAYMENTS_ENABLED` 默认 false，生产门未关完 |

Hosted SKU 已写进支付服务：

- `PRO_MONTH`：CNY **89**，30 天，15 小时 STT，2,000,000 LLM units
- `PRO_QUARTER`：CNY **199**，90 天，50 小时 STT，8,000,000 LLM units

支付宝一次性付款，无自动续费；提前续费从当前到期后续接，不把未来额度提前花掉。[server/src/payments.rs](../server/src/payments.rs) · [docs/hosted_gateway_runbook.md](../docs/hosted_gateway_runbook.md) · [landing/src/locales/authContent.ts](../landing/src/locales/authContent.ts)

旧文档冲突，以代码和 vendor contract 为准：

- 《落地计划》曾写免费额度 + 本机月卡 ¥79 / 季卡 ¥199 / 终身 ¥499，不建账号。[docs/PRODUCT_LAUNCH_PLAN.md](../docs/PRODUCT_LAUNCH_PLAN.md)
- 《优化方案》曾写只卖 ¥199 季卡锁 Copilot 时长，用户自付 API。[docs/PRODUCT_OPTIMIZATION_PLAN.md](../docs/PRODUCT_OPTIMIZATION_PLAN.md)
- 条款仍写“90 天季卡去掉 Copilot 时长上限，第三方 API 自付”。[docs/TERMS.md](../docs/TERMS.md)
- **现行实现是 Hosted 配额，不是本地许可证墙。** 旧条款需要在上线前改到与支付宝商品一致。

### 2.3 真正的产品特色（能对外讲、能被代码证明）

1. **Local-first，不是“数据永不离开电脑”。** BYOK 下简历、录音、Key 在本地 SQLite；音频和提示仍会去用户选的供应商。Hosted 下网关过音频和提示，但不存内容。隐私政策已经这样写，营销不得改口成绝对本地。[docs/PRIVACY.md](../docs/PRIVACY.md)
2. **原生系统音频，不是虚拟声卡玩具。** 这是相对 Ecoute / 早期开源脚本的硬差。
3. **窗口捕获排除是 OS API，不是“反监考”。** 条款禁止承诺完全隐身。[docs/TERMS.md](../docs/TERMS.md) · [src-tauri/src/copilot_window.rs](../src-tauri/src/copilot_window.rs)
4. **国内支付摩擦是功能。** 竞品要海外卡；OnCue 用支付宝买固定周期额度。这比“再便宜 20%”更决定转化。
5. **无自动续费。** 求职是 1–3 个月脉冲需求。这是对 Final Round / LockedIn 扣费投诉的直接反击。
6. **MIT 可审计。** 在 Cluely 泄露面试转写和截图的舆论里，这是信任资产，不是成本。

### 2.4 当前短板（决定营销能不能开始）

| 短板 | 证据 | 对商业的影响 |
|---|---|---|
| Hosted 未过生产门 | 火山真实账单、Gemini 取消对账、支付宝沙箱/退款、CSP 仍是 `gateway.example.com` | 现在不能收 Hosted 的钱 |
| 安装包可能未公证 | 落地页自己写了 | 付费转化会被 SmartScreen / Gatekeeper 吃掉 |
| 首次成功路径仍陡 | 优化方案：无向导时用户卡在 Key | BYOK 转化差，会把所有人推向尚未就绪的 Hosted |
| 编码 OCR 弱 | 对 Interview Coder 不是同一场战争 | 不要用 LeetCode 截屏当主承诺 |
| 品牌分裂 | OnCue / RabbitInterview / rabbitinterview.com 混用 | 搜索和口碑无法累积 |

**未满足“能听见系统音频 + 同一岗位能走完一场 Copilot + 仪表盘不被闲聊污染 + 可下载当前版本”时，不要投放。** 这是落地计划的完成定义，仍然成立。[docs/PRODUCT_LAUNCH_PLAN.md](../docs/PRODUCT_LAUNCH_PLAN.md)

---

## 3. 竞品格局（2026-09 核验）

品类已分成五层。OnCue 不在“招聘方 AI 面试官”那一层，也不在“算法截屏解题”那一层。

```
招聘方基础设施     HireVue / Eightfold / Greenhouse     企业采购，不是你的客户
海外全家桶 SaaS     Final Round AI / LockedIn AI         高价、云中转、隐身当卖点
海外单点/会议层     Interview Coder / Cluely             编码解题 vs 会议隐形
国内桌面套件       即答侠 / 面试狗                       中文、按次/月、隐身浮窗
开源/BYOK 原型     Cheating Daddy / Ecoute / OpenCluely  免费、丑、但会分流极客
OnCue              MIT 桌面 + 可选国内托管               本机数据，双轨收费
```

### 3.1 价格对照（能核对官网的才当硬事实）

| 产品 | 许可 | 官方可核价格（本次抓取） | 卖什么 | 信任问题 |
|---|---|---|---|---|
| **OnCue** | MIT 客户端 | Hosted ¥89 / 30 天，¥199 / 90 天（代码已写，支付未开） | 本机 Copilot；可选火山+Gemini 额度 | 预生产；安装包可能未签 |
| **即答侠 HireMe AI** | 闭源 | 免费：3 次模拟/月、1 次简历、1 次 Copilot 30 分钟；基础 ¥69/月或 ¥159/季（5 次 Copilot）；专业 ¥129/月或 ¥289/季（Copilot 不限次）；积分低至 ¥9/次 | 实时浮窗 + 模拟 + 简历。价差在 Copilot 次数 | 官网写“面试官完全无感”“Offer 奖学金全额返还” |
| **Cluely** | 闭源 | Starter 免费（限量回复）；Pro **$19.99/月**；Pro + Undetectability **$149.99/月**（“对会议屏幕共享完全隐藏”） | 会议助手；隐身单独加价 | TechCrunch 2025-06-20：a16z 领投 **$15M** Series A，两名未参投投资人估计投后约 **$1.2 亿**；创始人因 Interview Coder 被哥伦比亚停学。2025 泄露报道指向约 8.3 万用户转写/截图（无官方事故页，见第 8 节） |
| **LastRound AI** | 闭源 | Free 15 credits/月；Starter **$19**；Professional **$49**；Ultimate **$99**。Mock/Copilot 各 1 credit/分钟 | 积分套件 | 官方价格清晰，产品把 auto-apply 和 Copilot 捆在一起 |
| **Final Round AI** | 闭源 | 产品介绍页（2026-09-04）：年付 **$25/月 = $300/年**；季付 **$60/月 = $180/季**；月付 **$90/月**；无长期免费档；**10 分钟试用**；季/年 3 天退款，月付不退。[what-is-final-round-ai](https://www.finalroundai.com/blog/what-is-final-round-ai) 另一篇博客写月 **$148**、且 2026 起 live 无试用——**以产品介绍页 $90/$180/$300 为主，注明内部矛盾** | 练习可作获客，live Copilot + Stealth 收费 | 退款/扣费投诉在第三方评测里反复出现 |
| **LockedIn AI** | 闭源 | 官方计划文不写美元数字。结构：Unlimited General（**无桌面、无 True Stealth**）；Unlimited Pro（桌面 + Stealth + Azure GPT/Gemini/Deepseek）；Credit（例 2400 学分/年，专业会议 1 学分/分钟，学分不过期）。对比文另写“免费 10 分钟/天，付费从 $54.99/月起”。**美元价未在计划文核到** | 面试 Copilot + 编码；隐身只在桌面档 | 价格不透明；浏览器与桌面隐身分家 |
| **Interview Coder** | 闭源 | 官网可读提取未含价表。竞品评测反复写 **$299/月、$799 终身**——**未在本次官网 HTML 中核到，标为二手** | 编码面试截屏解题 | 与 Cluely 同源叙事（Columbia 停学 → 商业化） |
| **面试狗** | 闭源 | 官方教程：包月 **¥666** / 双月 ¥999 / 包季 ¥1299；面试模式 **¥0.5–1/分钟**；累计充值 ¥300 眼神修复；满 ¥666 送隐形耳机/双机位笔试 | 面试+笔试作弊套件 | **不要学。** 这是监考对抗，不是 Copilot 品类 |
| **Cheating Daddy** | GPL-3.0 | $0，BYOK Gemini | 开源隐形助手 | 产品名即作弊；Electron；极客分流 |
| **Ecoute** | MIT | $0，可选 OpenAI Whisper | 实时转写原型 | Windows + 虚拟声卡，不是产品 |

即答侠价格以 2026-09-04 的 [interviewasssistant.com/zh/pricing](https://interviewasssistant.com/zh/pricing) 为准。第三方站点仍在转 ¥49/¥79 旧价，**不要用。** 即答侠自己的博客也有互相矛盾的免费额度，以定价页为准。

Cluely 以 [cluely.com/pricing](https://cluely.com/pricing) 为准。标题写 “from $11.99/mo”，卡片写 Pro $19.99 与 Undetectability $149.99。对外引用用卡片数字，并注明标题促销可能另有年付。

### 3.2 竞品教给 OnCue 的定价结构

所有能赚钱的闭源产品都把墙架在**实时辅助**上：

- Final Round：练习可免，live Copilot 和 Stealth 要付费。
- 即答侠：模拟在基础版已无限，Pro 才无限 Copilot。
- Cluely：普通会议 $20 级，隐身 $150 级。

不要学的：

- LockedIn / LastRound 的 **credit 烧分钟**（用户在面试周爆额度）。
- Final Round 的 **自动续费 + 月费是年费 5–6 倍**。
- 即答侠的 **Offer 返现**（本产品条款禁止保证结果）。
- Cluely 的 **“完全隐藏”作为 SKU 名**（本产品条款明确不是隐身承诺）。

### 3.3 OnCue 相对竞品的优劣势（更新到 0.15）

**优势**

- 架构：BYOK 直连，面试内容不进第一方库；Hosted 过网关但不落内容。Cluely 把转写和截图放云端，已经出过泄露叙事。
- 成本：Deepgram 当前价目仍把 Nova-3 流式促销到约 **$0.0048/分钟**（原价 $0.0077），Nova-2 作为旧模型仍被文档提到。45 分钟 BYOK 转写大约 **$0.22–$0.35**，加 Groq/Gemini 仍远低于一场 ¥15–$20 的 SaaS。[deepgram.com/pricing](https://deepgram.com/pricing)
- 国内：支付宝 + 火山，不要求海外卡。
- 许可：MIT 可审计，对开发者社区是 Cluely/Interview Coder 买不到的。

**劣势**

- 没有即答侠的中文题库、手机同步、截屏解题。
- 没有 Interview Coder 的编码 OCR 深度。
- 没有 Cluely 的品牌声量和 VC 预算。
- Hosted 未上线，落地页却已经在卖“扫码即用”——**承诺超前于交付。**

**不要再引用 2026-08-27 竞品报告里的“软件 $0、综合得分 4.45”当对外材料。** 那份报告把当时的纯 BYOK 写成终局，且延迟数字来自本机理想路径，不是第三方基准。[outputs/rabbit-interview-competitor-analysis.md](rabbit-interview-competitor-analysis.md)

---

## 4. 市场环境

### 4.1 先分清两个市场

卖方研究报告里的 “AI Interview Market $1.5B–$2B” 主要是 **HireVue / Eightfold 这类招聘方工具**，不是候选人 Copilot。[NextMSC](https://www.nextmsc.com/report/ai-interview-market-ic4943) 等。**不能把这个数字当 OnCue TAM。**

候选人 Copilot 是 2023 后长出来的灰色消费品：远程视频面试把“第二块屏 + 系统音频”变成默认物理条件。OphyAI 等从业者把市场分成教练、Copilot、简历、招聘方检测四块，并指出 Copilot 是政策争议最大、增长最快的一块。

### 4.2 需求从哪来

- **远程面试仍是默认第一轮。** 系统音频 Copilot 只在“面试发生在这台电脑上”时成立。
- **求职是季节性脉冲。** 国内秋招约 8–10 月、春招约 2–4 月、社招金三银四 / 金九银十。90 天卡比 12 个月订阅更贴周期。即答侠和 OnCue 不约而同做季卡，不是巧合。
- **支付摩擦是中国市场的墙。** Deepgram / OpenAI Key 需要海外支付。Hosted 的存在理由首先是**开箱**，其次才是毛利。
- **SaaS 溢价制造了“干净工具”缺口。** Final Round 产品页月 **$90** / 年 $300；Cluely 隐身 **$149.99**；即答侠 Pro **¥129/月或 ¥289/季**。¥199 季卡低于国内 Pro 季卡，也低于海外月费入门。面试狗 ¥666/月是另一条（监考对抗）价格带，不要对标。
- **开源克隆在教育市场。** Cheating Daddy（GPL-3.0，GitHub 星标已到数千）证明：只要闭源卖“隐形”，就会被开源 BYOK 复制一层。OnCue 开源客户端是预防被抄成叙事，而不是害怕被抄功能。

### 4.3 监管、伦理、雇主对抗

**使用伦理（产品红线，已经写进条款）**

- 不得宣传违反面试规则。
- 不得承诺 Offer。
- 不得把 OS 捕获排除说成反监考 / 100% 不可见。
- 物理摄像头、内核探针、双机位、HireVue 类监考不在能力范围内。

SecureInterview 等招聘方内容已经把“隐藏 Copilot”当成流程设计问题，而不是靠插件抓人。长期趋势是：**部分公司会允许声明使用 AI，部分会改成当场追问和可控考场。** Copilot 产品要活在“规则允许的辅助”里，不要活在军备竞赛里。

**中国大陆 Hosted 合规（上线前必须律师过，这里只标法条事实）**

《生成式人工智能服务管理暂行办法》第二条：向境内公众提供生成文本等内容的服务，适用本办法。未向境内公众提供的研发应用，不适用。[CAC 原文](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)

含义：

- **纯 BYOK 桌面 + 用户自己调境外 API**：OnCue 更像工具分发，不直接提供生成内容服务。仍有应用商店/公证/隐私义务，但不是该办法的典型“服务提供者”。
- **Hosted 网关向境内用户提供 Gemini 生成**：OnCue 落入“生成式人工智能服务提供者”，要签用户协议、保护输入、发现违法内容处置。若服务具有舆论属性或社会动员能力，还涉及安全评估和算法备案（第十七条）。调用已上线的基础模型，不等于自动豁免应用层义务。网信办 2026-05-13 公告：截至 2026-04-30，累计 **868** 款生成式人工智能服务完成备案，**530** 款应用或功能完成登记；直接调用已备案模型能力的应用由地方网信办登记；已上线应用应公示模型名称和备案号/上线编号。[CAC 2026-03至04月备案公告](https://www.cac.gov.cn/2026-05/13/c_1780413225190669.htm) Hosted 若走火山等已备案国内模型，登记路径比自训模型短，但仍要做应用层公示与内容安全，不能把境外 Gemini 包装成“已备案服务”蒙混。

电信许可：广东通信管理局公开说明，企业用自有网站/APP **自营销售自身商品或服务**、且不是给他人提供信息发布平台的，**不一定**需要增值电信许可；ICP **备案**和经营性 **ICP 许可（B25）** 不是一回事。[广东省通管局办理指南](https://gdca.miit.gov.cn/bsfw/bszn/jyxk/tzgg/art/2025/art_30ca3eed248444a9bc108fdacab59c67.html)

**本报告不构成法律意见。** Hosted 对公收费前，至少要让律师书面判断：ICP 备案、是否触发 B25、生成式 AI 备案/标识、支付宝商户与退款、隐私政策与账号删除。vendor contract 已要求隐私审查后才能 `PAYMENTS_ENABLED=true`。

### 4.4 单位经济（数量级，不是已验证毛利）

内部测算：45 分钟、单音源、火山约 ¥1.2/小时档 + Gemini 小上下文，单场基础设施大约 **¥1–2**。[docs/cloud_stt_llm_subscription_proposal.md](../docs/cloud_stt_llm_subscription_proposal.md)

`PRO_QUARTER` 给 50 STT 小时。若用户用满，STT 成本大约 ¥60–100，再加 LLM。¥199 在“平均用户用不满 50 小时”时毛利可看；在双音源（系统+麦都计费）+ 长上下文 + 取消浪费下会被打穿。

vendor contract 写明：**真实发票舍入、45 分钟双音源、Gemini 断流账单都还没验证。** 所以 ¥89/¥199 只能当试点价，不能当对外“已验证单位经济”。[docs/vendor_contract.md](../docs/vendor_contract.md)

BYOK 轨道边际成本接近落地页和更新带宽。这是开源客户端可以免费的原因。

---

## 5. 三条路径：怎么做、做什么、不做什么

### 5.1 对照表

| | A. 纯开源 | B. 闭源商业 | C. 开源商业（推荐） |
|---|---|---|---|
| 客户端许可 | MIT，维持现状 | 新代码改专有；旧 MIT 副本仍合法 | MIT 维持现状 |
| 收入 | 捐赠 / GitHub Sponsor | 订阅锁功能 | Hosted 额度 + 以后可选签名包支持 |
| 对标 | Ecoute、Cheating Daddy | Final Round、即答侠、Cluely | Yaak（MIT+签名包）、Obsidian（本地免费+可选服务）、Plausible（AGPL 自托管+云）、Sentry 早期（开源+托管） |
| 适配 OnCue | 养社区，养不活公证和网关 | 和已发出的 MIT、落地页 GitHub 按钮冲突 | 和当前代码一致 |
| 主要风险 | 没钱 | 失信、被开源克隆、合规成本全扛 | Hosted 合规；免费用户支持负担 |
| 90 天能否做 | 能，但无商业 | 不能干净地做 | 能：先开 Hosted 试点 |

### 5.2 路径 A：纯开源怎么做

**做什么**

- 公开仓库、Issue、Releases、SHA256。
- README 把 BYOK 配通写成 10 分钟路径。
- 不收软件费。接受 Sponsor。
- 隐身能力继续开源，条款继续写“规则允许才用”。

**不做什么**

- 不承诺 SLA、不建账号、不开支付宝。
- 不和即答侠比客服。

**何时选：** 作者只想当作品集，或 Hosted 合规明确做不了。  
**商业结果：** 极客采用，大众不用。Cheating Daddy 已经占了“免费隐形”心智，OnCue 很难靠纯开源赢品牌。

### 5.3 路径 B：闭源商业怎么做

**如果硬做，标准剧本是：**

1. 新版本改专有许可；GitHub 变私有或 source-available。
2. 免费试用 20 分钟 Copilot，季卡解锁。
3. 支付用 Lemon Squeezy / Paddle / 微信+兑换码。
4. 营销学即答侠：隐身、700ms、上岸。

**为什么不建议现在做**

- MIT 已经允许别人继续编译旧代码。闭源新版本不会消灭开源分叉。
- 品类信任正在被 Cluely 泄露和 Final Round 扣费透支。再加一个不给源码、收面试音频的云，叙事更差。
- 隐身一旦变成付费功能，开源克隆会把它当民主化卖点（Natively / OpenCluely 已经这么打 Cluely）。
- 你已经写了落地页 “View GitHub” 和 MIT。收回许可是社区事件，不是开关。

**只有一种闭源有意义：** 公司以后做企业监考对抗、团队席位、不打算要开发者社区。那是另一家公司，不是 0.15 的 OnCue。

### 5.4 路径 C：开源商业怎么做（默认）

行业里真正能对上号的不是 GitLab 式“CE 砍 SSO”，而是下面三套的组合：

| 先例 | 做法 | 可抄的 | 不可抄的 |
|---|---|---|---|
| [Yaak](https://yaak.app/blog/commercial-use) | MIT 源码继续公开；**预编译签名包**对商业使用收费；$8 人月 / $12 席位 | 收费对象是便利（签名、更新、支持），不是核心功能；明确反对为收费把核心功能藏起来 | OnCue 的个人求职者不是“商业使用 API 客户端”，商用条款对个人面试官感差 |
| Ollama | MIT 客户端本地免费；云端 Pro 卖托管模型用量 | **许可类比最干净**：送 runner，卖 hosted minutes | 求职客户端比模型 runner 更易被道德攻击，不能抄它的“随便跑”品牌 |
| [Obsidian](https://obsidian.md/license) | 本地应用免费（含商用，2025-02-20 起强制商用许可改为可选）；Sync/Publish 另付；$50/用户/年商用许可现为支持性质 | 本地核心永远免费；钱来自托管同步和发布 | OnCue 没有同步笔记这种刚需云 |
| [Plausible](https://plausible.io/self-hosted-web-analytics) | AGPL 自托管免费；云订阅养团队；部分高级功能只在云 | 钱来自“你不想自己运” | 自托管网关对求职者过重；不要用 AGPL 污染已 MIT 的客户端 |
| [PostHog](https://posthog.com/blog/open-source-business-models) | 先托管赚钱，再 open-core 自托管 | 先有付费云，再谈拆企业版 | 不要为了 open-core 养两套客户端 |
| [Sentry 早期](https://blog.sentry.io/sentry-thrives-open-source-software-company/) | 产品开源，托管收费；后来改 BSL 是后话 | 开源可以当获客，托管当收入 | 不要学后期 BSL，会触发 fork |

**OnCue 具体拆法**

```
MIT 开源          桌面客户端、音频、隐身窗口、模拟、简历、BYOK
专有但不藏源码     网关：OIDC、支付宝、配额、火山/Gemini 密钥
收费              Hosted 周期额度（已实现）
以后可加          公证安装包的付费通道 / 优先支持（Yaak 模式）
永远不收费        源码编译权、BYOK、本地历史、捕获排除 API 调用
```

开源商业的钱来自 **运算力和合规运维**，不来自把 `WDA_EXCLUDEFROMCAPTURE` 藏起来。Cluely 把 Undetectability 卖 $149.99，那是 VC 故事。OnCue 若同样做，GitHub 上的 MIT 副本会变成“免费隐身版”，付费墙形同虚设。

**不要双许可。** 双许可需要 AGPL/GPL 把商业闭源逼过来，且要 CLA 收齐版权。客户端已经 MIT，覆水难收。FOSSA / Heather Meeker：对 Apache/MIT 做“或者买商业许可”没有约束力。[FOSSA dual licensing](https://fossa.com/blog/dual-licensing-models-explained/)

**不要为了防 AWS 改 BSL。** 没有云厂商会托管“面试作弊助手”。Relicense 只得罪贡献者。

---

## 6. 推荐经营方案（路径 C 的落地）

### 6.1 商品（冻结到首个付费日）

对外只讲三档，和代码一致：

| 档 | 价格 | 得到什么 | 得不到什么 |
|---|---|---|---|
| 开源 / BYOK | ¥0 | 完整客户端；自备 Key；本地数据；GitHub 自行编译 | 官方算力、官方 SLA |
| Pro 月卡 | ¥89 / 30 天 | 15h 托管 STT + 200 万 LLM units；支付宝；无自动续费 | 不锁隐身、不锁模拟次数 |
| Pro 季卡（主推） | ¥199 / 90 天 | 50h STT + 800 万 LLM units | 同上 |

落地页现在写 Hosted 价格为“免配置开箱即用”，没有数字。**上线前必须把 ¥89 / ¥199 写上**，否则像 LockedIn 一样被骂价格不透明。

BYOK 不要再收“软件季卡”。原因：

- MIT 用户会跳过本地许可证。
- 你已经把 Hosted 当付费墙，两套墙会把故事讲乱。
- 条款里的“季卡去掉 Copilot 时长上限”和代码里的配额模型不一致，上线前改条款。

### 6.2 免费如何获客（学即答侠的墙，不学它的文案）

Hosted 新账号：**注册不给额度**（代码已如此）。用运营发放：

- 邀请码：30 分钟 STT + 少量 LLM，够一场预演。
- 不要学即答侠把“Offer 奖学金”写进定价页。

BYOK：**完整功能免费**，用文档和向导降低 Key 门槛。这是对 Cheating Daddy 的答案：同样免费，但音频和会话纪律是产品级。

### 6.3 毛利闸门

在 P95 用户的 STT+LLM 发票成本超过售价 40% 之前，不涨配额、不开放自动续费、不加“无限”。试点样本不够就保持 15h / 50h 硬闸。这与内部订阅研究报告一致。[outputs/ai-tool-subscriptions.md](ai-tool-subscriptions.md)

双音源分别计费要在 UI 上写清楚。用户开麦克风会把 45 分钟变成接近 90 分钟额度。现在文档有，落地页没有。

### 6.4 营销叙事

**主句（中）**  
实时听懂面试官。回答提纲只显示在你这边。自备 Key 或支付宝开箱。

**主句（英）**  
A local-first interview copilot. System audio hears the interviewer. Bring your own keys, or pay Alipay for hosted minutes.

**三条支柱**

1. **上场演示：** 30 秒真实延迟，会议在响，浮窗出要点。结尾口播“仅在规则允许时使用”。
2. **信任：** 对照 Cluely 云端转写泄露——OnCue BYOK 无第一方内容库；Hosted 网关不落面试正文。
3. **成本：** 对照 ¥129/月无限云和 $150 隐身档——¥199 买 90 天官方算力，不用完不续。

**渠道顺序（优化方案仍然对）**

1. V2EX / 即刻 / 少数派 / HN Show HN：MIT + BYOK。
2. 小红书 / B 站：秋招前 30 天，系统音频权限、支付宝开通。
3. 搜索页：`macOS 系统音频 面试助手`、`BYOK 面试 Copilot`。

**渠道红线**

- 不写“完全隐身 / 面试官无感 / 100% undetectable”。
- 不写“保证上岸 / Offer 返还”。
- 不伪造用户数。
- 不在 Hosted 未开、安装包未签时投付费量。
- 英文市场不要用 Cheating Daddy 那套 unfair advantage。Cluely 已经把品类品牌做脏；OnCue 要用 privacy-first meeting copilot for interviews where tools are allowed。

### 6.5 开源运营（便宜且必要）

- LICENSE 保持 MIT。README 增加：Hosted 网关是独立服务，密钥和计费不在桌面仓库。
- 欢迎 PR：转写、语言包、会议兼容。不接受“更强反检测”类 PR。
- Releases 与 `package.json` 0.15.0 对齐，结束“GitHub latest 是旧版”的分发事故。
- 不要 CLA，除非将来真的要双许可（现在不要）。

### 6.6 如果以后要加第二条收入

优先级从高到低：

1. Hosted 加油包（5 小时 STT），代码里还没有，等季度卡用满数据再加。
2. 公证安装包的付费下载（Yaak）：源码仍可编译。只在 Windows SmartScreen 真的挡住转化时做。
3. 团队/培训机构席位。先有 50 个个人付费再谈。

不要加：终身 BYOK 买断、积分、SSO 企业版、白标。

---

## 7. 90 天动作（只做能卖的）

**Week 1–2 产品诚实**

- 落地页 Hosted 卡片写上 ¥89 / ¥199、额度、无续费、双音源计费。
- TERMS / 落地页去掉“本地季卡锁 Copilot 时长”，改成与支付宝商品一致。
- 向导：一个 LLM Key 或 Hosted 登录 + 10 秒系统音频测试。没过测试不显示就绪。

**Week 3–4 生产门**

- 按 vendor contract 关完：支付宝沙箱双商品、重复通知、金额篡改、提前续费；火山/Gemini 发票对账；CSP 换成真网关；Resend；备份。
- macOS 公证、Windows 签名。做不到就下载页写风险，不要装成商店应用。
- **境内 Hosted 闸门：** 律师书面判断后，才对大陆用户开支付宝。若只能走境外 Gemini、无法公示国内已备案模型，则大陆只卖 BYOK 安装包，Hosted 限境外用户。不要用未登记应用收境内生成式服务费。

**Week 5–8 小范围卖**

- 邀请制 Hosted，目标 20 个真实付费，不是投放。
- 记录：激活失败原因、STT 分钟、退款、是否改回 BYOK。
- 内容：一条 B 站系统音频原理、一条小红书“Key 怎么申请”、一条 V2EX MIT 帖。

**Week 9–12 决定是否扩**

- 若付费用户 P95 成本可控、退款低、首次建议成功率可接受：开公开支付宝。
- 若 Hosted 合规或成本炸：关掉支付，退回纯 MIT BYOK，把网关留作内部。

北极星仍是优化方案那句：**新用户 15 分钟内听到系统音频并得到第一条有用建议。** 下载量不是。

---

## 8. 争议、局限、未决

1. **Final Round 订阅结账页本次未抽出。** 产品介绍页写月 $90 / 季 $180 / 年 $300；另一篇博客写月 $148。对外用介绍页数字并注明矛盾。
2. **Interview Coder $299/$799 为竞品转述。** 官网提取失败。
3. **LockedIn 官方计划文不公布美元价。** 结构已核到（General 无桌面隐身，Pro/Credit 才有）。$54.99 仅出现在对比文，不当牌价。
4. **Cluely 8.3 万泄露**来自安全写手与竞品评测，不是 Cluely 官方事故页。当作云端存储面试内容的行业风险案例。融资数字以 TechCrunch 2025-06-20 为准。
5. **招聘方 AI 面试市场规模 ≠ Copilot TAM。**
6. **延迟 1.0–1.8s** 来自旧内部报告，不是 2026-09 的复测。
7. **法律结论需要律师。** 本办法第二条和广东通管局指南只解决“要去问什么”，不解决“能不能上线”。
8. **本仓库 Hosted 仍是预生产。** 任何对外“扫码即用”在支付开关打开前都是虚假广告。

---

## 9. 来源

### 本产品

1. [README.md](../README.md) — 产品定义、BYOK、音频、许可
2. [LICENSE](../LICENSE) — MIT
3. [docs/PRIVACY.md](../docs/PRIVACY.md) — 本机与 Hosted 数据流
4. [docs/TERMS.md](../docs/TERMS.md) — 可接受使用、非隐身承诺
5. [server/src/payments.rs](../server/src/payments.rs) — ¥89 / ¥199 SKU
6. [docs/vendor_contract.md](../docs/vendor_contract.md) — 生产门
7. [docs/hosted_gateway_runbook.md](../docs/hosted_gateway_runbook.md) — 预生产网关
8. [landing/src/locales/content.ts](../landing/src/locales/content.ts) — 对外文案
9. [docs/research/copilot-vs-suite.md](../docs/research/copilot-vs-suite.md) — 套件 vs Copilot
10. [docs/PRODUCT_LAUNCH_PLAN.md](../docs/PRODUCT_LAUNCH_PLAN.md)、[docs/PRODUCT_OPTIMIZATION_PLAN.md](../docs/PRODUCT_OPTIMIZATION_PLAN.md) — 旧商业草案（部分已被代码取代）
11. [src-tauri/src/copilot_window.rs](../src-tauri/src/copilot_window.rs) — 捕获排除

### 竞品官网（2026-09-04 抓取）

12. [即答侠定价](https://interviewasssistant.com/zh/pricing)
13. [Cluely Pricing](https://cluely.com/pricing)
14. [LastRound Pricing](https://lastroundai.com/pricing)
15. [Final Round Interview Copilot](https://www.finalroundai.com/interview-copilot)
16. [Final Round 产品介绍（$25/$60/$90）](https://www.finalroundai.com/blog/what-is-final-round-ai)
17. [Final Round 2026 Copilot 更新（live 无试用，与上条矛盾）](https://www.finalroundai.com/blog/whats-new-interview-copilot)
18. [Final Round 自述月费 $148（与产品介绍页矛盾）](https://www.finalroundai.com/blog/is-final-round-ai-worth-it)
19. [LockedIn 订阅计划结构](https://www.lockedinai.com/blog/lockedin-ai-subscription-plans)
20. [LockedIn vs Cluely（$54.99 起，非价目表）](https://www.lockedinai.com/blog/lockedin-vs-cluely-comparison)
21. [Interview Coder](https://www.interviewcoder.co/)
22. [面试狗教程与定价](https://docs.interviewdog.cn/docs/tutorial)
23. [Cheating Daddy GitHub](https://github.com/sohzm/cheating-daddy)
24. [Ecoute GitHub / MIT](https://github.com/SevaSk/ecoute)
25. [TechCrunch Cluely $15M Series A](https://techcrunch.com/2025/06/20/cluely-a-startup-that-helps-cheat-on-everything-raises-15m-from-a16z/)

### 开源商业先例

26. [Yaak commercial-use](https://yaak.app/blog/commercial-use)
27. [Obsidian license](https://obsidian.md/license)
28. [Obsidian Sync](https://obsidian.md/sync)
29. [PostHog open source business models](https://posthog.com/blog/open-source-business-models)
30. [GitLab thoughts on open source](https://about.gitlab.com/blog/thoughts-on-open-source/)
31. [Sentry open source company](https://blog.sentry.io/sentry-thrives-open-source-software-company/)
32. [Plausible self-hosted vs cloud](https://plausible.io/self-hosted-web-analytics)
33. [FOSSA dual licensing](https://fossa.com/blog/dual-licensing-models-explained/)

### 市场、成本、监管

34. [Deepgram Pricing](https://deepgram.com/pricing)
35. [生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)
36. [网信办 2026 年 3–4 月备案公告](https://www.cac.gov.cn/2026-05/13/c_1780413225190669.htm)
37. [广东省通管局增值电信许可指南](https://gdca.miit.gov.cn/bsfw/bszn/jyxk/tzgg/art/2025/art_30ca3eed248444a9bc108fdacab59c67.html)
38. [NextMSC AI Interview Market](https://www.nextmsc.com/report/ai-interview-market-ic4943) — 招聘方市场，非 Copilot TAM
39. [Interview Coder on Cluely pricing/breach](https://www.interviewcoder.co/blog/cluely-ai-review) — 二手，用于交叉，不单独当事故证明

---

## 10. 给决策人的一页纸

**做开源商业，不要做闭源，也不要做空开源。**

- 客户端继续 MIT。这是对抗“云端偷听面试”的唯一可信故事。
- 钱只来自 Hosted 算力（¥89 / ¥199，一次性支付宝）。BYOK 永远免费。
- 隐身、模拟、简历不要做付费墙。付费墙架在官方 STT/LLM 分钟上。
- 营销只讲听得见、提纲在、数据在哪、规则允许。不讲隐身军备和 Offer。
- Hosted 生产门没关、安装包没签之前，不投放。落地页先把价格和额度写对。

需要全量闭源或改 AGPL/双许可时再说一声；那会推翻这份默认方案，而不是补一章。
