import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const app = read('src/App.tsx')
const css = read('src/index.css')
const settings = read('src/pages/Settings.tsx')

assert.match(read('tailwind.config.js'), /darkMode:\s*['"]selector['"]/, 'manual theme uses the Tailwind selector strategy')
assert.ok(
  app.includes("colorScheme.addEventListener('change', syncTheme)")
    && app.includes("colorScheme.removeEventListener('change', syncTheme)"),
  'System theme follows operating-system changes and cleans up its listener',
)
assert.ok(css.includes('color-scheme: dark') && css.includes('background-color: var(--bg-app)'), 'root and native controls use theme tokens')
assert.ok(!read('src/main.tsx').includes('sonner') && !read('package.json').includes('sonner'), 'unused sonner toaster is removed')
assert.ok(settings.includes('pendingSaveRef') && settings.includes('if (pending) void persistToDisk(pending)'), 'pending settings are flushed')
assert.ok(
  app.includes("listen<AppSettings['theme']>('app-theme-changed'")
    && settings.includes("emit('app-theme-changed', val)"),
  'theme changes are synchronized across application windows',
)
assert.ok(settings.includes('persistToDisk({ theme: val })'), 'theme changes are persisted before another window can load stale settings')

for (const file of [
  'src/pages/Dashboard.tsx',
  'src/pages/History.tsx',
  'src/pages/MockInterview.tsx',
  'src/pages/ResumeOptimizer.tsx',
  'src/pages/Settings.tsx',
  'src/pages/StealthCopilot.tsx',
  'src/components/CopilotPanel.tsx',
]) {
  assert.ok(read(file).includes('dark:'), `${file} includes dark-mode styling`)
}

console.log('Theme verification passed')
