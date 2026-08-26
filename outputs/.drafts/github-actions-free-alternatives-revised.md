# GitHub Actions 免费平替：按用量与热度整理

- **检索日：** 2026-08-24
- **范围：** 有可用免费档，或软件可免费自建。GitHub Actions 只作对照基线，不当「平替」。
- **排序规则：** 用量、热度两轴分开排。综合名次一律标 **推断**。厂商「百万 builds」无独立印证则当营销，不进用量轴。
- **证据边界：** 官方 HTML 文档与定价页、JetBrains / Stack Overflow 公开页、GitHub/Codeberg API 星标（研究笔记当日抓取）、Hacker News。PDF 全文未解析（CNCF、CircleCI 完整报告标 blocked）。
- **修订：** 本文件吸收 T7 MAJOR（M1–M6）：下调 DevEco 转述置信度、改写「只剩 Azure/AppVeyor」、BuildJet 不计入循环免费、拆开 Bitbucket/TeamCity 来源、热度第 1 与 Azure 用量第 3 改为更弱表述。

## 执行摘要

2026 年没有第二个「公有仓、**不限分钟**、Linux + Windows + macOS 标准托管 runner 全免费」的 CI。GitHub 文档写明：标准 GitHub-hosted runner 在 **公有仓免费**；私有仓 GitHub Free **2,000 分钟/月**、产物存储 **500 MB**（与 Packages 共享）、缓存 **10 GB/仓库**。[^gha-billing] 超额 Linux 2-core x64 **$0.006/min**，Windows 2-core **$0.010/min**，macOS 3/4-core **$0.062/min**。[^gha-runner-price] AppVeyor 开源档也有三平台镜像，但是 **公有仓 + 1 并发 + 60 分钟/job**，不是「不限分钟的标准 runner」。[^appveyor-pricing]

真正的平替分三类，不能混成一张总榜：

1. **整平台替换**（重写 YAML）：GitLab CI、Azure Pipelines、CircleCI、Bitbucket、AppVeyor、Harness 等。
2. **仍跑 GitHub Actions YAML，只换 runner**：官方 self-hosted / ARC、Ubicloud、BuildJet、Blacksmith、Depot、Namespace、WarpBuild、RunsOn。
3. **软件免费、机器自备**：Jenkins、GitLab CE、Gitea Actions、Forgejo Actions、Woodpecker、Tekton、act。

**用量轴（组织采用，推断，非份额普查）：** 调查前三甲只有 GitHub Actions、Jenkins、GitLab CI。数字来自 JetBrains TeamCity 博文对 *State of Developer Ecosystem 2025* 的转述（组织侧 **33% / 28% / 19%**），**不是** DevEco 交互站图表原文件，置信度 **中**。[^jb-best-ci] Azure Pipelines 与 CircleCI **都不进前三甲**：前者只有非 CI 题的弱代理，后者只有己方遥测。

**热度轴（2025-12 至 2026-08，推断）：** 最大公共话题是 GitHub Actions 定价事件（HN 802 分 / 819 评）。[^hn-pricing] 该帖评论里被点名的开源迁出候选包括 GitLab、Forgejo/Codeberg、Gitea、Jenkins（定性，**未做评论编码，不设「第一平替」名次**）。Jenkins 与 GitLab 有调查存在感；self-hosted / ARC / 商业 runner 的热度是定价事件的导数；act 星标极高但是本地工具。

对 RabbitInterview 这种 Tauri 桌面应用（macOS universal + Windows MSVC + Linux 发布）：

- **公有仓、继续用 GHA YAML：** 留在 GitHub-hosted 仍是不加钱且不限分钟的完整三平台。[^gha-billing]
- **私有仓、继续用 YAML、不想付 SaaS：** 官方 self-hosted（一台 Mac + 一台 Windows + Linux）。软件免费，硬件不是。GitHub **已推迟**对 self-hosted 按分钟收控制面费；**私有仓 self-hosted 当前仍不向 GitHub 按分钟付费**（机器自付；政策可能再变）。[^gha-postpone]
- **离开 GitHub 控制面、还要托管 Win+mac：** 文档确认能调度托管三 OS 的自助免费档是 **Azure Pipelines**（须开通 Azure 计费、1 并发、1,800 分钟/月、单 job 60 分钟、**不能新建 public project**）[^azdo-jobs] 和 **AppVeyor 开源档**（仅公有仓、1 并发、60 分钟）。[^appveyor-pricing] **Harness Cloud Free** 名义上有三 OS，但 macOS 倍率 ×60，2,000 credits ≈ 33 分钟，且须绑卡。[^harness] **GitLab.com Free 本身无托管 macOS**；macOS 文档写明 Tier 为 Premium/Ultimate，并含 open source programs（仍 beta）。[^gl-macos] GitLab for Open Source 申请页确认可走 Ultimate 路径，但 **50,000 minutes 数字所在订阅页本次 HTTP 403，分钟配额未在本轮核实**。[^gl-oss]

