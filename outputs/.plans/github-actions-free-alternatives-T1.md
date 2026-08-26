# T1：托管 CI 平台平替

读 `outputs/.plans/github-actions-free-alternatives.md`。只做托管 CI **整平台替换**（不是 GHA runner 出租）。

候选（可增删，须有官方来源）：GitHub Actions 免费档（对照基线，不当平替）、GitLab.com CI、Azure Pipelines、CircleCI、Bitbucket Pipelines、Sourcehut builds、Travis CI、AppVeyor、Codefresh、Harness CI 免费档、Cloudflare Workers CI / Cloudflare Builds（若官方定位为 CI）、Render/Netlify/Vercel 仅当其构建系统可当通用 CI。

对每个纳入项写：托管/许可证、免费档硬限制（分钟、并发、公有/私有、产物）、OS 矩阵尤其 macOS/Windows 是否免费、YAML/迁移成本、相对 GHA 的坑、用量与热度线索 URL、证据日期。

排除纯付费产品到「非免费」附录。不要编造数字。不要解析 PDF；PDF 只记 URL 并标 blocked。

产出必须写到：`outputs/.drafts/github-actions-free-alternatives-research-hosted.md`
中文撰写。每个事实附 URL。
