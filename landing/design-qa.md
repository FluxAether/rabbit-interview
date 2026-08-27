# Landing design QA

- source visual truth path: /Users/thomas/.codex/generated_images/01a0410b-5dc8-7a52-81e6-888c014b08a8/exec-38ab43dc-c740-4a59-a0fe-6bc0fa63977f.png
- implementation: http://localhost:4174/ (landing Vite dev)
- viewport: 1440x1100 @2x desktop; 375x812 @2x mobile
- source pixels: 934x1685
- implementation CSS: 1440x748 then 375x812, deviceScaleFactor 2
- state: default zh, then EN toggle

## Findings

No remaining P0–P2 layout breaks after the Tailwind content-path fix and mobile nav collapse.

Accepted deviations:

- Workflow/privacy exist as in-page anchors rather than extra sections, so the selected mock’s three-up → download rhythm stays intact.
- Feature modules are live UI, not raster screenshots.
- GitHub and Windows marks are local SVG icons because lucide-react has no Github/Windows exports.

## Required surfaces

- Fonts: Inter + PingFang/Noto stack; 56–58px hero on desktop, 40px on small screens.
- Spacing: left copy / right glowing copilot, 3-up feature row, centered download band.
- Color: #0c0c0e canvas, white inverted CTAs, hairline #2e2e38-equivalent borders.
- Imagery: product logo from /logo.svg; waveform is DPR-aware canvas, not CSS-stretched.
- Copy: zh default, EN toggle persisted in localStorage; download URLs use GitHub latest stable names.

## Checks

- 1440 hero matches option 3 composition (left headline, right glowing copilot, waveform).
- 375 stacks without horizontal overflow; nav collapses to Download + language.
- ZH/EN toggle updates document lang and heading.
- macOS/Windows/GitHub/SHA256SUMS links resolve to thomas92118/rabbit-interview releases/repo.
- Console: no errors on load.
- npm run landing:build and npm run build both passed.

final result: passed
