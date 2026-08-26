I have enough evidence from the cited draft and research notes to write the verification report. No live URL fetch was possible in this pass.

## Review
- **Correct:** The cited draft keeps GHA as a baseline, splits usage/heat, marks composite ranks as 推断, and generally maps hard limits to official URLs or labeled research-note snapshots.
- **Fixed:** none (review-only; no edits applied)
- **Finding:** several MAJOR/MINOR issues below; no FATAL fabrication found against the research notes
- **Merge verdict:** **BLOCK** for promoting `outputs/.drafts/github-actions-free-alternatives-cited.md` to the T8 final until MAJOR items are fixed

---

# GitHub Actions 免费平替 — 引用稿核验

- **对象：** `outputs/.drafts/github-actions-free-alternatives-cited.md`
- **对照：** `outputs/.drafts/github-actions-free-alternatives-draft.md`；研究笔记 T1–T4（hosted / runners / selfhost / ranking）
- **核验日：** 2026-08-24
- **性质：** 引用与主张核验（verification），不是文风 peer review
- **方法限制：** 本轮只有仓库内只读核对，**没有**对官方 URL 做现场抓取。数字对错先以研究笔记与文内引用是否同构为准。

## Checks performed

1. 通读 cited 全文，对照 T1–T4 研究笔记中的硬限制、调查百分比、星标、HN 分数。
2. 核对 Sources 1–30 与文内 `[^…]` 是否一一对应；查缺引、错引、一脚注绑多条不相干主张。
3. 逐条检查执行摘要里的决策句是否被正文表格的限制条件支持，有没有摘要强于证据。
4. 标出单源关键主张（usage 排序脊柱、热度第 1、Azure 第 3、CircleCI 精确 workflow 数）。
5. 核对「循环免费 / 只剩 / 置信度 高」是否与同一文件其他行自相矛盾。
6. 核对 T1 已核实但 cited 降级为「未核实」或直接省略的免费档（Semaphore、Buildkite、GitLab OSS、Harness 绑卡、Azure 开通计费）。
7. 确认 PDF blocked、Reddit 抽取失败、Blacksmith 404、DevEco 原图表未抽出等降级项有没有在开放问题里交代（有）。
8. 未跑 git / 测试 / 网络抓取。现场 URL 仍待主会话或 T8 再核。

## Correct

- 三类平替拆分（整平台 / runner / 自建）与「不做单一综合分」和计划一致。
- GHA 基线硬数字（私有 Free 2,000 分钟、产物 500 MB、缓存 10 GB、Linux $0.006 / Windows $0.010 / macOS $0.062）与 T1/T2 一致，且指向官方 billing / runner-pricing。
- GitLab.com Free 无托管 macOS、Bitbucket 云 runner 仅 Linux Docker、Azure 1 并发 / 1,800 分钟 / 60 分钟 job、Harness ×60、CircleCI 对比表 macOS SKU「—」等，都能在 T1 找到对应官方页。
- 明确拒绝把 act 星标、Gitea 整仓星标、GitLab 6.1k 星、CircleCI「领先平台」文案当用量；单位不可比的警告正确。
- Blacksmith 免费分钟、WarpBuild/Depot/Namespace/RunsOn 未二次抓取、CNCF/CircleCI PDF blocked，开放问题写清楚，没有把缺口装成已核事实。
- 星标快照（act 71,613、Gitea 57,565、Forgejo 5,367、Jenkins 26,481、Woodpecker 7,736、Tekton 9,040 等）与 T3/T4 当日 API 一致，并标明研究笔记快照。

## FATAL

无。没有发现相对 T1–T4 的凭空造数；主要问题是摘要过满、置信度偏高、单源排序、以及把「一次性」说成「循环」。

## MAJOR

