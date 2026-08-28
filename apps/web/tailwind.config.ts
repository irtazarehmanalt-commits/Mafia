import type { Config } from 'tailwindcss';

/**
 * Modernist. Sharp corners, flat colour, one hot accent, and a lot of white
 * space held by 2px rules.
 *
 * Semantic colours resolve to CSS custom properties so a single `.dark` class
 * on a wrapper inverts an entire screen — that is how the night phases flip
 * without duplicating any markup.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware (see globals.css :root and .dark)
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        ink: 'var(--color-text)',
        accent: 'var(--color-accent)',
        divider: 'var(--color-divider)',
        muted: 'var(--muted)',
        tile: 'var(--tile-bg)',
        tint: 'var(--tint)',

        // Fixed tonal ramps — generated on one shared lightness scale, so the
        // same step of any role matches the others in visual value.
        neutral: {
          100: '#f8f4f4',
          200: '#eae7e7',
          300: '#d7d3d3',
          400: '#bab6b6',
          500: '#9b9797',
          600: '#7d7979',
          700: '#605d5d',
          800: '#444141',
          900: '#2d2b2b',
        },
        brand: {
          100: '#fff2ef',
          200: '#ffe0d9',
          300: '#ffc4b8',
          400: '#ff9783',
          500: '#ff563c',
          600: '#dd2b0f',
          700: '#ae1800',
          800: '#7c1405',
          900: '#4d170e',
        },
      },
      fontFamily: {
        sans: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        none: '0px',
        DEFAULT: '0px',
        sm: '0px',
        md: '0px',
        lg: '0px',
      },
      boxShadow: {
        sm: '0 1px 2px color-mix(in srgb, #2d2b2b 14%, transparent)',
        md: '0 3px 10px color-mix(in srgb, #2d2b2b 16%, transparent)',
        lg: '0 12px 32px color-mix(in srgb, #2d2b2b 22%, transparent)',
      },
      keyframes: {
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'bar-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'rise-in': 'rise-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bar-pulse': 'bar-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
