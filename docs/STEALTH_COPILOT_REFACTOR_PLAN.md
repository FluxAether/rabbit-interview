# 隐身助手重构计划

> 依据：[即答侠隐身功能一手资料研究](research/jidaxia-stealth-feature.md)
> 目标：先让“隐身”真实、状态可信、会话单一，再补齐高价值交互；不以一次性复制即答侠全部功能为目标。

## 1. 当前问题

1. `stealthEnabled` 只被保存，没有接入浮窗创建；UI 却无条件显示“隐形模式已激活”。
2. 浮窗只有 `always_on_top`、无边框和跳过任务栏，没有启用系统级内容保护。
3. `App.tsx` 的分离浮窗和 `StealthCopilot.tsx` 各自维护捕获、Deepgram、录音、监听器和停止清理，存在双启动、状态漂移和资源泄漏风险。
4. 主页面与浮窗各写一套面板，问题、建议和操作能力不一致。
5. `Cmd/Super + Shift + I` 实际只会显示/聚焦浮窗，不是设置页宣称的“切换”；设置页还展示了未注册的模拟面试快捷键。
6. 每条 final transcript 都直接触发一次非流式 LLM 请求；Copilot 没有使用已有的简历、JD 等上下文。
7. 当前 macOS 系统音频基于 ScreenCaptureKit 和专用构建 feature；目标方案改为 AudioTee。AudioTee 仅支持 macOS 14.2+、只采系统输出，旧系统和麦克风仍需明确降级路径；Windows 仍缺少内置 loopback。

## 2. 重构原则

- **真实性优先**：只有操作系统内容保护成功应用后，UI 才显示“屏幕捕获保护已启用”。失败时显示明确原因，不再使用绝对化的“完全隐身”。
- **单一会话所有者**：主 Webview 是唯一 Copilot 会话 host；主页面和浮窗只发送命令、消费快照。
- **深 module、小 interface**：UI 不理解权限顺序、采音实现、Deepgram 重连、录音缓冲或跨 Webview 同步。
- **显式状态而非 toggle 猜测**：优先 `start`、`stop`、`show`、`hide`；快捷键可以映射为 toggle，但 module 内部根据真实状态决定动作。
- **删除重复实现**：重构完成后不得保留旧捕获路径作为“备用”。
- **平台能力如实降级**：内容保护、系统音频和快捷键分别报告能力，不能用一个 `stealthEnabled` 布尔值掩盖差异。
- **AudioTee 是唯一 macOS 系统音频实现**：迁移完成后删除 ScreenCaptureKit 代码、feature、内容选择器和录屏权限流程，不长期维护双路径。

## 3. 目标结构

```text
Global shortcut / Main page / Floating window
                    │
                    ▼
        Copilot session interface
   start · stop · clear · subscribe(snapshot)
                    │
                    ▼
        Single session host (main Webview)
 permission → audio → STT → LLM → recording
                    │
          Tauri events synchronize views
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Main CopilotPanel    Floating CopilotPanel

Native window commands
 show · hide · toggle · close · protection status
                    │
                    ▼
 Tauri content protection + window configuration
```

### 3.1 Copilot session interface

UI 只依赖以下行为：

```ts
type CopilotPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

type CopilotSnapshot = {
  phase: CopilotPhase
  question: string
  suggestions: Suggestion[]
  amplitude: number
  hasRecording: boolean
  error: string | null
}

start(config): Promise<void>
stop(): Promise<void>
clear(): void
subscribe(listener): () => void
```

`start`、`stop` 必须幂等；`stop` 可安全处理 `starting` 中的会话；停止后到达的 STT/LLM 回调必须被忽略。

### 3.2 原生窗口 interface

```text
show_copilot_window(protected) -> WindowStatus
hide_copilot_window()          -> WindowStatus
toggle_copilot_window(protected) -> WindowStatus
close_copilot_window()
```

`WindowStatus` 至少包含 `visible`、`protection_requested`、`protection_applied` 和可选错误。Tauri 2.9.5 已提供创建时 `content_protected(bool)` 与运行时 `set_content_protected(bool)`；均为 desktop 能力：

- <https://docs.rs/tauri/2.9.5/tauri/window/struct.WindowBuilder.html#method.content_protected>
- <https://docs.rs/tauri/2.9.5/tauri/webview/struct.WebviewWindow.html#method.set_content_protected>

不再保留前端 `new WebviewWindow(...)` 降级路径，因为它会绕过原生内容保护和统一窗口状态。

