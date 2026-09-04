# Research: OnCue (RabbitInterview) go-to-market

**Date:** 2026-09-04  
**Product facts used:** MIT-licensed Tauri 2 desktop interview copilot (macOS/Windows). Local-first BYOK (Deepgram + Groq/OpenAI/Anthropic/Gemini). Optional hosted STT/LLM gateway with OIDC, billed via Alipay. Copilot + mock interviews + resume optimizer. README already says: use only where interview/assessment rules allow assistance.

## Summary

The 2025–2026 interview-copilot market is a noisy, high-CAC category of closed SaaS tools selling “undetectable” live overlays at **~$20–$299/month (US)** and **¥69–¥1,299 (CN)**. Trust is collapsing: Cluely’s “cheat on everything” brand plus a widely reported 2025 breach, Interview Coder’s $299/mo stealth premium, and 面试狗’s exam-evasion kits. OnCue should **not compete on invisibility**. Keep the **desktop MIT and BYOK-complete**; charge only for **hosted inference convenience**. That is the Obsidian Sync / Ollama Pro / Continue Hub pattern, not GitLab open-core. Never claim undetectability or guaranteed offers. For mainland hosted AI, treat CAC genAI filing + domestic-model registration as a real gate, not a later checkbox.

## Findings

### 1. Competitive landscape (2025–2026)

The category has three layers that get marketed as one product:

1. **Prep** (mocks, resume, question banks) — relatively legitimate, crowded, low willingness-to-pay except in campus season.
2. **Live copilot** (system audio → STT → suggested answers in a private window) — OnCue’s core.
3. **Stealth / anti-detection / OA cheating** (hide from screen share, dual-device 笔试, gaze “repair”) — where most paid conversion and most legal/brand risk sit.

Almost every commercial player gates **stealth behind paid**. That is the actual SKU. OnCue already has a floating copilot; it should not productize “undetectable.”

#### Final Round AI — closed SaaS, desktop-first copilot + prep suite

