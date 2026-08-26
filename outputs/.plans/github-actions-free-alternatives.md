# 计划：GitHub Actions 免费平替方案（按用量与热度排序）

- **Slug:** `github-actions-free-alternatives`
- **主题:** 整理 GitHub Actions 的免费/低成本平替方案，按用量与热度排序
- **日期:** 2026-08-24
- **状态:** 已交付终稿（PASS WITH NOTES）
- **语言:** 计划正文已改为中文（产品名、路径、标识符保持原文）

## 核心问题

1. 什么算「GitHub Actions 平替」？需要区分三类：
   - **整平台替换**：换掉 GitHub Actions 这套 CI（GitLab CI、Azure Pipelines、CircleCI、Bitbucket Pipelines、Buildkite、Sourcehut builds 等）
   - **可即插即用的 GHA runner 替换**：工作流仍用 GitHub Actions YAML（Blacksmith、Depot、Namespace、WarpBuild、BuildJet、Actions Runner Controller、self-hosted）
   - **可自建 / 开源 CI**：语法接近或兼容 GHA（Forgejo Actions、Gitea Actions、Woodpecker、Drone、Jenkins、Tekton）
2. 哪些方案有**真正免费**的档位（或软件本身可免费自建）？硬限制是什么（分钟数、并发、公有/私有仓库、macOS/Windows、产物存储）？
3. **用量**怎么量？优先用一手信号：公开消耗的分钟数（很少公布）、使用该产品的组织/仓库数、State of CI / Stack Overflow / JetBrains 调查、市场安装量、GitHub star + 近期提交、招聘帖、公开状态页 / 博客流量声明。厂商自己说的「X million builds」除非有独立印证，否则不当作用量。
4. **热度**怎么量？看 2025–2026 的讨论量：Hacker News、Reddit、changelog 频率、融资/收购新闻、GitHub star 增长、Google Trends 相对兴趣、CNCF / DevOps 报告。
5. 对 RabbitInterview 这种 Tauri 桌面应用（macOS universal + Windows MSVC + Linux 发布），哪些免费方案能在**不加钱**的情况下覆盖 **macOS + Windows**？
6. 相对 GitHub 托管 Actions，主要坑有哪些：YAML 兼容性、secrets、artifacts、`actions/checkout` + `actions/setup-node`、macOS/Xcode、Windows MSVC、`gh release`、出网、数据驻留？

## 需要的证据

只收一手来源：

- 各候选的官方定价 / 免费档文档（GitHub Actions 作为对照基线）
- runner 平替的官方文档（兼容性声明、支持的操作系统、免费分钟）
- 自建方案的官方文档（Forgejo Actions、Gitea Actions、Woodpecker、Drone、Jenkins、Tekton、Act）
- 独立用量/流行度：Stack Overflow Developer Survey、JetBrains DevEcosystem、CNCF 调查、GitLab/GitHub 公开报告、Google Trends、项目页上的 GitHub star/fork 数；BuiltWith 一类仅在方法公开时使用
- 2024–2026 的对比文章只当线索，不当权威
- 社区热度：HN 帖、r/devops、r/github、changelog 日期

每个纳入的候选必须记下：

- 许可证 / 托管还是自建
- 免费档：分钟、并发、操作系统矩阵、公有/私有
- GHA YAML 兼容性（无 / 部分 / 即插即用）
- macOS 与 Windows 支持
- 证据的最后更新日期
- 用量信号 + 热度信号，并附 URL

## 规模决策

**这是多面向的全景梳理，不是「X 是什么」那种短解释。**

用户要求枚举免费平替，并按用量和热度排序。需要覆盖三类产品，再加上排序证据。只靠主会话直接搜索，定价页和流行度信号会覆盖不足。

**决定：4 个 researcher 子代理**（宽调查档）。证据回来后，由主会话负责综合、引用和审阅。

若某条 researcher 路径失败，主会话用剩下的笔记 + 直接搜索降级继续；不中断产物流水线。

## 任务台账

| ID | 负责人 | 任务 | 产出 | 状态 |
|----|--------|------|------|------|
| T0 | 主会话 | 写本计划；等用户确认 | `outputs/.plans/github-actions-free-alternatives.md` | 完成 |
| T1 | researcher | 可替换 GHA 的托管 CI 平台；免费档、操作系统矩阵、用量线索 | `outputs/.drafts/github-actions-free-alternatives-research-hosted.md` | 进行中 |
| T2 | researcher | 可即插即用的 GitHub Actions runner 平替（更便宜/免费的托管 runner + ARC/self-hosted） | `outputs/.drafts/github-actions-free-alternatives-research-runners.md` | 进行中 |
| T3 | researcher | 可自建 / 开源 CI（Forgejo/Gitea Actions、Woodpecker、Drone、Jenkins、Tekton、Act） | `outputs/.drafts/github-actions-free-alternatives-research-selfhost.md` | 进行中 |
| T4 | researcher | 用量与热度排序证据（调查、star、趋势、社区） | `outputs/.drafts/github-actions-free-alternatives-research-ranking.md` | 进行中 |
| T5 | 主会话 | 综合成带排序的简报 | `outputs/.drafts/github-actions-free-alternatives-draft.md` | 阻塞 |
| T6 | verifier | 文内引用 + URL 核验 | `outputs/.drafts/github-actions-free-alternatives-cited.md` | 阻塞 |
| T7 | reviewer | FATAL / MAJOR / MINOR 核验 | `outputs/.drafts/github-actions-free-alternatives-verification.md` | 阻塞 |
| T8 | 主会话 | 交付终稿 + 来源说明 | `outputs/github-actions-free-alternatives.md`、`outputs/github-actions-free-alternatives.provenance.md` | 阻塞 |

各 researcher 的任务书（`outputs/.plans/github-actions-free-alternatives-T1.md` … `T4.md`）在**确认之后**、启动子代理之前再写。

## 核验记录

- [x] 计划文件已在磁盘上
- [x] 搜索前已获得用户确认
- [ ] 四份研究笔记存在（或已记录失败）
- [ ] 草稿没有编造的基准数字 / 假表
- [ ] 每条排序主张都能映射到 URL 或研究笔记路径
- [ ] 带引用的草稿在指定路径存在
- [ ] reviewer/verifier 已完成（或已记录降级）
- [ ] 终稿 + 来源说明存在；修改后的 grep 核验已记录

## 决策记录

- 2026-08-24：Slug = `github-actions-free-alternatives`（主题：免费 GHA 平替，按用量与热度排序）。
- 2026-08-24：规模 = 4 个 researcher。理由：三类产品 + 一条排序证据线；不是窄解释题。
- 2026-08-24：GitHub Actions 免费档只作对照基线，不当作「平替」。
- 2026-08-24：「免费」= 有可用的免费档 **或** 软件本身可免费自建。纯付费托管产品进短附录「非免费」，除非有像样的业余免费档。
- 2026-08-24：排序用两轴（用量、当前热度），不做单一综合分，因为厂商不公布可横向比较的用量。综合名次标为 **推断**。
- 2026-08-24：可见工具集里没有 `memory_remember`；计划只落盘。
- 2026-08-24：用户回复 yes；开始 T1–T4。可见 agent 列表无独立 verifier，T6 由主会话做引用核验。
- 2026-08-24：按用户要求将计划正文译为中文；slug、文件路径、产品名保持原文。
