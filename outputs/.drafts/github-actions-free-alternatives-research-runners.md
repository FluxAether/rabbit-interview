# T2 研究笔记：GitHub Actions runner 平替

- **范围：** 工作流仍跑 GitHub Actions YAML，只换 runner / 执行面。
- **「免费」：** 有可用免费档，或软件可免费自建。纯付费托管进附录。
- **检索日期：** 2026-08-24。未解析 PDF。数字只写官方页能核对的值；抓取失败处标为缺口。
- **对 RabbitInterview（Tauri：macOS universal + Windows MSVC + Linux）的含义：** 不加钱同时覆盖 macOS + Windows，官方 GitHub-hosted 公有仓仍最宽；私有仓几乎必须自建或接受厂商试用额度。多数 Linux 平替对 Windows 工具链（完整 VS / MSVC）和 macOS/Xcode 不完整。

---

## Summary

仍跑 GHA YAML 的平替分三类：① GitHub 官方 hosted / self-hosted / ARC；② 改 `runs-on` 的托管 runner SaaS（Blacksmith、Depot、Namespace、WarpBuild、BuildJet、Ubicloud）；③ 在自己云账里接 job 的控制面（RunsOn、AWS CodeBuild GitHub Actions runner）。Google Cloud Build **没有** 官方 GHA runner 产品，只有 Cloud Run / GKE 上自建 runner 教程。

`actions/checkout`、`actions/setup-node`、artifact、`gh release` 在「官方 runner 应用 + 能访问 GitHub API」时通常可用；坑集中在：镜像不是 GitHub `runner-images`、容器 job 需要 Docker/DinD、Windows 缺完整 Visual Studio、macOS 无 Docker / 并发受限、厂商要求 GitHub **Organization** 而非个人仓。

---

## 对照基线：GitHub-hosted

