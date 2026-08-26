# GitHub Actions 免费平替：按用量与热度整理

- **检索日：** 2026-08-24
- **范围：** 有可用免费档，或软件可免费自建。GitHub Actions 只作对照基线，不当「平替」。
- **排序规则：** 用量、热度两轴分开排。综合名次一律标 **推断**。厂商「百万 builds」无独立印证则当营销，不进用量轴。
- **证据来源：** 官方定价/文档、JetBrains / Stack Overflow 公开调查、GitHub/Codeberg API 星标、Hacker News。PDF 全文未解析。

## 执行摘要

2026 年没有第二个「公有仓 Linux + Windows + macOS 标准 runner 全免费」的托管 CI。GitHub 官方写明：标准 GitHub-hosted runner 在 **公有仓免费不限分钟**；私有仓 Free 档 **2,000 分钟/月**、产物存储 **500 MB**（与 Packages 共享）、缓存 **10 GB/仓库**。超额 Linux 2-core **$0.006/min**，Windows **$0.010/min**，macOS **$0.062/min**。

真正的平替分三类，不能混成一张总榜：

1. **整平台替换**（重写 YAML）：GitLab CI、Azure Pipelines、CircleCI、Bitbucket、AppVeyor、Harness 等。
2. **仍跑 GitHub Actions YAML，只换 runner**：官方 self-hosted / ARC、Ubicloud、BuildJet、Blacksmith、Depot、Namespace、WarpBuild、RunsOn。
3. **软件免费、机器自备**：Jenkins、GitLab CE、Gitea Actions、Forgejo Actions、Woodpecker、Tekton、act。

**用量轴（组织采用，推断）：** GitHub Actions（基线）→ Jenkins → GitLab CI → Azure Pipelines（弱代理）→ CircleCI（仅己方遥测）。依据是 JetBrains TeamCity 博文对 *State of Developer Ecosystem 2025* 的转述：组织侧 GitHub Actions **33%**、Jenkins **28%**、GitLab CI **19%**。

**热度轴（2025-12 至 2026-08，推断）：** GitHub Actions 定价事件（HN 802 分 / 819 评）→ Forgejo/Gitea（离开 GitHub 的默认开源答案）→ Jenkins → GitLab CI → self-hosted / ARC / 商业 runner → act（星标极高但是本地工具）。

对 RabbitInterview 这种 Tauri 桌面应用（macOS universal + Windows MSVC + Linux 发布）：

- **公有仓、继续用 GHA YAML：** 留在 GitHub-hosted 仍是唯一不加钱的完整三平台。
- **私有仓、继续用 YAML、不想付 SaaS：** 官方 self-hosted（一台 Mac + 一台 Windows + Linux）。软件免费，硬件不是。
- **离开 GitHub 控制面、还要免费托管 Win+mac：** 只剩 Azure Pipelines（1,800 分钟、单 job 60 分钟、1 并发）和 AppVeyor 开源档（仅公有仓、1 并发、60 分钟）。GitLab.com Free **没有托管 macOS**。

## 1. 「平替」指什么

| 类别 | 还用 `.github/workflows`？ | 还用 GitHub 当代码托管？ | 典型产品 |
|---|---|---|---|
| A. 整平台 | 否 | 通常否（或 mirror） | GitLab CI、Azure Pipelines、CircleCI、Bitbucket、AppVeyor |
| B. Runner 替换 | 是，改 `runs-on` | 是 | self-hosted、ARC、Ubicloud、BuildJet、Blacksmith |
| C. 自建/开源 CI | 仅 Gitea/Forgejo/act 接近或部分 | 通常换 forge | Jenkins、Gitea Actions、Forgejo Actions、Woodpecker |

Vercel / Netlify / Render / Cloudflare Workers Builds 是部署构建系统，不是通用多 OS CI，下文不列入平替主表。

## 2. 用量轴（推断）

