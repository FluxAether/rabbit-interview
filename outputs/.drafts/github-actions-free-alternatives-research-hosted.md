# T1 研究笔记：托管 CI 整平台替换（相对 GitHub Actions）

- **任务:** `outputs/.plans/github-actions-free-alternatives-T1.md`
- **范围:** 只覆盖**整平台替换**（换掉 GitHub Actions YAML / 控制面），不含 GHA runner 出租（T2）与自建引擎（T3）。
- **检索日期:** 2026-08-24
- **写法:** 每个硬数字附官方 URL。未在官方页面读到的数字标「未核实」，不编造。
- **RabbitInterview 背景:** Tauri 桌面应用，目标是**不加钱**覆盖 **macOS universal + Windows MSVC + Linux**。

## Summary

真正能当「免费档通用 CI」且官方托管 **Linux + Windows + macOS** 的选项很少：对照基线 GitHub Actions（公有仓标准 runner 无限、私有仓 Free 2,000 分钟）、Azure Pipelines（私有仓 1 个并行作业 / 1,800 分钟，三系统都走同一分钟池）、Harness Cloud Free（2,000 credits，macOS 倍率 60）、AppVeyor 开源档（仅公有仓）。GitLab.com Free 有 Windows（beta）但 **macOS 托管 runner 仅 Premium/Ultimate**；Bitbucket Cloud 托管 runner 只有 Linux Docker，Win/macOS 必须自建 runner。CircleCI Free 宣称支持三系统，但当前价目表上的 macOS SKU（M4 Pro）在 Free 对比表里标为不可用。Cloudflare Workers Builds、Vercel、Netlify、Render 是部署构建系统，不是通用 CI。Travis CI 免费试用目前不可用；Codefresh 官方定价页本次抓取失败且产品并入 Octopus。

## 对照基线（不当平替）：GitHub Actions

| 项 | 官方事实 | URL | 证据日期 |
|---|---|---|---|
| 形态 | GitHub 托管 SaaS；Actions 是平台功能 | https://github.com/pricing/ | 2026-08-24 抓取 |
| 公有仓 | 标准 GitHub-hosted runner **免费、不限分钟** | https://docs.github.com/en/billing/concepts/product-billing/github-actions | 2026-08-24 |
| 私有仓免费额度（Free） | **2,000 分钟/月**；产物存储 **500 MB**（与 Packages 共享）；缓存 **10 GB/仓库** | https://docs.github.com/en/billing/concepts/product-billing/github-actions | 2026-08-24 |
| 其他档分钟 | Pro/Team 3,000；Enterprise Cloud 50,000 | 同上 | 2026-08-24 |
| 超配额单价（托管 runner） | Linux 2-core x64 **$0.006/min**；Windows 2-core **$0.010/min**；macOS 3/4-core **$0.062/min**；Linux slim 1-core **$0.002/min** | https://docs.github.com/en/billing/reference/actions-runner-pricing | 2026-08-24（2026-01-01 降价后价目） |
| Larger runners | 始终计费，**不能**用 included minutes；公有仓也不免费 | https://docs.github.com/en/billing/reference/actions-runner-pricing | 2026-08-24 |
| OS 矩阵 | 公有仓：Linux 4-core / Windows 4-core / macOS Intel 4-core 与 M1 3-core；私有仓标准 runner 核数更小（Linux/Windows 2-core） | https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job | 2026-08-24 |
| 并发（托管标准 runner） | Free **20** 总并发、**5** macOS；Pro 40/5；Team 60/5；Enterprise 500/50 | https://docs.github.com/en/actions/reference/limits | 2026-08-24 |
| 作业时限 | 托管 runner 单 job **6 小时** | 同上 | 2026-08-24 |
| 2026 价格变动 | 2026-01-01 托管 runner 最高降约 39%；拟对 self-hosted 收 $0.002/min **已推迟再评估**；公有仓仍免费 | https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/ | changelog 原文 2025-12-16，页面含后续 Update |
| 用量厂商声明 | 2025 公有仓 Actions **115 亿分钟**（约 $1.84 亿）；架构日处理 **7100 万 jobs** | https://github.com/resources/insights/2026-pricing-changes-for-github-actions | 页面 2026 抓取 |
| YAML | `.github/workflows/*.yml`；生态 `actions/checkout`、`actions/setup-node`、`gh release` | https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job | 2026-08-24 |

**相对自身的坑（给平替对照用）：** 私有仓 macOS 分钟单价约为 Linux 2-core 的 **10×**（$0.062 vs $0.006）；Windows 约 **1.7×**。Tauri 若在私有仓跑 macOS universal + Windows MSVC，2,000 分钟很快被 macOS 吃掉。

---

## 纳入项（有官方免费档或可零价起步的托管 CI）

下列每条结构相同：形态 / 免费硬限制 / OS / YAML / 相对 GHA 的坑 / 用量热度线索。

### 1. GitLab.com CI/CD