- **Positioning:** Interview CoPilot™ as a full-loop desktop app (prepare / live or practice / debrief). Claims 500,000+ users and 4.9 Product Hunt. [What is Final Round AI](https://www.finalroundai.com/blog/what-is-final-round-ai)
- **Stealth:** Official Stealth Mode page: hides floating CoPilot windows from Zoom / Meet / Teams screen shares and recordings; **on by default**; “test it once… setups vary.” Schema.org offer on that page lists **price 25 USD**. [Stealth Mode](https://www.finalroundai.com/stealth-mode)
- **Architecture:** Native desktop (macOS 14.4+, Windows in schema). Audio + overlay. Closed.
- **Pricing (official blog, 2026):** Annual **$25/mo billed $300/yr**; quarterly **$60/mo billed $180/qtr**; monthly **$90/mo**. **No permanent free tier** in this article; **10-minute trial**; quarterly/annual **3-day refund**; monthly **non-refundable**; 10% discount for students/veterans/first responders/recently laid-off. Job Hunter add-on **$24.99–$74.99/mo**. [What is Final Round AI](https://www.finalroundai.com/blog/what-is-final-round-ai)
- **Contradiction:** A 2026 product post says practice is on a **free plan**, live Copilot / Stealth / debriefs need paid, and “there is no free trial for live sessions.” [What's new](https://www.finalroundai.com/blog/whats-new-interview-copilot) Homepage schema also advertises `price: 0`. Treat **$25 / $60 / $90** as the paid ladder; treat “free” as marketing that has been rewritten at least twice in 2026.
- **Target:** English-first job seekers on Zoom/Meet/Teams; coding + behavioral.
- **Trust:** Aggressive stealth marketing; competitor blogs allege screen-share leaks. No primary-source breach found. Closed SaaS.

#### LockedIn AI — closed SaaS, web + paid desktop stealth

- **Positioning:** Interview copilot with coding/OA (HireVue, CodeSignal, Codility, HackerRank), “True Stealth Mode,” optional **LockedIn Duo** (live human assist).
- **Stealth:** Desktop-only. Official blog: Unlimited General **has no desktop app**, hence no True Stealth. Pro and credit plans get desktop + Smart Area Selection + True Stealth. [Subscription plans](https://www.lockedinai.com/blog/lockedin-ai-subscription-plans)
- **Architecture:** Browser copilot + separate desktop for stealth. Models named on official blog: Azure GPT, Gemini 2.0, Deepseek V3, O3 on Pro.
- **Pricing:** **Official public dollar amounts not on the blog.** Plan *structure* is Unlimited General / Unlimited Pro (monthly or quarterly) / credits (quarterly or yearly, e.g. 2400 credits/year; general meeting 0.5 credit/min, professional 1/min; credits never expire). Third parties disagree: LastRound reconstruction (June 2026) ~**$54.99/mo** Unlimited Pro, credits ~**$34.99–$69.90**; Interview Coder comparison lists Unlimited General **$54.99**, Unlimited Pro **$119.99**, quarterly credits **$149.97**, yearly **$419.88**; Final Round’s LockedIn pricing article claims **$49.99/mo** or ~**$29.99** quarterly and lifetime **$1,499.25**. **Do not quote a single LockedIn price as verified.**
- **Target:** Engineers doing OA + live coding.
- **Trust:** Pricing gated behind signup (LastRound, June 2026). Closed SaaS.

#### Cluely — closed SaaS, viral “cheat on everything” meeting overlay

- **Positioning:** General meeting / homework / sales / interview overlay. Founders Chungin “Roy” Lee and Neel Shanmugam; Interview Coder origin; Columbia suspension. Seed **$5.3M** (Abstract + Susa, TechCrunch 2025-04-21). Series A **$15M led by a16z** (TechCrunch 2025-06-20); two investors told TC post-money ~**$120M**. Lee claimed **>$3M ARR** at seed. [TC seed](https://techcrunch.com/2025/04/21/columbia-student-suspended-over-interview-cheating-tool-raises-5-3m-to-cheat-on-everything/) [TC A](https://techcrunch.com/2025/06/20/cluely-a-startup-that-helps-cheat-on-everything-raises-15m-from-a16z/) [a16z note](https://a16z.com/announcement/investing-in-cluely/)
- **Stealth:** Paid SKU. Official pricing: **Pro + Undetectability $149.99/mo** — “Completely hidden to meeting screen sharing software.” [cluely.com/pricing](https://cluely.com/pricing)
- **Pricing (official page, fetched 2026-09-04):** Starter **Free** (limited AI responses, limited notetaking); Pro **$19.99/mo** (unlimited responses/notes/latest models); Pro + Undetectability **$149.99/mo**. Page title also says “from $11.99/mo” — **contradicts the $19.99 body**. Use **$19.99 / $149.99**.
- **Architecture:** Desktop overlay (macOS/Windows). Closed.
- **Trust:** Category poison. Mid-2025 breach of **~83,000 users** (transcripts/screenshots) is widely repeated by competitors and secondary blogs (admin creds in GitHub + GraphQL). **No Cluely incident report or reputable newsroom confirmation found in this pass** — treat as high-circulation allegation, not court-verified fact. Brand is what recruiter-side detectors train on.

#### Interview Coder — closed desktop, coding-interview stealth

- **Positioning:** “No. 1 undetectable AI for interviews”; LeetCode / system design overlay. Historically Roy Lee’s OSS Electron app; **current GitHub `ibttf/interview-coder` is releases-only**, README: “contains only releases.” Closed now. [GitHub](https://github.com/ibttf/interview-coder)
- **Stealth:** 20+ undetectability features; no dock; click-through; daily testing claims. Independent testers report Zoom/macOS visibility failures — not verified here.
- **Pricing:** Repeated across vendor blog and third parties: download free (no AI); **Monthly Pro $299** (listed vs original $499, 1,000 credits); **Lifetime Pro $799** (vs $1,598). Newsfile (2025-12-22) announced 2.0 lifetime license. **Exact live checkout not extracted** (JS-heavy homepage) but $299/$799 is the consistent public figure.
- **Target:** SWE coding rounds. Highest sticker in the category.
- **Trust:** Founder/ethics baggage; detection arms race; closed.

#### Sensei AI — closed browser copilot

- **Positioning:** Browser real-time copilot, resume/story editor, coding copilot. “11K+ job seekers” on homepage. [senseicopilot.com](https://www.senseicopilot.com/)
- **Stealth:** Discreet / separate window; Chrome extension listener to avoid share banners. **Not OS-level exclude-from-capture.** Full-desktop share exposes it (consistent third-party reports).
- **Pricing:** Official homepage fetch did not return the numbers (Framer). Multiple independent writeups quoting the site: Free **15-min** sessions; Pro **$89/mo** or **$24/mo billed annually ($288/yr)**; **no refunds**. Treat as **likely but not homepage-verified in this run**.
- **Architecture:** Browser / extension. Closed SaaS.

#### HireMe AI / 即答侠 — closed CN SaaS, closest feature twin

- **Positioning:** Desktop copilot for 腾讯会议 / 飞书 / 钉钉 / Zoom / Meet; 700ms claim; mock interviews; resume; English FAANG mode. Domain `interviewasssistant.com` (three s’s). [中文站](https://interviewasssistant.com/zh)
- **Stealth:** “隐身浮窗…屏幕共享和录屏完全不可见.”
- **Pricing (official `/zh/pricing`, fetched):** Free **¥0** — 3 mocks/mo, 1 resume analysis, 1 Copilot trial (30 min), basic bank. Basic **¥69/mo** or **¥159/季**. Pro **¥129/mo** or **¥289/季**. Credits “低至 ¥9/次, 不过期.” Scholarship copy: 上岸大厂 recharge refund with offer proof. [Pricing](https://interviewasssistant.com/zh/pricing)
- **Older aggregator pages still list ¥49/¥79** — **stale. Use ¥69/¥129.**
- **Target:** CN 校招/社招 + mixed EN. Closed SaaS.

#### 面试狗 — closed CN SaaS, high-risk cheating kit

- **Positioning:** Live interview + **online 笔试** screenshot solver; dual-device; “眼神修复”; recharge-gated invisible earbuds.
- **Pricing (official docs):** 包月 **¥666**; 双月 **¥999**; 包季 **¥1299**. Usage: interview **¥0.5–¥1/min**. Gaze feature at cumulative **¥300**; dual-device kit / earbuds at **¥666**. Founded Aug 2023. [docs.interviewdog.cn](https://docs.interviewdog.cn/docs/tutorial)
- **Trust / legal:** This is exam-proctor evasion, not interview prep. Do not copy claims, SKUs, or channels. Closed SaaS.

#### LastRound AI — closed SaaS, copilot + credits + auto-apply

- **Positioning:** Live copilot “<200 ms,” “completely undetectable on any screen share,” plus mocks, resume, auto-apply.
- **Pricing (official plan table on site):** Free **$0** (15 credits/mo, 5 auto-applies, desktop). Starter **$19/mo** (120 credits). Professional **$49/mo** (390). Ultimate **$99/mo** (990). Live copilot + mocks **1 credit/minute**. [lastroundai.com](https://lastroundai.com/)
- **Trust:** Marketing quotes (“failed all my CS classes”) are offer-guarantee adjacent. Closed SaaS. Their LockedIn review is a competitive attack piece.

#### Beyz — closed SaaS, “invisible” overlay + cheat sheets

- **Positioning:** Real-time suggestions, LeetCode assistant, cheat sheets; “completely invisible to Zoom, Meet, Teams, and every screen recorder”; “users are 5x more likely to land jobs.” [beyz.ai](https://beyz.ai/)
- **Pricing:** **`/pricing` 404.** Third parties quote **$24.99–$49.99**. **Unverified.**
- **Architecture:** Overlay; closed.

#### Cheating Daddy — GPL-3.0 desktop, BYOK (closest OSS analog)

- **Positioning:** “Listens… sees your screen… Completely invisible during screen share.” Profiles for interview / sales / study.
- **Architecture:** Electron; screen + system audio → Gemini; **BYOK**. Releases added Groq BYOK, local AI, and “cheating daddy cloud.”
- **License:** **GPL-3.0, not MIT.** [github.com/sohzm/cheating-daddy](https://github.com/sohzm/cheating-daddy) Site: “100% free… no premium tier.” [cheatingdaddy.com](https://cheatingdaddy.com/)
- **Stars:** ~5.5k. Fork risk for any MIT/GPL copilot is demonstrated here.
- **Implication for OnCue:** A named, viral OSS competitor already occupies “free stealth overlay + BYOK.” OnCue’s differentiators are Tauri (not Electron), local SQLite, mocks + resume, bilingual UI, optional hosted Alipay gateway — **not stealth branding**.

#### Ecoute — MIT hobby transcriber, not a commercial copilot

- Live mic + speaker transcription; optional Whisper API + GPT-3.5 suggestions. **MIT.** Windows-oriented. ~6k stars. [SevaSk/ecoute](https://github.com/SevaSk/ecoute)
- Ancestor of many “interview assistant” forks. Not a priced product.

#### Other notable names (thin primary evidence)

| Product | What is known | License / model |
|---|---|---|
| Interview Sidekick | Competitor blogs; free-tier positioning vs LockedIn/Cluely | Closed SaaS (unverified pricing) |
| Cornerman | Coach-style hints, $1 trial / $39/mo in *its own* buyer’s guide | Closed; treat as self-reported |
| InterviewMan | Comparison pages vs Sensei | Closed |
| WingMan / interview-hacker | Electron overlay, Groq BYOK, `setContentProtection` | Small GitHub, not a market leader |
| AnswerCue | Desktop prep + live STT; **AGPL-3.0** | OSS |
| leetcode-mafia/cheetah | Early macOS coding assistant, often cited | OSS, niche |

**Category price band (decision use):** US live stealth **$19–$90/mo typical, $149–$299 outlier**; CN live **¥69–¥129/mo** or 面试狗 **¥666/mo**. Prep-only tools sit lower. Lifetime SKUs exist because job search is bursty (Interview Coder $799, LockedIn lifetime alleged).

---

### 2. Market environment

#### Demand is real on both sides of the table

- **Employer AI in recruiting is majority-ish in the US.** SHRM 2025 Talent Trends (2,040 HR pros, Feb 2025), as cited in later 2026 roundups: **51% of US organizations use AI in recruiting**; **89%** of those cite time/efficiency. Greenhouse platform: applications per job **28 (2021) → 95 (2025), +239%**. Greenhouse 2026 candidate survey (2,950 seekers, 5 markets): **63% of US candidates have had an AI interview**; **70%** say AI was not clearly disclosed; **38%** withdrew over an AI interview. [InterviewFlowAI compilation](https://interviewflowai.com/blog/ai-recruitment-statistics) (secondary; SHRM/Greenhouse primary not re-fetched — 404 on one SHRM URL).
- **CN campus: AI is default for graduates.** 前程无忧《2026校园招聘白皮书》reporting: **65.3% of enterprises used AI in 2025 campus recruiting** (+12.7 pp YoY); AI interviews **33.1%**, resume screen **31.8%**. Graduates using AI to job-hunt: **72.4% (2024 class) → 91.5% (2026 class)**; resume **66%**, interview prep **64%**. [网易转载](https://c.m.163.com/news/a/L1BA09Q705506BEH.html)
- **CN hiring mix:** China Daily / Maimai (first five months 2026): campus openings +3.56% YoY; **AI-related openings +47.3%**; AI share of new graduate posts **26.41% → 37.56%**. [China Daily](https://global.chinadaily.com.cn/a/202607/08/WS6a4da707a310986e2b4640e4.html)
- **C-end “assistant” vs “do it for me”:** 艾瑞 2026 commentary: 智联 survey **51.9% already use AI to job-hunt**, **87.2% want a dedicated AI job tool**. Platforms (智联求职侠, BOSS 职决, Offer快) are moving into auto-apply, which **is not OnCue’s job**. Stay in copilot + mock + resume.

#### Seasonality (plan launches and paid conversion around these)

| Market | Peak | Implication |
|---|---|---|
| CN 秋招 | Aug–Oct (offers into Nov) | **Primary CN launch window.** Hosted minutes spike. |
| CN 春招 | Feb–Apr | Second spike; intern conversions. |
| CN 金三银四 / 金九银十 | Mar–Apr, Sep–Oct 社招 | Job-hopper BYOK + short hosted packs. |
| US campus | Aug–Nov + Jan–Mar | English GitHub/HN less seasonal than CN social. |
| US experienced | Always-on, weaker seasonality | Monthly hosted, not annual. |

Do **not** sell annual seats as default. Job search lasts ~2–4 months. Competitors already learned this (Final Round quarterly; HireMe 求职季卡; Interview Coder lifetime).

#### Willingness to pay

- **Prep** (mocks, resume): CN graduates already get free/cheap tools from 智联, university platforms, DeepSeek-backed provincial sites. WTP is **low** unless tied to a live interview next week.
- **Live copilot:** WTP is **high and bursty**. US $19–$90/mo is proven. CN ¥69–¥129 is the local ceiling for “respectable” tools; ¥666 is the cheating-kit ceiling.
- **BYOK users** (OnCue’s natural GitHub audience) will **not** pay a seat fee for software they can build. They will pay to **avoid Deepgram/OpenAI billing, latency, and key management** — if hosted is cheaper/simpler than BYOK *for a 45-minute interview*.
- **Never** hide hosted rates. LockedIn’s gated pricing is a documented churn reason.

#### Regulatory and ethical risk

**Interviews vs exams vs assessments**

- Coaching / mock / resume: generally acceptable.
- Live suggested answers in a real interview: **policy-dependent**. Amazon and others require candidates to attest they will not use unauthorized tools (TechCrunch on Lee/Amazon). Employer detection products exist; “100% undetectable” is a false claim and a future lawsuit magnet.
- **Proctored OA / 笔试 / civil-service exams:** 面试狗-style dual-device and “gaze repair” is academic/employment fraud territory. OnCue README already forbids this; GTM must repeat it in CN copy.

**China generative-AI filing (hosted gateway selling inference to 境内公众)**

Primary text: 《生成式人工智能服务管理暂行办法》, CAC + 6 agencies, effective **2023-08-15**. [CAC](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)

Material articles:

- **Art. 2:** Applies to providing genAI **to the public in the PRC** (text/image/audio/video). **Internal R&D/use that is not public-facing is out of scope.**
- **Art. 2 / 22:** “Provider” includes **API** provision.
- **Art. 17:** Services with **public-opinion or social-mobilization attributes** → security assessment + algorithm filing under the recommendation-algorithm rules.
- **Art. 20:** Overseas services into China that violate PRC law can be **technically blocked**.
- **Art. 11:** Do not illegally retain identifiable inputs/logs; PIPL duties.
- **Art. 12:** Label synthetic image/video (less relevant for text suggestions, still a process).

CAC still publishes filing batches. Announcement covering Mar–Apr 2026: **+72 filings, +49 registrations**; cumulative **868 filed, 530 registered** as of **2026-04-30**. Apps must show **model name + filing/registration number**. [CAC 2026-05-13](https://www.cac.gov.cn/2026-05/13/c_1780413225190669.htm)

Practical reading for OnCue:

| Mode | Likely CAC posture |
|---|---|
| Desktop BYOK: app talks to Deepgram/OpenAI from the user’s machine | User is the API customer; OnCue is not the genAI *service provider*. Still: don’t proxy the keys. |
| Hosted gateway **outside** China, marketed only to non-PRC users | Measures target 境内公众; still Art. 20 risk if you onboard mainland users. |
| Hosted gateway **sold to mainland users** (Alipay, Chinese copy) | You are a **provider**, including via API. Using **unfiled overseas models** for a public CN service is the fact pattern commentators flag as non-compliant. Need a **filed domestic model** (or a registered app on top of one), content filters, user agreement, complaint channel, possible security assessment. |
| China-hosted website/app | **ICP 备案** (MIIT) for the site; 应用商店 filings; PIPL/DSL if you store 简历/面试 audio. |

**Do not** ship a mainland hosted LLM that just wraps OpenAI/Anthropic/Groq and take Alipay. That is the expensive way to get blocked.

**ICP:** Required for internet information services hosted in mainland. A GitHub Pages EN site is not an ICP problem. A `oncue.cn` + China CDN + Alipay checkout **is**.

#### Payment friction

- Mainland consumers **do not** reliably have Visa/Mastercard. Stripe/PayPal-only hosted billing **kills CN conversion**.
- Alipay for *receiving* as a foreign merchant is **cross-border acquiring**, not a personal Alipay QR. Stripe documents Alipay as a method for overseas businesses; consumer overseas-card-in-Alipay fees are commonly **3% above ¥200** (Stripe Alipay guide). [Stripe](https://stripe.com/resources/more/alipay-an-in-depth-guide)
- Domestic Alipay (境内商户, 营业执照) is smoother if you have a PRC entity. Without one: Alipay+ / cross-border PSPs (Airwallex, PingPong, LianLian) — slower KYC, higher MDR, industry MCC restrictions.
- OnCue’s “billed via Alipay” is the **correct CN default**. Keep a second rail (Stripe) for EN BYOK-fail users.

---

### 3. Open-source vs closed vs open-core playbooks that fit a desktop BYOK + optional hosted inference

OnCue is **not GitLab**. It is a local app whose costly resource is **GPU/API minutes**, not seat-gated enterprise features. Map to products that already split **client (free)** vs **hosted convenience (paid)**.

| Playbook | License | Free | Paid | Fork risk | Fit for OnCue |
|---|---|---|---|---|---|
| **Obsidian** | Closed local-first | Full app, no account | Optional Catalyst; **Sync $4–5/user/mo** (1 vault / 1GB) or **Plus $8–10** (10 vaults / 10GB); Publish separate; commercial license *encouraged* not required | Low (closed) | **Best analog for product, worst for license** (OnCue is already MIT). Steal: never rent the local app; rent sync/inference. [obsidian.md/pricing](https://obsidian.md/pricing) [license](https://obsidian.md/license) |
| **Ollama** | **MIT** client | Local models free | Cloud **Pro ~$20/mo** with included usage (site copy) | High, accepted | **Best license analog.** Give away the runner; sell hosted models. [github.com/ollama/ollama](https://github.com/ollama/ollama) |
| **Continue.dev** | **Apache-2.0** IDE | BYOK / local forever | Hub was $3/M tokens, Teams ~$20/seat; **acquired by Cursor (2026)**; Hub billing dead, data deletion announced | High; acquisition ended the company | Proof that **MIT/Apache client + hosted hub works until a bigger closed tool buys you**. Do not build Hub-like lock-in as the only asset. [continue.dev](https://continue.dev/) [LICENSE](https://github.com/continuedev/continue/blob/main/LICENSE) |
| **Open WebUI** | Custom “keep the name” license; branding required if **>50 users / 30 days** unless enterprise license | Self-host | Enterprise de-brand | Forks + angry relicensing | Warning: relicensing a community MIT/BSD app **burns trust**. Don’t do this to OnCue later. [LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE) |
| **Plausible** | **AGPLv3 CE**; cloud withholds funnels, journeys, e-comm, SSO, Sites API; CE ships **twice a year** | Self-host CE | Cloud subscription (Starter advertised ~$9→$6/mo in secondary captures; confirm live) | AGPL slows parasitic SaaS; does **not** stop serious forks | Fit **only if you copyleft the gateway**. Bad fit for a desktop MIT app. [self-hosted](https://plausible.io/self-hosted-web-analytics) |
| **PostHog** | MIT core + `ee/` proprietary; `posthog-foss` purge repo | Hobby Docker, no support; Cloud free tier 1M events | Usage cloud; paid features **cloud-only**; K8s self-host deprecated | They *want* you on Cloud | Same conversion mechanic OnCue wants: OSS is a demo, **Cloud is the product**. Docs actively talk people out of self-host. [self-host](https://posthog.com/docs/self-host) [GitHub](https://github.com/PostHog/posthog) |
| **Supabase** | Apache-2.0 client libs / studio; hosted | Free project limits | **Pro from $25/mo** + compute | High | Hosted database analog of hosted STT. |
| **Sentry** | Was **BUSL**, now **FSL-1.1-Apache-2.0** (no competing SaaS; reverts Apache after **2 years**). SDKs MIT/Apache. | Self-host for internal use | Cloud Team/Business (**~$26 / $80** on pricing page, usage extra) | Fair Source stops cloud clones, **not** a desktop-BYOK problem | **Do not FSL the desktop.** Maybe FSL the *gateway* if clones resell it. [open.sentry.io/licensing](https://open.sentry.io/licensing/) [FSL intro](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/) |
| **GitLab** | MIT CE + source-available EE; buyer-based: IC features OSS, manager features paid. Promise: **never move OSS → paid**. | Full forge, no artificial limits | Premium/Ultimate seats (marketing: Ultimate **$1,188/user/year** in handbook language; public pricing page **$29/user/mo** Premium — confirm live) | CE forks exist (Gitea etc. in adjacent space) | **Poor fit.** Open-core of “stealth window” vs “mock interview” will look extractive and is easy to reimplement. [Stewardship](https://handbook.gitlab.com/handbook/company/stewardship/) |
| **Cal.com** | 2026 split: **Cal.diy MIT** (personal self-host, EE stripped) vs **closed** commercial Cal.com. Cloud **Teams $12/seat/yr-billed**, **Orgs $28**, Enterprise custom. | Community self-host | Cloud + private EE repo | They already forked themselves | Cautionary: MIT-everything then clawing EE **out** is a trust event. [v6.4 changelog](https://cal.com/blog/calcom-v6-4) [linear-style pricing analog on cal.com/pricing](https://cal.com/pricing) |
| **Linear** | **Closed.** PLG. | Free: unlimited members, **2 teams, 250 issues** | Basic **$10/user/mo yearly**; Business **$16**; Enterprise custom | N/A | Steal **pricing-page brevity** and volume caps, not the license. [linear.app/pricing](https://linear.app/pricing) |
| **Ghostty / WezTerm / Alacritty** | Ghostty **MIT**; Alacritty **Apache-2.0**; WezTerm OSS (license file present). No paid tier. HashiCorp-founder distribution, GitHub stars. | Everything | Donations / none | High, irrelevant | Distribution analog: **quality desktop OSS** gets EN developer reach. Not a revenue model. [Ghostty LICENSE](https://github.com/ghostty-org/ghostty/blob/main/LICENSE) |

**Conversion mechanics that actually match OnCue**

1. **Local app is complete without an account** (Obsidian, Ollama, Continue, GitLab promise #9).
2. **Paid = someone else runs the expensive API** (Obsidian Sync, Ollama Pro, Continue Hub, PostHog Cloud).
3. **Do not seat-license individuals** (Linear/GitLab). Job seekers are not teams.
4. **Do not time-bomb the MIT desktop** (Sentry FSL / Cal.com clawback). Community will snapshot v1.
5. **Expect forks** (Cheating Daddy, Ecoute). Compete on signed builds, latency, CN ASR, Alipay, and not being a cheat brand.

---

### 4. Practical GTM for OnCue

#### Recommended default path (do this, skip the rest)

**Keep the desktop MIT and feature-complete on BYOK. Sell hosted STT+LLM minutes. Two rails: Alipay (CN) and cards (EN). Position as local-first interview prep + optional live copilot, never as stealth.**

That is Ollama + Obsidian Sync, not Cluely, not GitLab.

#### What to keep MIT

- Tauri/React client, audio capture, overlay, mock interview, resume optimizer, local SQLite, i18n, updater metadata format.
- BYOK provider adapters.
- Docs and verify scripts.

**Do not** move overlay, system-audio, or “exclude from capture” into a proprietary module. GitLab’s “who cares most” test would put those in OSS anyway (individual contributor). Relicensing after MIT is Cal.com/Open WebUI territory.

#### What may stay proprietary (optional, small)

- **Hosted gateway** (`server/`): OIDC, billing, provider keys, abuse filters, CN content compliance if you ever file. Can be **not in the public repo**, or public with a **non-compete / FSL** if you fear resale. Default: **source-available or private** is enough; don’t bikeshed BUSL.
- **Signed build pipeline**, notarization, Authenticode.
- **Prompt packs / company-specific banks** if you ever sell them — but YAGNI; JD+resume grounding is enough.

#### How to price hosted vs BYOK

**BYOK: $0 forever.** No credit card. No account required (already true). This is the GitHub/HN wedge and the privacy story.

**Hosted: usage, not seats.** Job search is 3–8 interviews, not 12 months.

Decision defaults (tune after first 50 paying users; not sacred):

| SKU | Role | Ballpark | Why |
|---|---|---|---|
| Hosted trial | First session | **30–45 min once**, no card if possible | Sensei 15 min is too short for a real interview; Final Round 10 min trial is a tease. |
| CN 场次包 | 秋招 burst | **¥29–¥49 / 60 min** or **¥99 / 300 min / 90 days** | Under 即答侠 ¥69–¥129/mo; not 面试狗 ¥666. Credits that **don’t expire for 90 days**. |
| CN monthly | Heavy users | **¥79–¥99/mo uncapped-with-fair-use** | Only if abuse appears. |
| EN pack | Same | **$9 / 60 min** or **$29 / 300 min / 90 days** | Undercut Final Round $25–$90 and Cluely $20 without matching $149 stealth. |
| EN monthly | Optional | **$19/mo** | Match Cluely Pro *without* undetectability SKU. |

Price hosted so that **a 45-minute interview is cheaper than a panicked OpenAI+Deepgram setup**, not cheaper than cheating. Publish **¥/min and $/min**. No gated pricing.

Do **not** sell lifetime. You pay GPU forever; Interview Coder’s $799 lifetime is their problem.

#### Channels

**CN**

- GitHub README 中文 + 即得的 `.msi/.dmg`.
- 小红书 / B站：mock + resume + 系统音频权限教学. 前程无忧：新媒体求职渠道 **29.5%** and rising.
- 牛客 / 一亩三分地: technical, but **no 笔试 auxiliary**.
- WeChat customer only if you can staff it; 即答侠/面试狗 win on 客服, not model quality.
- **Alipay checkout in-app.** No “bind Visa.”
- University career-center mock positioning (ZJU-style) is the clean brand. Don’t pay KOLs to demo hiding from 腾讯会议.

**EN**

- GitHub, HN, r/cscareerquestions **prep** framing; avoid r/csMajors stealth threads.
- Contrast: “keys stay on disk; we don’t need your interview audio unless you turn on hosted.” Cluely breach narrative is the opening.
- Signed macOS/Windows builds. Unsigned Tauri apps die in this category.

**Do not** run the same landing page. CN “面试辅助” is read as cheating; EN “stealth copilot” is read as Cluely. Split copy:

- EN: *Local-first interview copilot. Practice, resume match, optional live notes. BYOK.*
- CN: *本地优先的模拟面试 / 简历对照 / 可选实时提纲. 请遵守面试与考试规则.*

#### Claims that must never be made

Hard bans (legal + detection arms race + CAC):

1. **Invisible / undetectable / 100% 隐身 / 面试官完全无感 / 录屏也看不到.** OS APIs (`WDA_EXCLUDEFROMCAPTURE`, `NSWindowSharingNone`) are **best-effort** and break across Zoom versions, macOS permissions, and full-desktop share. Final Round’s own stealth FAQ already hedges (“test once”). Cluely sells undetectability as a **$149.99** line item — that is the hole you do not enter.
2. **Guaranteed offer / 5x more likely to land jobs / 上岸返还.** Beyz “5x”; 即答侠 Offer 奖学金; LastRound “failed all my CS classes.”
3. **Works on HireVue / CodeSignal / 笔试 / 公务员 / 四六级.** OA and exams.
4. **Military-grade / GPU-level undetectable / WebRTC invisible mode** (面试狗).
5. **We don’t store audio** if hosted mode does. PIPL/Art. 11.

Allowed, if true:

- Floating window; user can place it off the shared display.
- Local BYOK: keys and history on device.
- Mock interviews and resume-vs-JD.
- “Use only where rules allow.”

Ship a **one-screen preflight** that says the product can appear in a full-screen share. That is a feature, not a bug.

#### 90-day default sequence (minimum)

1. MIT GitHub + signed macOS/Win BYOK. No account.
2. EN landing: local-first, no stealth hero.
3. CN landing + Alipay hosted packs, **or** delay hosted-CN until a filed domestic model is wired. If you cannot file, **do not take mainland hosted traffic**; sell BYOK only in CN.
4. Price packs; kill anything that looks like 隐身套餐.
5. Ignore open-core, lifetime, Duo humans, auto-apply.

## Sources

### Kept (primary or high-signal)

- OnCue README / MIT LICENSE — product constraints.
- [Final Round — What is Final Round AI](https://www.finalroundai.com/blog/what-is-final-round-ai) — $25/$60/$90, 10-min trial, add-on prices.
- [Final Round — Stealth Mode](https://www.finalroundai.com/stealth-mode) — official stealth hedge + $25 schema.
- [Final Round — What's new Interview Copilot](https://www.finalroundai.com/blog/whats-new-interview-copilot) — 2026 free-practice vs paid-live contradiction.
- [Cluely pricing](https://cluely.com/pricing) — Free / $19.99 / $149.99.
- [TechCrunch Cluely $15M](https://techcrunch.com/2025/06/20/cluely-a-startup-that-helps-cheat-on-everything-raises-15m-from-a16z/) and [seed $5.3M](https://techcrunch.com/2025/04/21/columbia-student-suspended-over-interview-cheating-tool-raises-5-3m-to-cheat-on-everything/).
- [a16z Investing in Cluely](https://a16z.com/announcement/investing-in-cluely/).
- [LockedIn official plan structure](https://www.lockedinai.com/blog/lockedin-ai-subscription-plans).
- [Interview Coder GitHub releases-only](https://github.com/ibttf/interview-coder).
- [HireMe AI official pricing](https://interviewasssistant.com/zh/pricing).
- [面试狗 docs pricing](https://docs.interviewdog.cn/docs/tutorial).
- [LastRound site plans](https://lastroundai.com/).
- [Beyz marketing](https://beyz.ai/).
- [Cheating Daddy site](https://cheatingdaddy.com/) + [GPL repo](https://github.com/sohzm/cheating-daddy).
- [Ecoute MIT](https://github.com/SevaSk/ecoute).
- [Sensei homepage](https://www.senseicopilot.com/).
- [CAC 生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm).
- [CAC filing batch 2026-05-13](https://www.cac.gov.cn/2026-05/13/c_1780413225190669.htm).
- [GitLab stewardship](https://handbook.gitlab.com/handbook/company/stewardship/).
- [Sentry licensing](https://open.sentry.io/licensing/) + [FSL announcement](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding/).
- [PostHog self-host docs](https://posthog.com/docs/self-host) + [GitHub](https://github.com/PostHog/posthog).
- [Plausible CE vs Cloud](https://plausible.io/self-hosted-web-analytics).
- [Obsidian pricing](https://obsidian.md/pricing) + [license](https://obsidian.md/license).
- [Linear pricing](https://linear.app/pricing).
- [Cal.com v6.4 license split](https://cal.com/blog/calcom-v6-4).
- [Continue.dev acquisition notice](https://continue.dev/).
- [Open WebUI LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE).
- [Ollama GitHub MIT](https://github.com/ollama/ollama).
- [Stripe Alipay guide](https://stripe.com/resources/more/alipay-an-in-depth-guide).
- [China Daily campus AI hiring](https://global.chinadaily.com.cn/a/202607/08/WS6a4da707a310986e2b4640e4.html).
- [前程无忧 2026 校招白皮书 coverage](https://c.m.163.com/news/a/L1BA09Q705506BEH.html).

### Dropped or heavily discounted

- Interview Sidekick / Cornerman / InterviewMan / Dupple “reviews” — competitor SEO; prices used only when flagged unverified.
- CSDN/AtomGit “yidaxia.ai $10/mo vs Final Round” — unsourced latency table; contradicts official 即答侠 ¥ pricing.
- Toolify/TopAIHubs 即答侠 ¥49/¥79 — stale vs official ¥69/¥129.
- Cluely 83k-breach posts (Medium, BlueDot, Interview Coder blog) — consistent story, **no primary incident report**.
- ainchina.com graduate-coaching market tables — not primary; directional only.
- 艾瑞 “200亿 AI招聘” — vendor essay; used only for 智联 51.9%/87.2% citation chain.
- SHRM URL 404 in this run — statistic kept via secondary compilation and labeled.

## Gaps

1. **LockedIn, Sensei, Interview Coder, Beyz live checkout** not fully rendered (JS or signup-gated). Sensei $89/$24 and Interview Coder $299/$799 are consistent but not pixel-verified on this date.
2. **Cluely breach** lacks a company blog, attorney general notice, or Tier-1 newsroom piece in the fetch set.
3. **SHRM / Greenhouse primary PDFs** not downloaded; US recruiting stats are second-hand.
4. **ICP + payment entity path** depends on whether OnCue has a PRC company. Not in repo. Legal counsel needed before Alipay-in-China hosted LLM.
5. **Which domestic filed models** the gateway would call (通义 / 智谱 / DeepSeek filed endpoints) — not researched at API-contract level.
6. **Apple/Windows store policy** for “interview assistance” binaries — not checked.
7. **Employer detection vendors** (FabricHQ etc.) — only mentioned in competitor blogs.

**Next steps if this memo must become a price card:** screenshot LockedIn after signup, Sensei pricing DOM, Interview Coder checkout, Beyz pricing if it moves off 404; ask counsel for a 2-page CAC memo on “BYOK desktop vs Alipay-hosted proxy for 境内 users.”
