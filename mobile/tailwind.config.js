/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          pressed: 'var(--brand-pressed)',
          tint: 'var(--brand-tint)',
          fg: 'var(--brand-fg)',
        },
        ink: 'var(--ink)',
        body: 'var(--body)',
        muted: 'var(--muted)',
        surface: 'var(--surface)',
        canvas: 'var(--canvas)',
        line: 'var(--border)',
        danger: 'var(--danger)',
        elevated: 'var(--elevated)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'Roboto', '"Segoe UI"', 'sans-serif'],
      },
      fontSize: {
        base: ['17px', '24px'],
        title: ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '700' }],
        label: ['13px', { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '600' }],
      },
      borderRadius: {
        card: '20px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        sheet: '0 -8px 32px rgba(15, 23, 42, 0.18)',
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        tabbar: 'calc(56px + env(safe-area-inset-bottom))',
      },
      transitionDuration: {
        fast: '150ms',
        base: '220ms',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'sheet-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 220ms ease-out both',
        'sheet-up': 'sheet-up 250ms ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