单位不可比：GitHub 的 CPU 分钟、CircleCI 的 28 天 workflow 数、Jenkins 安装数、GitLab 注册用户不能放进同一列比大小。Stack Overflow 2025 的 GitHub **81.1%** / GitLab **35.6%** / Azure DevOps **16.6%** 是「协作/文档工具」，不是 CI 产品题，只能当弱代理。

### 2.1 有调查百分比的产品

| 推断名次 | 产品 | 用量信号 | 置信度 |
|---|---|---|---|
| 0 基线 | GitHub Actions | DevEco 组织 33%、个人 39%；Octoverse 2025 公有仓 **115 亿** Actions CPU 分钟（同比 +35%）；官方称新架构约 **7100 万 jobs/天** | 高 |
| 1 | Jenkins | DevEco 组织 **28%**（自建里唯一进前三）、个人 13%。2022 年「30 万已知安装」已过时，不与 2025 调查混排 | 高（调查）；低（安装数） |
| 2 | GitLab CI/CD | DevEco 组织 **19%**、个人 10%。公司页「超过 5000 万注册用户」是平台账号，不是 CI 用户 | 调查高；用户数中 |
| 3 | Azure Pipelines | 无 CI 分项百分比。SO Azure DevOps 16.6% 作弱代理 | 中 |
| 4 | CircleCI | 自家报告：2025-09 前 28 天超过 **2800 万** workflow。未进入 DevEco 前三百分比，不能称「第四大份额」 | 中（己方遥测） |
| 5 | Bitbucket Pipelines / TeamCity | JetBrains 专项调查写组织侧「有存在感、不进总榜」；TeamCity 专项样本里组织约 7% | 低–中 |
| 6 | Gitea/Forgejo/Woodpecker/Tekton/Drone | 星标活跃，**没有**进入 2025 组织采用百分比；SO 仅为 write-in | 用量低 |
| 7 | 托管 GHA runner 厂商 | 用量完全不透明 | 无法排 |

Buildkite（「6 万用户」未标采集年）、Sourcehut：数据不足，不排名。

### 2.2 不要用这些当用量

- `nektos/act` **71,613** 星：本地跑 workflow 的工具，不是托管 CI。
- `go-gitea/gitea` **57,565** 星：整个 forge，不等于 Gitea Actions 安装量。
- `gitlab-org/gitlab` 约 6.1k 星：严重低估平台规模。
- Google Trends：本轮未取得可引用的数值序列。
- CircleCI / Buildkite 的「领先平台」「节省开发年」类文案：营销。

## 3. 热度轴（推断）

2025-12 GitHub 宣布 self-hosted 控制面将按分钟收费，随后推迟；托管 runner 2026-01-01 降价。这是全年最大 CI 公共话题。

| 推断名次 | 产品 | 依据 |
|---|---|---|
| 0 基线 | GitHub Actions | HN「Pricing Changes for GitHub Actions」**802** 分 / **819** 评（2025-12-16） |
| 1 | Forgejo / Gitea（及 Codeberg） | 定价抗议帖里最常被点的开源迁出目标；Gitea 57.6k★、Forgejo Codeberg 5.4k★。独立 Show HN 分数低，热度是「配角」不是爆款产品帖 |
| 2 | Jenkins | 调查第二 + 核心仓日更（26.5k★）；情绪两极但存在感强 |
| 3 | GitLab CI | HN/企业替代首选之一；SO SCM 第二 |
| 4 | ARC / self-hosted / 商业 runner | 热度是定价事件的导数。Blacksmith 借势博文 HN 216 分。ARC 约 6.5k★ |
| 5 | act | 星标开源第一，场景是本地调试 |
| 6 | Woodpecker / Tekton | 维护活跃（7.7k / 9.0k★），HN 峰值低 |
| 7 | CircleCI / Bitbucket / Buildkite | 企业存量，没有 GHA 级公共话题 |

