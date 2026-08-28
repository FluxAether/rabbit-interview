# Deep Research Plan: RabbitInterview 与主流面试辅助竞品优劣势及多源交叉比对

- **Slug:** `rabbit-interview-competitor-analysis`
- **Topic:** 分析本 App（RabbitInterview）与国内外主要竞品（Final Round AI, LockedIn AI, 即答侠, Cluely, Sensei AI, Ecoute, Interview Coder 等）在架构设计、隐身与音频捕获技术、实时辅助体验、隐私合规与商业模式上的优劣势，并进行多源交叉比对与破局建议。
- **Created Date:** 2026-08-27
- **Status:** COMPLETED

---

## 1. Key Questions (核心研究问题)

1. **核心定位与架构对比**：
   - RabbitInterview 的 Tauri 2 + React 19 + 本地 SQLite + BYOK（Bring Your Own Key）纯本地/直接调用大模型架构，与主流商业 SaaS（云端中心化中转、订阅制、全家桶套件）以及开源项目（Python/Electron 脚本）相比，底层架构有何本质差异？
2. **音频捕获与防检测/隐身机制 (Stealth & Audio Capture)**：
   - RabbitInterview 采用的 macOS AudioTee (ScreenCaptureKit/CoreAudio) 与 Windows WASAPI loopback 混音方案，与竞品的屏幕共享隐形（Invisible Window/Transparent Overlay）、虚拟声卡、浏览器插件、双机/外设方案相比，技术实现门槛、稳定性与防作弊系统（如 HireVue、Karat、Zoom/Teams 屏幕共享检测）规避能力如何？
3. **实时问答延迟、转写与生成质量 (Real-time Pipeline & Quality)**：
   - 各竞品在 STT（Deepgram Nova-2 vs Whisper vs 飞书/云厂商 STT）、大模型提示词工程（STAR 原则、代码补全、上下文注入 Resume/JD）、首字延迟（TTFT）与端到端响应时间上的技术表现与实测差异。
4. **功能矩阵与用户旅程 (Feature Matrix & Workflow)**：
   - 比较各产品的“三件套”（实时 Copilot、模拟面试 Mock Interview、简历优化 Resume ATS）的组织形态——是作为独立功能还是作为 Copilot 的前置上下文？对算法题（LeetCode 识别与代码生成）、系统设计、行为面试（BQ）的支持深度如何？
5. **商业模式、成本与用户心智 (Pricing, Unit Economics & Market Fit)**：
   - 对比高单价周/月/季订阅制（如 Final Round AI $150/月、LockedIn $54.99/月）、按次付费（即答侠）、开源免费、BYOK 按 Token 计费的单位经济模型与目标用户群体（应届生、跨国求职、国内大厂求职）心理画像。
6. **SWOT 分析与 RabbitInterview 差异化破局策略**：
   - RabbitInterview 的绝对优势、核心短板、市场机会与潜在法律/合规威胁，提出切实可行的迭代路线图与定位建议。

---

## 2. Evidence Needed (所需证据与多源数据)

1. **本 App 源码与架构基准**：
   - 核心会话与提示词链路（`src/lib/copilotSession.ts`）
   - 音频捕获与混合机制（macOS AudioTee Swift sidecar、Windows WASAPI loopback）
   - 数据存储与隐私模型（本地 SQLite、无第一方后端、直连模型厂商）
2. **海外主流商业 SaaS 竞品数据**：
   - **Final Round AI**：定价、Interview Copilot 功能、Stealth 浮窗技术、Coding Copilot、支持语种及隐私条款。
   - **LockedIn AI**：定价阶梯、全真模拟与实时辅助比例、屏幕共享防检测宣传与真实机制。
   - **Cluely / Sensei AI**：轻量级实时会议助手与专属面试助手的差异，快捷键与隐身控制。
   - **Interview Coder**：针对 LeetCode/技术面试的桌面级/浮窗极简工具。
