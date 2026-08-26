# 研究笔记 T3：可自建 / 开源 CI（相对 GitHub Actions）

- **任务：** `outputs/.plans/github-actions-free-alternatives-T3.md`
- **范围：** 软件可自建或开源的 CI，不是 SaaS runner 出租。
- **证据日期：** 2026-08-24（GitHub/Codeberg/Gitea API 与官方文档当日抓取）
- **GHA YAML 兼容度约定：** 无 / 部分 / 接近（官方明确说「熟悉但不兼容」时标「部分」，说「designed to be compatible」且有差异清单时标「接近」）
- **免费含义：** 软件许可证免费 ≠ 机器免费。下列方案几乎都要自备 Linux/macOS/Windows 硬件与电费/云账单。
- **Tauri 桌面应用（macOS universal + Windows MSVC + Linux）要点：** 没有方案能在「不加钱且不自备 macOS/Windows 机器」的情况下覆盖官方 Xcode / MSVC 构建。容器化 Linux 便宜；macOS 必须买/租 Mac；Windows 可自备 PC 或云 VM。
- **PDF 解析：已阻塞。** 计划禁止解析 PDF。Forgejo runner 2024 渗透测试报告仅保留 HTML 文档中的链接与「问题于 2025 修复」这一陈述，未打开 PDF 正文。

Star / 发布数字一律来自当日 API 或官方 release 页，不编造。本轮按主会话要求收束，不再追加搜索。

---

## 对照表

| 方案 | 许可证 | GHA YAML | macOS | Windows | 软件免费 vs 机器成本 | 热度（当日） |
|------|--------|----------|-------|---------|----------------------|--------------|
| Forgejo Actions | GPL-3.0-or-later（v9+） | 部分 | 官方 runner 测 Linux；host 标签可挂自备 Mac | 官方不维护 Windows；社区构建 + host | 软件免费；自备 runner | Forgejo 5367★；runner 112★；v16.0.3 / runner v13.0.0 |
| Gitea Actions | MIT | 接近 | 官方二进制含 macOS；host 模式自备 | 官方二进制含 Windows；host 需 powershell | 软件免费；自备 runner | Gitea 57565★；runner 240★；Gitea v1.27.2 / runner v3.3.0 |
| nektos/act | MIT | 接近（本地执行器，不是平台） | Docker 模拟 Linux；本机 `-self-hosted` 才能跑 macos | 同上，需 Windows 主机 | 软件免费；用你的本机 | 71613★；v0.2.89（2026-06-01） |
| Woodpecker | Apache-2.0 | 无 | agent 有 darwin 二进制；仅 Local 后端 | agent 有 Windows 二进制；Docker 经 WSL2/Windows 容器 | 软件免费；自备 agent | 7736★；v3.17.0（2026-07-31） |
| Drone | OSS=Apache-2.0（需自行 oss 构建）；EE=Polyform Small Business | 无 | Exec runner / MacStadium 管道 | Exec runner 有 Windows 安装 | OSS 软件免费但无官方发行；EE 有营收门槛 | harness/harness 38096★（含历史）；drone 分支 latest v2.28.2（2026-04-20） |
| Jenkins | MIT | 无（Jenkinsfile / Groovy） | 可装 agent；官方 macOS 安装器在项目外 | 官方 Windows 支持政策 + MSI | 软件免费；自备 controller/agent | 26481★；weekly 2.578（2026-08-18） |
| Tekton | Apache-2.0 | 无（Task/Pipeline CRD） | 无官方 macOS 节点；需自管 K8s | 官方 Windows 节点文档 | 软件免费；需 K8s 集群 | 9040★；v1.15.0 LTS（2026-07-31） |
| Buildbot | GPL-2.0 | 无（Python master.cfg） | worker 可跑多平台 | worker 可跑 Windows | 软件免费；自备 master/worker | 5469★；GitHub latest tag v4.3.0（2025-05-12） |
| Concourse | Apache-2.0 | 无（pipeline.yml + task 镜像） | 发布 darwin 二进制；任务默认容器 | 容器为主 | 软件免费；自备 worker | 7893★；v8.3.0（2026-08-13） |
| GitLab Self-Managed CI | CE=MIT；EE 专有 | 无（`.gitlab-ci.yml`） | 官方 Runner 支持 macOS LaunchAgent | 官方 Runner 支持 Windows | CE/Free 档含内建 CI；分钟限制主要针对 GitLab.com 托管 runner | 见 T1/T4；本文只记自建 |
| Sourcehut builds | AGPL-3.0 | 无（build manifest） | 兼容矩阵无 macOS 镜像 | 兼容矩阵无 Windows 镜像 | 软件可自建；官方 VM 是 Linux/BSD | 源码 `git.sr.ht/~sircmpwn/builds.sr.ht` |
| Argo Workflows | Apache-2.0 | 无（K8s Workflow CRD） | 取决于集群节点；非桌面 runner | 取决于 Windows 节点 | 软件免费；需 K8s | 16930★；v4.1.2（2026-08-21） |

