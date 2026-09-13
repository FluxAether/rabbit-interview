---
format: 1920x1080
duration: 74.155s
message: "从简历靶向调优、实战模拟到实时隐形副驾，OnCue 打造全流程桌面面试求职引擎"
arc: "Hook → Step 01 靶向对齐 → Step 02 实战对练 → Step 03 实时护航 → Privacy/BYOK → CTA"
audience: "求职工程师与职场候选人"
mode: collaborative
music: modern-tech-ambient
---

## Video direction
- **Aesthetic Tone**: Ultra-clean dark glassmorphic interface on `#0c0c0e` deep space backdrop. Accents in glowing sky blue `#38bdf8` and emerald `#34d399`. Crisp system typography, sleek neon borders, and subtle radial gradient glows.
- **Pacing & Choreography**: Narrative reveals precisely synchronized with voice timestamps. Staggered reveals paced to spoken cues to prevent front-loading. Each scene resolves into a clear visual anchor with a dedicated 1.5–2s held reading window before cutting.
- **Motion Doctrine**: Easing uses `power3.out` and `expo.out` for crisp mechanical entrances; `power2.inOut` for dimensional depth shifts. No continuous distracting drift—deliberate stillness amplifies information hierarchy.

## Frame 1 — The Hook 痛点切入与视线伴随
- status: animated
- src: compositions/frames/01-hook.html
- duration: 11.051s
- transition_in: cut
- scene: 黑暗中微光呼吸，面试高压场景下，OnCue 极简 HUD 浮窗于视线中央沉着浮现。
- voiceover: 面试遇到刁钻提问？脑子瞬间卡壳？你需要的不只是准备，而是一个随时在视线里护航的副驾。
- asset_candidates: [assets/logo.svg, Copilot HUD Window]
- blueprint: compose
- focal: OnCue Glowing HUD Copilot Window
- roles: HUD = hero cutout · ambient glow = background · badge = supporting

Scene 1 (0.0–3.0s): 深邃黑底上浮现极简微光粒子，大字标题「面试遇到刁钻提问？」伴随轻微故障红光微颤浮现，引出职场面试高压痛点。
Scene 2 (3.0–5.2s): 画面聚焦「脑子瞬间卡壳？」，高对比度警示虚线框收紧，伴随心跳波形图剧烈抖动后骤然定格。
Scene 3 (5.2–7.8s): 画面平滑淡化警示，主标语跃出「你需要的不只是准备」，柔和的天蓝色径向光晕在屏幕中央缓缓展开。
Scene 4 (7.8–11.051s): 随着「随时在视线里护航的副驾」，OnCue 极简半透明玻璃拟态 HUD 浮窗携带着实时音频波形与提示卡片于视线中央升起，光斑掠过窗口边框并持久稳定定格。

## Frame 2 — Step 01 靶向对齐（简历优化）
- status: animated
- src: compositions/frames/02-target-align.html
- duration: 13.013s
- transition_in: crossfade
- scene: 简历与目标岗位 JD 深度匹配诊断，匹配度由浅入深跃升至 82%，量化技术成果提炼。
- voiceover: 第一步，靶向对齐。导入简历与目标岗位，AI 深度解析匹配度，自动提炼量化亮点与核心关键词，让每一次投递都直击要害。
- asset_candidates: [Resume Match Card, assets/logo.svg]
- blueprint: dataviz-countup
- focal: Circular Match Score Ring (60% -> 82%)
- roles: Score Card = hero · Keyword Tags = supporting · Blueprint Grid = background

Scene 1 (0.0–2.6s): 左上方「01 靶向对齐」步骤标识与发光胶囊标签入场，两道技术光束将「候选人简历」与「目标岗位 JD」投射至中轴线。
Scene 2 (2.6–5.0s): 简历与 JD 迅速融合进深度诊断容器，两张卡片交错吸附，呈现「数据链路解析中」动态扫描线。
Scene 3 (5.0–7.4s): 核心匹配圆环展开，数字从 60% 动态递增跃升至 82%，环形进度条由深灰点亮为高饱和天蓝光芒。
Scene 4 (7.4–10.6s): 诊断结果下方依次弹出 3 组量化成果标签（「高并发吞吐提升 300%」、「K8s 集群成本优化」），核心关键词高亮发光。
Scene 5 (10.6–13.013s): 整体卡片定格，印上绿色的「直击要害 - 匹配度卓越」认证徽章，保持阅读静止。

## Frame 3 — Step 02 实战对练（AI 模拟面试）
- status: animated
- src: compositions/frames/03-mock-interview.html
- duration: 13.333s
- transition_in: crossfade
- scene: 选择后端高并发与架构设计场景，全真实语音多轮交锋，实时波形与表现分析。
- voiceover: 第二步，实战对练。模拟真实面试场景，全语音多轮深度交锋。练逻辑、练表达、抗压复盘，在真正上场前胸有成竹。
- asset_candidates: [Mock Interview UI]
- blueprint: compose
- focal: AI Mock Interview Voice Waveform & Exchange
- roles: Waveform Console = hero · Dialogue Bubbles = supporting · Score Radar = supporting