- **形态 / 许可证:** GitLab.com 多租户 SaaS。软件另有 Self-Managed（MIT/开源 CE），本条只评托管。https://about.gitlab.com/pricing/
- **免费档硬限制:**
  - Free：**400 compute minutes / 月**（GitLab.com namespace 配额默认开启）。https://docs.gitlab.com/ci/pipelines/compute_minutes/
  - Premium 文档与营销页写 **10,000 compute minutes / 月**。https://about.gitlab.com/pricing/premium/
  - Ultimate 定价页写 **50,000 compute minutes / 月**。https://about.gitlab.com/pricing/
  - 加购：定价页写 **$10 / 1,000 minutes**（一次性）。https://about.gitlab.com/pricing/
  - Open Source 计划：达标项目可拿 Ultimate + **50,000** compute minutes。https://docs.gitlab.com/17.6/subscriptions/gitlab_com/
  - 托管 job 超时 **3 小时**（与项目 timeout 无关）。https://docs.gitlab.com/ci/runners/hosted_runners/
  - 缓存：GCS 分布式缓存，14 天未更新删除，压缩后最大 **5 GB**。https://docs.gitlab.com/ci/runners/hosted_runners/
- **OS 矩阵与是否免费:**
  - Linux x86-64 / Arm：Free/Premium/Ultimate。默认 untagged → `small` Linux x86-64（2 vCPU / 8 GB）。`large` 及以上仅 Premium/Ultimate。https://docs.gitlab.com/ci/runners/hosted_runners/linux/
  - **Windows：Free 可用，但 beta**，tag `saas-windows-medium-amd64`，cost factor **1**。https://docs.gitlab.com/ci/runners/hosted_runners/windows/ ；倍率表 https://docs.gitlab.com/ci/pipelines/compute_minutes/
  - **macOS：仅 Premium/Ultimate + OSS 计划，beta**。`saas-macos-medium-m1` cost factor **6**；`saas-macos-large-m2pro` **12**。https://docs.gitlab.com/ci/runners/hosted_runners/macos/ ；https://docs.gitlab.com/ci/pipelines/compute_minutes/
- **YAML / 迁移:** `.gitlab-ci.yml`，与 GHA **不兼容**。需重写 jobs/tags/`image`/`artifacts`/`cache`。Windows 必须用 PowerShell，不能 `image:`。https://docs.gitlab.com/ci/yaml/ ；https://docs.gitlab.com/ci/runners/hosted_runners/windows/
- **相对 GHA 的坑（severity）:**
  - **blocker（RabbitInterview 私有仓免费档）:** Free **没有**托管 macOS。https://docs.gitlab.com/ci/runners/hosted_runners/macos/
  - **major:** 400 分钟且 macOS 若升级到付费仍 ×6/×12。https://docs.gitlab.com/ci/pipelines/compute_minutes/
  - **major:** Windows/macOS 均为 beta：Windows 平均开机约 5 分钟；macOS 排队、无头模式、无 UI 测试。https://docs.gitlab.com/ci/runners/hosted_runners/windows/ ；https://docs.gitlab.com/ci/runners/hosted_runners/macos/
  - **major:** 无 `actions/*` 市场；发布要用 GitLab Releases / `glab`，不是 `gh release`。
- **用量 / 热度线索:** Stack Overflow 2025「documentation and collaboration」使用率 GitLab **35.6%**（不是纯 CI 指标）。https://survey.stackoverflow.co/2025/technology ；GitLab 自称约 3000 万注册用户（旧博文，不当作用量）。https://about.gitlab.com/blog/ci-minutes-update-free-users/
- **证据日期:** 2026-08-24

### 2. Azure Pipelines（Azure DevOps Services）

- **形态:** Microsoft 托管 Azure DevOps；Pipelines 可单独用。https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/
- **免费档硬限制:**
  - 私有项目：启用免费档后 **1 个 Microsoft-hosted 并行作业**，每月 **1,800 分钟（30 小时）**，单 job **60 分钟**。https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
  - 付费：每额外 Microsoft-hosted 并行作业 **$40/月**，取消月度分钟上限，单 job 升到 **360 分钟**。https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/
  - 自托管并行作业：组织 **1 个免费、无限分钟**；额外 **$15/月**。同上。
  - 新组织须绑定 Azure 订阅才发放托管免费档。https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
  - **公有项目：** 文档写现有公有项目保留免费并行额度，**2027 转私有**；**不能再新建公有项目**。https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
  - Artifacts：**2 GiB** 免费。https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/
  - 用户：Basic 前 **5 用户免费**（$6/用户/月之后）；Pipelines 本身无按用户收费。同上。
