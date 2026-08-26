# T4 草稿：GitHub Actions 平替的用量与热度排序证据

- **轨道：** T4（只收集可横向比较的用量 / 热度信号；不抄定价页）
- **检索日：** 2026-08-24
- **语言：** 中文；产品名保持原文
- **方法：** 优先一手调查、官方公开数字、仓库 API、HN Algolia。厂商「X million builds」无独立印证则标营销声明。CNCF / CircleCI 调查 PDF **未解析**（按计划：只引 HTML 摘要页，全文 blocked）。

## 1. 先说不能比什么

下列信号**不能**直接排成一张「谁用量更大」的总表：

| 不可比点 | 原因 |
|---|---|
| GitHub Actions 分钟 vs CircleCI workflow 数 vs Jenkins 安装数 vs GitLab 注册用户 | 单位不同：CPU 分钟、28 天窗口内的 workflow、opt-in 控制器、平台账号。 |
| Stack Overflow 的 GitHub / GitLab / Azure DevOps 百分比 | 2025 问卷是「协作 / 文档工具」，不是 CI/CD 产品题。GitHub 81.1% ≠ Actions 用量。 |
| GitHub star vs SaaS 用量 | `nektos/act` 7.1 万星是本地 runner；`go-gitea/gitea` 5.7 万星含 forge，不等于 Gitea Actions 安装量。GitLab.com 上的 star 文化弱于 GitHub，`gitlab-org/gitlab` 6.1k 星严重低估平台规模。 |
| 托管 runner 厂商（Blacksmith / Depot / Namespace / WarpBuild / BuildJet） | 不进 JetBrains / SO / CNCF 分项。公开 star 很少或仓库 404。 |
| Google Trends 相对兴趣 | Trends 页面未给出可引用的数值序列；本轨 **未取得** 可比指数。 |
| 招聘帖数量 | 未找到 2025–2026 公开、可复现的 CI 岗位统计。 |
| Jenkins「30 万安装」（2022）vs 2025 调查 28% | 年份差三年；stats.jenkins.io 2024 数字在图片里，HTML 无表格。 |

**排序规则（与主计划一致）：** 两轴（用量、当前热度），不做单一综合分。文末「综合名次」一律标 **推断**。

---

## 2. 一手调查（用量主轴）

### 2.1 JetBrains State of Developer Ecosystem 2025（高）