## 1. 「平替」指什么

| 类别 | 还用 `.github/workflows`？ | 还用 GitHub 当代码托管？ | 典型产品 |
|---|---|---|---|
| A. 整平台 | 否 | 通常否（或 mirror） | GitLab CI、Azure Pipelines、CircleCI、Bitbucket、AppVeyor |
| B. Runner 替换 | 是，改 `runs-on` | 是 | self-hosted、ARC、Ubicloud、BuildJet、Blacksmith |
| C. 自建/开源 CI | 仅 Gitea/Forgejo/act 接近或部分 | 通常换 forge | Jenkins、Gitea Actions、Forgejo Actions、Woodpecker |

Vercel / Netlify / Render / Cloudflare Workers Builds 是部署构建系统，不是通用多 OS CI，下文不列入平替主表。此为分类判断，不是厂商市场份额主张。

## 2. 用量轴（推断）

单位不可比：GitHub 的 CPU 分钟、CircleCI 的 28 天 workflow 数、Jenkins 安装数、GitLab 注册用户不能放进同一列比大小。Stack Overflow 2025 的 GitHub **81.1%** / GitLab **35.6%** / Azure DevOps **16.6%** 出自「Code documentation and collaboration tools」，不是 CI 产品题，只能当弱代理。[^so-2025]

JetBrains DevEco 2025 样本 24,534 人（2025 年 4–6 月）。[^deveco] 组织/个人 CI 百分比来自 TeamCity 官方博文对同一报告的转述，**不是**交互站图表原文件。Jenkins 官方博客复述了组织侧 28%，不是第二次独立普查。[^jb-best-ci][^jenkins-blog]

另有一份更小的 JetBrains × TeamCity *State of CI/CD 2025* 专项调查（2025-10）：个人项目 GitHub Actions **62%**、组织 **41%**；组织侧 TeamCity **7%**（个人 2%）；32% 组织用两套工具、9% 用至少三套。文中专节写 TeamCity 与 Bitbucket Pipelines「neither … tops the overall usage charts」，但在组织侧「stand out」。样本小于 DevEco，且调查方是 TeamCity 厂商。[^jb-cicd-2025]

### 2.1 有调查或官方绝对量的产品

| 推断名次 | 产品 | 用量信号 | 置信度 |
|---|---|---|---|
| 0 基线 | GitHub Actions | TeamCity 转述 DevEco：组织 33%、个人 39%。[^jb-best-ci] 专项调查：组织 41%、个人 62%。[^jb-cicd-2025] Octoverse 2025 公有仓 **11.5 billion** Actions CPU 分钟（同比 +35%，上年 8.5 billion）；若沿用上年「公有 + self-hosted」口径则为 13.5 billion。[^octoverse] 官方称新架构自 2025-08 起约 **71 million jobs/day**（对比 2024 初约 23 million/day）。[^gha-71m] | 绝对量高（GitHub 第一方）；调查百分比 **中（官方转述，非原图表）** |
| 1 | Jenkins | 转述 DevEco：组织 **28%**、个人 13%。[^jb-best-ci] 新闻稿模板仍写 2022 年「300,000 known installations」，已过时，不与 2025 调查混排。[^jenkins-press] | 调查 **中（转述）**；安装数低 |
| 2 | GitLab CI/CD | 转述 DevEco：组织 **19%**、个人 10%。[^jb-best-ci] 公司页截至 2026-06「Estimated registered users: Over 50 million」是平台账号，不是 CI 用户。[^gl-company] | 调查 **中（转述）**；用户数中 |
| 不进前三甲 | Azure Pipelines | **无 CI 分项百分比。** SO Azure DevOps 16.6% 是协作工具弱代理，**不能**据此排成用量第 3。[^so-2025] | 低–中（代理） |
| 不进前三甲 | CircleCI | 官方博客脚注：基于 2025-09 **28,738,317** 条 CircleCI 上的 workflow（≥2 contributors，workflow 至少跑 5 次）。这是厂商遥测，不是市场份额；完整报告 PDF **blocked**。未进入 DevEco 前三百分比，不能称「第四大份额」。[^circle-sosd] | 中（己方遥测） |
| 组织侧可见、总榜不突出 | Bitbucket Pipelines / TeamCity | 2025-10 专项调查：TeamCity 组织 7% vs 个人 2%；专节写二者不进总榜但组织侧 noticeable。[^jb-cicd-2025] 2026-03 文也写二者「appear less frequently overall, but they have noticeable traction within organizations」。[^jb-best-ci] | 低–中（厂商专项 + 转述） |
| 无普查百分比 | Gitea/Forgejo/Woodpecker/Tekton/Drone | 星标活跃，**没有**进入 2025 组织采用百分比；SO 仅为 write-in（研究笔记） | 用量低（缺普查） |
| 无法排 | 托管 GHA runner 厂商 | 用量完全不透明 | — |