## 4. 类别 A：整平台替换（要重写 YAML）

下表只列官方免费档或可零价起步者。**没有任何纳入平台声称即插即用 GHA YAML。**

| 产品 | 免费档硬限制 | Linux | Windows | macOS | 对 Tauri 的判断 |
|---|---|---|---|---|---|
| GitHub Actions（基线） | 公有仓标准 runner 不限分钟；私有 Free 2,000 min；产物 500 MB；缓存 10 GB/仓 | 是 | 是 | 是 | 公有仓完整；私有仓 macOS 约 10× Linux 单价 |
| GitLab.com Free | **400 compute minutes/月**；托管 job 超时 3 小时 | 是（small） | 是（beta，倍率 1） | **否**（仅 Premium/Ultimate，beta；M1 ×6，M2 Pro ×12） | **blocker**：免费托管没有 macOS |
| Azure Pipelines | 私有项目启用后 **1 个托管并行作业**、**1,800 分钟/月**、单 job **60 分钟**；产物 2 GiB；新 org 须绑 Azure 订阅。公有项目不能新建，现有公有 2027 转私有 | 是 | 是 | 是（agent 在美国） | 理论三平台，长构建/矩阵不适合 |
| CircleCI Free | **30,000 credits/月**，最多 5 用户，网络 1 GB，存储 2 GB，不滚存。Linux/Windows 并发 30，macOS VM 并发 1。OSS Linux/Arm/Docker 另有 400,000 credits | 是 | 是（Windows VM Medium 40 credits/min） | **冲突**：营销列 macOS，对比表里当前 **M4 Pro Medium/Large 在 Free 为「—」** | 不能当作已核实的免费 macOS |
| Bitbucket Cloud Free | ≤5 用户，**50 build minutes/月**，LFS 1 GB | 仅 Linux Docker | **否**（self-hosted） | **否**（self-hosted） | **blocker** |
| AppVeyor Open-source | **FREE**；无限**公有**项目；**1** concurrent job；**5** self-hosted jobs；所有计划单 job **60 分钟** | 有镜像 | 有（Windows 起家） | 有镜像 | 仅公有仓；并发/超时紧 |
| Harness Cloud Free | 每月 **2,000** credits，不滚存；Linux ×2、Windows ×6、macOS ×60；Free Linux 并发 20、Win/mac 各 1；绑信用卡 | 是 | 是 | 是，但 2,000/60 ≈ **33 分钟** | 实用 blocker（macOS 预算） |
| Sourcehut | 托管 CI 要付费账户；兼容矩阵无 Win/mac 镜像 | Linux/BSD | 否 | 否 | 不是桌面三平台平替 |

**附录（非免费或无稳定自助免费档）：** Travis CI 文档写 trial unavailable、OSS 需工单；Codefresh 已并入 Octopus，本次官方定价页抓取失败；Buildkite / Semaphore 有限免费 Linux，未核实完整免费 Win+mac。

## 5. 类别 B：仍跑 GHA YAML 的 runner 平替

`actions/checkout`、`actions/setup-node`、artifact、`gh release` 在「官方 runner 应用 + 能访问 GitHub API」时通常可用。坑集中在：镜像不是 GitHub `runner-images`、容器 job 要 Docker/DinD、Windows 缺完整 Visual Studio、macOS 无 Docker / 并发受限、部分厂商只要 **GitHub Organization**。

GitHub 已推迟 self-hosted 控制面收费；**公有仓标准 hosted / self-hosted 仍免费**。私有仓 hosted 继续吃 included minutes。