### 3.3 原生音频 interface

Copilot session 只调用统一的 `start_system_audio_capture`、`start_microphone_capture` 和 `stop_audio_capture`，不感知 AudioTee、cpal 或 WASAPI。

macOS 的目标 adapter 为 AudioTee sidecar：

```text
AudioTee --sample-rate 16000 --chunk-duration 0.1
    stdout: mono PCM16 little-endian
       │
       ▼
Rust decoder -> f32 audio-chunk -> existing Deepgram/recording pipeline

cpal microphone -> existing mixer ────────────────────────────────┘
```

- AudioTee 使用 macOS 14.2 引入的 Core Audio Taps，系统音频能力最低要求为 macOS 14.2；应用当前最低系统版本不自动上调，macOS 13.0–14.1 显示“仅麦克风”。
- AudioTee 只支持默认输出设备且不采麦克风；麦克风继续使用现有 cpal，并复用现有 mixer。
- 首版捕获全部系统输出，不实现 PID 过滤和音频源选择器。
- AudioTee API 当前不稳定且没有正式 release，构建必须固定到审核过的 commit，并记录 checksum；不能跟随 `main` 自动升级。
- 官方项目与集成约束：<https://github.com/makeusabrew/audiotee>

## 4. 分阶段实施

### PR 1：真实窗口保护与可信状态（P0）

**目标**：修复“设置已开但实际未保护”的根问题，可独立发布。

变更：

1. 新建 `src-tauri/src/copilot_window.rs`，集中创建、复用、显示、隐藏、关闭及保护状态。
2. 创建窗口时应用 `.content_protected(stealth_enabled)`；复用窗口时调用 `set_content_protected` 后再显示。
3. 删除 `StealthCopilot.tsx` 中直接创建 `WebviewWindow` 的 fallback。
4. `Cmd/Super + Shift + I` 改为真实的显示/隐藏切换。
5. UI 根据 `WindowStatus` 显示：
   - 屏幕捕获保护已启用；
   - 屏幕捕获保护未启用；
   - 平台不支持或启用失败。
6. 将文案“隐形模式已激活”改为“屏幕捕获保护已启用”，并增加“不能防止焦点、进程扫描或物理摄像头检测”的说明。

删除：

- `commands.rs` 中分散的浮窗生命周期实现。
- 前端绕过 Rust command 的建窗路径。
- 无条件展示的 stealth active 标记。

验收：

- 开关关闭时共享/录屏可看到浮窗，UI 显示未保护。
- 开关开启且原生调用成功时，UI 显示已保护。
- macOS、Windows 至少各完成一次 Zoom/Google Meet/OBS 手工矩阵；记录“不可见、黑区、可见”真实结果，不写绝对承诺。
- 重复按快捷键不会创建多个 `copilot` 窗口。

主要文件：

- `src-tauri/src/copilot_window.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src/App.tsx`
- `src/pages/StealthCopilot.tsx`
- `src/i18n/translations.ts`
- `scripts/verify-copilot.mjs`

### PR 2：单一会话 host（P0）

**目标**：只允许一个采音、STT、LLM 和录音生命周期。

变更：

1. 新建 `src/lib/copilotSession.ts`，从两个页面迁入：
   - 权限检查；
   - 根据原生能力选择系统音频、麦克风或降级模式，不调用平台专属 command；
   - `audio-config`、`audio-chunk`、`audio-amplitude`、`audio-error` 监听；
   - Deepgram 建连、采样率重连和关闭；
   - LLM 请求与迟到回调防护；
   - 15 分钟录音上限、快照和导出数据。
2. 仅在非 floating 的主 Webview 挂载 session host。
3. 主页面、浮窗和全局快捷键通过 Tauri event 发送显式命令；host 广播 `CopilotSnapshot`。
4. 浮窗启动时主动请求一次快照，避免先打开浮窗时显示旧状态。
5. 复用 `useAppStore.copilot` 作为各 Webview 的快照，不新建第二套状态库。

删除：

- `App.tsx` 中 `startFloatingCaptureSupport`、浮窗专用 Deepgram refs 和录音累积。
- `StealthCopilot.tsx` 中重复的捕获 refs、监听器和 `toggleCapture` 实现。
- `captureHotkeyPending` 导航中转逻辑；快捷键直接发送 session command。
- 全局 `window.__stealthMasterRecording` 兜底状态。

验收：