Buildkite About 页写「over 60,000 users」且未标采集年，数据不足，不排名。Sourcehut 无公开用户数。

### 2.2 不要用这些当用量

- `nektos/act` **71,613** 星（研究笔记 2026-08-24 API）：本地跑 workflow 的工具，不是托管 CI。[^act]
- `go-gitea/gitea` **57,565** 星：整个 forge，不等于 Gitea Actions 安装量。托管站是 GitHub。
- Forgejo **5,367** 星在 Codeberg，**不能**与 GitHub 星标混成绝对热度榜。
- `gitlab-org/gitlab` 约 6.1k 星：严重低估平台规模。
- Google Trends：本轮未取得可引用的数值序列。
- CircleCI / Buildkite 的「领先平台」「节省开发年」类文案：营销，不进用量轴。

## 3. 热度轴（推断）

2025-12-16 GitHub 宣布 self-hosted 将引入 Actions cloud platform charge；随后官方说明 **postponing the announced billing change for self-hosted GitHub Actions**，托管 runner 降价仍于 2026-01-01 生效；公有仓标准 hosted 仍免费；私有仓 self-hosted 控制面费已推迟，**当前文档口径仍是 self-hosted 不按分钟向 GitHub 付费**。[^gha-postpone] 这是检索窗口内最大的 CI 公共话题（单帖证据，不是全年普查）。

| 推断档 | 产品 | 依据 | 不要过度解读 |
|---|---|---|---|
| 事件中心（基线） | GitHub Actions | HN「Pricing Changes for GitHub Actions」**802** 分 / **819** 评（2025-12-16）[^hn-pricing] | 单帖，勿外推为「最受欢迎平替」 |
| 被点名的开源迁出候选（定性，不排名次） | GitLab、Forgejo/Codeberg、Gitea、Jenkins | T4 对同一 HN 线程的阅读：评论提到上述名字。独立 Show HN 分数低 | **未做评论编码**；Gitea GitHub 星标与 Forgejo Codeberg 星标不可混排 |
| 调查存在感强 | Jenkins、GitLab CI | 转述 DevEco 前三；SO SCM 第二 35.6%[^so-2025] | 情绪两极 ≠ 正在增长 |
| 定价事件的导数 | ARC / self-hosted / 商业 runner | Blacksmith 借势博文对应 HN **216** 分（T4：item 46291500，研究笔记；主会话未重开该帖）[^hn-blacksmith]；ARC 仓库约 6.5k★（研究笔记） | 热度是新闻导数，不是日常占有率 |
| 开源星标高、场景是本地 | act | 71,613★（研究笔记 API）[^act] | 不是托管平替用量 |
| 维护活跃、公共峰值低 | Woodpecker / Tekton | 7,736 / 9,040★（研究笔记，GitHub） | HN 峰值低 |
| 企业存量、无 GHA 级公共话题 | CircleCI / Bitbucket / Buildkite | 无与定价帖同级的 HN 主帖 | 不等于没人用 |

## 4. 类别 A：整平台替换（要重写 YAML）

下表只列官方免费档或可零价起步者。研究笔记覆盖的托管平台均未声称即插即用 GHA YAML。