- **OS 矩阵:** Microsoft-hosted 提供 Windows / Ubuntu / macOS，YAML `vmImage: windows-latest | ubuntu-latest | macOS-latest`。Windows/Linux：约 2 核 / 7 GB / 14 GB SSD；macOS：约 3 核 / 14 GB（Sequoia ARM64：3 核 / 7 GB）。**macOS agent 始终在美国运行**（数据驻留问题）。https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
  - 标准池分钟 **按 1:1 计**，无 GHA 那种 macOS 倍率（文档/计费模型是并行作业 + 月分钟，不按 OS 加价）。https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
  - 另有 GitHub-hosted agents 按分钟计费（Mac OS Standard/XL），**不走**并行作业免费池。https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/
- **YAML / 迁移:** `azure-pipelines.yml`。语法接近但 **不是** GHA；`pool.vmImage` 对应 `runs-on`。镜像与 GHA 同源 `actions/runner-images`。https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
- **相对 GHA 的坑:**
  - **blocker（长构建）:** 免费档单 job **60 分钟**。Tauri macOS universal + 签名/公证很容易超时。https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops
  - **major:** 并发=1，矩阵（mac+win+linux）串行。
  - **major:** 新 org 默认可能是 0 托管并行，需开通计费。同上。
  - **major:** macOS 数据在美国。https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops
  - **minor:** 无 `actions/checkout` 市场；用 `checkout` 任务 + 微软任务。
- **用量 / 热度:** SO 2025 Azure DevOps **16.6%**（协作工具，非纯 CI）。https://survey.stackoverflow.co/2025/technology
- **证据日期:** 2026-08-24

### 3. CircleCI

- **形态:** 托管 SaaS，credits 计费。https://circleci.com/pricing/
- **免费档硬限制:**
  - Free：**30,000 credits/月**，**最多 5 活跃用户**，网络 1 GB，存储 2 GB；credits **不滚存**。https://circleci.com/pricing/
  - 并发：Docker/Linux/Arm/Windows **30**；macOS VM **1**；self-hosted runner 任务 **5**。https://circleci.com/pricing/
  - Docker Medium = 10 credits/min → 30,000 credits ≈ **3,000 分钟**；Docker Small = 5 credits/min → ≈ **6,000 分钟**。价目表：https://circleci.com/pricing/price-list/ （Last updated: July 21, 2026）
  - Windows VM Medium = **40 credits/min** → 30k ≈ **750 分钟**。macOS M4 Pro Medium = **200 credits/min** → 30k ≈ **150 分钟**（若该 SKU 可用）。https://circleci.com/pricing/price-list/
  - OSS（公开仓库）：定价页写 Linux/Arm/Docker **400,000 credits/月**；Windows/macOS 或私有仓用 Free 的 30,000。https://circleci.com/pricing/ ；营销页写 OSS **400,000** Linux/Arm/Docker + **30,000** macOS/Windows。https://circleci.com/open-source/ ；Support 另写 OSS Linux 400,000（文中换算 40,000 分钟）+ macOS **25,000 credits**（文中换算 500 分钟）——**两处官方数字不一致，排序时勿混用**。https://support.circleci.com/hc/en-us/articles/360049861131-When-will-free-or-open-source-credits-renew
  - 用尽 credits 后 Free 作业失败。https://circleci.com/docs/guides/plans-pricing/credits/
- **OS 矩阵:** 定价页 Free 列出 Docker、Windows、Linux、Arm、macOS、self-hosted。https://circleci.com/pricing/
  - **冲突点（须标）：** 同一对比表里当前 **macOS VM「M4 Pro Medium/Large」在 Free 列为「—」**（仅 Performance/Scale）。https://circleci.com/pricing/  Support（2026-05-14）仍写 Free 支持 Linux/Windows/macOS。https://support.circleci.com/hc/en-us/articles/27365890679195-Which-CircleCI-Resources-are-made-Available-to-Users-on-the-Free-Plan
- **YAML / 迁移:** `.circleci/config.yml`（orbs、executor、resource_class）。与 GHA **不兼容**。
- **相对 GHA 的坑:**
  - **major:** 私有仓 30k credits；Windows/macOS 很贵。https://circleci.com/pricing/price-list/
  - **major:** 当前价目 macOS SKU 可能不在 Free；迁移前必须在账号里验证 executor。https://circleci.com/pricing/
  - **minor:** 无 GHA action 生态；secrets 是 CircleCI project/org env。
- **用量 / 热度:** 厂商宣称 OSS **3,698,553 monthly open source builds**（无独立审计）。https://circleci.com/open-source/
- **证据日期:** 2026-08-24；价目表标注 2026-07-21

### 4. Bitbucket Pipelines

- **形态:** Bitbucket Cloud 附带的 CI。https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/
- **免费档硬限制:**
  - Free：≤5 用户，**50 build minutes/月**，LFS **1 GB**，每 pipeline 最多 **100 steps**，并发 steps **最多 10**。无 overage protection（除非绑卡买加量）。https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/
  - Standard：**2,500 min**，$3.65/用户/月（1–5 用户一口价 $18.25）；Premium：**3,500 min**，$7.25/用户。加量 **$10 / 1,000 min**。同上。
  - 仓库软限制 2 GB / 硬限制 4 GB。同上。
  - 一次 push 超过 5 个 tag/branch 不触发 pipeline。https://support.atlassian.com/bitbucket-cloud/docs/limitations-of-bitbucket-pipelines/
