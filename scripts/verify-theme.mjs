import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const app = read('src/App.tsx')
const css = read('src/index.css')
const settings = read('src/pages/Settings.tsx')
const tailwind = read('tailwind.config.js')
const uiFiles = [
  'src/App.tsx',
  'src/pages/Dashboard.tsx',
  'src/pages/History.tsx',
  'src/pages/MockInterview.tsx',
  'src/pages/ResumeOptimizer.tsx',
  'src/pages/Settings.tsx',
  'src/pages/StealthCopilot.tsx',
  'src/components/CopilotPanel.tsx',
]
const uiSource = uiFiles.map(read).join('\n')

assert.match(tailwind, /darkMode:\s*['"]selector['"]/, 'manual theme uses the Tailwind selector strategy')
assert.ok(
  app.includes("colorScheme.addEventListener('change', syncTheme)")
    && app.includes("colorScheme.removeEventListener('change', syncTheme)"),
  'System theme follows operating-system changes and cleans up its listener',
)
for (const token of [
  '--bg-app',
  '--bg-sidebar',
  '--bg-surface',
  '--bg-subtle',
  '--bg-hover',
  '--border-color',
  '--text-main',
  '--text-muted',
  '--action',
  '--action-text',
  '--success',
  '--warning',
  '--danger',
]) {
  assert.ok(css.includes(`${token}:`), `global theme defines ${token}`)
  assert.ok(tailwind.includes(`var(${token})`) || css.includes(`var(${token})`), `${token} is consumed by the styling system`)
}
assert.ok(css.includes('color-scheme: dark') && css.includes('background-color: var(--bg-app)'), 'root and native controls use theme tokens')
assert.ok(css.includes(':focus-visible') && css.includes('prefers-reduced-motion: reduce'), 'theme includes keyboard focus and reduced-motion support')
assert.ok(
  css.includes("appearance: none")
    && css.includes("border: 1px solid var(--border-color)")
    && !css.includes('box-shadow: inset 0 0 0 1px')
    && css.includes("input[type='checkbox']:focus-visible")
    && !css.includes('input:focus-visible,\nselect:focus-visible,\ntextarea:focus-visible'),
  'text inputs use a single CSS border instead of native chrome plus an outer focus outline',
)
assert.ok(!read('src/main.tsx').includes('sonner') && !read('package.json').includes('sonner'), 'unused sonner toaster is removed')
assert.ok(settings.includes('pendingSaveRef') && settings.includes('if (pending) void persistToDisk(pending)'), 'pending settings are flushed')
assert.ok(
  app.includes("listen<AppSettings['theme']>('app-theme-changed'")
    && settings.includes("emit('app-theme-changed', val)"),
  'theme changes are synchronized across application windows',
)
assert.ok(settings.includes('persistToDisk({ theme: val })'), 'theme changes are persisted before another window can load stale settings')

for (const banned of [
  'bg-gradient-',
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#312e81',
  '#818cf8',
  '#a5b4fc',
  '#e0e7ff',
  '#eef2ff',
  '#c7d2fe',
  '#3730a3',
  'indigo-',
  'violet-',
]) {
  assert.ok(!uiSource.includes(banned), `application UI excludes legacy decorative style ${banned}`)
}

console.log('Theme verification passed')
