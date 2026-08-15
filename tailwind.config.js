/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'selector',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-app)',
        sidebar: 'var(--bg-sidebar)',
        surface: 'var(--bg-surface)',
        subtle: 'var(--bg-subtle)',
        hover: 'var(--bg-hover)',
        'ui-border': 'var(--border-color)',
        ink: 'var(--text-main)',
        muted: 'var(--text-muted)',
        action: 'var(--action)',
        'action-text': 'var(--action-text)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
      },
      borderRadius: {
        'xl': '10px',
        '2xl': '12px',
        '3xl': '12px',
      }
    },
  },
  plugins: [],
}