- 从主页面、浮窗、快捷键任一入口启动，都只产生一个 capture 和一个 Deepgram socket。
- 两个视图同时显示一致的 phase、问题、建议和音量。
- 启动中停止、连续双击启动、关闭浮窗、主页面切路由都不会留下后台采音。
- 采样率修正、15 分钟上限、WAV 导出保持现有行为。

### PR 3：统一面板与核心交互（P1）

**目标**：主页面预览和分离浮窗共享同一套 UI 与行为。

变更：

1. 提取 `src/components/CopilotPanel.tsx`，统一问题、建议、音量、状态和操作区。
2. 浮窗恢复 `resizable`，保留最小/最大尺寸；先只提供一个可调整窗口，不实现三套布局模板。
3. 补齐高价值操作：开始/停止、清除、复制建议、显示/隐藏。
4. 主页面保留音频来源和权限配置；浮窗只保留面试中必要操作。
5. `Esc` 默认隐藏浮窗，不停止正在进行的会话；关闭应用或显式停止才终止采音。
6. 键盘焦点、按钮名称、滚动区域和状态提示满足基础可访问性。

验收：

- 两处面板使用同一 module，不再复制 JSX。
- 调整窗口大小时内容不溢出，问题和建议区可独立滚动。
- 仅键盘即可启动、停止、隐藏、恢复和复制建议。

### PR 4：回答链路与上下文（P1）

**目标**：在不引入新后端的前提下，提高响应速度和答案相关性。

变更：

1. 让现有 Groq/OpenAI/Anthropic/Gemini adapters 通过统一内部 seam 输出增量文本；Copilot session 只消费 `onDelta/onComplete/onError`。
2. 复用现有 `resumeOriginal`、`jobDescription` 和设置数据构建 `CopilotContext`，不新增知识库系统。
3. 使用 Deepgram 已有 final/utterance 信号合并问题；不另写 VAD。
4. 增加“重答”和文字追问；保留最近一轮问题与回答上下文，不引入无限会话历史。
5. 对未配置 API key、模型调用失败和网络中断提供可恢复状态。

验收：

- 首段建议在完整回答结束前可见。
- 同一问题不会因多个 final 片段被重复请求。
- 有简历/JD 时提示词包含真实上下文；为空时行为与当前版本一致。
- 重答不会复用已经取消请求的迟到结果。

### PR 5：AudioTee 迁移与平台音频收口（P2，独立工作流）

**目标**：使用 AudioTee 完全替换 macOS ScreenCaptureKit 系统音频，再补齐 Windows loopback；不保留双实现。

macOS AudioTee：

1. 固定 AudioTee 的审核 commit，在 CI 分别构建 arm64、x86_64 release sidecar；随应用打包对应架构的可执行文件和 MIT License。
2. 新建 `src-tauri/src/audio/audiotee.rs`：Rust 启动 sidecar，参数固定为 `--sample-rate 16000 --chunk-duration 0.1`，持续读取 stdout，单独消费 stderr 日志。
3. 将 PCM16 little-endian mono 转为现有 `f32 audio-chunk`；处理任意长度读取并保留未成对的尾字节，不能假设一次 read 等于一个 AudioTee chunk。
4. AudioTee 不采麦克风；将现有 `TimedAudioMixer` 移到共享 audio module，继续用 cpal 麦克风与系统音频混合。
5. session 停止、应用退出或 sidecar 异常时必须关闭管道、终止并 `wait` 子进程，避免僵尸进程；启动后超时无 PCM 应返回可恢复错误。
6. 在 `Info.plist` 配置 `NSAudioCaptureUsageDescription`。AudioTee 本身不能预检查权限，首次启动由系统提示；需在签名后的 `.app` 中验证 TCC 权限归属和拒绝后的错误文案。
7. 删除 `screencapturekit.rs`、`macos-system-audio` feature、`start_macos_capture`、`list_macos_sources`、`present_macos_content_picker` 和 ScreenCaptureKit 屏幕录制权限流程。
8. macOS 14.2+ 提供 AudioTee 系统音频；macOS 13.0–14.1 保持应用可运行但只提供麦克风。只有产品决定不再支持旧系统时，才单独提高 `minimumSystemVersion`。
9. AudioTee 当前只支持默认输出设备，UI 删除 macOS 音频源选择器，不展示无法执行的设备选择。

Windows：

1. 单独做 WASAPI loopback 技术 spike，验证耳机、扬声器、独占模式和会议软件兼容性，再决定具体 crate；不提前加入依赖。
2. Windows adapter 复用与 AudioTee 相同的 `audio-chunk`、能力状态和停止语义，不把平台分支泄漏到 UI。

