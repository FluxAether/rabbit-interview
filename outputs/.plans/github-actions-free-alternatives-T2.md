# T2：GitHub Actions runner 平替

读 `outputs/.plans/github-actions-free-alternatives.md`。只做 **仍跑 GitHub Actions YAML** 的 runner 替换。

候选：GitHub-hosted 对照；官方 self-hosted；Actions Runner Controller (ARC)；Blacksmith、Depot、Namespace、WarpBuild、BuildJet、Ubicloud、RunsOn、AWS CodeBuild GitHub Actions runner、Google Cloud Build GitHub runner（若存在）、其他有免费档或开源自建的 runner。

对每个纳入项写：是否 drop-in、免费档/自建成本、支持 OS（macOS/Windows/Linux）、与 `actions/checkout` `setup-node` artifact `gh release` 的兼容坑、用量与热度线索 URL、证据日期。

「免费」= 有可用免费档或软件可免费自建。纯付费进附录。不要编造数字。不要解析 PDF。

产出必须写到：`outputs/.drafts/github-actions-free-alternatives-research-runners.md`
中文撰写。每个事实附 URL。
