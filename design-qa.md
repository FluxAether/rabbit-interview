# Waveform Design QA

## Evidence

- Source visual truth: `/Users/thomas/.codex/generated_images/01a04611-4905-7662-8c6b-73af8d8f5c91/exec-526257e7-cfe0-4f9f-8051-1bf4ab06e79d.png`
- Implementation screenshot, active waveform (64px + 35% gain): `/tmp/rabbit-waveform-active-64px.png`
- Implementation screenshot, idle waveform (64px): `/tmp/rabbit-waveform-idle-64px.png`
- Full-view comparison: `/tmp/rabbit-interview-full-comparison.png`
- Focused waveform comparison: `/tmp/rabbit-interview-waveform-comparison.png`
- Viewport: Rabbit Interview desktop window at `1162 x 768` CSS px.
- Source pixels: `1543 x 1019`; implementation pixels: `2324 x 1536` (Retina 2x).
- Density normalization: the source full view was normalized to `1162 x 768`; both waveform crops were normalized to `874 x 80` before comparison.
- State: light theme, Hidden Assistant route. The active implementation capture rendered the production `CopilotWaveform` with a temporary `0.72` QA amplitude and no native audio capture; the override was removed before final verification. The idle capture used final runtime state.

## Findings

- No actionable P0, P1, or P2 differences in the requested waveform treatment.
- Fonts and typography: unchanged from the existing product; no waveform labels or text were introduced.
- Spacing and layout rhythm: the waveform canvas occupies a dedicated 64px height band with 35% amplitude gain, preserving panel header and message scrolling rhythm.
- Colors and visual tokens: gray/black samples and the emerald active region use the existing text, border, and success tokens.
- Image quality and asset fidelity: the Retina-scaled Canvas produces crisp dots and narrow vertical bars without blur or stretching.
- Copy and content: unchanged. The isolated Debug app has empty session content, so the full-view comparison intentionally evaluates the waveform region rather than transcript parity.

## Full-View Comparison

`/tmp/rabbit-interview-full-comparison.png` confirms that the waveform preserves the existing Hidden Assistant composition and remains within its panel bounds. The reference places the visualizer above the conversation panel; the implementation retains the product's existing shared `CopilotPanel` placement because the requested change was waveform style, not page restructuring.

## Focused Comparison

`/tmp/rabbit-interview-waveform-comparison.png` confirms the target's quiet dotted tails, narrow gray/black history bars, concentrated green live region, center emphasis, and clean white background at matched crop scale.

## Open Questions

- The floating window was not separately recaptured after the Computer Use service stopped responding. It renders the same `CopilotPanel` component, and responsive sample count, `ResizeObserver`, DPR scaling, and reduced-motion behavior are covered by the verification script.

## Comparison History

- Iteration 1: no P0/P1/P2 findings. No visual fix loop was required after the combined full-view and focused comparisons.
- Iteration 2: enhanced waveform height to 64px (`h-[64px]`) and boosted active display amplitude by 35% (`displayLevel = Math.min(1, baseLevel * 1.35)`).
- Post-comparison verification: restored live `copilot.amplitude` and `running` props; `npm run verify:copilot` (228/0), `npm run build`, `cargo test` (28/0), and `git diff --check` passed.

## Implementation Checklist

- [x] Replace the flat progress bar with the shared Canvas waveform.
- [x] Increase waveform canvas height to 64px and apply 35% amplitude gain.
- [x] Keep Canvas sharp across device pixel ratios and responsive widths.
- [x] Respect reduced-motion preference.
- [x] Verify idle and active visual states without recording audio.

## Follow-up Polish

- None required for this scope.

final result: passed
