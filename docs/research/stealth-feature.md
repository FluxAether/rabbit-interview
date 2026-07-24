# 同类软件（HireMe AI）隐身功能一手资料研究

> 核验日期：2026-07-20  
> 当前官网桌面端版本：v0.3.44；官方教程标注适用于桌面端 v0.3.34+，最后更新于 2026 年 5 月。  
> 研究边界：只记录同类软件官方站点及官方教程的公开信息，不把厂商自测等同于第三方验证。

## 结论摘要

同类软件的“隐身”不是单一的隐藏窗口开关，而是一组覆盖不同风险层的能力：操作系统级窗口捕获排除、始终置顶浮窗、快捷键无鼠标操作、截图前临时自隐藏、窗口名称伪装、副屏放置、透明度与工具栏控制，以及手机端物理隔离。官方明确把它用于实时语音面试和截图解题，并公开宣称浮窗不会出现在屏幕共享和录屏中。[官方首页](https://interviewasssistant.com/zh) [官方教程](https://interviewasssistant.com/tutorial)

但“不会被共享/录屏捕获”不等于“不会被检测”：官方教程明确区分了屏幕共享豁免、窗口焦点变化、进程扫描和物理摄像头，并承认隐身豁免存在“极少数”失效可能。因此对比其他产品时，应将其表述为**厂商声明的软件捕获排除能力**，不能外推成所有会议、监考或物理拍摄条件下均绝对不可见。[官方教程：浮窗调整、隐身设置与排障](https://interviewasssistant.com/tutorial)

## 1. 功能范围

### 官方明确说明

- 桌面 Copilot 默认捕获会议软件的系统音频，实时转写面试官问题，自动识别问题结束点，并以流式方式在浮窗中生成结构化回答建议；官网宣称首字响应约 700ms。[官方首页](https://interviewasssistant.com/zh) [Copilot 功能页](https://interviewasssistant.com/zh/interview-copilot)
- 面试上下文可组合简历、岗位 JD、目标公司/职位、知识库、自我介绍稿、回答长度、模型档位、自定义指令和热词表。自我介绍稿会进入面试浮窗的 Notes 抽屉。[官方教程：面试前配置](https://interviewasssistant.com/tutorial)
- 答题可用自动模式，也可切成只由快捷键触发的手动模式；用户还能强制回答、重答、暂停转录、文字纠错或追问。[官方教程：快捷键与答题模式](https://interviewasssistant.com/tutorial)
- 截图解题覆盖算法题、代码题和系统设计图；浮窗还提供“找 Bug”模式、历史题目列表以及对既有题解继续追问。[官方教程：截屏解题与找 Bug](https://interviewasssistant.com/tutorial)
- 手机浏览器可同步桌面答案，并反向触发桌面截屏、找 Bug、立即回答和文字追问；支持同一 Wi-Fi 的本地直连及云中继两种连接。[官方教程：手机同步](https://interviewasssistant.com/tutorial)

### 与“隐身”直接相关的功能层

1. 操作系统级窗口捕获排除：面向屏幕共享、截图与录屏。
2. 无鼠标操作：降低点击浮窗导致的焦点切换风险。
3. 窗口伪装：更改共享选择器、进程列表、任务管理器和 Alt+Tab 中显示的窗口名。
4. 视觉控制：浮窗透明度、尺寸、字体、工具栏显隐、显示器选择。
5. 截图自隐藏：产品自带截图在采集当前屏幕前短暂隐藏浮窗。
6. 手机物理隔离：软件捕获排除不足或存在物理摄像头时，将答案转移到手机。

上述六层均由官方教程逐项描述，不是从第三方评测归纳。[官方教程](https://interviewasssistant.com/tutorial)

## 2. 平台与会议软件支持

### 桌面平台

| 平台 | 官方当前要求 | 分发方式 |
|---|---|---|
| macOS | macOS 12.0+；Apple Silicon 与 Intel | 官网直接下载 DMG |
| Windows | Windows 10/11 64 位 | 官网直接下载 EXE |
| Linux | 官方下载页未列出 | 未发现官方版本 |

来源：[官方下载页](https://interviewasssistant.com/zh/download)；首页当前列出的安装包版本为 v0.3.44：[官方首页](https://interviewasssistant.com/zh)。本次未找到同类软件的 App Store 或 Microsoft Store 开发者页面，不能写成已通过应用商店分发。

### Web 版边界

网页版 Copilot 被官方标为 Beta 简易体验版，只能用麦克风输入，不能直接捕获系统音频，也没有桌面端的隐身浮窗；完整的“系统音频 + 隐身浮窗”要求安装桌面端。[官方 Dashboard Copilot 页](https://interviewasssistant.com/zh/dashboard/copilot)

### 官方逐项列出的会议与笔试软件

- 飞书 / Lark（个人版与企业版）
- 腾讯会议（个人版与企业版）
- Zoom（个人版与企业版）
- Google Meet
- Microsoft Teams
- 钉钉
- WeMeeting / 企业微信
- HireVue（单机位）
- 赛码网、牛客、京 ME 等笔试客户端

官网还概括为 macOS 与 Windows 上兼容任意视频会议工具，但这是广义宣传口径；精确对比时应优先使用上面的官方枚举列表。[官方教程：支持软件](https://interviewasssistant.com/tutorial) [官方首页](https://interviewasssistant.com/zh)

## 3. 隐身机制与可见性声明

### 官方明确说明

- 官网称隐身浮窗在屏幕共享和录屏状态下“完全不可见”，桌面端功能页也称窗口不会出现在共享和录屏中。[官方首页](https://interviewasssistant.com/zh) [官方 Dashboard Copilot 页](https://interviewasssistant.com/zh/dashboard/copilot)
- 官方技术博客称 macOS 基于 Electron `setContentProtection(true)`，等价于 `NSWindow.sharingType = .none`，让屏幕共享、截图和录屏跳过该窗口。[官方技术博客](https://interviewasssistant.com/zh/blog/hireme-ai-core-tech)
- 官方技术博客称 Windows 使用 `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)`；同一篇文章对其文字解释是录屏和共享会看到黑色区域，但其测试表又把 Zoom、腾讯会议、飞书、Teams、Google Meet 与 OBS 的 macOS/Windows 结果都列为“完全不可见”。这是官方材料内部需要保留的口径差异。[官方技术博客](https://interviewasssistant.com/zh/blog/hireme-ai-core-tech)
- 自带截屏快捷键触发后，应用先把自身隐藏 120ms，再捕获当前屏幕并交给 AI 解题；官方同时警告系统或第三方截图可能把浮窗一起截入。[官方教程：截屏解题](https://interviewasssistant.com/tutorial)

### 官方自己给出的失效边界

- 多屏场景下，官方建议把浮窗放在副屏；理由是即使捕获豁免在极少数情况下失效，副屏仍提供一层物理隔离。[官方教程：浮窗显示器选择](https://interviewasssistant.com/tutorial)
- 点击浮窗输入框可能产生窗口焦点变化，面试或笔试页面可通过 blur 等事件感知“切屏”；捕获排除并不能消除这种交互痕迹。[官方教程：排障“面试官说你切屏了”](https://interviewasssistant.com/tutorial)
- 专用监考或笔试客户端仍可能扫描进程列表，所以产品另提供 Command Prompt、Notes / 记事本等窗口显示名伪装；这也说明捕获不可见和进程不可发现是两类问题。[官方教程：伪装模式](https://interviewasssistant.com/tutorial)
- 双机位、手机第二摄像头拍键盘、线下监考或其他物理摄像头拍屏不受软件级捕获排除保护；官方建议改用手机端并放到摄像头拍不到的位置。[官方教程：双机位与现场监考](https://interviewasssistant.com/tutorial)

### 研究判断

“共享/录屏不可见”是同类软件官方对自身实现和自测结果的声明，本次未找到独立实验室或会议软件厂商的验证材料。最稳妥的比较口径是：**它提供 OS 级内容保护并针对多款常见软件做了厂商自测，但官方也明确提供了失效时的副屏与手机降级路径。**

## 4. UI 结构

### 主应用

公开网页版 Dashboard 的导航包括总览、面试 Copilot、面试记录、模拟面试、模拟面试记录、简历优化、充值积分、兑换码、题库和设置等入口；这表明隐身浮窗是 Copilot 工作流的一部分，而不是独立产品。[官方 Dashboard Copilot 页](https://interviewasssistant.com/zh/dashboard/copilot)

### Setup 页

官方教程直接描述了以下配置层级：

- 顶部四张面试类型卡：综合、行为、技术、编程。
- 回答长度三张卡：简洁、标准、详细。
- 模型档位四张卡：Flash、Plus、Max、DeepSeek。
- 简历、知识库、JD、公司、职位、自我介绍与自定义指令输入区。
- 高级设置：热词、麦克风测试模式、编程语言、浮窗显示器、透明度、字体、窗口大小、伪装模式、自动/手动答题、工具栏显隐、快捷键等。

来源：[官方教程：配置 AI 与浮窗设置](https://interviewasssistant.com/tutorial)。

### 面试浮窗

官方教程明确列出的浮窗组成如下：

- 顶部标题栏可拖动，右下角可自由缩放。
- 顶部工具栏含字号 A- / A+；解题模式会增加“截屏+回答”“找 Bug”等控制。
- 主内容区显示实时转录和流式 AI 建议；滚离底部时会出现“N 条新建议”跳转徽章。
- AI 答案悬停后出现复制按钮。
- Notes 抽屉显示预先写好的自我介绍稿。
- 截图解题后出现“当前题解 / 题目列表”Tab。
- 底部输入框用于纠正题意、追问、缩短或加深回答。

浮窗有小 400×320、中 500×420（默认）、大 620×520 三种初始规格；可继续手动缩放。透明度范围 20%–100%，浮窗字号 10–20，主窗口字号 10–22。[官方教程：浮窗 UI](https://interviewasssistant.com/tutorial)

### 从官方营销素材推断，非发布版确认

官网首屏产品示意图采用 Google Meet 会话状态、Listening、Interviewer transcript 与 AI Suggestion 的分区展示，可推断官方想表达“会议软件旁的即时建议面板”心智。该图是营销素材，不能据此确认 v0.3.44 实际客户端的颜色、像素级布局或视觉还原度。[官方首页](https://interviewasssistant.com/zh)

## 5. 核心交互流程

### 实时语音面试

1. 在 Setup 选择面试类型与回答长度，上传简历、JD 和知识库，并补充自我介绍稿。
2. 选择模型档位、自定义指令和热词；正式面试默认使用系统音频，而非麦克风测试模式。
3. 开始面试后，桌面端在后台捕获会议软件输出、转写面试官语音并自动判断问题结束点。
4. AI 在始终置顶浮窗中流式给出回答建议；用户可复制、展开 Notes、文字追问或强制重答。
5. 需要降低交互痕迹时，用快捷键暂停、触发、重答、隐藏或聚焦输入框。

来源：[官方教程](https://interviewasssistant.com/tutorial) [Copilot 功能页](https://interviewasssistant.com/zh/interview-copilot)。

### 截图解题

1. 面试前选定编程语言，复杂题建议使用 Max 档。
2. 按自带截屏快捷键；应用先隐藏自身，再截取当前屏幕。
3. AI 识别图片中的一道或多道题，输出思路、完整代码和复杂度。
4. 后续可直接强制回答或在输入框追问，无需重新截图。
5. 代码执行失败时切到解题模式，触发“找 Bug”再次截取代码并输出诊断及修复版。

来源：[官方教程：截屏解题与找 Bug](https://interviewasssistant.com/tutorial)。

### 手机同步

1. 桌面浮窗点击手机图标或使用快捷键，弹出二维码、网址和“本地直连 / 云中继”切换。
2. 手机扫码后在浏览器查看答案；本地直连要求同一 Wi-Fi，云中继可使用 4G/5G。
3. 手机端可反向触发桌面截屏、找 Bug、立即回答，也可输入文字追问。

官方给出的延迟口径为本地直连 50–100ms、云中继 200–500ms；这些数字属于厂商说明。[官方教程：手机同步](https://interviewasssistant.com/tutorial)

## 6. 快捷键与控制方式

| 动作 | macOS | Windows | 官方说明 |
|---|---|---|---|
| 立即回答 | `Cmd + Enter` | `Ctrl + Enter` | 自动未触发时强制回答 |
| 重答 | `Cmd + Backspace` | `Ctrl + Backspace` | 换角度重新生成 |
| 截屏解题 | `Cmd + Shift + C` | `Ctrl + Shift + C` | 自带安全截图流程 |
| 暂停 / 恢复转录 | `Cmd + Shift + P` | `Ctrl + Shift + P` | 避免本地说话干扰识别 |
| 显示 / 隐藏浮窗 | `Cmd + Shift + H` | `Ctrl + Shift + H` | 一键收起或恢复浮窗 |
| 聚焦输入框 | `Cmd + Shift + I` | `Ctrl + Shift + I` | 不用鼠标即可纠错、追问 |
| 解题模式 | `Cmd + Shift + S` | `Ctrl + Shift + S` | 显示截图回答与找 Bug 控制 |
| 手机同步 | `Cmd + Shift + L` | `Ctrl + Shift + L` | 打开二维码与连接方式 |
| 精确移动浮窗 | `Cmd + Option + 方向键` | `Ctrl + Alt + 方向键` | 每次移动 50 像素 |

官方教程称共有 16 个动作可在高级设置中自定义快捷键，上表只列教程明确给出默认组合的动作。[官方教程：快捷键](https://interviewasssistant.com/tutorial)

## 7. 限制与风险边界

- **浏览器版没有完整隐身能力。** 网页版只能通过麦克风采音，系统音频捕获和隐身浮窗要求桌面端。[官方 Dashboard Copilot 页](https://interviewasssistant.com/zh/dashboard/copilot)
- **macOS 需要屏幕录制权限。** 官方排障指引要求开启系统设置中的屏幕录制权限并重启应用，否则可能无法捕获系统音频。[官方教程：音频排障](https://interviewasssistant.com/tutorial)
- **Windows 耳机存在 loopback 风险。** 官方称戴耳机时系统音频捕获可能失败，建议取消设备独占控制、关闭占音应用，仍失败则改扬声器外放。[官方教程：Windows 音频排障](https://interviewasssistant.com/tutorial)
- **共享豁免不能阻止焦点检测。** 鼠标点击浮窗仍可能触发页面 blur；因此官方推荐全程快捷键操作。[官方教程：切屏排障](https://interviewasssistant.com/tutorial)
- **进程扫描是另一条检测面。** 伪装模式只改变公开材料所说的显示名，官方没有提供对所有监考检测机制的技术保证。[官方教程：伪装模式](https://interviewasssistant.com/tutorial)
- **物理摄像头不受保护。** 双机位或拍屏场景只能通过副屏或手机位置做物理隔离，不能靠窗口捕获排除解决。[官方教程：双机位与现场监考](https://interviewasssistant.com/tutorial)
- **网络是硬依赖。** 下载页要求稳定网络；教程在网络失败时建议切热点、关闭 VPN 或稍后恢复转录。[官方下载页](https://interviewasssistant.com/zh/download) [官方教程：网络排障](https://interviewasssistant.com/tutorial)
- **答案质量依赖上下文和模型档位。** 官方教程明确警告未填写简历、JD、自我介绍或知识库时可能答非所问、编造经历；低档模型生成代码也可能无法编译。[官方教程：答案与代码排障](https://interviewasssistant.com/tutorial)
- **服务条款限制考试使用。** 同类软件条款明确禁止在不允许辅助工具的考试或测评中使用服务，因此“产品提供伪装/监考场景指引”不等于用户被授权绕过考试规则。[官方服务条款](https://interviewasssistant.com/zh/terms)

## 8. 付费边界

以下为 2026-07-20 对当前 `/zh` 首页定价区的快照；官网仍可调整价格，不应视为长期固定报价。[官方首页定价区](https://interviewasssistant.com/zh)

| 方案 | 当前价格 | Copilot / 隐身相关边界 |
|---|---:|---|
| 按量积分 | 低至 ¥9/次，积分不过期 | 按使用量扣积分 |
| 免费版 | ¥0 | 1 次 Copilot 体验，30 分钟 |
| 基础版 | ¥69/月；¥159/季 | 5 次 Copilot/月，每次 30 分钟；含面试记录回放 |
| 专业版 | ¥129/月；¥289/季 | 官网写“全部功能无限使用”；另含优先响应、编程辅助、详细报告、客服和 API |

模型档位会进一步影响积分消耗：Flash 1×、Plus 2×、Max 3×、DeepSeek 2×；长回答也会增加消耗。该积分倍率来自官方教程，而非首页套餐表。[官方教程：模型档位与积分排障](https://interviewasssistant.com/tutorial)

## 9. 对横向比较最有用的证据分级

| 结论 | 证据性质 | 建议写法 |
|---|---|---|
| 支持 macOS / Windows 桌面端 | 官方下载页直接列出 | 可写为已确认产品范围 |
| 支持列出的会议与笔试软件 | 官方教程直接枚举 | 可写为厂商兼容列表 |
| 共享与录屏不显示浮窗 | 官方承诺与厂商自测 | 必须注明“官方宣称” |
| macOS / Windows 的具体内容保护 API | 官方技术博客 | 可描述实现口径，不等同于独立代码审计 |
| 捕获豁免偶发失效、焦点与进程检测、物理摄像头边界 | 官方教程主动披露 | 可作为隐身能力的明确上限 |
| 浮窗组件、设置卡片、快捷键、手机同步 | 官方教程逐项说明 | 可用于功能/UI/交互对比 |
| 深色或半透明视觉风格 | 官网营销示意图 | 只能标成素材推断，不应当作当前客户端像素级事实 |

## 主要一手来源

- [同类软件官方首页、当前下载与定价](https://interviewasssistant.com/zh)
- [同类软件 Copilot 完整使用教程](https://interviewasssistant.com/tutorial)
- [同类软件 Dashboard Copilot 页面](https://interviewasssistant.com/zh/dashboard/copilot)
- [同类软件 Copilot 功能页](https://interviewasssistant.com/zh/interview-copilot)
- [官方技术博客：系统音频与隐身窗口实现](https://interviewasssistant.com/zh/blog/hireme-ai-core-tech)
- [官方下载页](https://interviewasssistant.com/zh/download)
- [官方服务条款](https://interviewasssistant.com/zh/terms)