| 产品 | 免费档硬限制 | Linux | Windows | macOS | 对 Tauri 的判断 |
|---|---|---|---|---|---|
| GitHub Actions（基线） | 公有仓标准 runner 免费不限分钟；私有 Free 2,000 min；产物 500 MB；缓存 10 GB/仓[^gha-billing] | 是 | 是 | 是 | 公有仓完整；私有仓 macOS 单价约 10× Linux（0.062/0.006）[^gha-runner-price] |
| GitLab.com Free | **400 compute minutes/月**；[^gl-minutes] 托管 job **3 hours** 超时，与项目 timeout 无关[^gl-hosted] | 是（未打 tag 默认 `small` Linux x86-64）[^gl-hosted] | 是（Tier: Free/Premium/Ultimate；Status: Beta；cost factor 1）[^gl-win][^gl-minutes] | **Free 档否**（Tier: Premium, Ultimate **and open source programs**；Status: Beta；M1 medium ×6，M2 Pro large ×12）[^gl-macos][^gl-minutes] | **blocker（Free 档）**：免费托管没有 macOS。OSS 计划是条件路径，分钟配额页 403 |
| Azure Pipelines | 私有项目须 **enable billing / 开通免费档** 后才有 **1** 个 Microsoft-hosted job、单 job **60 minutes**、每月 **1,800 minutes**。**不能再新建 public project**；现有 public 保留免费并行直到 **2027** 转私有。产物 2 GiB（Azure DevOps 定价页，研究笔记）[^azdo-jobs] | 是（约 2 核 / 7 GB）[^azdo-hosted] | 是 | 是；**macOS agent 始终在美国**[^azdo-hosted] | 理论三平台，不是即开即用；长构建/矩阵不适合 |
| CircleCI Free | **30,000 credits/month**，最多 5 active users，网络 1 GB，存储 2 GB，credits 不滚存。Docker/Linux/Windows 并发 30，macOS VM 并发 1。OSS：Linux/Arm/Docker 最高 400,000 credits/月；Windows/macOS 或私有仓用 Free 的 30,000[^circle-pricing] | 是 | 是（Windows VM Medium 列在 Free） | **冲突**：正文写 Free 含 macOS，对比表 **macOS VM M4 Pro Medium/Large 在 Free 为「—」**（仅 Performance/Scale）[^circle-pricing] | 不能当作已核实的免费 macOS |
| Bitbucket Cloud Free | ≤5 用户，**50 min/month** build minutes，LFS 1 GB，每 pipeline 最多 100 steps，并发 steps 最多 10[^bb-billing] | 仅 **Linux Docker** 跑在 Atlassian 基础设施[^bb-runners] | **否**（self-hosted Windows）[^bb-runners] | **否**（self-hosted MacOS）[^bb-runners] | **blocker** |
| AppVeyor Open-source | 定价页：**Open-source / FREE / Unlimited public projects / 1 concurrent job / 5 self-hosted jobs / Community support**。FAQ：所有计划单 job 最长 **60 minutes**[^appveyor-pricing] | 有镜像（文档，研究笔记） | 有（Windows 起家） | 有镜像（文档列 macos-sonoma 等，研究笔记；当前 Xcode 是否最新未在定价页声明） | 仅公有仓；并发/超时紧 |
| Harness Cloud Free | **2,000 free credits every month**，月末作废。Linux medium ×2、Windows small ×6、macOS small ×60（as of December 2025）。Free 并发 Linux 20 / Windows 1 / macOS 1。存储 2 GB，网络 1 GB。**Free 用 Harness Cloud 须信用卡验证**（T1；主会话打开的 credits 页确认 2,000 与倍率，绑卡句以研究笔记为准）。[^harness] 换算 2,000/60 ≈ 33 macOS small 分钟（算术，非官方「分钟包」） | 是 | 是 | 是，但 macOS 预算约半小时级 | 名义三平台，实用 blocker |
| Sourcehut | 研究笔记：托管 CI 要付费账户；兼容矩阵无 Win/mac 镜像 | Linux/BSD | 否 | 否 | 不是桌面三平台平替 |

**附录（有限免费或无稳定自助免费档）：**

- **Travis CI：** 研究笔记：trial unavailable，OSS 需工单。
- **Codefresh：** 已并入 Octopus；本次官方定价页抓取失败。
- **Buildkite：** T1 记 Free 为有限 **Linux vCPU minutes**（笔记写最多 2,000 Linux vCPU minutes）；macOS 在付费文案才明确。**不是**已核实的免费三平台。主会话未重抓 buildkite.com/pricing。
- **Semaphore：** T1 记云档有每月 credits、macOS **$0.09/min**；Windows 未在定价首页单列。主会话未重抓 semaphoreci.com/pricing。不要把「未列入主表」读成「完全没查」。

## 5. 类别 B：仍跑 GHA YAML 的 runner 平替

GitHub 已推迟 self-hosted 控制面收费。**公有仓标准 hosted 仍免费。私有仓 self-hosted 当前也不按分钟向 GitHub 付费**（机器、电、云账单自付）。私有仓 **hosted** runner 继续吃 included minutes。[^gha-postpone][^gha-billing]