| 项 | 内容 | 证据 |
|---|---|---|
| 是否 drop-in | 是（默认） | [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| 免费档 | 公有仓：标准 runner **无限免费**。私有仓按计划：Free 2,000 min + 500 MB artifact；Pro/Team 3,000 min；Enterprise Cloud 50,000 min。Cache 每仓 10 GB。 | [GitHub Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) |
| OS | Linux x64/arm64、Windows x64/arm64、macOS Intel + Apple Silicon（含 `macos-26` / `xcode-27` preview） | [hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) |
| 私有仓默认规格 | Linux/Windows 2 vCPU / 8 GB；公有仓 Linux/Windows 4 vCPU / 16 GB | 同上 |
| 超额单价（2026-01-01 后文档表） | Linux 2-core x64 **$0.006**/min；Windows 2-core **$0.010**/min；macOS 3/4-core **$0.062**/min。Larger runners **不吃** included minutes，公有仓也不免费。 | [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing) |
| 并发 | Free：20 job / 5 macOS；Pro 40/5；Team 60/5；Enterprise 500/50 | [Actions limits](https://docs.github.com/en/actions/reference/limits)（WarpBuild 对照页 2026-08-13 复核同一表：[compare](https://www.warpbuild.com/compare/github-actions)） |

**兼容：** checkout / setup-node / artifact / `gh` 均为一等公民。artifact 与 Packages **共用** 计划存储配额；cache 单独 10 GB/仓。

**2025–2026 定价动态：** GitHub 2025-12-16 宣布 hosted 降价最多 39%（2026-01-01），并对私有仓 self-hosted 拟收 **$0.002/min** 控制面费（原定 2026-03-01）。随后官方 changelog **推迟** self-hosted 收费，hosted 降价继续。公有仓 self-hosted 仍免费；GHES 不受影响。见 [Update to GitHub Actions pricing](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)。当前计费页仍写 self-hosted **免费**（只付机器成本）：[billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)。

---

## 纳入项（按「仍跑 YAML」）

### 1. GitHub 官方 self-hosted runner

| 项 | 内容 |
|---|---|
| Drop-in | **部分。** YAML 几乎不变，但 `runs-on` 必须改成自建标签；镜像/工具链自己管。 |
| 免费档 / 自建成本 | GitHub 编排目前免费（控制面费已推迟）。机器、电、云账单自付。 |
| OS | Linux（RHEL/CentOS/Debian/Ubuntu 等）、Windows 10/11/Server 2016–2022、macOS 11+；arch：x64、ARM64（Windows ARM64 为 public preview）、Linux ARM32。[self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) |
| 兼容坑 | Docker **容器 action / service container 只支持 Linux + 已装 Docker**。默认**不**每 job 干净机。Job 排队超 24h 失败。建议 ephemeral（`--ephemeral`）。关闭自动更新后须在新版本 30 天内升级，否则停派 job。 |
| checkout / setup-node / artifact / gh | 官方 runner 应用即可用 JS action。`setup-node` 从 GitHub 拉 Node，需出网。`gh release` 需本机有 `gh` 或自行安装。Artifact 仍存 GitHub，吃账户存储配额。 |
| 用量/热度 | 官方能力，无独立「用户数」。定价争议 2025-12 起热度高：[changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)、[community discussion](https://github.com/orgs/community/discussions/182186)。 |
| 证据日期 | 文档抓取 2026-08-24。[Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) |

### 2. Actions Runner Controller (ARC)

| 项 | 内容 |
|---|---|
| Drop-in | **部分。** `runs-on: <Helm INSTALLATION_NAME>`。[Get started](https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/get-started) |
| 免费档 / 自建成本 | 软件 Apache-2.0，免费。成本 = Kubernetes 集群 + 镜像维护。 |
| OS | 默认 **Linux 容器**。官方 runner 镜像是 **最小集**（`ghcr.io/actions/actions-runner`），不是完整 `runner-images`。GitHub 明确可用 `actions/setup-node` 等 setup action 补工具。[ARC 概念](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller) |
| 兼容坑 | **容器 job / 容器 action 必须** `containerMode: dind` 或 `kubernetes`；DinD 要 privileged。[Deploy runner scale sets](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/deploy-runner-scale-sets)。macOS/Windows 不是 ARC 默认路径；changelog 称未来 12 个月才会加强 Windows 等（[定价博文](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)）。legacy `actions.summerwind.net` 与现行 scale set 是两套。 |
| checkout / setup-node / artifact / gh | checkout/setup-node 可用（最小镜像正是为 setup-* 设计）。Artifact 走 GitHub API。容器内 git 认证需较新 runner（checkout 仓库说明 Docker container action 要 runner ≥ v2.329.0：[actions/checkout](https://github.com/actions/checkout)）。`gh` 默认镜像可能未预装。 |
| 用量/热度 | [actions/actions-runner-controller](https://github.com/actions/actions-runner-controller)：检索时约 **6446 stars / 1467 forks**（第三方搜索摘要，需打开仓库复核）。GitHub 将其标为 scale set API 的参考实现。 |
| 证据日期 | 2026-08-24 |

### 3. Blacksmith

| 项 | 内容 |
|---|---|
| Drop-in | **接近。** 改 `runs-on`：`ubuntu-latest` → `blacksmith-2vcpu-ubuntu-2404`；`windows-latest` → `blacksmith-2vcpu-windows-2025`；`macos-latest` → `blacksmith-6vcpu-macos-latest`。[Quickstart](https://docs.blacksmith.sh/introduction/quickstart) |
| 免费档 | 营销页写 **3,000 free minutes / 无需信用卡**：[github-action-runners](https://www.blacksmith.sh/github-action-runners)。搜索引擎对 docs FAQ 的摘录为「3000 x64 2vCPU minutes / org / month」。**定价页 `blacksmith.sh/pricing` 本次抓取几乎全是客户引言，表格数字未能从 HTML 抽出**——超额单价以实例文档「约为 GitHub 一半」为定性，不以未核表当作精确价。 |
| OS | Linux Ubuntu 22.04/24.04 x64+ARM；Windows Server 2025 **Public Beta**；macOS 15/26 Apple Silicon M4（6/12 vCPU，文档写 macOS 6 vCPU **$0.08/min**、12 vCPU **$0.16/min**）。[Instance Types](https://docs.blacksmith.sh/blacksmith-runners/overview) |
| 限制 | **仅 GitHub Organization，个人仓不可用。** [Quickstart](https://docs.blacksmith.sh/introduction/quickstart) |
| 兼容坑 | 声称与 GitHub runner image 相同。Windows：**无完整 Visual Studio IDE，只有 VS Build Tools 2022**；无 WinAppDriver / Cosmos emulator；**Windows 上不能跑 Linux Docker 容器**（嵌套虚拟化）。这对 Tauri Windows MSVC 可能够用（Build Tools），但不能假设与 `windows-latest` 完全一致。 |
| checkout / setup-node / artifact / gh | 官方称 drop-in；artifact 仍在 GitHub。Cache 走 Blacksmith 共置缓存（文档称官方 cache action 透明加速）。 |
| 用量/热度 | 客户 logo（Clerk、Mintlify 等）在定价页；无独立分钟消耗公开。 |
| 证据日期 | 2026-08-24 |

### 4. Depot

| 项 | 内容 |
|---|---|
| Drop-in | **接近。** `runs-on: depot-ubuntu-24.04` 等。[产品页](https://depot.dev/products/github-actions)、[runner types](https://depot.dev/docs/github-actions/runner-types) |
| 免费档 | **无长期免费档。** 7 天试用、无需信用卡。[产品页](https://depot.dev/products/github-actions)。付费：Developer **$20/月**含 2,000 GHA minutes；Startup **$200** 含 20,000；超额 Linux 2 vCPU **$0.004/min**；Windows 2 vCPU **$0.008/min**；macOS **$0.08/min**。[Pricing](https://depot.dev/pricing) |
| OS | Linux Intel/ARM Ubuntu 22.04/24.04（至 64 vCPU）；Windows Server 2022/2025；macOS 14/15 M2 与 macOS 26 M4。**仓库必须属于 GitHub Organization。** [overview](https://depot.dev/docs/github-actions/overview) |
| 兼容坑 | 尽量同步 `actions/runner-images`，可能滞后一两周。Windows：**无 Hyper-V，Docker 等依赖嵌套虚拟化的负载「unlikely to work」**。[runner types](https://depot.dev/docs/github-actions/runner-types)。macOS 因 Apple 许可 **非完全弹性，高峰可能排队**。 |
| checkout / setup-node / artifact / gh | 官方称零配置加速 GitHub cache；artifact/`gh` 仍走 GitHub。 |
| 用量/热度 | 客户案例 PostHog、Jane、grpc/kafka 加速数字见产品页（厂商自述，非独立审计）。 |
| 证据日期 | 2026-08-24 |

### 5. Namespace

| 项 | 内容 |
|---|---|
| Drop-in | **接近，但标签体系自有。** `nscloud-{os}-{arch}-{shape}`，**`runs-on` 里只能有一个 `nscloud` 标签**，否则不调度。[Runner configuration](https://namespace.so/docs/reference/github-actions/runner-configuration) |
| 免费档 | **30 天试用** Compute / GitHub Runners 等。[Pricing](https://namespace.so/pricing)。之后 Developer 为 pay-as-you-go；Team $100/月含 100,000 unit minutes。Linux 基线 1 vCPU 预付 **$0.001/min**；Windows **2×**、macOS **10×**、Linux-on-Apple-Silicon **7×** 分钟乘数。 |
| OS | Linux amd64/arm64（含 Apple silicon 上的 Linux）；Windows amd64（`windows-2022`）；macOS arm64（Sonoma / Sequoia / Tahoe）。硬件：Linux/Windows AMD EPYC；macOS M5 Max / M4 Pro。[GitHub Actions 方案](https://namespace.so/docs/solutions/github-actions) |
| 兼容坑 | 大仓 checkout 建议换成 `namespacelabs/nscloud-checkout-action` 才能吃 git mirror，**标准 `actions/checkout` 不一定吃到该加速**。容器 job 要额外挂 cache volume。Docker image cache 与部分 Buildpacks 不兼容。 |
| checkout / setup-node / artifact / gh | setup-* 可通过 `nscloud-runner-tool-cache` 缓存 `$RUNNER_TOOL_CACHE`。Artifact/`gh` 仍 GitHub。 |
| 用量/热度 | 营销称 “Join 1,000+ … companies”；客户页 Warp 案例「20k sandboxes/month、4x faster GHA」——厂商自述。[github-actions 产品页](https://namespace.so/github-actions) |
| 证据日期 | 2026-08-24 |

### 6. WarpBuild

| 项 | 内容 |
|---|---|
| Drop-in | **接近。** 文档：「drop-in replacements … fully compatible with GitHub Actions」。[Cloud Runners](https://www.warpbuild.com/docs/ci/cloud-runners) |
| 免费档 | 注册 **无需信用卡**；FAQ：「hit the free usage or credit limits」后才要付款方式。[Pricing](https://warpbuild.com/pricing)。对照页写 **signup 含 $10 credits**（[compare](https://www.warpbuild.com/compare/github-actions)，厂商页，2026-08-13 自称核对）。**不是按月循环免费分钟。** |
| OS | Linux x64/ARM64（Ubuntu 22.04/24.04/26.04）；macOS ARM64 14/15/26（M4 Pro，6 vCPU **$0.08/min**、12 vCPU **$0.16/min**）；Windows Server 2022/2025（最小 4 vCPU，**$0.016/min** 起）。Linux 2 vCPU **$0.004/min**。 |
| 兼容坑 | ARM64 Ubuntu 24.04 **workdir 为 `/runner/_work`，不是 GitHub 的 `/home/runner/work/`**。macOS：**无嵌套虚拟化、不能跑 Docker**。Windows cache 文档写 **WarpBuild cache 不支持 Windows**。macOS 13 已于 2026-06-08 移除；Windows 2 vCPU 与 cloud spot 同期移除。macOS 高并发需联系支持。 |
| checkout / setup-node / artifact / gh | Linux 镜像对齐 GitHub tooling。Artifact/`gh` 走 GitHub。 |
| 用量/热度 | 无公开消耗分钟。对照文写 2026-08-13 核对 GitHub 数字。 |
| 证据日期 | 2026-08-24 |

### 7. BuildJet

| 项 | 内容 |
|---|---|
| Drop-in | **Linux 接近。** `runs-on: buildjet-4vcpu-ubuntu-2204`。[Run your first workflow](https://buildjet.com/for-github-actions/docs/getting-started/run-your-first-workflow) |
| 免费档 | **一次性 $5 credit**，非每月额度。[Pricing](https://buildjet.com/for-github-actions/docs/about/pricing)。用量价自称 GitHub 一半：2 vCPU **$0.004/min**。Cache **每仓每周 20 GB 免费**。默认并发 64 AMD vCPU + 32 ARM vCPU。 |
| OS | **仅 Ubuntu Linux** AMD/ARM。文档明确 **不提供 macOS**（因 GitHub 已有 M1）。[Hardware](https://buildjet.com/for-github-actions/docs/runners/hardware)。**无 Windows 标签。** |
| 兼容坑 | AMD 用官方 `runner-images`。Ubuntu 20.04 home 在 `/home/ubuntu` 而非 `/home/runner`。ARM 包不完整，需手装依赖。镜像更新相对 GitHub 可能滞后数小时。 |
| checkout / setup-node / artifact / gh | checkout 示例用 `actions/checkout`。若要用 BuildJet 快缓存，需把 `actions/cache` → `buildjet/cache`，`actions/setup-node` → `buildjet/setup-node`（可选，非必须）。 |
| 用量/热度 | 老牌 GHA runner SaaS；无公开 MAU。 |
| 证据日期 | 2026-08-24 |

### 8. Ubicloud

| 项 | 内容 |
|---|---|
| Drop-in | **Linux 接近。** `ubuntu-latest` → `ubicloud-standard-2`。[Quickstart](https://www.ubicloud.com/docs/github-actions-integration/quickstart) |
| 免费档 | 托管：**$2.5/月 credit ≈ 1,250 min**（按其 $0.002/min premium 2 vCPU 或文档换算）。**必须先绑信用卡**（防滥用）。[Pricing](https://www.ubicloud.com/docs/about/pricing)、[Quickstart](https://www.ubicloud.com/docs/github-actions-integration/quickstart)。自建：源码 **AGPL**，可在 Hetzner 等裸金属上搭整朵云。[ubicloud/ubicloud](https://github.com/ubicloud/ubicloud) |
| OS | **仅 Linux x64 + arm64**（standard/premium）。文档无 macOS/Windows GHA runner。 |
| 单价 | Standard x64 2 vCPU **$0.00125/min**；Premium 2 vCPU **$0.002/min**；arm64 2 vCPU **$0.00125/min**。对照表把 GitHub Linux 写成 $0.006/min。 |
| 兼容坑 | 自称 full GHA compatibility，但镜像是否逐包对齐 `runner-images` 未在定价/quickstart 展开。防火墙需放行 [api.ubicloud.com/ips-v4](https://api.ubicloud.com/ips-v4)。 |
| checkout / setup-node / artifact / gh | 改一行 `runs-on` 即可跑；artifact/`gh` 仍 GitHub。 |
| 用量/热度 | 开源云 + 托管；GitHub 仓库活跃（clone 可见大量 GH runner CLI）。无公开「多少 org 在用 runner」。 |
| 证据日期 | 2026-08-24 |

### 9. RunsOn（自建在自己的 AWS 账户）

| 项 | 内容 |
|---|---|
| Drop-in | **部分。** 标签形如 `runs-on=${{ github.run_id }}/runner=2cpu-linux-x64`，常需 `uses: runs-on/action@v2`。[README](https://github.com/runs-on/runs-on)、[platforms](https://runs-on.com/docs/runners/platforms/) |
| 免费档 | **非商业（非营利/开源/教育/个人非商用）免费许可**（需公开致谢）。商业：15 天试用；Starter **€300/年**（<50k runners/月）；Enterprise €3,600/年。计算按 AWS 账单、无分钟加价。[Pricing](https://runs-on.com/pricing/) |
| OS | Linux x64/arm64（ubuntu22/24/26 full 镜像，称对齐 GitHub）；Windows Server 2022/2025（「mostly compatible」）；GPU。**文档此页无 macOS 产品线。** |
| 兼容坑 | Windows 冷启动 1–3 分钟。Hyper-V 要 `nested-virt`。完整镜像砍了部分预装软件以加快启动。新 AWS 账户有 EC2 quota。 |
| checkout / setup-node / artifact / gh | Linux full AMI 走 GitHub 工具链。Artifact 仍 GitHub；S3 cache 为额外能力。 |
| 用量/热度 | 厂商称单日 2.13M jobs / 24.7 runners/s（[README](https://github.com/runs-on/runs-on) 链到自家博文，**非独立审计**）。 |
| 证据日期 | 2026-08-24 |

### 10. AWS CodeBuild GitHub Actions runner

| 项 | 内容 |
|---|---|
| Drop-in | **否，标签必须含项目名。** `runs-on: codebuild-<project>-${{ github.run_id }}-${{ github.run_attempt }}`，可附加 `image:` / `instance-size:`。[Tutorial](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html) |
| 免费档 | AWS Free Tier（定价页检索摘要）：on-demand EC2 **100 build minutes/月**（`general1.small` 或 `arm1.small`）；Lambda **6,000 build seconds/月**。Reserved / Mac / Docker image server **无** free tier。请以 [CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/) 页内嵌表为准（本次 HTML 抽取不完整）。 |
| OS | Amazon Linux 2/2023、Ubuntu、Windows Server Core 2019/2022；另有 Lambda。FAQ 平台列表：**Amazon Linux 2、AL2023、Ubuntu、Windows Server Core 2019**。[Questions](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner-questions.html)、[images](https://docs.aws.amazon.com/codebuild/latest/userguide/sample-github-action-runners-update-yaml.images.html)。**托管 runner FAQ 未列 macOS**；定价页另有 Mac **reserved** 实例（最少 24h），与 GHA runner FAQ 不是同一段。 |
| 兼容坑 | **不是 GitHub `runner-images`。** buildspec 默认忽略；`buildspec-override:true` 仍不跑 BUILD 阶段。密钥默认不打码。镜像/工具链与 `ubuntu-latest` 差异大，Tauri/Node/MSVC 需自备。 |
| checkout / setup-node / artifact / gh | JS actions 一般能跑（需镜像有 Node 或 setup-node 能下载）。`gh` 未必预装。Artifact 仍 GitHub。 |
| 用量/热度 | 2024-04 AWS 宣布：[whats-new](https://aws.amazon.com/about-aws/whats-new/2024/04/aws-codebuild-managed-github-action-runners/)。 |
| 证据日期 | 2026-08-24 |

### 11. Google Cloud Build「GitHub runner」——不存在作为产品

| 项 | 内容 |
|---|---|
| 结论 | **没有** 类似 CodeBuild 的「托管 GHA runner」SKU。Cloud Build 是另一套 CI，用 trigger 建 GitHub 仓：[build repos from GitHub](https://cloud.google.com/build/docs/automating-builds/github/build-repos-from-github)。 |
| 仍跑 GHA YAML 的 GCP 路径 | ① 官方教程：Cloud Run worker pools 上自建 GitHub runner + CREMA 扩缩：[Cloud Run tutorial](https://docs.cloud.google.com/run/docs/tutorials/github-runner)。② Terraform 模块在 GKE 上跑 runner（可跟 ARC）：[terraform-google-github-actions-runners](https://github.com/terraform-google-modules/terraform-google-github-actions-runners)。③ 2020 年 GitHub Blog 与 Google 合写的自建指南：[GitHub Blog](https://github.blog/news-insights/product-news/github-actions-self-hosted-runners-on-google-cloud/)。 |
| 免费档 | 等同 GCP 计算免费额度 / Cloud Run 定价，**不是** GHA 分钟包。 |
| OS | 取决于你选的容器/GKE 节点；教程面向 Linux 容器。 |
| 证据日期 | 2026-08-24 |

---

## 兼容性总表（checkout / setup-node / artifact / gh release）

| 方案 | checkout | setup-node | artifact | gh release | 说明 |
|---|---|---|---|---|---|
| GitHub-hosted | 原生 | 原生 | 原生 | 预装 `gh` | 存储吃 GitHub 配额 |
| 官方 self-hosted | 是 | 是（需出网） | 是 | 需自装 `gh` | 非 Linux 无容器 action |
| ARC | 是 | 是（官方推荐补齐最小镜像） | 是 | 需自装 | 容器 job 要 DinD/k8s |
| Blacksmith | 声称是 | 声称是 | 是 | 视镜像 | Windows 无完整 VS |
| Depot | 声称是 | 声称是 | 是 | 视镜像 | Windows 无 Hyper-V |
| Namespace | 可用；加速要换 nscloud-checkout | 可用；tool cache 可选 | 是 | 视镜像 | 多 `nscloud` 标签会拒调度 |
| WarpBuild | 声称是 | 声称是 | 是 | 视镜像 | ARM workdir 不同；Windows 无其 cache |
| BuildJet | 是 | 可选换成 buildjet/setup-node | 是 | Linux 镜像 | 无 Win/macOS |
| Ubicloud | 声称是 | 声称是 | 是 | 视镜像 | 仅 Linux |
| RunsOn | 是（Linux full AMI） | 是 | 是 | 视 AMI | Windows「mostly」 |
| CodeBuild | 视镜像 | 视镜像 | 是 | 常需自装 | 非 GitHub 镜像 |
| GCP Cloud Run 教程 | 自建 runner 行为 | 同 self-hosted | 是 | 自装 | 非托管产品 |

**共性：** Artifact 与 `gh release` 的**存储与鉴权在 GitHub**，不随 runner 厂商搬家。Runner 只要能访问 `api.github.com` 即可。厂商加速 cache 往往要换 action 或装 agent，**不等于** GitHub artifact 兼容问题。

---

## 对 RabbitInterview（macOS + Windows MSVC + Linux）不加钱覆盖

| 路径 | Linux | Windows MSVC | macOS / Xcode | 不加钱是否可行 |
|---|---|---|---|---|
| GitHub-hosted 公有仓 | 是 | 是（完整 VS 镜像） | 是 | **是**（标准 runner） |
| GitHub-hosted 私有 Free | 是，吃 2,000 min；macOS 按 $0.062 相对 Linux $0.006 很贵 | 是 | 是但分钟很快耗尽 | 仅低流量 |
| 官方 self-hosted / ARC | 是 | 需自备 Windows 机+VS | 需自备 Mac | 软件免费，硬件自付 |
| Blacksmith 3,000 min | 是 | Build Tools 2022，非完整 IDE | 是，但免费分钟是否含 macOS 未在抽出的 FAQ 核实 | 仅 Organization |
| WarpBuild $10 credit | 是 | 是（VS2022/2026 标签） | 是 | 一次性额度 |
| Depot / Namespace | 是 | 是（Depot 无 Hyper-V） | 是 | 试用期后付费 |
| BuildJet / Ubicloud | 是 | **否** | **否** | 不能覆盖桌面三端 |
| RunsOn 非商用许可 | 是 | 是 | **文档无 macOS** | 缺 macOS |
| CodeBuild 100 min | 是（非 GHA 镜像） | Windows Core 镜像，MSVC 需自备 | FAQ 未支持 GHA macOS runner | 不适合 Tauri 发布 |

**推断（非排名）：** 私有仓、坚持 GHA YAML、又不想付 SaaS：自建 Linux + 一台 Windows + 一台 Mac（或租 MacStadium）仍是唯一完整免费矩阵。托管平替里，**循环免费且含 Win+macOS** 的只有 GitHub 自己的 included minutes；第三方循环免费（Ubicloud $2.5、BuildJet $5 一次性）基本是 Linux。

---

## 附录：纯付费 / 试用后付费（无像样业余循环免费档）

- **Depot：** 7 天试用 → 最低 $20/月。[pricing](https://depot.dev/pricing)
- **Namespace：** 30 天试用 → Developer PAYG / Team $100。[pricing](https://namespace.so/pricing)
- **WarpBuild：** 用完 credit 后纯按分钟；无月费但无循环免费包。[pricing](https://warpbuild.com/pricing)
- **RunsOn 商业许可：** 年费 + AWS。[pricing](https://runs-on.com/pricing/)
- **Blacksmith 超额：** 定价表未能从页面抽出；文档称 Linux 约 GitHub 一半、macOS $0.08–$0.16/min。

---

## Findings

1. **GitHub-hosted 仍是唯一「公有仓 Win+macOS+Linux 全免费」的 runner 矩阵。** 私有仓 Free 仅 2,000 min，macOS 单价 $0.062/min。 [billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) [pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
2. **Self-hosted 控制面 $0.002/min 已官方推迟**；当前文档仍写 self-hosted 对 GitHub 免费。政策可能再变。 [changelog](https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/)
3. **ARC 不是完整 `ubuntu-latest`。** 最小容器 + 必须为容器 action 开 DinD/k8s；不适合直接当 Tauri macOS/Windows 发布机。 [ARC](https://docs.github.com/en/actions/concepts/runners/actions-runner-controller) [deploy](https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/deploy-runner-scale-sets)
4. **Blacksmith / Depot / Namespace / WarpBuild 是真正的 YAML drop-in 候选**，但 Blacksmith/Depot **只要 GitHub Org**；Windows 常缺完整 VS 或 Hyper-V。 [Blacksmith quickstart](https://docs.blacksmith.sh/introduction/quickstart) [Depot overview](https://depot.dev/docs/github-actions/overview) [Depot Windows 注记](https://depot.dev/docs/github-actions/runner-types)
5. **BuildJet、Ubicloud 有真免费额度但只有 Linux**，覆盖不了 RabbitInterview 的 macOS/Windows 发布。 [BuildJet hardware](https://buildjet.com/for-github-actions/docs/runners/hardware) [Ubicloud pricing](https://www.ubicloud.com/docs/about/pricing)
6. **RunsOn 非商用许可 + AWS 现货** 是成本最低的 Linux/Windows 自建之一，**无官方 macOS runner**。 [platforms](https://runs-on.com/docs/runners/platforms/) [pricing](https://runs-on.com/pricing/)
7. **CodeBuild 是托管 self-hosted，不是 GitHub 镜像 drop-in**；免费 100 min 量级，标签绑定项目名。 [tutorial](https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html)
8. **Google Cloud Build 不是 GHA runner 平替**；GCP 侧只有自建教程。 [Cloud Run](https://docs.cloud.google.com/run/docs/tutorials/github-runner)
9. **artifact / `gh release` 不随 runner 迁移。** 兼容性取决于 runner 能否调 GitHub API 以及镜像是否有 `gh`/Node，而不是厂商对象存储。
10. **WarpBuild ARM64 workdir `/runner/_work`** 与 GitHub `/home/runner/work/` 不一致，硬编码路径的 workflow 会炸。 [cloud-runners](https://www.warpbuild.com/docs/ci/cloud-runners)

---

## Sources

**Kept**

- GitHub Actions billing — https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions — 免费分钟与 self-hosted 是否计费
- Actions runner pricing — https://docs.github.com/en/billing/reference/actions-runner-pricing — 2026 单价
- GitHub-hosted runners reference — https://docs.github.com/en/actions/reference/runners/github-hosted-runners — OS 矩阵
- Self-hosted runners / reference — https://docs.github.com/en/actions/hosting-your-own-runners 、 https://docs.github.com/en/actions/reference/runners/self-hosted-runners
- Actions limits — https://docs.github.com/en/actions/reference/limits
- GitHub changelog 定价更新 — https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/
- ARC 概念 / 入门 / 部署 — https://docs.github.com/en/actions/concepts/runners/actions-runner-controller 、 https://docs.github.com/en/actions/tutorials/use-actions-runner-controller/get-started 、 https://docs.github.com/en/actions/how-tos/manage-runners/use-actions-runner-controller/deploy-runner-scale-sets
- ARC 仓库 — https://github.com/actions/actions-runner-controller
- Blacksmith docs — https://docs.blacksmith.sh/introduction/quickstart 、 https://docs.blacksmith.sh/blacksmith-runners/overview
- Depot — https://depot.dev/pricing 、 https://depot.dev/docs/github-actions/runner-types 、 https://depot.dev/docs/github-actions/overview
- Namespace — https://namespace.so/pricing 、 https://namespace.so/docs/reference/github-actions/runner-configuration 、 https://namespace.so/docs/solutions/github-actions
- WarpBuild — https://www.warpbuild.com/docs/ci/cloud-runners 、 https://warpbuild.com/pricing 、 https://www.warpbuild.com/compare/github-actions
- BuildJet — https://buildjet.com/for-github-actions/docs/about/pricing 、 https://buildjet.com/for-github-actions/docs/runners/hardware 、 https://buildjet.com/for-github-actions/docs/getting-started/run-your-first-workflow
- Ubicloud — https://www.ubicloud.com/docs/about/pricing 、 https://www.ubicloud.com/docs/github-actions-integration/quickstart 、 https://github.com/ubicloud/ubicloud
- RunsOn — https://runs-on.com/pricing/ 、 https://runs-on.com/docs/runners/platforms/ 、 https://github.com/runs-on/runs-on
- AWS CodeBuild — https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner.html 、 https://docs.aws.amazon.com/codebuild/latest/userguide/action-runner-questions.html 、 https://aws.amazon.com/codebuild/pricing/ 、 https://aws.amazon.com/about-aws/whats-new/2024/04/aws-codebuild-managed-github-action-runners/
- GCP — https://docs.cloud.google.com/run/docs/tutorials/github-runner 、 https://github.com/terraform-google-modules/terraform-google-github-actions-runners
- actions/checkout — https://github.com/actions/checkout

**Dropped**

- binhong.me GitHub Action Runner Alternatives — 二手对比表，数字未作权威
- Cirrus-runners 博客解释 GitHub 定价 — 非候选官方文档
- Medium / DEV.to CodeBuild 教程 — 二手
- apis.io 转载 Blacksmith 定价 — 非一手
- WarpBuild 对照文中的 GitHub 数字 — 仅作交叉线索，权威以 GitHub docs 为准

---

## Gaps

1. **Blacksmith `blacksmith.sh/pricing` HTML 未抽出价表**（前端渲染）。3,000 免费分钟是否计入 Windows/macOS、是否仅 2 vCPU x64，需浏览器打开或登录控制台再核。
2. **WarpBuild $10 credit** 写在对照页，定价 FAQ 只说 “free usage or credit limits”，额度数字应以控制台/条款再核。
3. **AWS CodeBuild 免费档与 Mac reserved 实例** 定价页抽取不完整；100 min 是否适用于 GHA runner 项目，官方未在 runner FAQ 单独重申。
4. **厂商用量**：无独立「消耗分钟」；star 数除 ARC 搜索摘要外未在本笔记逐仓打开确认。
5. **`gh` 是否预装**：除 GitHub-hosted 外，多数镜像 README 未在本次逐条打开。
6. 未评估 Cirrus Runners、MacStadium 自建等任务书未列厂商。

**建议下一步：** 浏览器打开 Blacksmith 定价表；对 Tauri 开一个最小 `checkout + setup-node + cargo test` 矩阵，分别打在 Blacksmith Windows Build Tools 与 GitHub `windows-latest` 上对比 MSVC。

---

## Supervisor coordination

无需阻塞决策。产出已写入本路径。