Scene 1 (0.0–2.5s): 「02 实战对练」标识滑入，中央展开控制台，选择预设场景「后端高并发系统设计架构师」，难度标识「Hard · 专家级」点亮。
Scene 2 (2.5–4.8s): AI 面试官拟真头像与声波涟漪激活，提问气泡平滑推入：「如果核心订单服务瞬时流量激增 10 倍，你的限流与降级策略是什么？」。
Scene 3 (4.8–7.2s): 候选人回答动态音频能量条（双向波形）交错跳动，AI 实时生成思路结构分解与多轮追问。
Scene 4 (7.2–10.4s): 右侧即时生成「表现复盘雷达图」：逻辑清晰度 92 分、技术深度 88 分、表达节奏 95 分，各项数据指标柱状动画升起。
Scene 5 (10.4–13.333s): 界面定格为「模拟完成 - 综合战力 S」，沉着大气，静止供观众浏览。

## Frame 4 — Step 03 实时护航（隐形 HUD 副驾）
- status: animated
- src: compositions/frames/04-hud-copilot.html
- duration: 16.107s
- transition_in: crossfade
- scene: 真实面试实战，系统内录直听面试官，极简 HUD 瞬间解析并分步输出答题思路。
- voiceover: 第三步，实时护航。真实面试开启置顶 HUD 浮窗。系统内录直听面试官提问，毫秒级推送结构化回答思路。快捷键一键隐形，全场从容掌控。
- asset_candidates: [Copilot HUD Window]
- blueprint: compose
- focal: OnCue Floating HUD with Real-time Answer Framing
- roles: Floating HUD = hero · Audio Monitor Pill = supporting · Hotkey Badge = interactive

Scene 1 (0.0–2.4s): 场景切换至真实线上视频会议桌面背景，「03 实时护航」徽标亮起，上方置顶小巧的 OnCue HUD 浮窗。
Scene 2 (2.4–5.6s): HUD 顶部的「System Audio 监听」绿灯脉冲闪烁，显示捕捉到面试官音频「请介绍你主导的高并发重构项目」。
Scene 3 (5.6–8.6s): HUD 浮窗瞬间感知，毫秒级在窗口内递进显现黄金答题框架：
「01 先讲背景与 100w QPS 规模」
「02 拆解三层架构优化与关键权衡」
「03 用 P99 延迟降低 60% 数据收尾」。
Scene 4 (8.6–11.9s): 关键词高亮闪动，条理清晰，候选人视线自然保持直视镜头，宛如行云流水般从容应答。
Scene 5 (11.9–13.9s): 屏幕右下角弹出快捷键提示「Alt + Space」，HUD 窗口瞬间响应，透明度优雅过渡至 5% 隐形状态，展现无痕隐匿黑科技。
Scene 6 (13.9–16.107s): HUD 重新恢复至 100% 水晶拟态，高亮「全场从容掌控」，画面平稳凝驻。

## Frame 5 — Privacy & BYOK（本地隐私与自备密钥）
- status: animated
- src: compositions/frames/05-privacy-byok.html
- duration: 10.283s
- transition_in: crossfade
- scene: 本地 SQLite 存储架构与多大模型 BYOK 支持，隐私与自由掌控。
- voiceover: 本地优先，隐私无忧。数据与记录完全存留本机，支持自备 API Key，自由接入主流大模型。
- asset_candidates: [assets/logo.svg]
- blueprint: compose
- focal: Security Shield & Local SQLite Topology
- roles: Privacy Shield = hero · Model Provider Badges = supporting · Data Pipeline = background

Scene 1 (0.0–2.7s): 中央浮现坚固发光的金属玻璃安全盾牌，绿意盎然的加锁图标「Local Encrypted SQLite」在核心处点亮。
Scene 2 (2.7–5.5s): 伴随「数据与记录完全存留本机」，数据流动轨迹从外部返回并锁定在本地容器内部，杜绝云端泄露。
Scene 3 (5.5–7.7s): 盾牌周围展开「BYOK 自由接入」插槽，用户可以自由填入自己的 API Key。
Scene 4 (7.7–10.283s): 4 大主流大模型图标（OpenAI GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro, Deepgram Nova-2）如同星轨般环绕排布并依次点亮，展示自由掌控与极客友好。

## Frame 6 — CTA（品牌定格与免费下载）
- status: animated
- src: compositions/frames/06-cta.html
- duration: 10.368s
- transition_in: crossfade
- scene: 品牌大标与客户端下载，召唤行动。
- voiceover: 从简历定制到真实面试，一站式闭环。立即下载 OnCue，开启你的下一场从容面试。
- asset_candidates: [assets/logo.svg, assets/logo.png]
- blueprint: logo-outro
- focal: OnCue Master Logo & Download Badges
- roles: Logo = hero · Download Badges = supporting · Glow = atmosphere

Scene 1 (0.0–3.0s): 全流程 3 步闭环（靶向对齐 ➔ 实战对练 ➔ 实时护航）图标流星般向中心汇聚融合。
Scene 2 (3.0–4.6s): 中心爆发出震撼的天蓝色离子光晕，OnCue 标志性兔子耳机矢量 Logo 破空而出，品牌文字「OnCue」沉稳落定。
Scene 3 (4.6–6.9s): Logo 下方推入两枚主控按钮：「macOS 客户端下载」与「Windows 客户端下载」，伴随「免费体验」与「GitHub 开源」徽章。
Scene 4 (6.9–10.368s): 核心主标语「你的智能面试副驾 · 每一场都从容不迫」在底纹优雅显现，微光流转，定格收尾。