`actions/checkout`、`actions/setup-node`、artifact、`gh release` 在「官方 runner 应用 + 能访问 GitHub API」时通常可用（研究笔记兼容表）。坑集中在：镜像不是 GitHub `runner-images`、容器 job 要 Docker/DinD、Windows 缺完整 Visual Studio、macOS 无 Docker / 并发受限、部分厂商只要 **GitHub Organization**。

官方 self-hosted 支持 Linux / Windows / macOS（GitHub self-hosted runners 文档，研究笔记）。[^gha-selfhost]

| 产品 | 免费含义 | OS | Drop-in | 备注 |
|---|---|---|---|---|
| 官方 self-hosted | 编排目前免费；机器自付[^gha-postpone] | Linux / Windows / macOS[^gha-selfhost] | 部分（改 `runs-on` 标签） | Docker 容器 job 仅 Linux。默认不是每 job 干净机 |
| ARC | 软件 Apache-2.0；成本=K8s[^arc] | 默认 Linux 容器；官方维护 **minimal runner container image**，含最少包，要用 `actions/setup-node` 等补工具[^arc] | 部分 | 不是完整 `ubuntu-latest`。macOS/Windows 不是默认路径 |
| Ubicloud | **Every account gets a $2.5/month credit that’s equivalent to 1,250 minutes** of Ubicloud runner time；`ubicloud-standard-2` 默认 Linux x64 2 vCPU[^ubicloud] | **仅 Linux** x64/arm64（研究笔记：文档无 macOS/Windows GHA runner） | Linux 接近 | **这是本表里核实过的按月循环 Linux 额度**。研究笔记：须绑信用卡防滥用 |
| BuildJet | **Every account gets a one-time $5 credit**；2 vCPU `$0.004 / min`；自称半价 GitHub[^buildjet] | **仅 Ubuntu**；研究笔记：硬件文档明确不提供 macOS，无 Windows 标签 | Linux 接近 | **一次性试用金，不是每月循环免费** |
| Blacksmith | 研究笔记写营销页 3,000 免费分钟。**主会话核验：`https://www.blacksmith.sh/github-action-runners` HTTP 404；`blacksmith.sh/pricing` 抽出内容为客户引言，未核到分钟表。免费分钟数字标未核实。** Quickstart 反复要求 GitHub **organization** 安装 app[^blacksmith-qs] | 研究笔记：Linux + Windows beta + macOS | 接近（改标签） | 个人仓路径未在 Quickstart 展开。Windows 工具链细节见研究笔记 |
| WarpBuild | 研究笔记：注册含 $10 credits（对照页自称 2026-08-13 核对），非循环免费分钟。**主会话未重抓对照页，数字置信度中。** | Linux / Windows / macOS（研究笔记） | 接近 | macOS 无嵌套虚拟化（研究笔记） |
| Depot | 研究笔记：无长期免费档，7 天试用。Developer $20/月含 2,000 GHA minutes。**主会话未重抓 depot.dev/pricing。** | Linux / Windows / macOS（研究笔记） | 接近 | 只要 Organization。Windows 无 Hyper-V（研究笔记） |
| Namespace | 研究笔记：30 天试用。**主会话未重抓 namespace.so/pricing。** | Linux / Windows / macOS（研究笔记） | 接近，自有标签 | `runs-on` 只能有一个 `nscloud` 标签（研究笔记） |
| RunsOn | 研究笔记：非商用许可免费（需致谢）；计算走 AWS 账单。**主会话未重抓 runs-on.com/pricing。** | Linux / Windows；文档无 macOS 产品线（研究笔记） | 部分 | 缺 macOS |
| AWS CodeBuild GHA runner | 研究笔记：Free Tier HTML 抽取不完整。**不以「100 minutes」为已核硬数字。** | Linux / Windows Core；FAQ 未列 macOS GHA runner（研究笔记） | 否（标签含项目名） | 不是 GitHub runner-images |
| Google Cloud Build | 研究笔记：没有官方托管 GHA runner SKU | — | — | 只有 Cloud Run/GKE 自建教程 |

**推断：** 循环免费且含 Win+macOS 的托管 runner，目前仍只有 GitHub 自己的 included minutes。第三方 **按月循环** 免费额度里，本轮核实到的是 **Ubicloud Linux**。BuildJet 是一次性 $5。

## 6. 类别 C：可自建 / 开源（软件免费 ≠ 机器免费）

没有方案能在「不加钱且不自备 Mac/Windows 机器」时提供官方 Xcode / MSVC。此为从各官方 runner/agent 文档归纳的判断。

