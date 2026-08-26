# T3：可自建 / 开源 CI

读 `outputs/.plans/github-actions-free-alternatives.md`。只做 **可自建或开源** 的 CI，不是 SaaS runner 出租。

候选：Forgejo Actions、Gitea Actions、nektos/act、Woodpecker、Drone、Jenkins、Tekton、Buildbot、Concourse、Dagster/其他无关项不要。可补充：GitLab self-managed CI、Sourcehut builds self-host、Argo Workflows（仅当可作为 CI）。

对每个纳入项写：许可证、GHA YAML 兼容程度（无/部分/接近）、macOS/Windows runner 现实情况、免费含义（软件免费 vs 机器成本）、相对 GHA 的坑、star/发布热度 URL、证据日期。

不要编造数字。不要解析 PDF。

产出必须写到：`outputs/.drafts/github-actions-free-alternatives-research-selfhost.md`
中文撰写。每个事实附 URL。