- **OS 矩阵:**
  - **Cloud runner = Linux Docker only**（Atlassian 基础设施）。step size 1x–4x（4–32 GB），消耗按 size 乘分钟。https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-runners-comparison/
  - Windows / macOS / Linux Shell = **self-hosted**，不扣 build minutes。https://support.atlassian.com/bitbucket-cloud/docs/runners/
- **YAML:** `bitbucket-pipelines.yml`。与 GHA 不兼容。
- **相对 GHA 的坑:**
  - **blocker（免费托管 Win/mac）:** 托管云**没有** Windows/macOS。https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-runners-comparison/
  - **blocker（用量）:** 50 分钟对 Tauri 矩阵几乎不可用。https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/
  - **major:** 必须把代码放到 Bitbucket（或再用 mirror）；GHA 生态丢失。
- **用量 / 热度:** 无一手消耗分钟公开数。热度主要来自 Atlassian 套件绑定。
- **证据日期:** 2026-08-24；runners comparison 页更新标注 2025-09-26

### 5. SourceHut builds.sr.ht

- **形态:** 托管 forge + CI；软件 AGPL/MIT 可自建。https://sourcehut.org/pricing ；https://man.sr.ht/builds.sr.ht/
- **「免费」边界:**
  - 付费档 €4 / €8 / €12（或 $4/$8/$12），**功能无差**，按支付能力自选。https://sourcehut.org/pricing
  - **alpha 期间：builds.sr.ht 与 chat.sr.ht 需要付费**；git/todo 等可选用。只贡献别人的项目可免付费。https://sourcehut.org/pricing
  - 经济困难可邮件申请免费服务。https://man.sr.ht/billing-faq.md
  - **结论:** 托管 CI **不是**「注册即免」；零价路径是经济援助或自建。
- **OS 矩阵:** 兼容矩阵为 Alpine/Arch/Debian/Fedora/Ubuntu/Rocky、FreeBSD/NetBSD/OpenBSD、Guix、NixOS 等 **Linux/BSD**。**未列出 Windows 或 macOS 托管镜像。** https://man.sr.ht/builds.sr.ht/compatibility.md
- **YAML:** 无状态 build manifest（YAML），通常 `.build.yml`。与 GHA 不兼容。https://man.sr.ht/builds.sr.ht/
- **坑:**
  - **blocker:** 无托管 macOS/Windows。https://man.sr.ht/builds.sr.ht/compatibility.md
  - **major:** 付费才能提交 builds；secrets 在 public/unlisted 日志泄漏视为永久泄露。https://man.sr.ht/builds.sr.ht/
- **用量 / 热度:** 无公开分钟数。社区热度在 HN / 邮件列表，量化交给 T4。
- **证据日期:** 2026-08-24

### 6. AppVeyor（开源免费档）

- **形态:** 托管 CI（Windows 起家，现 Linux/macOS）。另有可下载的 AppVeyor Server（自建，不在本条展开）。https://www.appveyor.com/pricing/
- **免费档硬限制:**
  - **Open-source: FREE** — 无限**公有**项目，**1 concurrent job**，**5 self-hosted jobs**，社区支持。https://www.appveyor.com/pricing/
  - Basic $29/月（1 私有项目）；Pro $59/月（无限私有）。同上。
  - 所有计划单 job **最长 60 分钟**。https://www.appveyor.com/pricing/ FAQ；https://www.appveyor.com/docs/build-configuration/
  - 额外并发 $50/月（FOSS $25）。https://www.appveyor.com/pricing/
- **OS 矩阵:** 文档标准镜像含 VS 2013–2022、Ubuntu 16.04/18.04/20.04、`macos`（文档仍写 10.15 Catalina）等。https://www.appveyor.com/docs/build-environment/  软件页另列 macos-sonoma / ventura / monterey。https://www.appveyor.com/docs/macos-images-software/
  - 托管 VM：Hyper-V 2 核 6 GB 或 4 核 7 GB；GCE 2 核 7.5 GB。https://www.appveyor.com/docs/build-environment/
- **YAML:** `appveyor.yml` 或 UI；与 GHA 不兼容。可接 GitHub/Bitbucket/GitLab/Azure DevOps。https://www.appveyor.com/docs/
- **相对 GHA 的坑:**
  - **blocker（私有仓）:** 开源免费档只覆盖 **public**。https://www.appveyor.com/pricing/
  - **major:** 1 并发 + 60 分钟 job。Tauri 三平台要排队；长 macOS 构建可能超时。
  - **major:** macOS/Linux 镜像文档版本偏旧，迁移前要核对当前 image 名与 Xcode。https://www.appveyor.com/docs/macos-images-software/