### M1. 用量排序脊柱是单源转述，表内却标「高」
- **位置：** 执行摘要用量轴；§2.1 表 GHA/Jenkins/GitLab 行；开放问题 5
- **主张：** 组织侧 GHA 33% / Jenkins 28% / GitLab CI 19%，GHA 与 Jenkins 置信度「高」
- **证据：** 同一文件写明 DevEco 交互站 RSC **没有**抽出百分比，数字来自 TeamCity 博文转述 `[^jb-best-ci]`。Jenkins 博客只复述组织侧 28%，不是独立普查。T4 也把这标成转述缺口。
- **问题：** 33/28/19 是全文用量名次的脊柱，却是卖 TeamCity 的官方博文对 DevEco 的转述。开放问题 5 已承认原图表未检出，与「高」互相矛盾。
- **最小修复：** 这三行置信度改为「中（官方转述，非原图表）」；摘要改为「TeamCity 博文转述 DevEco，尚未核对交互站/原始数据」。

### M2. 执行摘要「只剩 Azure + AppVeyor」强于正文，也强于 T1
- **位置：** 执行摘要第 3 条决策；对比 §4 表、T1「对 RabbitInterview 的免费可达性」
- **主张：** 离开 GitHub 控制面还要免费托管 Win+mac，「只剩」Azure Pipelines 与 AppVeyor 开源档
- **证据：**
  - 同文 §4：Harness Cloud Free **官方有** Linux/Windows/macOS，只是 macOS 预算约 33 分钟（实用 blocker，不是「不存在」）。
  - T1：GitLab **Open Source 计划**可达 Ultimate + 50,000 compute minutes，macOS 文档含 OSS 计划（仍 beta，×6/×12）。cited 完全未提。
  - 同文 §4：Azure 私有免费档须开通计费；**不能再新建 public project**。执行摘要没写这两道门。对「新开 Azure 组织离开 GitHub」的读者，这不是即开即用的免费三平台。
- **问题：** 决策者若只读摘要，会以为全球只有两条路，并低估 Azure 开通成本与公有仓路径关闭。
- **最小修复：** 改成「文档确认能调度托管 Win+mac 的自助免费档：Azure（须开通计费、60 min/job、不能新建 public）、AppVeyor OSS（仅公有）；Harness 名义三平台但 macOS ≈33 分钟；GitLab OSS 计划为条件路径，Free 档本身无 macOS」。

### M3. 把 BuildJet 一次性 $5 写成「循环免费」
- **位置：** §5 段末推断；§7.2「循环免费 Linux：Ubicloud、BuildJet」
- **主张：** 第三方循环免费额度包括 BuildJet；想保住 YAML 时循环免费 Linux = Ubicloud、BuildJet
- **证据：** 同文 §5 表：BuildJet「**Every account gets a one-time $5 credit**」「一次性额度，非每月」。T2 同。
- **问题：** 表对、摘要错。读者按 §7 选月度免费 Linux runner 会选到一次性试用金。
- **最小修复：** 循环免费只留 Ubicloud；BuildJet 改为「一次性 $5」。

### M4. Bitbucket/TeamCity 用量行错绑来源，且专项调查 URL 未进 Sources
- **位置：** §2.1 推断名次 5；Sources 只有 `[^jb-best-ci]`（2026-03 Best CI/CD Tools）
- **主张：** 2026-03 文写 TeamCity 与 Bitbucket「appear less frequently overall, but they have noticeable traction within organizations」；专项 *State of CI/CD* 被用作「组织侧可见、总榜不突出」
- **证据：** T4 把 Bitbucket/TeamCity「组织侧有存在感、不进总榜」和 TeamCity 组织约 7% 放在 **2025-10** `the-state-of-cicd`（805 人），不是 2026-03 那篇的 33/28/19 列表。cited Sources **没有** `https://blog.jetbrains.com/teamcity/2025/10/the-state-of-cicd/`。英文引语未在 T4 原文出现，属张冠李戴风险。
- **问题：** 用量第 5 名的依据无法回溯到所列脚注；专项调查被用了却没列进来源。
- **最小修复：** 英文句若确属 2026-03 再保留并单独引；「组织侧可见」改引 2025-10 文并加入 Sources。不要用 `[^jb-best-ci]` 同时扛两篇。

