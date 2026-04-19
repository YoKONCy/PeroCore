/** Tailwind CSS v3 配置 — 桥接设计令牌 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 语义色 → Tailwind 类: bg-primary, text-accent 等
        primary: 'var(--color-primary)',
        accent: 'var(--color-accent)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        info: 'var(--color-info)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        pixel: 'var(--font-pixel)',
      },
      backgroundColor: {
        card: 'var(--bg-card)',
        glass: 'var(--bg-glass)',
        page: 'var(--bg-page)',
      },
      textColor: {
        default: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
      },
      borderColor: {
        default: 'var(--border-default)',
        hover: 'var(--border-hover)',
      },
    },
  },
  plugins: [],
}
