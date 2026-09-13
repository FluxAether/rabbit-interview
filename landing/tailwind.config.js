/** @type {import('tailwindcss').Config} */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const landingDir = dirname(fileURLToPath(import.meta.url))

export default {
  darkMode: 'selector',
  content: [
    join(landingDir, 'index.html'),
    join(landingDir, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        subtle: 'var(--subtle)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        mute: 'var(--mute)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Noto Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
      },
      borderRadius: {
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        glow: 'var(--shadow-glow)',
      },
    },
  },
  plugins: [],
}
