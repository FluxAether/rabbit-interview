/** @type {import('tailwindcss').Config} */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const landingDir = dirname(fileURLToPath(import.meta.url))

export default {
  content: [
    join(landingDir, 'index.html'),
    join(landingDir, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#0c0c0e',
        surface: '#19191d',
        subtle: '#131316',
        line: '#2e2e38',
        ink: '#f4f4f7',
        mute: '#9d9da8',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Noto Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
      },
      borderRadius: {
        xl: '10px',
        '2xl': '12px',
      },
      boxShadow: {
        glow: '0 0 80px rgba(244, 244, 247, 0.08)',
      },
    },
  },
  plugins: [],
}