### M5. 热度第 1（Forgejo/Gitea）是定性阅读，写成名次
- **位置：** 执行摘要热度轴；§3 表第 1 名
- **主张：** 定价抗议帖「大量点名」迁出目标，故 Forgejo/Gitea 为热度第一平替
- **证据：** 依据写「研究笔记对 HN 线程的定性」。T4 有 HN 802/819 与「评论大量提到 GitLab、Forgejo/Codeberg、Gitea、Jenkins…」，**没有**评论计数或编码表。T4 还写 Codeberg 星标不能和 GitHub 星标混成绝对榜，cited 仍并列 Gitea 57,565★ 与 Forgejo 5,367★。独立 Show HN 分数低，文内已承认是「配角」。
- **问题：** 「配角」与「热度第一平替」冲突。单线程定性不够支撑排序轴第 1 名。
- **最小修复：** 改为「HN 定价帖中被点名的开源迁出候选（定性，未编码）」；不要给 Forgejo/Gitea 推断名次 1，或把置信度标低并禁止与 GitHub 星标混排。

### M6. Azure Pipelines 用量第 3 名建立在非 CI 题目上
- **位置：** 执行摘要用量轴；§2.1 名次 3
- **主张：** Azure 排在已公布 CI 百分比的工具之后、CircleCI 之前
- **证据：** 文内自己说无 CI 分项，SO 16.6% 是「Code documentation and collaboration tools」弱代理。CircleCI 至少有己方 2,800 万级 workflow 遥测。把「无 CI 份额」排成用量第 3，逻辑是「有弱代理就压过只有遥测的产品」。
- **问题：** 名次传达的信息强于「中 / 弱代理」。对「按用量排序」这个任务是实质性跳跃。
- **最小修复：** Azure/CircleCI 改为并列「调查无分项，不进前三甲」；或明确「第 3 只表示弱代理排序，不是份额」。

## MINOR

### m1. CircleCI `28,738,317` 及过滤条件超出 T4 笔记
- **位置：** §2.1 CircleCI 行；§7.4；Sources 20
- **说明：** T4 只有「2025-09 前 28 天超过 2800 万 workflow」。cited 写成精确整数，并加「≥2 contributors，workflow 至少跑 5 次」。可能是 T6 从博客脚注补的，但本轮未现场打开该页；完整 PDF 仍 blocked。这是单源厂商遥测，精确到个位容易显得像审计数。
- **修复：** 现场核对脚注原文；若在，保留并写「厂商博客脚注，非独立审计」；若不在，退回「超过 2800 万 / 28 天窗口」。

### m2. 「没有第二个公有仓三平台标准 runner 全免费」易被读成「没有第二个免费三平台」
- **位置：** 执行摘要首句
- **说明：** AppVeyor OSS 公有仓确有 Linux/Win/mac 镜像，只是 1 并发 / 60 分钟。用 GHA 黑话「标准 runner 全免费」才排除它。一般读者会和后文 AppVeyor 打架。
- **修复：** 改成「没有第二个公有仓、不限分钟、Linux+Win+mac 标准托管 runner 全免费的 CI」。

### m3. 附录把 T1 已核的 Semaphore/Buildkite 写成「未核实」
- **位置：** §4 附录
- **说明：** T1 已写 Buildkite Free = 最多 2,000 Linux vCPU minutes，macOS 在 Pro 文案才明确；Semaphore **$15/月 credits**，MacOS **$0.09/min**（约 166 macOS 分钟），Windows 未在首页单列。cited 附录「未核实完整免费 Win+mac」掩盖已有证据，也把 Semaphore 排除出主表。
- **修复：** 附录改为 T1 已核事实，不要用「未核实」一笔勾销。

### m4. Harness Free 绑信用卡未进 §4 表
- **位置：** §4 Harness 行；对比 T1 与未引用草稿
- **说明：** T1：Free 用 Harness Cloud 要信用卡验证。cited 只在 Ubicloud 写绑卡。免费档门槛不对称。
- **修复：** Harness 行补「须绑卡」。