3. **国内主流面试 Copilot 竞品数据**：
   - **即答侠 (HireMe AI)**：国内网络与大模型适配、按次/月度定价、微信小程序/桌面客户端形态、题库与简历绑定模式。
   - **面试狗 / 智能求职等衍生竞品**：国内竞品的核心宣传点与主要用户吐槽点（网络延迟、封号、价格过高、退费维权）。
4. **开源/社区生态竞品数据**：
   - **Ecoute / Cheating-daddy 等 GitHub 开源项目**：本地运行成本、安装与依赖门槛、用户留存痛点。
5. **用户社区反馈与多源交叉验证 (Reddit, V2EX, GitHub, 小红书, Trustpilot)**：
   - 用户对各类产品的真实抱怨点（如延迟过长、AI 幻觉、被面试官发现屏幕异样/眼神漂移、自动扣费陷阱）。

---

## 3. Scale Decision (规模与分工决策)

- **Scale:** **Broad Survey & Multi-Faceted Comparison**
- **Execution Mode:** Direct Deep Research Lead Execution with multi-source web cross-referencing and local codebase auditing.

---

## 4. Task Ledger (任务台账)

| Task ID | Focus Domain / Track | Scope & Deliverable | Status |
|---|---|---|---|
| **T1** | Overseas SaaS Competitors | Final Round AI, LockedIn AI, Cluely, Sensei AI, Interview Coder 的功能、定价、隐身技术与优劣势 | COMPLETED |
| **T2** | Domestic Chinese Competitors | 即答侠及国内主流竞品的产品形态、定价机制、本土化大模型/STT 方案与用户反馈 | COMPLETED |
| **T3** | Open-source & BYOK Alternatives | Ecoute、Cheating-daddy、本地 Whisper/Ollama 方案的架构、运行门槛、优缺点对比 | COMPLETED |
| **T4** | RabbitInterview Architecture & Deep Matrix | 本 App 深入技术审计（音频捕获、延迟管线、隐私、BYOK 成本）与全局横向多维对比矩阵构建 | COMPLETED |
| **T5** | Synthesis & SWOT Roadmap | 跨源证据交叉比对、SWOT 矩阵、定价/成本分析与破局策略报告撰写 | COMPLETED |
| **T6** | Verification & Citation Audit | 一手链接查验、数据核实、FATAL/MAJOR/MINOR 审查与终稿交付 | COMPLETED |

---

## 5. Verification Log (验证日志)

| Verification Point | Method / Evidence Source | Result / Notes |
|---|---|---|
| RabbitInterview 源码真实性 | 本地代码与构建配置文件审查 | PASS (Tauri 2 + SQLite + AudioTee + WASAPI 源码核对无误) |
| 竞品功能与定价准确性 | 官方文档、定价页、Terms/Privacy、产品实测与社区多源交叉核实 | PASS (Final Round, LockedIn, 即答侠等定价与功能核对无误) |
| 音频与隐身技术真实限制 | 操作系统权限机制 (macOS SCK/Core Audio Tap, Windows CoreAudio/DWM) 与防作弊检测逻辑比对 | PASS (`NSWindowSharingType::None` 与 `WDA_EXCLUDEFROMCAPTURE` 经代码与系统文档核实) |
| 引用来源真实有效性 | 全文链接可访问性检查与来源声明 | PASS (12 条核心信源均有实体文档/代码对应) |

---

## 6. Decision Log (决策日志)

- **2026-08-27**: 确立研究范围不仅限于 UI 功能罗列，深挖至底层技术架构（音频流/延迟/防作弊）、隐私安全（BYOK vs 云端）、单位经济学（SaaS 订阅 vs 纯 Token 消耗）以及产品叙事（实时 Copilot vs 全流程套件）四大核心战场。
- **2026-08-27**: 竞品样本选取涵盖海外头部（Final Round AI, LockedIn AI）、极简技术向（Interview Coder, Cluely）、国内头部（即答侠）及开源代表（Ecoute），确保横向比对具有全景代表性。
- **2026-08-27**: 终稿验证全部通过，无致命及重大问题，已将报告归档至 `outputs/rabbit-interview-competitor-analysis.md`。
