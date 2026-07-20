# 隐身助手重构验证记录

## 2026-07-20 自动验证

| 检查 | 结果 |
|---|---|
| `npm run build` | 通过；仅保留现有 Vite 大 chunk / dynamic import 警告 |
| `npm run verify:copilot` | 18/18 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 8/8 通过 |
| `git diff --check` | 通过 |
| `npm run prepare:audiotee` | arm64 sidecar 构建通过，源码 commit 已锁定，SHA-256 已记录 |
| `scripts/build-audiotee.sh universal` | arm64、x86_64 与 universal Mach-O 构建通过 |
| Tauri debug `.app` | 打包通过；包含 AudioTee、MIT License 与 lock 文件 |
| 应用启动冒烟 | 通过；SQLite 初始化后主进程正常运行 |

本机产物审计哈希位于生成目录 `src-tauri/target/audiotee-checksums.txt`。该文件不提交，因为 Swift release 产物包含构建路径信息，跨机器不能假设二进制哈希可复现；源码 commit 始终严格校验。

## 仍需实机执行的发布矩阵

自动测试不能证明具体共享软件会如何处理 Tauri 内容保护，也不能替代真实会议采音。发布前必须填写：

| 平台 | Zoom | Google Meet | OBS | 结果说明 |
|---|---|---|---|---|
| macOS 14.2+ arm64 | 待测 | 待测 | 待测 | 记录不可见、黑区或可见；同时验证 AudioTee 首次 TCC 授权 |
| macOS 14.2+ x86_64 | 待测 | 待测 | 待测 | 验证 sidecar 签名、公证和系统音频 |
| macOS 13.0–14.1 | 待测 | 待测 | 待测 | 应显示仅麦克风，不进入失败循环 |
| Windows 10/11 x86_64 | 待测 | 待测 | 待测 | 当前为麦克风降级；WASAPI 结果见独立 spike |

只有上述矩阵、签名、公证和干净机器首次授权完成后，才满足发布层面的完整完成定义。
