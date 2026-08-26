# Provenance: GitHub Actions 免费平替（按用量与热度）

- **Date:** 2026-08-24
- **Rounds:** 1（计划确认后一次搜集；T7 MAJOR 后一轮修订）
- **Slug:** `github-actions-free-alternatives`
- **Plan:** `outputs/.plans/github-actions-free-alternatives.md`
- **Research files:**
  - `outputs/.drafts/github-actions-free-alternatives-research-hosted.md` (T1)
  - `outputs/.drafts/github-actions-free-alternatives-research-runners.md` (T2)
  - `outputs/.drafts/github-actions-free-alternatives-research-selfhost.md` (T3)
  - `outputs/.drafts/github-actions-free-alternatives-research-ranking.md` (T4)
- **Drafts:**
  - `outputs/.drafts/github-actions-free-alternatives-draft.md`
  - `outputs/.drafts/github-actions-free-alternatives-cited.md`
  - `outputs/.drafts/github-actions-free-alternatives-revised.md`（终稿候选）
  - `outputs/.drafts/github-actions-free-alternatives-verification.md`
- **Final:** `outputs/github-actions-free-alternatives.md`

## Sources consulted

主会话二次抓取并用于硬数字（accepted）：

- GitHub Actions billing; runner pricing; pricing-changes postpone 页; Octoverse 2025; Let’s talk about GitHub Actions; ARC docs
- JetBrains Best CI/CD Tools for 2026; DevEco 2025 方法页; State of CI/CD 2025 (2025-10); Jenkins 复述博文
- SO 2025 technology; HN 46291156
- GitLab compute minutes; hosted runners; macOS hosted; Windows hosted; company; OSS join 页
- Azure concurrent-jobs; hosted agents
- CircleCI pricing; CircleCI 2026 SoSD 博客
- Bitbucket billing; runners comparison
- AppVeyor pricing（raw HTML 抽出 Open-source FREE）
- Harness CI subscription credits
- Forgejo Actions 兼容页; Gitea comparison
- Ubicloud pricing; BuildJet pricing; Blacksmith quickstart
- nektos/act

研究笔记当日 API / 未二次抓取（accepted with note）：

- 星标快照（act / Gitea / Forgejo / Jenkins / Woodpecker / Tekton / ARC / harness）
- WarpBuild / Depot / Namespace / RunsOn / CodeBuild / Buildkite / Semaphore 部分免费档
- HN 46291500（Blacksmith 216 分）
- Forgejo FAQ Windows

## Sources rejected / blocked

- `https://www.blacksmith.sh/github-action-runners` — HTTP 404
- `blacksmith.sh/pricing` — 抽出内容为客户引言，无分钟表
- `https://docs.gitlab.com/subscriptions/gitlab_com/` — HTTP 403；GitLab OSS 50,000 minutes **未写入硬表**
- CircleCI / CNCF 调查 PDF — 按计划未解析（blocked）
- Reddit 自托管对比帖 — HTML 抽取失败
- Google Trends — 未取得可引用数值序列
- AppVeyor 定价页可读模式抽不到计划表；改用 raw HTML（accepted after raw）
- 营销声明（CircleCI「领先平台」、Buildkite「years saved」、未经审计的 million builds）— 不进用量轴

## Verification

**PASS WITH NOTES**

主会话核验 + reviewer T7：无 FATAL 造数。Reviewer 标 **BLOCK** 升格，直到 M1–M6 修复。修订稿已应用：

| ID | 修复 | 磁盘核验 |
|---|---|---|
| M1 | 33/28/19 置信度改为中（官方转述，非原图表） | `rg`：新稿含「置信度 **中**」；旧「用量轴…弱代理」摘要句已不在 revised 决策句中 |
| M2 | 摘要不再写「只剩 Azure/AppVeyor」；补 Harness、GitLab OSS 403、Azure 计费/不能新建 public | 「只剩 Azure」仅出现在修订说明元数据，不在决策句 |
| M3 | 循环免费 Linux 只留 Ubicloud；BuildJet 标一次性 $5 | HIT「一次性试用金，不是每月循环免费」；MISS「循环免费 Linux：Ubicloud、BuildJet」 |
| M4 | Bitbucket/TeamCity 改引 2025-10 专项调查 `[^jb-cicd-2025]` | HIT `jb-cicd-2025` |
| M5 | 热度不设 Forgejo/Gitea 第一名 | HIT「不设「第一平替」名次」 |
| M6 | Azure/CircleCI 标「不进前三甲」 | HIT「不进前三甲」 |

残留 notes：部分 runner SaaS 定价未二次抓取；PDF blocked；DevEco 原图表未抽出；GitLab OSS 分钟页 403；星标会变。

## Process notes

- `memory_remember` 不在可见工具集，计划只落盘。
- 可见 agent 无独立 `verifier`；T6 由主会话引用+抓取。
- T1–T4 四个 `researcher` 并行完成。
- T7 `reviewer` 完成后主会话写 `-revised.md` 再交付。