- 样本：24,534 名开发者；2025 年 4–6 月。方法页：[devecosystem-2025.jetbrains.com](https://devecosystem-2025.jetbrains.com/)
- 工具分项图表在交互站 `tools-and-trends` 的 RSC payload 中**没有**检出 GitHub Actions / Jenkins 字符串；**数字来自 JetBrains TeamCity 官方博文对同一报告的转述**（仍是 JetBrains 一手，但不是图表原文件）。
- 转述数字（[Best CI/CD Tools for 2026](https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/)，2026-03）：
  - 55% 开发者「经常使用 CI/CD 工具」
  - **组织：** GitHub Actions **33%**，Jenkins **28%**，GitLab CI **19%**
  - **个人项目：** GitHub Actions **39%**，Jenkins **13%**，GitLab CI **10%**
  - **18%** 组织不用任何 CI/CD
  - 「大约三分之一组织同时跑两套 CI，近十分之一跑三套及以上」——与下面 805 人专项调查的 32% / 9% 同口径

Jenkins 项目官方博客复述了组织侧 28%：[jetbrains-report-highlights-jenkins-as-a-popular-tool-in-2026](https://www.jenkins.io/blog/2026/04/06/jetbrains-report-highlights-jenkins-as-a-popular-tool-in-2026/)（2026-04-06）。

### 2.2 JetBrains × TeamCity《State of CI/CD 2025》（高，样本更小）

- 样本：**805** 人；[The State of CI/CD in 2025](https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/)（2025-10）
- GitHub Actions：**个人项目 62%**，**组织 41%**
- 组织同时用 2 套工具 **32%**，≥3 套 **9%**
- 文字结论：组织侧仍大量依赖 Jenkins 与 GitLab；GHA 在小公司更常见，Jenkins 在中大公司更常见；Bitbucket Pipelines 与 TeamCity「组织侧有存在感，但不进总榜前列」
- **注意：** 805 人专项调查的组织 GHA 41% 高于 DevEco 的 33%。两套问卷不可混成一个百分比。专项调查更偏向已在做 CI 的人。

### 2.3 Stack Overflow Developer Survey 2025（中，仅作 SCM 代理）

来源：[survey.stackoverflow.co/2025/technology](https://survey.stackoverflow.co/2025/technology) 图表「Code documentation and collaboration tools」，全样本条（id `s127`）：

| 工具 | Have used（全样本） | 能否当 CI 用量 |
|---|---|---|
| GitHub | **81.1%** | 否。含托管代码，不等于 Actions |
| GitLab | **35.6%** | 否。含 GitLab.com / 自建，不等于 CI |
| Azure DevOps | **16.6%** | 弱代理。平台含 Pipelines，但题目不是 CI |
| Bitbucket / Gitea / Forgejo | 仅 write-in：约 0.08% / 0.05% / 0.03% | **不可比**。未进正式选项 |

2024 技术页同样没有独立 CI/CD 题：[survey.stackoverflow.co/2024/technology](https://survey.stackoverflow.co/2024/technology)。

### 2.4 CNCF Annual Survey 2024 HTML（中，无分产品）

- 新闻稿（2025-04-01）：[CNCF Research Reveals…](https://www.cncf.io/announcements/2025/04/01/cncf-research-reveals-how-cloud-native-technology-is-reshaping-global-business-and-innovation/)
- 750 名云原生社区受访者（摘要页：[linuxfoundation.org/research/cncf-2024-annual-survey](https://www.linuxfoundation.org/research/cncf-2024-annual-survey)）
- **CI/CD 采用同比 +31%**；**60%** 组织对「大多数或全部应用」使用 CI/CD
- **没有** GitHub Actions / Jenkins / Tekton 分项
- 2024 / 2025 全文 PDF：**blocked，未解析**

---

## 3. 厂商官方公开数字（用量辅轴）

| 产品 | 信号 | 年份 | 性质 | 置信度 | URL |
|---|---|---|---|---|---|
| GitHub Actions（基线，非平替） | 公有仓库免费 **115 亿** Actions CPU 分钟，同比 +35%（2024 为 85 亿）；若沿用上年口径（公有 + self-hosted）则 **135 亿**，+30% | 2025 | 官方 Octoverse | 高 | [Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) |
| GitHub Actions | 新架构 **7100 万 jobs/天**（2025-08 之后）；对比 2024 初约 2300 万/天 | 2025-12 | 官方产品博客 | 高 | [Let’s talk about GitHub Actions](https://github.blog/news-insights/product-news/lets-talk-about-github-actions/) |
| GitHub Actions | 公有仓库 115 亿分钟估值约 **1.84 亿美元** 免费算力；自托管按分钟收费方案已 **推迟** | 2025–2026 | 官方定价说明 | 高 | [Pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) |
| GitLab（平台，非纯 CI） | 「Estimated registered users: Over 50 million」（截至 **2026-06**） | 2026-06 | 公司页 | 中 | [about.gitlab.com/company](https://about.gitlab.com/company/) |
| CircleCI | **2025-09 前 28 天** 分析 **超过 2800 万** CI workflow，「数千个团队」；日均 throughput 同比 +59%（自家平台内） | 2026-02 | 官方 State of Software Delivery + PR | 中（只描述 CircleCI 上的客户，不是市场份额） | [博客](https://circleci.com/blog/five-takeaways-2026-software-delivery-report/) · [PR Newswire](https://www.prnewswire.com/news-releases/circleci-publishes-2026-state-of-software-delivery-302691131.html) |
| Buildkite | 「over **60,000** users」；另有 2023 年「节省 18,212 年开发时间」 | 页脚 2026，用户数**未标采集年** | 公司 About | 低–中 | [buildkite.com/about/company](https://buildkite.com/about/company/) |
| Jenkins | 「2022 年达到 **300,000 known installations**」 | 2022 | 新闻稿模板 | 低（过时） | [jenkins.io/press](https://www.jenkins.io/press/) |
| Jenkins | 2024 年回顾引用 [stats.jenkins.io/statistics](https://stats.jenkins.io/statistics) **图片**，HTML 无数字 | 2025-01 | 官方年复盘 | 低（数字在图里） | [Jenkins 2024 in Review](https://www.jenkins.io/blog/2025/01/16/jenkins-2024-recap/) |
| Azure Pipelines / Bitbucket Pipelines / Sourcehut builds | 未找到 2025–2026 官方全局用户/分钟数 | — | — | — | 仅有客户侧 usage 文档，不是市场用量 |

**营销声明（不进用量排序）：** Buildkite「18,000 years saved」、GitHub「~$184 million」、CircleCI「leading software delivery platform」、第三方站点声称的 CircleCI「35,696 家客户」。

---

## 4. 仓库星标 / fork / 活跃度（热度辅轴，2026-08-24 API）

星标**不是用量**。只用于开源/自建方案横向比较，以及证明项目是否还在提交。

| 产品 | 仓库 | Stars | Forks | 最近 push | 置信度 |
|---|---|---|---|---|---|
| Act（本地跑 GHA，非托管平替） | [nektos/act](https://github.com/nektos/act) | **71,613** | 2,009 | 2026-08-09 | 高（热度）；用量不可比 |
| Gitea（forge + Actions） | [go-gitea/gitea](https://github.com/go-gitea/gitea) | **57,565** | 7,030 | 2026-08-24 | 高；含整个 forge |
| Harness Open Source / 原 Drone 仓库演进 | [harness/harness](https://github.com/harness/harness) | **38,096** | 3,361 | 2026-08-21 | 中（历史星标继承，产品已改名） |
| Jenkins | [jenkinsci/jenkins](https://github.com/jenkinsci/jenkins) | **26,481** | 9,803 | 2026-08-24 | 高 |
| Tekton Pipelines | [tektoncd/pipeline](https://github.com/tektoncd/pipeline) | **9,040** | 1,954 | 2026-08-23 | 高 |
| Woodpecker CI | [woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker) | **7,736** | 655 | 2026-08-24 | 高 |
| Actions Runner Controller | [actions/actions-runner-controller](https://github.com/actions/actions-runner-controller) | **6,459** | 1,469 | 2026-08-17 | 高 |
| GitHub Actions runner 二进制 | [actions/runner](https://github.com/actions/runner) | **6,212** | 1,412 | 2026-08-23 | 高；官方组件 |
| GitLab（主仓库在 GitLab.com） | [gitlab-org/gitlab](https://gitlab.com/gitlab-org/gitlab) | **6,125** | 12,364 | 2026-08-24 | 中（star 低估） |
| Forgejo | [codeberg.org/forgejo/forgejo](https://codeberg.org/forgejo/forgejo) | **5,367** | 922 | 2026-08-24 | 高（Codeberg 星标，不能和 GitHub 星标混排成「谁更热」的绝对榜） |
| GitLab Runner | [gitlab-org/gitlab-runner](https://gitlab.com/gitlab-org/gitlab-runner) | **2,569** | 2,651 | 2026-08-24 | 高 |
| RunsOn（自托管 GHA runner 在 AWS） | [runs-on/runs-on](https://github.com/runs-on/runs-on) | **1,298** | 51 | 2026-08-21 | 高 |
| Buildkite agent | [buildkite/agent](https://github.com/buildkite/agent) | **1,047** | 370 | 2026-08-24 | 高 |
| CircleCI docs（无产品核心仓库可代表用量） | [circleci/circleci-docs](https://github.com/circleci/circleci-docs) | 850 | 1,496 | 2026-08-22 | 低，勿当产品热度 |
| Depot CLI | [depot/cli](https://github.com/depot/cli) | 203 | 18 | 2026-08-21 | 低 |
| GitHub 镜像 gitlab-runner | [gitlabhq/gitlab-runner](https://github.com/gitlabhq/gitlab-runner) | 246 | 88 | 镜像 | 勿用 |
| Sourcehut builds / Blacksmith / Namespace / WarpBuild 产品仓 | API 404 | — | — | — | 无 GitHub 公开主仓可数星 |

---

## 5. 社区热度（2025–2026）

### 5.1 Hacker News（Algolia，高）

| 帖子 | 时间 | Points | 评论 | 说明 |
|---|---|---|---|---|
| [Pricing Changes for GitHub Actions](https://news.ycombinator.com/item?id=46291156) | 2025-12-16 | **802** | **819** | 2025 末最大 CI 事件；评论大量提到 GitLab、Forgejo/Codeberg、Gitea、Jenkins、CircleCI、自托管 |
| [Coming soon: Simpler pricing…](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/) 对应 HN | 2025-12-16 | **454** | 2 | 官方 changelog 镜像热度 |
| [The GitHub Actions control plane is no longer free](https://www.blacksmith.sh/blog/actions-pricing)（Blacksmith 博文） | 2025-12-16 | **216** | 3 | runner 厂商借势 |
| [GitHub postponing the announced billing change…](https://news.ycombinator.com/item?id=46304379) | 2025-12-17 | **157** | 126 | 自托管收费推迟 |

Forgejo Actions / Woodpecker 的独立 Show HN **没有**进入百点级：Forgejo Actions 相关 story 多为 1–4 分；Woodpecker 历史帖最高约 10 分（2022 发布），2025–2026 仍是个位数。说明：**自建 GHA 兼容方案在 HN 是定价抗议的配角，不是独立爆款。**

### 5.2 Reddit（中，正文抓取失败）

线索帖：[r/selfhosted – Github actions replacement: gitea vs forgejo vs gitlab vs others](https://www.reddit.com/r/selfhosted/comments/1pp4kn0/github_actions_replacement_gitea_vs_forgejo_vs/)（2025）。HTML 抽取失败，**未拿到分数/评论数**。只能记：自托管圈的比较对象是 **Gitea / Forgejo / GitLab**，而不是 CircleCI / Buildkite。

### 5.3 2025–2026 热度事件（定性）

1. **GitHub Actions 自托管即将按分钟收费 → 推迟**：同时点燃「换平台」和「换 runner」两条讨论。Bitbucket 同期也在动 self-hosted runner 定价（HN 评论交叉引用）。
2. **Forgejo / Codeberg** 作为「离开 GitHub」的默认开源 forge+Actions 被反复点名，但调查表上仍是 write-in 噪声级。
3. **Jenkins** 在 JetBrains 数据里仍是组织第二；HN 情绪两极（「噩梦」vs「每天在用」）。
4. **CircleCI / Buildkite** 有企业案例与自家报告，没有与 GHA 定价同级的社区峰值。

---

## 6. 比较表草稿（每行一个产品）

| 产品 | 类别 | 用量信号 | 热度信号 | 年份 | URL | 置信度 |
|---|---|---|---|---|---|---|
| **GitHub Actions**（对照基线） | 托管 CI | DevEco 组织 33% / 个人 39%；专项调查组织 41% / 个人 62%；Octoverse 公有 115 亿分钟；71M jobs/天 | HN 定价帖 802 分 / 819 评；SO GitHub 平台 81.1%（非 CI） | 2025–2026 | [DevEco 转述](https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/) · [Octoverse](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) · [HN 46291156](https://news.ycombinator.com/item?id=46291156) | 高 |
| **Jenkins** | 自建 CI | DevEco 组织 **28%**（第二）、个人 13%；2022 年 30 万已知安装（过时） | 核心仓 26.5k★ / 9.8k fork，日更；HN 定价帖中作为「旧世界」被反复提起 | 2025–2026 / 安装数 2022 | [TeamCity 2026-03](https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/) · [jenkinsci/jenkins](https://github.com/jenkinsci/jenkins) · [press](https://www.jenkins.io/press/) | 用量高；安装数低 |
| **GitLab CI/CD** | 整平台替换 | DevEco 组织 **19%**、个人 10%；平台注册用户 5000 万+（**不是 CI 用户**） | SO GitLab 35.6%（SCM）；主仓 6.1k★（低估）；Runner 2.6k★；HN 定价帖中最常被提的「企业/自建」替代 | 2025–2026 | [TeamCity 2026-03](https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/) · [GitLab company](https://about.gitlab.com/company/) · [gitlab-org/gitlab](https://gitlab.com/gitlab-org/gitlab) | 调查高；用户数中 |
| **Azure Pipelines** | 整平台 | SO Azure DevOps **16.6%**（平台，弱代理）；DevEco 文中点名但未给百分比 | 无 2025–2026 可引用的 HN 峰值；无公开全局 job 数 | 2025 | [SO 2025](https://survey.stackoverflow.co/2025/technology) | 中（代理） / 热度低 |
| **CircleCI** | 托管 CI | 自家 28 天窗口 2800 万 workflow；**未进入** DevEco 前三百分比 | docs 仓 850★ 无意义；无百点级 HN 主帖 | 2026-02 | [CircleCI 博客](https://circleci.com/blog/five-takeaways-2026-software-delivery-report/) | 中（仅己方遥测） |
| **Bitbucket Pipelines** | 整平台 | 专项调查：组织侧「有存在感、不进总榜」；SO 仅为 write-in | 2025-12 自托管 runner 定价讨论（间接，via HN） | 2025 | [State of CI/CD](https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/) | 低–中 |
| **TeamCity** | 商业 CI | 专项调查：组织 7% vs 个人 2%（文内） | JetBrains 自家渠道热度，社区讨论弱 | 2025 | 同上 | 中（样本 805，且调查方是厂商） |
| **Buildkite** | 托管+自建 agent | 「6 万用户」未标年份；Shopify/Reddit 案例是客户故事不是普查 | agent 1.0k★；无调查分项 | 页脚 2026 | [About](https://buildkite.com/about/company/) | 低 |
| **Sourcehut builds** | 小众托管 | 无公开用户数 | 定价抗议帖中偶尔被点名；GitHub 无主仓 | 2026 | [builds.sr.ht](https://builds.sr.ht/) | 低 |
| **Gitea Actions** | 自建、部分 GHA YAML | 无独立 CI 调查分项；SO write-in ~0.05% | forge 仓 **57.6k★**（含非 CI）；自托管 Reddit/HN 常客 | 2026-08 | [go-gitea/gitea](https://github.com/go-gitea/gitea) | 热度中高；用量低（缺普查） |
| **Forgejo Actions** | 自建、GHA 兼容叙事 | 无普查；SO write-in ~0.03% | Codeberg **5.4k★**；HN 定价帖多次推荐 Codeberg/Forgejo；独立帖分数低 | 2025–2026 | [forgejo/forgejo](https://codeberg.org/forgejo/forgejo) | 热度中；用量低 |
| **Woodpecker** | 自建（Drone 社区叉） | 无普查 | 7.7k★，日更；HN 长期个位数 | 2026-08 | [woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker) | 热度中（星标）；讨论低 |
| **Drone / Harness OSS** | 自建/演进 | 无 2025 调查分项 | harness 仓 38k★（历史+改名，**不能**当 2026 新增热度） | 2026-08 | [harness/harness](https://github.com/harness/harness) | 低（口径污染） |
| **Tekton** | 云原生自建 | CNCF 调查无分项；K8s 生态内有存在感 | 9.0k★ | 2026-08 | [tektoncd/pipeline](https://github.com/tektoncd/pipeline) | 中（星标）；用量未知 |
| **ARC / self-hosted GHA** | runner 替换 | 无独立用量；吃 GHA 控制面 | ARC 6.5k★；runner 6.2k★；2025-12 定价新闻的直接对象 | 2025–2026 | [ARC](https://github.com/actions/actions-runner-controller) · [定价页](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) | 热度高（事件驱动）；用量未知 |
| **Act** | 本地 GHA | 不是托管用量 | **71.6k★**，开源热度第一，但是本地工具 | 2026-08 | [nektos/act](https://github.com/nektos/act) | 热度高；用量轴 N/A |
| **RunsOn** | 自托管 GHA on AWS | 无普查 | 1.3k★；独立 CPU 基准站存在（热度线索，非用量） | 2026-08 | [runs-on/runs-on](https://github.com/runs-on/runs-on) | 低–中 |
| **Depot / Blacksmith / Namespace / WarpBuild / BuildJet** | 即插即用托管 runner | 无调查、无官方经审计的全局分钟数 | 2025-12 Blacksmith 博文 HN 216 分；Depot CLI 203★；其余主仓 404 | 2025–2026 | [Blacksmith HN](https://news.ycombinator.com/item?id=46291500) | 低（营销+事件热度） |

---

## 7. 推断名次（两轴，非综合分）

### 7.1 用量轴（组织 CI 采用，**推断**）

依据：JetBrains DevEco 2025 组织百分比为主，专项调查与官方绝对数字为辅。

| 推断名次 | 产品 | 依据一句话 |
|---|---|---|
| 0（基线） | GitHub Actions | 唯一同时有调查第一 + 百亿分钟官方数的产品 |
| 1 | **Jenkins** | 组织 28%，自建里唯一进入调查前三 |
| 2 | **GitLab CI/CD** | 组织 19%；平台用户不能直接换算成分钟 |
| 3 | **Azure Pipelines** | 无 CI 分项；SO 平台 16.6% 作弱代理，排在已公布百分比的工具之后 |
| 4 | **CircleCI** | 有大规模己方遥测，但调查无百分比，不能声称「第四大市场份额」 |
| 5 | Bitbucket Pipelines / TeamCity | 专项调查「组织侧可见、总榜不突出」 |
| 6 | 自建轻量栈（Gitea Actions / Forgejo Actions / Woodpecker / Tekton / Drone） | 星标活跃，但**没有**进入 2025 组织采用百分比 |
| 7 | 托管 GHA runner 平替 | 用量完全不透明 |

Buildkite / Sourcehut：**数据不足，不排名**。

### 7.2 当前热度轴（2025-12 至 2026-08，**推断**）

| 推断名次 | 产品 | 依据一句话 |
|---|---|---|
| 0（基线） | GitHub Actions | 定价/推迟事件是全年最大 CI 话题 |
| 1 | **Forgejo / Gitea**（及 Codeberg） | 离开 GitHub 讨论的默认开源答案；星标与 HN 提及高于 Woodpecker |
| 2 | **Jenkins** | 调查第二 + 持续日更；情绪负向但存在感强 |
| 3 | **GitLab CI** | HN/企业替代首选之一；SO SCM 第二 |
| 4 | **ARC / self-hosted / 托管 runner 厂商** | 热度是定价事件的导数，不是日常占有率 |
| 5 | **Act** | 星标极高，讨论场景是「本地调试 workflow」 |
| 6 | Woodpecker / Tekton | 维护活跃，社区峰值低 |
| 7 | CircleCI / Buildkite / Bitbucket | 企业存量，2025–2026 没有 GHA 级公共话题 |

### 7.3 给主会话的合成建议（仍是**推断**）

若必须给「免费/低成本平替」读者一张**分层**而不是总分：

1. **整平台、有调查证据的免费/自建档：** GitLab CI（第二大调查占有）→ Jenkins（自建第一）→ Azure Pipelines（弱证据）。
2. **想保住 GHA YAML：** 热度在 self-hosted / ARC / 商业 runner，**用量无法排序**；开源兼容叙事热度：**Forgejo Actions ≈ Gitea Actions >> Woodpecker**（Woodpecker 不是 GHA YAML）。
3. **不要**用 `act` 星标证明托管平替用量。
4. **不要**把 GitHub 115 亿分钟和 CircleCI 2800 万 workflow 放进同一列比大小。

---

## 8. 来源去留

### Kept

- JetBrains TeamCity [State of CI/CD 2025](https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/) — 805 人专项，GHA/Jenkins/GitLab 分场景
- JetBrains TeamCity [Best CI/CD Tools for 2026](https://blog.jetbrains.com/teamcity/2026/03/best-ci-tools/) — DevEco 2025 组织/个人百分比的官方转述
- [DevEco 2025 方法/样本](https://devecosystem-2025.jetbrains.com/) — 24,534 人
- Jenkins.io [复述 28%](https://www.jenkins.io/blog/2026/04/06/jetbrains-report-highlights-jenkins-as-a-popular-tool-in-2026/)
- SO [2025 technology](https://survey.stackoverflow.co/2025/technology) — SCM/协作，必须降权
- GitHub [Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/) · [Let’s talk about Actions](https://github.blog/news-insights/product-news/lets-talk-about-github-actions/) · [Pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- GitLab [company 数字](https://about.gitlab.com/company/) · GitLab API `gitlab-org/gitlab`、`gitlab-org/gitlab-runner`
- CircleCI [2026 报告博文](https://circleci.com/blog/five-takeaways-2026-software-delivery-report/) · [PR](https://www.prnewswire.com/news-releases/circleci-publishes-2026-state-of-software-delivery-302691131.html)
- Buildkite [About](https://buildkite.com/about/company/)
- Jenkins [press](https://www.jenkins.io/press/) · [2024 recap](https://www.jenkins.io/blog/2025/01/16/jenkins-2024-recap/)
- CNCF [2024 调查新闻稿](https://www.cncf.io/announcements/2025/04/01/cncf-research-reveals-how-cloud-native-technology-is-reshaping-global-business-and-innovation/)
- GitHub/Codeberg REST：jenkins、gitea、woodpecker、tekton、ARC、harness、act、runner、runs-on、depot/cli、forgejo
- HN Algolia：`46291156`（802/819）、Blacksmith `46291500`（216）
- Reddit 线索 URL（无分数）

### Dropped

- hubkub / neuralwired / technologymatch / gravitydevops / foundermag / latchkey — 二手 listicle，转抄调查且夹带未核验的「6 billion pipeline runs」
- ELP Data「35,696 CircleCI 客户」— 方法不透明
- Wikipedia GitHub 用户数（JetBrains 文内引用，非本轨核验）
- Google Trends 页面 — 无可用数值
- CircleCI / CNCF PDF — 按计划不解析
- `gitlabhq/gitlab-runner` GitHub 镜像星标
- Warp 终端仓库（搜 Namespace/WarpBuild 时的误匹配）

---

## 9. Gaps

1. DevEco 2025 交互页未抽出 CI 原图表；33/28/19 依赖 TeamCity 博文转述。主会话若要「图表级」引用，需打开 [jb.gg/deveco-2025](https://jb.gg/deveco-2025) 工具章或下载 raw data zip。
2. stats.jenkins.io 2024/2025 安装数在图里，HTML 无表。
3. Google Trends、招聘统计、BuiltWith：本轨无可用一手。
4. 托管 runner 厂商无一给出经第三方验证的全局分钟/组织数。
5. Reddit 帖正文未抽出；r/devops「State of CI/CD 2025」讨论只当线索。
6. Sourcehut、Azure Pipelines、Bitbucket 缺少与 GHA/Jenkins/GitLab 同构的采用百分比。