- **用量 / 热度:** 无公开分钟。历史上 Windows OSS 常用，近年讨论量低于 GHA/GitLab（T4 再定量）。
- **证据日期:** 2026-08-24

### 7. Harness CI Cloud（Free）

- **形态:** Harness 模块化 DevOps SaaS；CI 可用 Harness Cloud 或自建 runner。https://developer.harness.io/docs/continuous-integration/use-ci/set-up-build-infrastructure/use-harness-cloud-build-infrastructure/
- **免费档硬限制:**
  - Free：**每月 2,000 Harness Cloud credits**，月末作废不滚存。https://developer.harness.io/docs/continuous-integration/get-started/ci-subscription-mgmt （文档 Last updated **2026-07-20**）
  - 倍率（文档写 as of December 2025）：Linux medium 8-core **×2**；Windows small 4-core **×6**；macOS small 6-core **×60**。例：1,000 Linux min = 2,000 credits；1,000 Windows = 6,000；1,000 macOS = 60,000。同上。
  - 换算（勿当官方「分钟包」）：2,000 credits ≈ **1,000 Linux medium 分钟**，或 ≈ **333 Windows small 分钟**，或 ≈ **33 macOS small 分钟**。
  - 并发：Free Linux **20**、Windows **1**、macOS **1**。存储（CI Intelligence 缓存）Free **2 GB**；网络传输 Free **1 GB**。同上。
  - **Free 用 Harness Cloud 需要信用卡验证**；不想绑卡只能 local runner。https://developer.harness.io/docs/continuous-integration/use-ci/set-up-build-infrastructure/use-harness-cloud-build-infrastructure/
- **OS:** Linux / Windows / macOS 托管 VM。同上。
- **YAML:** Harness pipeline YAML（`runtime.type: Cloud`），与 GHA 不兼容。
- **坑:**
  - **blocker（免费 macOS 预算）:** ×60 意味着一个月大约 **半小时级** macOS。https://developer.harness.io/docs/continuous-integration/get-started/ci-subscription-mgmt
  - **major:** 必须绑卡；connector 必须走 Harness Platform 而非 delegate。https://developer.harness.io/docs/continuous-integration/use-ci/set-up-build-infrastructure/use-harness-cloud-build-infrastructure/
  - **minor:** macOS `.netrc` 权限已知问题。同上 Known issues。
- **用量 / 热度:** 无公开分钟。企业 GitOps/CD 品牌强于「免费 CI 平替」。
- **证据日期:** 订阅文档 2026-07-20；Cloud 基础设施文档 Last updated **2026-08-19**

### 8. Cloudflare Workers Builds（有限纳入）

- **形态:** Cloudflare **Workers 的集成 CI/CD**，连 GitHub/GitLab 后每次 push 构建并部署 Worker。官方定位是 Workers 构建/部署，不是通用测试矩阵。https://developers.cloudflare.com/workers/ci-cd/ ；https://blog.cloudflare.com/workers-builds-integrated-ci-cd-built-on-the-workers-platform/
- **免费档:** Build minutes **3,000/月**；并发 **1**；超时 **20 分钟**；2 vCPU / 8 GB / 20 GB disk。付费：6,000 分钟后 **$0.005/min**，并发 6，4 vCPU。https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- **OS:** 未提供 Windows/macOS 选择；构建环境是 Linux 容器式 Workers 构建机。
- **YAML:** 控制台/Git 集成，不是 GHA workflow。
- **坑:**
  - **blocker（通用 CI）:** 20 分钟超时 + 无 Win/macOS + 产出是 Worker 部署，不能签 Tauri `.dmg/.msi`。https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- **证据日期:** 2026-08-24

### 9. Semaphore Cloud（额外纳入：有官方每月免费 credits）

原候选表未列，但官方有持续免费额度，故记一笔。

- **形态:** 托管 Semaphore Cloud；另有 Apache-2.0 Community Edition 自建（属 T3）。https://semaphore.io/pricing
- **免费额度:** **$15 credits / 月** ≈ **2,000 Ubuntu x64 2-vCPU 分钟**。默认并发 20。产物：20 GB egress + 100 GB storage 免费。https://semaphore.io/pricing
- **OS 单价:** Ubuntu ARM $0.003/min（2 vCPU）；Ubuntu x64 $0.0075/min（2 vCPU）；**MacOS $0.09/min（4 vCPU）**；self-hosted $0.0025/min。https://semaphore.io/pricing
  - $15 ≈ **166 macOS 分钟**（$15 / $0.09），官方未单独写 macOS 免费包。
- **YAML:** Semaphore YAML，与 GHA 不兼容。
- **坑:** macOS 单价高；免费 $15 对 Tauri 三平台不够。厂商自比「最快最便宜」属营销，不当作用量。https://semaphore.io/pricing
- **证据日期:** 2026-08-24

### 10. Buildkite（混合：免费托管 Linux 分钟 + 自建 agent）