| 方案 | 许可证 | GHA YAML | macOS / Windows 现实 | 热度（2026-08-24，研究笔记 API） |
|---|---|---|---|---|
| Gitea Actions | MIT | **接近**：官方「designed to be compatible with GitHub Actions」并列出差异[^gitea-cmp] | 官方 runner 二进制含 macOS/Windows；host 模式自备机器（研究笔记） | GitHub：Gitea 57,565★；runner 约 240★ |
| Forgejo Actions | GPL-3.0-or-later（v9+，研究笔记） | **部分**：官方 “familiar … **not designed to be compatible**”[^forgejo-gha] | 官方 runner 测 Linux；host 可挂自备 Mac；官方不维护 Windows（Forgejo FAQ，研究笔记）[^forgejo-faq] | **Codeberg**：Forgejo 5,367★；runner 约 112★。不要和 Gitea 的 GitHub 星标比绝对值 |
| nektos/act | MIT[^act] | 接近（本地执行器，**不是平台**） | 默认把 ubuntu 映射成 Linux 容器；要跑 macos/windows 必须已在该 OS 上跑 act（研究笔记） | GitHub **71,613★** |
| Jenkins | MIT | 无（Jenkinsfile/Groovy） | agent 可挂任意 JVM 机器；Windows 有官方支持政策（研究笔记） | GitHub 26,481★；weekly 2.578 |
| GitLab Self-Managed | CE MIT；EE 专有（研究笔记） | 无（`.gitlab-ci.yml`） | Runner 官方支持 Linux/macOS/Windows。自管 runner 不受 GitLab.com 400 分钟约束[^gl-minutes] | 平台用量大，star 低估 |
| Woodpecker | Apache-2.0 | 无 | darwin/Windows agent 二进制；桌面构建用 Local 后端（研究笔记） | GitHub 7,736★；v3.17.0 |
| Tekton | Apache-2.0 | 无 | 需 K8s；Windows 有官方节点文档；无官方 macOS 农场（研究笔记） | GitHub 9,040★ |
| Drone | OSS Apache-2.0（需自行 oss 构建）；EE Polyform（研究笔记） | 无 | Exec runner 可挂 Win/Mac（研究笔记） | harness 仓 38,096★（历史改名，不能当 2026 新热度） |
| Concourse / Buildbot / Argo / Sourcehut builds | Apache/GPL/AGPL（研究笔记） | 无 | 容器/Linux 为主；Sourcehut 兼容矩阵无 Win/mac 镜像（研究笔记） | 中低 |

想尽量留 GHA YAML 又离开 GitHub 托管：优先 **Gitea Actions（接近）** 或 **Forgejo Actions（部分）**，并自备三台 runner。新开源自建若接受重写 YAML，Woodpecker 许可证比历史 Drone 默认镜像干净（研究笔记许可证对照）。Forgejo 2024 渗透测试 PDF **未解析（blocked）**。

## 7. 给决策者的分层（推断，不是总分）

1. **调查上真正有体量的免费/自建档（转述 DevEco，置信度中）：** Jenkins（自建调查第二）→ GitLab CI（第三，但.com Free 无 macOS）→ 其后不要把 Azure 排成「用量第三」。Azure 的价值是 **免费托管三 OS**，不是调查份额。[^jb-best-ci][^gl-macos][^azdo-jobs]
2. **想保住 GHA YAML：** 热度在 self-hosted / ARC / 商业 runner，**用量无法排序**。按月循环免费 Linux：本轮核实到 **Ubicloud**。BuildJet 是一次性 $5。[^ubicloud][^buildjet] 完整桌面矩阵：自备机器挂官方 runner。
3. **开源兼容叙事：** Gitea（接近 YAML）与 Forgejo（熟悉但不兼容）是离开 GitHub 时最常被点名的 forge+Actions，**不是**已编码的热度第一。Woodpecker 不是 GHA YAML。不要用 act 星标证明托管平替用量。
4. **不要**把 GitHub 11.5 billion 分钟和 CircleCI 28,738,317 workflow 放进同一列比大小。[^octoverse][^circle-sosd]

## 8. 相对 GitHub-hosted 的常见坑

