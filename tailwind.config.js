/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Slate-based neutral surface system tuned for a dense operations console
        surface: {
          0: '#0b1020',
          1: '#101730',
          2: '#161f3d',
          3: '#1e2949',
          4: '#273356',
        },
        line: {
          DEFAULT: 'rgba(148,163,203,0.14)',
          strong: 'rgba(148,163,203,0.28)',
        },
        ink: {
          hi: '#eef2ff',
          mid: '#a7b1d4',
          low: '#6a76a3',
        },
        brand: {
          300: '#8fb4ff',
          400: '#5e8dff',
          500: '#3d6dff',
          600: '#2f55d4',
        },
        ok: { 400: '#34d399', 500: '#10b981', dim: 'rgba(16,185,129,0.14)' },
        warn: { 400: '#fbbf24', 500: '#f59e0b', dim: 'rgba(245,158,11,0.14)' },
        bad: { 400: '#f87171', 500: '#ef4444', dim: 'rgba(239,68,68,0.14)' },
        info: { 400: '#60a5fa', 500: '#3b82f6', dim: 'rgba(59,130,246,0.14)' },
        purple: { 400: '#c084fc', dim: 'rgba(192,132,252,0.14)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(2,6,23,0.5), 0 4px 16px rgba(2,6,23,0.35)',
        pop: '0 8px 32px rgba(2,6,23,0.65)',
      },
      animation: {
        'fade-in': 'fadeIn 0.18s ease-out',
        'slide-up': 'slideUp 0.22s cubic-bezier(0.16,1,0.3,1)',
        'slide-in-right': 'slideInRight 0.25s cubic-bezier(0.16,1,0.3,1)',
        pulse2: 'pulse2 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.45' } },
      },
    },
  },
  plugins: [],
}