原计划把 Buildkite 放在「整平台」举例里。官方 **Free Plan** 存在，但产品默认是 **自建 agent**；托管 agents 是加购/限额。

- **Free Plan:** $0；最多 **5 用户**；最多 **10 concurrent jobs**；最多 **2,000 Linux vCPU minutes/月**；25 万 test executions；社区支持。30 天 all-access trial。https://buildkite.com/pricing/
- **Pro:** $30/活跃用户/月；含 4,000 Linux vCPU min，并写明 **access to macOS agents**、更大机型。https://buildkite.com/pricing/
- **YAML:** Buildkite pipeline YAML（可动态生成），与 GHA 不兼容。
- **坑:**
  - **major:** Free 托管额度是 **Linux vCPU minutes**；macOS 在 Pro 文案中才明确。https://buildkite.com/pricing/
  - **major:** 要换控制面，不是 GHA 兼容。
- **OSS:** 「special pricing」，需联系销售，不是自助免费无限。https://buildkite.com/pricing/ FAQ
- **证据日期:** 2026-08-24

### 11. Buddy（额外纳入：有 Free 档）

- **Free:** 文档：基础功能（无 2FA、无 Sandboxes）；**60 天无登录则冻结**，再 30 天销毁；pipeline 定时跑**不算**活跃。https://buddy.works/docs/basics/billing-and-usage/features
- 定价页抓取不完整（大量 “Start a free trial”）。第三方与对比页常写 1 seat / 1 concurrent / **300 pipeline GB-minutes** / 1 GB cache——**本次未能从 buddy.works/pricing 正文稳定读出这些数字，标未核实**。https://buddy.works/pricing
- **OS:** 托管 Linux 构建为主；Windows/macOS 需自建 runner（官方定价页本次未展开，迁移前再核）。
- **证据日期:** 2026-08-24

---

## 部署构建系统（官方不是通用 CI）

按任务书：仅当构建系统能当**通用 CI** 才纳入。下列官方定位是 **Git push → 构建前端/应用并部署**，没有一等 Windows/macOS 测试矩阵、没有通用 artifact/release 工作流。

| 产品 | 免费相关硬限制 | 为何不算通用 CI | URL |
|---|---|---|---|
| **Vercel Builds** | 每次部署自动 build；隔离 Linux 构建环境；框架预设 | 「把源码变成可服务资产」，不是跑 Win/mac 测试/签名 | https://vercel.com/docs/builds |
| **Netlify** | Free **300 credits/月**；并发构建 **1**；生产部署 15 credits/次 | Web 部署平台 | https://www.netlify.com/pricing/ |
| **Render Build Pipeline** | Hobby **500 pipeline minutes**（Starter 2 CPU/8 GB）；构建超时 120 min；磁盘 16 GB；每服务同时仅 1 个 build | 服务部署前的 build/pre-deploy，不是多 OS CI | https://render.com/docs/build-pipeline |
| **Cloudflare Workers Builds** | 见上节 | 只服务 Workers 部署 | https://developers.cloudflare.com/workers/ci-cd/ |

---

## 非免费 / 无稳定自助免费档（附录）

| 产品 | 结论 | 证据 |
|---|---|---|
| **Travis CI** | 文档：**Free Trial Plans are currently unavailable**。试用曾为 10k credits（约 1k Linux 分钟）且不续。OSS credits **必须邮件申请**，非自助。公开定价 Usage Based **$15/月**（35,000 Linux credits）起。 | https://docs.travis-ci.com/user/billing-overview/ ；https://docs.travis-ci.com/user/billing-faq/ ；https://www.travis-ci.com/pricing/ |
| **TeamCity Cloud** | JetBrains 明确：**currently do not offer a free tier in TeamCity Cloud**（On-Prem 有免费 Professional License，属 T3）。14 天试用。 | https://teamcity-support.jetbrains.com/hc/en-us/articles/360021064900-Is-there-a-free-plan-for-TeamCity-Cloud |
| **Codefresh** | `codefresh.io/docs/.../pricing-plans/` **HTTP 403**。GitHub Marketplace 显示维护中。Octopus：**GitOps Cloud 已下线**；「Codefresh CI remains available」但无公开免费档数字。第三方「120 builds/月」**不采用**。 | https://octopus.com/codefresh ；https://github.com/marketplace/codefresh |
| **GitLab macOS 托管** | 对 Free 用户等于付费功能 | https://docs.gitlab.com/ci/runners/hosted_runners/macos/ |

---

## 对 RabbitInterview（Tauri macOS + Windows + Linux）的免费可达性