---

## 1. Forgejo Actions

**定位：** 内建于 Forgejo 的 CI。实例不跑 job，交给独立 Forgejo Runner。[https://forgejo.org/docs/latest/user/actions/overview/](https://forgejo.org/docs/latest/user/actions/overview/)

**许可证：** Forgejo v9.0 起 GPL v3+；v8.0 及更早仍是 MIT。[https://forgejo.org/faq/](https://forgejo.org/faq/) [https://forgejo.org/2024-08-gpl/](https://forgejo.org/2024-08-gpl/) Runner 同为 GPL-3.0-or-later。[https://code.forgejo.org/forgejo/runner](https://code.forgejo.org/forgejo/runner)

**GHA YAML：** **部分。** 官方原文：“designed to be familiar … **not designed to be compatible**”。无 `.forgejo/workflows` 时会回退读 `.github/workflows`。差异包括默认 Debian+node 镜像 vs GitHub ubuntu、部分 `github` context 缺失、`permissions` / `continue-on-error` 被忽略、OIDC 用 `enable-openid-connect` 而非 `permissions: id-token: write`。[https://forgejo.org/docs/latest/user/actions/github-actions/](https://forgejo.org/docs/latest/user/actions/github-actions/)

**macOS / Windows：**
- Runner 官方支持并测试 `amd64`/`arm64` **Linux**。[https://code.forgejo.org/forgejo/runner](https://code.forgejo.org/forgejo/runner)
- `host` 标签可在无隔离下直接跑宿主（可挂自备 Mac，无官方 macOS 镜像）。[https://forgejo.org/docs/latest/admin/actions/configuration/](https://forgejo.org/docs/latest/admin/actions/configuration/)
- Forgejo 项目 2024 决定放弃 Microsoft Windows 发行；FAQ 写社区没有维护专有 OS 的精力。Runner 的 Windows 是 issue 标签，不是官方支持；社区构建见 FAQ 链接。[https://forgejo.org/faq/](https://forgejo.org/faq/)

**免费含义：** 软件 copyleft 免费。无托管分钟；要自备 Forgejo 实例 + runner 机器。`host` 模式无隔离，不适合不可信 PR。

**相对 GHA 的坑：**
- 不是即插即用；marketplace action 镜像/工具链与 GitHub-hosted 不同。
- `ubuntu-latest` 只是 runner 标签映射，默认不是 GitHub 同款 VM。
- 官方不提供 Windows runner 二进制。
- 安全审计针对 runner（HTML 文档称 2024 渗透测试、问题于 2025 修复）。**PDF 正文未解析（已阻塞）。** [https://forgejo.org/docs/latest/user/actions/overview/](https://forgejo.org/docs/latest/user/actions/overview/)

**热度：** Codeberg API 2026-08-24：`forgejo/forgejo` **5367** stars，115 个 release，最新 **v16.0.3**（2026-08-20）。[https://codeberg.org/api/v1/repos/forgejo/forgejo](https://codeberg.org/api/v1/repos/forgejo/forgejo) [https://codeberg.org/forgejo/forgejo/releases/tag/v16.0.3](https://codeberg.org/forgejo/forgejo/releases/tag/v16.0.3) Runner **112** stars，最新 **v13.0.0**（2026-08-03，含 breaking changes）。[https://code.forgejo.org/api/v1/repos/forgejo/runner](https://code.forgejo.org/api/v1/repos/forgejo/runner) [https://code.forgejo.org/forgejo/runner/releases/tag/v13.0.0](https://code.forgejo.org/forgejo/runner/releases/tag/v13.0.0)

---

## 2. Gitea Actions

**定位：** Gitea 1.19 起内建 CI；1.21 默认启用。Runner 独立部署，核心硬分叉自 nektos/act。[https://docs.gitea.com/usage/actions/overview](https://docs.gitea.com/usage/actions/overview) [https://docs.gitea.com/runner/](https://docs.gitea.com/runner/)

**许可证：** Gitea MIT。[https://github.com/go-gitea/gitea](https://github.com/go-gitea/gitea) Runner API `licenses: ["MIT"]`。[https://gitea.com/gitea/runner](https://gitea.com/gitea/runner) FAQ：Gitea 与 Runner 完全 MIT 开源。[https://docs.gitea.com/usage/actions/faq](https://docs.gitea.com/usage/actions/faq)

**GHA YAML：** **接近。** “designed to be compatible”，但有官方差异清单：忽略 `jobs.<id>.environment`；`runs-on` 仅单标签或单元素数组（FAQ 仍讨论多标签历史坑）；无 problem matcher / 部分 annotation；表达式几乎只有 `always()`；`GITEA_TOKEN` 不能默认推 package（需 PAT）；`permissions` 语义不同且无 GitHub 若干 scope；默认从 github.com 拉 `actions/checkout@v4`；可用绝对 URL；`github.*` 与 `gitea.*` 目前等价。[https://docs.gitea.com/usage/actions/comparison/](https://docs.gitea.com/usage/actions/comparison/) [https://docs.gitea.com/usage/actions/faq](https://docs.gitea.com/usage/actions/faq)

**macOS / Windows：** FAQ：官方二进制覆盖 Linux、macOS、Windows。Host 模式无容器隔离，Windows 上默认 bash 常不可用，需 `defaults.run.shell: powershell`。Podman 非支持配置。[https://docs.gitea.com/usage/actions/faq](https://docs.gitea.com/usage/actions/faq) [https://docs.gitea.com/runner/](https://docs.gitea.com/runner/)

**免费含义：** 软件免费。无官方托管 macOS/Windows 分钟。gitea.com 公共实例只给自家 org 注册 runner，不替你跑桌面构建。

**相对 GHA 的坑：**
- 环境是 Docker/host，不是 GitHub VM（无预装 Xcode/MSVC）。
- PR `ref` 是 `refs/pull/:n/head` 不是 GitHub 的 merge ref。[https://docs.gitea.com/usage/actions/faq](https://docs.gitea.com/usage/actions/faq)
- `actions/checkout` + `setup-node` 依赖镜像里有 Node；缓存/artifact 行为与 GHES 补丁相关（runner v3.3.0 修过 `GHESNotSupportedError`）。[https://gitea.com/gitea/runner/releases/tag/v3.3.0](https://gitea.com/gitea/runner/releases/tag/v3.3.0)

**热度：** GitHub API 2026-08-24：`go-gitea/gitea` **57565** stars，MIT，latest **v1.27.2**（2026-08-13）。[https://api.github.com/repos/go-gitea/gitea](https://api.github.com/repos/go-gitea/gitea) [https://github.com/go-gitea/gitea/releases/tag/v1.27.2](https://github.com/go-gitea/gitea/releases/tag/v1.27.2) `gitea/runner` **240** stars，latest **v3.3.0**（2026-08-21）。[https://gitea.com/api/v1/repos/gitea/runner](https://gitea.com/api/v1/repos/gitea/runner)

---

## 3. nektos/act

**定位：** 在本机用 Docker API 跑 `.github/workflows`，用于快速反馈或当 task runner，**不是** 可共享的 CI 平台。[https://github.com/nektos/act](https://github.com/nektos/act)

**许可证：** MIT。[https://api.github.com/repos/nektos/act](https://api.github.com/repos/nektos/act)

**GHA YAML：** **接近**（尽力模拟）。默认用精简 Node/catthehacker 镜像，**故意不完整**，缺少 GitHub-hosted 全套工具；容器也没有 systemd。[https://nektosact.com/usage/runners.html](https://nektosact.com/usage/runners.html)

**macOS / Windows：** 默认把 `ubuntu-*` 映射成 Linux 容器。若要跑 `windows-latest` / `macos-latest`，必须 **已经在该 OS 上** 运行 act，并用 `-P …=-self-hosted` 退出 Docker。没有官方 macOS VM 后端。[https://nektosact.com/usage/runners.html](https://nektosact.com/usage/runners.html) [https://nektosact.com/installation/](https://nektosact.com/installation/)

**免费含义：** CLI 免费。计算就是你的笔记本/CI 机。不能替代 GitHub 上的共享 runner 队列。

**相对 GHA 的坑：** 镜像差、无托管并发、secrets/OIDC/`gh release` 需本机凭据、不适合不可信 PR。Forgejo/Gitea runner 都从 act 谱系分叉，平台能力另算。

**热度：** **71613** stars；latest **v0.2.89**（2026-06-01）。[https://api.github.com/repos/nektos/act](https://api.github.com/repos/nektos/act) [https://github.com/nektos/act/releases/tag/v0.2.89](https://github.com/nektos/act/releases/tag/v0.2.89)

---

## 4. Woodpecker CI

**定位：** 2019 从 Drone 0.8（当时 Apache-2.0）分叉的容器原生 CI。Codeberg 用它做主 CI。[https://woodpecker-ci.org/about](https://woodpecker-ci.org/about) [https://github.com/woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker)

**许可证：** Apache-2.0。[https://github.com/woodpecker-ci/woodpecker](https://github.com/woodpecker-ci/woodpecker)

**GHA YAML：** **无。** 语法是 `.woodpecker.yaml` 步骤列表（`image` + `commands`），与 GHA `jobs/steps/uses` 不同。[https://woodpecker-ci.org/docs/usage/workflow-syntax](https://woodpecker-ci.org/docs/usage/workflow-syntax)

**macOS / Windows：** 官方矩阵：server 以 Linux 为中心；agent 有 **windows/amd64** 与 **darwin amd64/arm64** 二进制。Docker/K8s 后端要 Linux（Windows 经 WSL2 或 Windows 容器）。macOS/OpenBSD **只有 Local 后端**（无隔离，仅可信私有环境）。[https://woodpecker-ci.org/docs/administration/installation/supported-platforms](https://woodpecker-ci.org/docs/administration/installation/supported-platforms)

**免费含义：** 软件 Apache 免费。Codeberg 公共实例是别人的用量政策，不是你的免费 macOS。自建 = 自备 agent。

**相对 GHA 的坑：** 要重写流水线；插件是容器插件不是 `actions/*`；Local 后端无隔离；server 不官方跑在 macOS。

**热度：** **7736** stars；latest **v3.17.0**（2026-07-31）。[https://api.github.com/repos/woodpecker-ci/woodpecker](https://api.github.com/repos/woodpecker-ci/woodpecker) [https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.17.0](https://github.com/woodpecker-ci/woodpecker/releases/tag/v3.17.0)

---

## 5. Drone CI（Harness）

**定位：** 容器 CI；文档仍用 `.drone.yml`。Harness 称 Open Source 是「下一代 Drone」，Drone 功能冻结在 `drone` 分支。[https://docs.drone.io/pipeline/overview/](https://docs.drone.io/pipeline/overview/) [https://github.com/harness/harness](https://github.com/harness/harness)

**许可证（重要）：**
- Open Source Edition：Apache-2.0，**无官方发行**，需 `go build -tags "oss nolimit"`。[https://docs.drone.io/enterprise/](https://docs.drone.io/enterprise/)
- Enterprise Edition：Polyform Small Business；个人/学生免费；组织上年总收入 **低于 100 万美元** 可免费；否则需商业许可。官方 Docker 安装走 EE。[https://docs.drone.io/enterprise/](https://docs.drone.io/enterprise/)
- `drone` 分支 LICENSE 同时写 Community=Apache-2.0 与 Non-Commercial / 32 天商业试用条款，读源码时以文件头为准。[https://github.com/harness/drone/blob/drone/LICENSE](https://github.com/harness/drone/blob/drone/LICENSE)
- Woodpecker 关于页仍称 Drone 在 0.8 后改为专有/Polyform。[https://woodpecker-ci.org/about](https://woodpecker-ci.org/about)

**GHA YAML：** **无。** `kind: pipeline` + `type: docker|kubernetes|exec|ssh|macstadium`。

**macOS / Windows：**
- Exec runner：无隔离，有 Linux / **macOS** / **Windows** 安装页；文档写 macOS 尤其适合（容器差）。[https://docs.drone.io/runner/exec/overview/](https://docs.drone.io/runner/exec/overview/) [https://docs.drone.io/pipeline/exec/overview/](https://docs.drone.io/pipeline/exec/overview/)
- MacStadium 管道：仅自托管，Drone Cloud 禁用。[https://docs.drone.io/pipeline/macstadium/overview/](https://docs.drone.io/pipeline/macstadium/overview/)

**免费含义：** 「免费」取决于走 OSS 自编译还是 EE 收入门槛。机器仍要自备。新用户更常被导向 Harness Open Source（Apache-2.0 仓库）而非历史 Drone EE。

**相对 GHA 的坑：** YAML 不兼容；许可证分裂；OSS 无官方镜像；Exec 不安全；MacStadium 是第三方 Mac 云（另计费）。

**热度：** `github.com/drone/drone` 重定向到 `harness/harness`，**38096** stars，Apache-2.0，homepage developer.harness.io。latest release **v2.28.2** 打在 **drone** 分支（2026-04-20）。[https://api.github.com/repos/harness/harness](https://api.github.com/repos/harness/harness) [https://github.com/harness/harness/releases/tag/v2.28.2](https://github.com/harness/harness/releases/tag/v2.28.2)

---

## 6. Jenkins

**定位：** Java 自动化服务器，2000+ 插件。[https://www.jenkins.io/](https://www.jenkins.io/) [https://github.com/jenkinsci/jenkins](https://github.com/jenkinsci/jenkins)

**许可证：** MIT。[https://api.github.com/repos/jenkinsci/jenkins](https://api.github.com/repos/jenkinsci/jenkins)

**GHA YAML：** **无。** Declarative/Scripted Pipeline 是 `Jenkinsfile`（Groovy），Snippet Generator 按已装插件生成步骤。[https://www.jenkins.io/doc/book/pipeline/getting-started/](https://www.jenkins.io/doc/book/pipeline/getting-started/)

**macOS / Windows：** Agent 是任意能跑受支持 JVM 的机器，用 label 区分 os。[https://www.jenkins.io/doc/book/using/using-agents/](https://www.jenkins.io/doc/book/using/using-agents/) Windows 有官方支持政策与 MSI。[https://www.jenkins.io/doc/book/platform-information/support-policy-windows/](https://www.jenkins.io/doc/book/platform-information/support-policy-windows/) macOS 安装器在 Jenkins 项目外维护。[https://www.jenkins.io/doc/book/installing/macos/](https://www.jenkins.io/doc/book/installing/macos/)

**免费含义：** 核心与绝大多数插件免费。运维成本（Java、插件 CVE、agent 机）是真实账单。

**相对 GHA 的坑：** 无 `actions/checkout` 生态；Groovy 学习成本；默认 agent 共享工作区；安全模型与 GitHub OIDC 不同；要自己做 artifact/`gh release`。

**热度：** **26481** stars；weekly **2.578**（2026-08-18）。[https://github.com/jenkinsci/jenkins/releases/tag/jenkins-2.578](https://github.com/jenkinsci/jenkins/releases/tag/jenkins-2.578) LTS changelog：[https://www.jenkins.io/changelog-stable/](https://www.jenkins.io/changelog-stable/)

---

## 7. Tekton Pipelines

**定位：** K8s 风格 CI/CD 资源（Task/Pipeline）。云原生、容器为块。[https://github.com/tektoncd/pipeline](https://github.com/tektoncd/pipeline) [https://tekton.dev/docs/pipelines/](https://tekton.dev/docs/pipelines/)

**许可证：** Apache-2.0。

**GHA YAML：** **无。** CRD YAML，不是 GHA workflow。

**macOS / Windows：** 官方 Windows 文档：Windows 容器只能跑在 Windows 节点；控制面必须 Linux；一个 Task 不能混 Windows/Linux 容器；Pipeline 可以混 Task。[https://tekton.dev/docs/pipelines/windows/](https://tekton.dev/docs/pipelines/windows/) **没有** 官方 macOS Kubernetes 节点/Xcode 方案。

**免费含义：** 软件免费。成本是集群（含 Windows 节点授权）。

**相对 GHA 的坑：** 必须会 K8s；无 GitHub marketplace actions；macOS 桌面构建基本不在设计内。

**热度：** **9040** stars；latest **v1.15.0** “Toyger Orisa” LTS（2026-07-31）。[https://github.com/tektoncd/pipeline/releases/tag/v1.15.0](https://github.com/tektoncd/pipeline/releases/tag/v1.15.0)

---

## 8. Buildbot

**定位：** Python CI 框架：一个 master + 多 worker，配置用 Python 子类而非 GHA YAML。[https://docs.buildbot.net/latest/manual/introduction.html](https://docs.buildbot.net/latest/manual/introduction.html)

**许可证：** GPL-2.0（GitHub SPDX；文档写 GPL）。[https://api.github.com/repos/buildbot/buildbot](https://api.github.com/repos/buildbot/buildbot)

**GHA YAML：** **无。**

**macOS / Windows：** 「variety of worker platforms」；worker 只需能 checkout 源码并执行命令，可放防火墙后。[https://docs.buildbot.net/latest/manual/introduction.html](https://docs.buildbot.net/latest/manual/introduction.html) 官方未提供 GitHub-hosted 式 macOS 镜像。

**免费含义：** 软件 GPL 免费。适合已有跨平台编译农场（CPython、Mozilla 类），不是即插 GHA。

**相对 GHA 的坑：** Python 配置；无 action 市场；上手曲线陡。

**热度：** **5469** stars；GitHub releases/latest **v4.3.0**（2025-05-12）。注意：`latest` 可能落后于文档站点 “latest”。[https://github.com/buildbot/buildbot/releases/tag/v4.3.0](https://github.com/buildbot/buildbot/releases/tag/v4.3.0)

---

## 9. Concourse

**定位：** 容器自动化，常用作 CI。Pipeline 像分布式 Makefile；`fly set-pipeline`。[https://concourse-ci.org/](https://concourse-ci.org/)

**许可证：** Apache-2.0。

**GHA YAML：** **无。** `resources` + `jobs` + 每 task 自带镜像。

**macOS / Windows：** 一切在容器里；v8.3.0 发布资源含 `concourse-8.3.0-darwin-amd64.tgz`（CLI/二进制，不是 macOS 应用签名环境）。[https://github.com/concourse/concourse/releases/tag/v8.3.0](https://github.com/concourse/concourse/releases/tag/v8.3.0) Windows 桌面/MSVC 不是一等公民，除非自建 Windows 容器 worker。

**免费含义：** 软件免费。Worker 集群自备。

**相对 GHA 的坑：** 概念（resource/job/task）与 GHA 不同；本地调试是 `fly execute` 不是 `act`。

**热度：** **7893** stars；**v8.3.0**（2026-08-13）。[https://api.github.com/repos/concourse/concourse](https://api.github.com/repos/concourse/concourse)

---

## 10. GitLab Self-Managed CI（补充）

**定位：** 仓库根 `.gitlab-ci.yml`；job 由 GitLab Runner 执行。文档标 **Tier: Free, Premium, Ultimate** 且 **Offering 含 GitLab Self-Managed**。[https://docs.gitlab.com/ci/](https://docs.gitlab.com/ci/) [https://docs.gitlab.com/runner/](https://docs.gitlab.com/runner/)

**许可证：** GitLab CE MIT；EE 为 GitLab EE 专有许可。[https://docs.gitlab.com/development/licensing/](https://docs.gitlab.com/development/licensing/) 内建 CI/CD 出现在 Self-Managed 功能对比的 Free 列。[https://about.gitlab.com/pricing/feature-comparison/](https://about.gitlab.com/pricing/feature-comparison/) 该页上的 400/10k/50k compute minutes 针对 **GitLab.com 托管 runner**，自管 runner 不受同一套「GitLab 送分钟」约束（你付机器）。

**GHA YAML：** **无。** 完全另一套 YAML（`stages`/`script`/`image`）。

**macOS / Windows：** Runner 官方文档：GNU/Linux、macOS、Windows；Bash / PowerShell Core / Windows PowerShell。macOS 安装为 user-mode LaunchAgent（非 LaunchDaemon）。[https://docs.gitlab.com/runner/](https://docs.gitlab.com/runner/) [https://docs.gitlab.com/runner/install/osx/](https://docs.gitlab.com/runner/install/osx/) [https://docs.gitlab.com/runner/install/windows/](https://docs.gitlab.com/runner/install/windows/)

**免费含义：** CE/Free 可自建完整 CI。Xcode/MSVC 仍要自备 Mac/PC。GitLab.com 托管 macOS/Windows 是另一产品（T1）。

**相对 GHA 的坑：** 迁移成本高；EE 功能门控（部分安全扫描等）；自管 runner 版本建议与 GitLab major.minor 对齐。[https://docs.gitlab.com/runner/](https://docs.gitlab.com/runner/)

---

## 11. Sourcehut builds.sr.ht（补充）

**定位：** 提交 YAML build manifest，worker 启动 **完整 VM** 跑任务。可自建 master + workers。[https://man.sr.ht/builds.sr.ht/](https://man.sr.ht/builds.sr.ht/) [https://man.sr.ht/builds.sr.ht/installation.md](https://man.sr.ht/builds.sr.ht/installation.md)

**许可证：** GNU AGPL v3（源码树 LICENSE）。[https://git.sr.ht/~sircmpwn/builds.sr.ht/tree/master/item/LICENSE](https://git.sr.ht/~sircmpwn/builds.sr.ht/tree/master/item/LICENSE)

**GHA YAML：** **无。** `image:` + `tasks:`。

**macOS / Windows：** 官方兼容矩阵列出 Alpine/Arch/Debian/Fedora/FreeBSD/Guix/NetBSD/NixOS/OpenBSD/Rocky/Ubuntu 等 **Linux 与 BSD**，**没有 Windows 或 macOS 镜像**。[https://man.sr.ht/builds.sr.ht/compatibility.md](https://man.sr.ht/builds.sr.ht/compatibility.md)

**免费含义：** 软件 AGPL 可自建。sourcehut.org 托管构建是付费/配额产品（属 T1）。自建也提供不了官方 macOS VM。

**相对 GHA 的坑：** 无 `actions/*`；默认 `set -x` 易泄露 secret；不适合 Tauri 的 Xcode/MSVC。

---

## 12. Argo Workflows（仅当可作为 CI）

**纳入理由：** 官方 Use Cases 明确列出 **CI/CD**。[https://github.com/argoproj/argo-workflows](https://github.com/argoproj/argo-workflows) （README 链到 `use-cases/ci-cd`）

**许可证：** Apache-2.0。CNCF graduated。

**GHA YAML：** **无。** Kubernetes Workflow/DAG CRD，每步一个容器。

**macOS / Windows：** 跟集群节点走。默认 Linux 容器。Windows 需 Windows 节点（同类限制见 Tekton）。macOS/Xcode 不是 K8s 一等公民。

**免费含义：** 软件免费。成本=集群。适合已有 K8s 的批处理/ML/CI，不是 Git 事件驱动的轻量 GHA 替换。

**相对 GHA 的坑：** 无 GitHub 上下文；artifact 走 S3 等；git 触发通常还要 Argo Events/CD。

**热度：** **16930** stars；latest **v4.1.2**（2026-08-21）。[https://github.com/argoproj/argo-workflows/releases/tag/v4.1.2](https://github.com/argoproj/argo-workflows/releases/tag/v4.1.2)

---

## 对 RabbitInterview（Tauri）的自建结论

1. **想尽量留 GHA YAML：** 只有 **Gitea Actions（接近）**、**Forgejo Actions（部分）**、**act（本地接近）**。都要自备 runner；GitHub-hosted 的 `macos-*` / `windows-*` 工具链不会免费出现。
2. **macOS universal + Xcode：** 所有方案都要求 **你有一台 Mac**（Forgejo/Gitea/Woodpecker Local、Drone Exec、Jenkins agent、GitLab Runner macOS）。Sourcehut/Tekton/Concourse/Argo **不能**当免费 Mac 农场。
3. **Windows MSVC：** Gitea Runner 官方有 Windows 二进制；GitLab Runner / Jenkins / Drone Exec / Woodpecker Local 也可。Forgejo **官方不维护 Windows**。Tekton 需要 Windows K8s 节点。
4. **Linux 发布：** 任何容器 CI（Woodpecker/Drone/Concourse/Tekton/Argo/GitLab Docker executor）都够用，成本最低。
5. **「不加钱」覆盖三平台：** **做不到**——软件免费，Apple 硬件与 Windows 授权/机器不是免费。act 只能在你已有的 Mac/PC 上本地跑。
6. **许可证雷区：** Drone EE/Polyform；GitLab EE 专有层；Forgejo GPL-3.0-or-later（相对 Gitea MIT）。新开源自建优先 Woodpecker 或 Gitea/Forgejo Actions，而不是历史 Drone Docker Hub 默认镜像。

---

## 来源

**保留（一手）：**
- Forgejo Actions 差异 / overview / runner 配置 / FAQ / GPL 公告 / runner 仓库与 API
- Gitea comparison / FAQ / runner / overview / GitHub+Gitea API
- nektos/act README、runners 文档、GitHub API
- Woodpecker about / platforms / workflow-syntax / GitHub API
- Drone pipeline/exec/macstadium/enterprise、harness README、LICENSE
- Jenkins 官网、agents、pipeline、GitHub API
- Tekton windows 文档、GitHub API
- Buildbot 导论、GitHub API
- Concourse 官网、GitHub releases
- GitLab CI/Runner 安装与 licensing
- Sourcehut builds 文档、compatibility、LICENSE
- Argo Workflows README/releases API

**丢弃：**
- devopsness/sumguy/latchkey/devopsboys 等博客（线索，非权威）
- `about.gitlab.com/install/ce-vs-ee/`（404）
- `forgejo.org/license/`（404）
- `docs.drone.io/license/`（404）
- Argo 旧路径 `argoproj.github.io/argo-workflows/ci/`（404）；改用 README use-cases
- Dagster（计划明确排除）
- Forgejo 2024 渗透测试 PDF（计划禁止解析；仅保留 HTML 摘要）

---

## 缺口

- **PDF 解析已阻塞：** 未读取 Forgejo runner 渗透测试 PDF 正文，CVE/发现项清单以 HTML 概述为准。
- GitHub `stargazers_count` 是瞬时值；T4 应再抓一次以免综合稿数字漂移。
- Buildbot GitHub `latest`（v4.3.0，2025-05-12）可能不是 docs.buildbot.net 上的最新文档版本；未核 PyPI。
- `harness/harness` 38096★ 混有 Drone 历史，不能当「当前 Drone 用量」。
- GitLab.com 托管 macOS/Windows 免费分钟属 T1，不在本笔记展开。
- Forgejo Windows 社区构建（Crown0815）未做安全审计，仅 FAQ 提及。
- 未实测 `actions/setup-node` 在 Forgejo/Gitea 默认 Debian 镜像上的完整矩阵。