| 产品 | 免费含义 | OS | Drop-in | 备注 |
|---|---|---|---|---|
| 官方 self-hosted | 编排目前免费；机器自付 | Linux / Windows / macOS | 部分（改 `runs-on` 标签） | Docker 容器 job 仅 Linux。默认不是每 job 干净机 |
| ARC | 软件 Apache-2.0；成本=K8s | 默认 **Linux 容器**，最小 runner 镜像 | 部分 | 不是完整 `ubuntu-latest`。macOS/Windows 不是默认路径 |
| Ubicloud | **$2.5/月 credit ≈ 1,250 min**（按其文档）；须绑信用卡防滥用。源码 AGPL 可自建 | **仅 Linux** x64/arm64 | Linux 接近 | 覆盖不了桌面 Win/mac |
| BuildJet | **一次性 $5 credit**，非每月。自称半价；2 vCPU $0.004/min | **仅 Ubuntu**，文档明确不提供 macOS | Linux 接近 | 无 Windows 标签 |
| Blacksmith | 研究笔记写营销页 3,000 免费分钟；**本次 `blacksmith.sh/pricing` 抽出的是客户引言，未核到分钟表**；`www.blacksmith.sh/github-action-runners` **404** | Linux + Windows beta + macOS | 接近（改标签） | 只要 Organization。Windows 为 VS Build Tools 而非完整 IDE |
| WarpBuild | 注册含 **$10 credits**（对照页自称 2026-08-13 核对），非循环免费分钟 | Linux / Windows / macOS | 接近 | macOS 无嵌套虚拟化 |
| Depot | **无长期免费档**，7 天试用。Developer $20/月含 2,000 GHA minutes | Linux / Windows / macOS | 接近 | 只要 Organization。Windows 无 Hyper-V |
| Namespace | **30 天试用** | Linux / Windows / macOS | 接近，自有标签 | `runs-on` 只能有一个 `nscloud` 标签 |
| RunsOn | 非商用许可免费（需致谢）；计算走 AWS 账单 | Linux / Windows；**文档无 macOS 产品线** | 部分 | 缺 macOS |
| AWS CodeBuild GHA runner | Free Tier 摘要：on-demand 约 100 build minutes（HTML 抽取不完整，以定价页为准） | Linux / Windows Core；FAQ **未列 macOS GHA runner** | 否（标签含项目名） | **不是** GitHub runner-images |
| Google Cloud Build | **没有**官方托管 GHA runner SKU | — | — | 只有 Cloud Run/GKE 自建教程 |

**推断：** 循环免费且含 Win+macOS 的托管 runner，目前仍只有 GitHub 自己的 included minutes。第三方循环免费额度基本是 Linux。

## 6. 类别 C：可自建 / 开源（软件免费 ≠ 机器免费）

没有方案能在「不加钱且不自备 Mac/Windows 机器」时提供官方 Xcode / MSVC。

| 方案 | 许可证 | GHA YAML | macOS / Windows 现实 | 热度（2026-08-24） |
|---|---|---|---|---|
| Gitea Actions | MIT | **接近**（官方「designed to be compatible」+ 差异清单） | 官方 runner 二进制含 macOS/Windows；host 模式自备机器；Windows 常需 `powershell` | Gitea 57,565★；runner 约 240★ |
| Forgejo Actions | GPL-3.0-or-later（v9+） | **部分**（官方「familiar … **not designed to be compatible**」） | 官方 runner 测 Linux；host 可挂自备 Mac；**官方不维护 Windows** | Forgejo 5,367★；runner 约 112★ |
| nektos/act | MIT | 接近（本地执行器，**不是平台**） | 默认把 ubuntu 映射成 Linux 容器；要跑 macos/windows 必须已在该 OS 上跑 act | **71,613★** |
| Jenkins | MIT | 无（Jenkinsfile/Groovy） | agent 可挂任意 JVM 机器；Windows 有官方 MSI | 26,481★；weekly 2.578 |
| GitLab Self-Managed | CE MIT；EE 专有 | 无（`.gitlab-ci.yml`） | Runner 官方支持 Linux/macOS/Windows。自管 runner **不受** GitLab.com 400 分钟约束 | 平台用量大，star 低估 |
| Woodpecker | Apache-2.0 | 无 | darwin/Windows agent 二进制；桌面构建用 Local 后端 | 7,736★；v3.17.0 |
| Tekton | Apache-2.0 | 无 | 需 K8s；Windows 有官方节点文档；无官方 macOS 农场 | 9,040★ |
| Drone | OSS Apache-2.0（需自行 oss 构建）；EE Polyform | 无 | Exec runner 可挂 Win/Mac | harness 仓 38k★（历史改名，不能当 2026 新热度） |
| Concourse / Buildbot / Argo / Sourcehut builds | Apache/GPL/AGPL | 无 | 容器/Linux 为主；Sourcehut 兼容矩阵无 Win/mac 镜像 | 中低 |