### m5. 私有仓 self-hosted 是否计费写得含糊
- **位置：** §3、§5「公有仓标准 hosted 与 self-hosted 仍免费」
- **说明：** T2：控制面费推迟后，文档仍写 self-hosted 对 GitHub 免费（含私有仓机器自付）。cited 有时只强调公有仓 self-hosted 仍免费，读者可能以为私有仓 self-hosted 已经按分钟收费。
- **修复：** 写明「私有仓 self-hosted 控制面费已推迟，当前仍不按分钟向 GitHub 付费；政策可能再变」。

### m6. 若干决策相关事实只靠研究笔记，未进 Sources
- GitHub 官方 self-hosted OS 矩阵
- Forgejo FAQ「官方不维护 Windows」
- Blacksmith 借势 HN 216 分（T4：item 46291500）
- GitLab hosted Windows beta 专页
- **修复：** 补 URL，或在该单元格保持「研究笔记」且不要在摘要当硬事实。

### m7. Gitea/Forgejo 星标与 Codeberg/GitHub 混读
- T4 已警告不可混排绝对热度。§3 仍把 57,565 与 5,367 并置支撑同一名次。
- **修复：** 分列托管站，或只当「项目仍在维护」的辅证。

### m8. `[^jb-best-ci]` 超载
- 同一脚注绑 33/28/19、Jenkins 复述链、Bitbucket/TeamCity 英文句、专项调查指针。削弱可核查性。
- **修复：** 一文一注。

## 单源关键主张清单

| 主张 | 为何关键 | 源 | 文内是否降权 |
|---|---|---|---|
| DevEco 组织 33/28/19 | 用量名次脊柱 | TeamCity 博文转述 | 写了转述，但置信度仍「高」 |
| Azure 用量第 3 | 填补调查空白 | SO 非 CI 题 16.6% | 写了弱代理，仍给名次 |
| CircleCI 28,738,317 | 唯一大规模非 GHA 绝对量 | CircleCI 自家博客脚注 | 中（己方遥测）——合适 |
| 热度第 1 Forgejo/Gitea | 热度轴第一平替 | 单帖定性 | 推断，但名次过硬 |
| Octoverse 11.5B 分钟 / 71M jobs/day | GHA 基线体量 | GitHub 官方 | 可接受的第一方用量 |
| HN 802/819 | 热度事件 | 单帖 | 可接受，勿外推「全年最大」为普查 |
| GitLab 5,000 万注册用户 | 易被误当成 CI 用户 | GitLab 公司页 | 已标明不是 CI 用户 |

## 未现场复核（残留风险）

本轮不能打开网页。下列主张在笔记里有 URL，但 **T7 未独立确认页面仍在、文案未改**：

- GHA billing / runner pricing / postpone 洞察页
- JetBrains TeamCity 2026-03 是否真有 33/28/19 与那段英文
- CircleCI 定价对比表 macOS「—」与 28,738,317 脚注
- Azure concurrent-jobs、GitLab macOS tier、AppVeyor pricing、Ubicloud $2.5、BuildJet one-time $5
- Blacksmith marketing 404 是否仍 404

T8 前应对上述 URL 做一次抓取；若 TeamCity 博文或 CircleCI 脚注对不上，对应 MAJOR/MINOR 升级。

## Merge verdict

**BLOCK** 升格为 `outputs/github-actions-free-alternatives.md`。

不阻塞的前提（最小集）：

1. 下调 33/28/19 的置信度，并避免「高」与「原图表未检出」并存（M1）。
2. 改写执行摘要「只剩 Azure/AppVeyor」，补 Harness、GitLab OSS、Azure 计费/公有仓门闩（M2）。
3. BuildJet 从「循环免费」拿掉（M3）。
4. 拆开 Bitbucket/TeamCity 的脚注，补 2025-10 专项调查或删掉该依据（M4）。
5. 热度第 1 与 Azure 用量第 3 改为更弱的表述（M5、M6）。

修完后此稿的证据边界（PDF blocked、未二次抓取厂商定价、DevEco 原图表缺失）仍然诚实，适合作为终稿底本。