- YAML 不兼容（类别 A、多数 C）。
- `actions/checkout` / `setup-node` 在自建 forge 上行为不同；Forgejo 明确不追求兼容。[^forgejo-gha]
- Artifact 若仍上传 GitHub，吃 GitHub 存储配额。[^gha-billing]
- `gh release` 在最小镜像/Windows 上往往要自装（ARC 最小镜像只带 runner 二进制与 Docker）。[^arc]
- macOS：GitLab.com Free 没有；[^gl-macos] CircleCI Free 当前 M4 Pro SKU 在对比表为不可用；[^circle-pricing] Azure 免费档 60 分钟/job；[^azdo-jobs] Harness ×60；[^harness] 自建必须有 Mac。
- Windows：Bitbucket 云 runner 没有；[^bb-runners] Ubicloud/BuildJet 托管没有；Forgejo 官方不维护；[^forgejo-faq] 若干 SaaS 只有 Build Tools 或无 Hyper-V（研究笔记，部分未二次抓取）。
- 数据驻留：Azure macOS agent 在美国。[^azdo-hosted]
- 个人仓：Blacksmith Quickstart 面向 organization app 安装。[^blacksmith-qs]
- 私有仓 self-hosted：控制面费已推迟，当前不是「已经按分钟向 GitHub 付费」。[^gha-postpone]

## 9. 开放问题 / 降级项

1. CircleCI Free 是否仍能调度任何 macOS resource class（对比表与页面文案冲突；无账号无法点选）。[^circle-pricing]
2. Blacksmith 循环免费分钟的权威数字（营销页 404，定价页本次未抽出表格）。
3. AppVeyor 当前 macOS 镜像 / Xcode 是否仍与软件文档一致（定价页未声明）。
4. GitHub self-hosted 控制面费推迟到何时重新提案。[^gha-postpone]
5. JetBrains DevEco 交互站 RSC payload 未直接检出百分比，33/28/19 来自 TeamCity 官方博文转述。[^jb-best-ci]
6. CNCF Annual Survey 与 CircleCI 完整 PDF 报告按计划 **未解析（blocked）**；CircleCI 仅用博客 HTML 脚注。[^circle-sosd]
7. Reddit 自托管对比帖 HTML 抽取失败，未拿到分数。
8. WarpBuild / Depot / Namespace / RunsOn / CodeBuild / Buildkite / Semaphore 部分数字主要来自研究笔记，主会话未全部二次抓取。
9. 星标为 2026-08-24 API 快照（研究笔记），会变。
10. GitLab OSS 计划的 compute minutes 配额页本次 403，未把「50,000 minutes」写入硬表。[^gl-oss]
11. HN item 46291500（Blacksmith 216 分）主会话未重开，保留研究笔记口径。

## Sources

1. GitHub Docs — GitHub Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions
2. GitHub Docs — Actions runner pricing: https://docs.github.com/en/billing/reference/actions-runner-pricing
3. GitHub — Pricing changes for GitHub Actions: https://github.com/resources/insights/2026-pricing-changes-for-github-actions
4. GitHub Blog — Octoverse 2025: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
5. GitHub Blog — Let’s talk about GitHub Actions: https://github.blog/news-insights/product-news/lets-talk-about-github-actions/
6. GitHub Docs — Actions Runner Controller: https://docs.github.com/en/actions/concepts/runners/actions-runner-controller
7. GitHub Docs — Self-hosted runners: https://docs.github.com/en/actions/hosting-your-own-runners
8. JetBrains TeamCity Blog — Best CI/CD Tools for 2026: https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/
9. JetBrains — State of Developer Ecosystem 2025: https://devecosystem-2025.jetbrains.com/
10. JetBrains TeamCity Blog — The State of CI/CD in 2025: https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/
11. Jenkins Blog — JetBrains report highlights Jenkins: https://www.jenkins.io/blog/2026/04/06/jetbrains-report-highlights-jenkins-as-a-popular-tool-in-2026/
12. Jenkins — Press kit: https://www.jenkins.io/press/
13. Stack Overflow Developer Survey 2025 — Technology: https://survey.stackoverflow.co/2025/technology
14. Hacker News — Pricing Changes for GitHub Actions: https://news.ycombinator.com/item?id=46291156
15. Hacker News — Blacksmith pricing post (T4): https://news.ycombinator.com/item?id=46291500
16. GitLab Docs — Compute minutes: https://docs.gitlab.com/ci/pipelines/compute_minutes/
17. GitLab Docs — Hosted runners: https://docs.gitlab.com/ci/runners/hosted_runners/
18. GitLab Docs — Hosted runners on macOS: https://docs.gitlab.com/ci/runners/hosted_runners/macos/
19. GitLab Docs — Hosted runners on Windows: https://docs.gitlab.com/ci/runners/hosted_runners/windows/
20. GitLab — Company: https://about.gitlab.com/company/
21. GitLab — Join the GitLab for Open Source Program: https://about.gitlab.com/solutions/open-source/join/
22. Microsoft Learn — Parallel jobs: https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
23. Microsoft Learn — Microsoft-hosted agents: https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
24. CircleCI — Pricing: https://circleci.com/pricing/
25. CircleCI Blog — 2026 State of Software Delivery takeaways: https://circleci.com/blog/five-takeaways-2026-software-delivery-report/
26. Atlassian Support — Bitbucket plan and billing: https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/
27. Atlassian Support — Bitbucket runners comparison: https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-runners-comparison/
28. AppVeyor — Pricing: https://www.appveyor.com/pricing/
29. Harness Docs — CI Cloud credits: https://developer.harness.io/docs/continuous-integration/get-started/ci-subscription-mgmt
30. Forgejo Docs — GitHub Actions familiarity vs compatibility: https://forgejo.org/docs/latest/user/actions/github-actions/
31. Forgejo FAQ: https://forgejo.org/faq/
32. Gitea Docs — Compared to GitHub Actions: https://docs.gitea.com/usage/actions/comparison/
33. Ubicloud Docs — Pricing: https://www.ubicloud.com/docs/about/pricing
34. BuildJet Docs — Pricing: https://buildjet.com/for-github-actions/docs/about/pricing
35. Blacksmith Docs — Quickstart: https://docs.blacksmith.sh/introduction/quickstart
36. nektos/act: https://github.com/nektos/act