想尽量留 GHA YAML 又离开 GitHub 托管：优先 **Gitea Actions（接近）** 或 **Forgejo Actions（部分）**，并自备三台 runner。新开源自建若接受重写 YAML，Woodpecker 许可证比历史 Drone 默认镜像干净。

## 7. 给决策者的分层（推断，不是总分）

1. **调查上真正有体量的免费/自建档：** Jenkins（自建用量第一）→ GitLab CI（第二大调查占有，但.com Free 无 macOS）→ Azure Pipelines（弱证据，但免费托管三 OS）。
2. **想保住 GHA YAML：** 热度在 self-hosted / ARC / 商业 runner，**用量无法排序**。循环免费 Linux：Ubicloud、BuildJet。完整桌面矩阵：自备机器挂官方 runner。
3. **开源兼容叙事热度：** Forgejo/Gitea >> Woodpecker（Woodpecker 不是 GHA YAML）。不要用 act 星标证明托管平替用量。
4. **不要**把 GitHub 115 亿分钟和 CircleCI 2800 万 workflow 放进同一列比大小。

## 8. 相对 GitHub-hosted 的常见坑

- YAML 不兼容（类别 A、多数 C）。
- `actions/checkout` / `setup-node` 市场在自建 forge 上行为不同；Forgejo 明确不追求兼容。
- Artifact 若仍上传 GitHub，吃 GitHub 存储配额。
- `gh release` 在最小镜像/Windows 上往往要自装。
- macOS：GitLab.com Free 没有；CircleCI Free 当前 M4 Pro SKU 在对比表为不可用；Azure 免费档 60 分钟/job；Harness ×60；自建必须有 Mac。
- Windows：Bitbucket/Ubicloud/BuildJet 托管没有；Forgejo 官方不维护；若干 SaaS 只有 Build Tools 或无 Hyper-V。
- 数据驻留：Azure macOS agent 在美国。
- 个人仓：Blacksmith/Depot 只要 Organization。

## 9. 开放问题

1. CircleCI Free 是否仍能调度任何 macOS resource class（对比表与 Support 文冲突；无账号无法点选）。
2. Blacksmith 循环免费分钟的权威数字（营销页 404，定价页本次未抽出表格）。
3. AppVeyor 当前 macOS 镜像是否仍停留在文档里的较旧 Xcode 列表。
4. GitHub self-hosted 控制面费推迟到何时重新提案。
5. JetBrains DevEco 交互站 RSC payload 未直接检出百分比，33/28/19 来自 TeamCity 官方博文转述，不是图表原文件。
6. CNCF / CircleCI 调查 PDF 按计划未解析。
7. Reddit 自托管对比帖 HTML 抽取失败，未拿到分数。

## 10. 来源（草稿清单，引用步将逐条挂到主张上）

见研究笔记：

- `outputs/.drafts/github-actions-free-alternatives-research-hosted.md`
- `outputs/.drafts/github-actions-free-alternatives-research-runners.md`
- `outputs/.drafts/github-actions-free-alternatives-research-selfhost.md`
- `outputs/.drafts/github-actions-free-alternatives-research-ranking.md`