| 平台 | 免费托管 Linux | 免费托管 Windows | 免费托管 macOS | 不加钱跑三平台？ | 严重度 |
|---|---|---|---|---|---|
| GitHub Actions 公有仓 | 是 | 是 | 是 | **是（标准 runner）** | 基线 |
| GitHub Actions 私有 Free | 是（扣 2000 分） | 是（更贵） | 是（约 10×） | 勉强，macOS 会先爆 | major 成本 |
| GitLab.com Free | 是 | 是（beta） | **否** | **否** | **blocker** |
| Azure Pipelines Free | 是 | 是 | 是 | 理论可以，**60 min/job + 1 并发** | **blocker/major** |
| CircleCI Free | 是 | 是 | **SKU 存疑** | 不建议当作已核实 | major |
| Bitbucket Free | 是（50 min） | **否（自建）** | **否（自建）** | **否** | **blocker** |
| SourceHut 付费/援助 | Linux/BSD | **否** | **否** | **否** | **blocker** |
| AppVeyor OSS | 是（公有） | 是（公有） | 是（公有） | 仅公有 + 60 min + 1 并发 | major |
| Harness Free | 是 | 是（×6，并发 1） | 是（×60，≈33 min） | macOS 预算几乎不够 | **blocker**（实用） |
| Semaphore $15 | 是 | 未在定价首页单列 | 按 $0.09/min 很贵 | 不够 | major |
| Buildkite Free | 有限 Linux vCPU | 未在 Free 写明 | Free 未写明 | 不像完整三平台托管 | major |
| Cloudflare / Vercel / Netlify / Render | Linux 构建 | 否 | 否 | **否** | **blocker** |

**推断（非单一排名，供 T5）：** 若仓库可公开，GHA 仍是最完整免费三平台。若必须离开 GHA 且保持免费托管 Win+mac：只剩 **Azure Pipelines**（超时风险）和 **AppVeyor 公有仓**。私有仓还要完整三平台，几乎都要付钱或自建 runner（那是 T2/T3）。

---

## YAML / 迁移成本总表

| 从 GHA 迁到 | 配置文件 | GHA YAML 兼容 | `actions/checkout` / `setup-node` | `gh release` |
|---|---|---|---|---|
| GitLab | `.gitlab-ci.yml` | 无 | 无，用 `git` + 官方 `image` | 无，GitLab Releases |
| Azure | `azure-pipelines.yml` | 无（概念相近；镜像同源） | 无，内置 checkout / UseNode | 无 |
| CircleCI | `.circleci/config.yml` | 无 | orb 近似物 | 无 |
| Bitbucket | `bitbucket-pipelines.yml` | 无 | 无 | 无 |
| SourceHut | build manifest | 无 | 无 | 无 |
| AppVeyor | `appveyor.yml` | 无 | 无 | 无 |
| Harness | Harness pipeline YAML | 无 | 无 | 无 |
| Semaphore | Semaphore YAML | 无 | 无 | 无 |
| Buildkite | pipelines YAML | 无 | 无 | 无 |

没有任何纳入的托管平台声称 **即插即用 GHA YAML**（那是 T2 runner 平替的范畴）。

---

## Findings（带路径与严重度）