统一能力：

1. 原生层返回：系统音频是否可用、麦克风是否可用、当前模式、采样率和失败原因。
2. UI 只展示当前平台真实可用的模式。

验收：

- macOS 14.2+ 在不调用 ScreenCaptureKit command 的情况下得到 16kHz mono 系统音频，并可与 cpal 麦克风混合。
- macOS 13.0–14.1 明确显示仅麦克风，不进入失败循环。
- 拒绝系统音频录制权限、AudioTee 崩溃、停止会话和退出应用都不会留下 sidecar 进程。
- arm64、x86_64 sidecar 均随应用正确签名、打包和公证；目标机器不需要安装 Swift 或 AudioTee。
- Windows 具备 WASAPI 系统音频成功路径和麦克风降级路径。
- 切换设备或权限失败不会让 session 停留在 `starting`。
- 打包产物在干净机器完成至少一次真实会议采音测试。

## 5. 本轮明确不做

以下能力是独立产品功能，不属于此次重构：

- 窗口名/进程伪装；
- 绕过监考或反作弊检测；
- 手机端同步和云中继；
- 截图识题、找 Bug、多题历史；
- 透明度、三档尺寸、16 个可配置快捷键的完整复刻；
- AudioTee 的 PID 过滤、非默认输出设备选择和静音被捕获进程；
- 将 Deepgram、LLM 或录音整体迁移到 Rust/backend。

需要这些能力时，应分别立项；其中手机同步需要认证、传输和隐私设计，截图解题需要新的屏幕捕获与多模态链路，不能塞进窗口重构。

## 6. 风险与控制

| 风险 | 控制方式 |
|---|---|
| 内容保护在不同共享软件中表现不同 | UI 使用实际状态；维护 macOS/Windows × Zoom/Meet/OBS 手工矩阵 |
| 跨 Webview 事件乱序 | 每个 snapshot 带单调递增 revision；浮窗挂载后主动请求完整快照 |
| 快捷键与按钮同时触发导致双启动 | session host 中 `start/stop` 幂等，所有入口经过同一 interface |
| 停止后仍收到 STT/LLM 回调 | 每次启动生成 session id，回调只接受当前 id |
| 重构破坏录音导出 | 保留 `buildExportWav` 纯函数，通过 session interface 验证输出 |
| 平台能力被营销文案放大 | 文案只描述“屏幕捕获保护”，明确不覆盖焦点、进程和物理拍摄 |
| AudioTee API 不稳定且没有 release | 固定审核 commit 和 checksum；升级必须显式评审并重跑音频矩阵 |
| AudioTee 仅支持 macOS 14.2+ | 旧系统保留麦克风模式；不静默提高应用最低版本 |
| sidecar 未签名或 TCC 权限归属错误 | CI 验证两种架构、codesign、公证，并在干净机器测试首次授权 |
| AudioTee 只采默认输出、不采麦克风 | UI 不展示无效来源；麦克风继续走 cpal 和共享 mixer |

## 7. 验证基线

每个 PR 至少执行：

```bash
npm run build
npm run verify:copilot
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

额外规则：

- PR 1、PR 5 必须附 macOS/Windows 实机结果，自动测试不能证明共享软件是否真正排除窗口。
- PR 5 增加 PCM16 流解码、奇数尾字节、sidecar 异常退出、重复 stop 和 mixer 回归检查；发布验证必须覆盖 arm64 与 x86_64。
- `scripts/verify-copilot.mjs` 应从真实源码驱动状态机，覆盖双启动、启动中停止、迟到回调、浮窗重连和 protection 状态文案。
- 仓库现有 ESLint 9 flat-config 缺失和 Rust 全树格式漂移应继续单独报告，不作为本次重构顺手清理项。

## 8. 完成定义

满足以下条件才算重构完成：

- `stealthEnabled` 能真实控制窗口内容保护，UI 展示实际结果。
- 全仓库只有一个 Copilot capture/STT/LLM/recording 生命周期实现。
- 主页面与浮窗通过同一 `CopilotPanel` 和同一 session snapshot 工作。
- 全局快捷键、按钮和窗口关闭不会产生重复会话或后台残留采音。
- ScreenCaptureKit 音频实现及相关 feature/commands 已删除；macOS 14.2+ 仅通过 AudioTee sidecar 采集系统音频。
- macOS、Windows 的音频能力和降级路径在 UI 中可解释、可验证。
- 所有聚焦验证通过，实机屏幕共享结果有记录。