研究笔记：

- `outputs/.drafts/github-actions-free-alternatives-research-hosted.md`
- `outputs/.drafts/github-actions-free-alternatives-research-runners.md`
- `outputs/.drafts/github-actions-free-alternatives-research-selfhost.md`
- `outputs/.drafts/github-actions-free-alternatives-research-ranking.md`

[^gha-billing]: https://docs.github.com/en/billing/concepts/product-billing/github-actions
[^gha-runner-price]: https://docs.github.com/en/billing/reference/actions-runner-pricing
[^gha-postpone]: https://github.com/resources/insights/2026-pricing-changes-for-github-actions
[^gha-selfhost]: https://docs.github.com/en/actions/hosting-your-own-runners
[^octoverse]: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
[^gha-71m]: https://github.blog/news-insights/product-news/lets-talk-about-github-actions/
[^arc]: https://docs.github.com/en/actions/concepts/runners/actions-runner-controller
[^jb-best-ci]: https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/
[^jb-cicd-2025]: https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/
[^deveco]: https://devecosystem-2025.jetbrains.com/
[^jenkins-blog]: https://www.jenkins.io/blog/2026/04/06/jetbrains-report-highlights-jenkins-as-a-popular-tool-in-2026/
[^jenkins-press]: https://www.jenkins.io/press/
[^so-2025]: https://survey.stackoverflow.co/2025/technology
[^hn-pricing]: https://news.ycombinator.com/item?id=46291156
[^hn-blacksmith]: https://news.ycombinator.com/item?id=46291500
[^gl-minutes]: https://docs.gitlab.com/ci/pipelines/compute_minutes/
[^gl-hosted]: https://docs.gitlab.com/ci/runners/hosted_runners/
[^gl-macos]: https://docs.gitlab.com/ci/runners/hosted_runners/macos/
[^gl-win]: https://docs.gitlab.com/ci/runners/hosted_runners/windows/
[^gl-company]: https://about.gitlab.com/company/
[^gl-oss]: https://about.gitlab.com/solutions/open-source/join/
[^azdo-jobs]: https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
[^azdo-hosted]: https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
[^circle-pricing]: https://circleci.com/pricing/
[^circle-sosd]: https://circleci.com/blog/five-takeaways-2026-software-delivery-report/
[^bb-billing]: https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/
[^bb-runners]: https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-runners-comparison/
[^appveyor-pricing]: https://www.appveyor.com/pricing/
[^harness]: https://developer.harness.io/docs/continuous-integration/get-started/ci-subscription-mgmt
[^forgejo-gha]: https://forgejo.org/docs/latest/user/actions/github-actions/
[^forgejo-faq]: https://forgejo.org/faq/
[^gitea-cmp]: https://docs.gitea.com/usage/actions/comparison/
[^ubicloud]: https://www.ubicloud.com/docs/about/pricing
[^buildjet]: https://buildjet.com/for-github-actions/docs/about/pricing
[^blacksmith-qs]: https://docs.blacksmith.sh/introduction/quickstart
[^act]: https://github.com/nektos/act