1. **baseline — GitHub Actions 私有仓 Free 2,000 分钟 / 公有仓标准 runner 无限** — 产物 500 MB、缓存 10 GB/仓库；macOS $0.062/min。 [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) [runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
2. **blocker — GitLab.com Free 无托管 macOS** — macOS runner 文档明确 Tier: Premium, Ultimate，且仍为 beta；Windows 虽 Free 但 beta。 [macOS hosted runners](https://docs.gitlab.com/ci/runners/hosted_runners/macos/) [Windows](https://docs.gitlab.com/ci/runners/hosted_runners/windows/)
3. **major — GitLab Free 仅 400 compute minutes** — macOS 若付费仍 ×6/×12。 [compute minutes](https://docs.gitlab.com/ci/pipelines/compute_minutes/)
4. **blocker/major — Azure 免费档 60 分钟/job、1 并发、1,800 分钟/月** — 三 OS 都有，但 Tauri 长构建和高矩阵不适合。 [concurrent jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops)
5. **major — Azure 公有项目路径在关闭** — 不能新建 public；现有 public 2027 转私有。同上。
6. **major — CircleCI Free 30,000 credits；当前 macOS M4 Pro SKU 在 Free 对比表为不可用** — OSS 400k Linux credits 是厂商数字。 [pricing](https://circleci.com/pricing/) [price list](https://circleci.com/pricing/price-list/)
7. **blocker — Bitbucket Cloud 托管只有 Linux Docker，免费 50 分钟** — Win/mac 仅 self-hosted。 [plan billing](https://support.atlassian.com/bitbucket-cloud/docs/manage-your-plan-and-billing/) [runners comparison](https://support.atlassian.com/bitbucket-cloud/kb/bitbucket-runners-comparison/)
8. **blocker — SourceHut 托管 CI 要付费且无 Win/mac 镜像** — [pricing](https://sourcehut.org/pricing) [compatibility](https://man.sr.ht/builds.sr.ht/compatibility.md)
9. **major — AppVeyor 免费仅公有仓、1 并发、60 分钟** — 有 Win/Linux/macOS 镜像。 [pricing](https://www.appveyor.com/pricing/)
10. **blocker（实用）— Harness Free 2,000 credits，macOS ×60 ≈ 33 分钟** — 且要信用卡。 [subscription](https://developer.harness.io/docs/continuous-integration/get-started/ci-subscription-mgmt)
11. **blocker — Cloudflare/Vercel/Netlify/Render 不是通用多 OS CI** — 见部署表。
12. **major — Travis 无可用自助免费档** — Trial unavailable；OSS 需工单。 [billing overview](https://docs.travis-ci.com/user/billing-overview/)
13. **info — 2025 公有仓 GHA 115 亿分钟、日 7100 万 jobs** — 厂商声明，T4 作热度上限。 [pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
14. **info — SO 2025 协作工具：GitHub 81.1% / GitLab 35.6% / Azure DevOps 16.6%** — 非 CI 专项题。 [survey](https://survey.stackoverflow.co/2025/technology)

---

## Sources

### Kept
- GitHub Actions billing (https://docs.github.com/en/billing/concepts/product-billing/github-actions) — 基线分钟/存储
- Actions runner pricing (https://docs.github.com/en/billing/reference/actions-runner-pricing) — 2026 单价
- Choosing the runner (https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job) — OS 矩阵
- Actions limits (https://docs.github.com/en/actions/reference/limits) — 并发
- GitHub changelog pricing (https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/) — 2026 政策
- GitHub Executive Insights (https://github.com/resources/insights/2026-pricing-changes-for-github-actions) — 115 亿分钟
- GitLab compute minutes (https://docs.gitlab.com/ci/pipelines/compute_minutes/) — 400 分钟与倍率
- GitLab hosted runners (https://docs.gitlab.com/ci/runners/hosted_runners/) 及 linux/windows/macos 子页
- GitLab pricing (https://about.gitlab.com/pricing/) 与 Premium (https://about.gitlab.com/pricing/premium/)
- Azure concurrent jobs (https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs?view=azure-devops)
- Azure hosted agents (https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops)
- Azure DevOps pricing (https://azure.microsoft.com/en-us/pricing/details/devops/azure-devops-services/)
- CircleCI pricing / price-list / credits / open-source
- Bitbucket billing / limitations / runners comparison
- SourceHut pricing / billing FAQ / builds docs / compatibility
- AppVeyor pricing / build environment / macOS software
- Travis billing overview / FAQ / pricing
- Harness CI subscription + Cloud infra
- Cloudflare Workers Builds limits
- Semaphore pricing
- Buildkite pricing
- Buddy plans docs
- Vercel Builds / Netlify pricing / Render build pipeline
- Octopus Codefresh 过渡说明 (https://octopus.com/codefresh)
- SO 2025 technology (https://survey.stackoverflow.co/2025/technology)

### Dropped
- starsling.dev / cicdcost.com / stackfreeks / agentdeals / toolradar / eesel.ai — 二手汇总，数字不作为权威
- GitLab feature-comparison 抓取落到 Self-Managed 短页，未当作 GitLab.com 完整对照
- `app.travis-ci.com/plans` — JS 渲染失败
- `codefresh.io` 定价/文档 403
- `docs.gitlab.com/subscriptions/gitlab_com/` 当前 403；改用 17.6 快照 https://docs.gitlab.com/17.6/subscriptions/gitlab_com/
- CircleCI 与 OSS 分钟换算在 Support 与营销页不一致的部分，不合成单一数字
- PDF：本次未遇到必须引用的 PDF。GitLab hosted runners 安全白皮书是 Google PDF，按任务书 **不解析**；仅在 GitLab 文档中作为外链存在，不引用其页内数字。

---

## Gaps

1. **CircleCI Free 是否仍能跑 macOS：** 定价对比表与 Support 文冲突；需要登录后看可用 resource class（本任务无账号）。
2. **GitLab.com Free 存储配额：** 定价页抓取不完整；Premium 页写 500 GiB 属付费档。Free 存储常见「10 GiB」出现在订阅文档其它版本，本次未在 2026 主定价页稳定读到，**不写入硬表**。
3. **Codefresh 免费档数字：** 官方页 403，不采用第三方 120 builds/月。
4. **Buddy 300 GB-minutes：** 定价页抓取失败，仅文档确认有 Free + 不活跃销毁。
5. **AppVeyor 当前 macOS/Xcode：** 软件页到 Sonoma/Xcode 15，是否还有更新镜像未在定价页声明。
6. **用量横向比较：** 除 GHA 厂商自报分钟与 CircleCI OSS 自报 builds 外，没有可比较的公开消耗。完整排序交给 T4。
7. **Azure 公有仓 10 并行「无限分钟」：** 旧文常见，2026 文档强调 public retirement；未把「无限公有分钟」当现行可新开能力。

建议 T5：按「免费三平台托管」过滤后只深比 Azure vs AppVeyor OSS vs（核实后的）CircleCI；GitLab/Bitbucket 放到「要自建 runner 才有 macOS」桶。
