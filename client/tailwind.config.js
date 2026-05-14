import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    resolve(__dirname, 'index.html'),
    resolve(__dirname, 'src/**/*.{js,ts,jsx,tsx}'),
  ],
  theme: {
    borderRadius: {
      none: '0',
      sm: '1px',
      DEFAULT: '2px',
      md: '2px',
      lg: '2px',
      xl: '2px',
      '2xl': '2px',
      '3xl': '2px',
      full: '2px',
    },
    screens: {
      'xs': '475px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
      '3xl': '1920px',
    },
    extend: {
      fontFamily: {
        sans: ['Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      fontSize: {
        'micro':   ['9px',  { lineHeight: '12px', letterSpacing: '0.04em' }],
        'label':   ['10px', { lineHeight: '14px', letterSpacing: '0.05em' }],
        'caption': ['11px', { lineHeight: '16px' }],
        'body-sm': ['12px', { lineHeight: '18px' }],
        'body':    ['13px', { lineHeight: '20px' }],
        'title':   ['15px', { lineHeight: '22px' }],
        'heading': ['18px', { lineHeight: '26px' }],
        'display': ['24px', { lineHeight: '32px' }],
      },
      colors: {
        // ── Surface tokens (CSS variable backed, alpha-capable) ──
        // Uses rgb(<channels> / <alpha-value>) so Tailwind's /NN opacity
        // modifier works (e.g. bg-surface-sunken/50). RGB channels are
        // declared in index.css as --surface-*-rgb (space-separated).
        surface: {
          // Dark Mode colors:  #000000 #0b0b0b #000000 #030303 #000000
          // Light Mode colors: #081828 #0d2440 #051420 #061525 #020a14
          base:    'rgb(var(--surface-base-rgb) / <alpha-value>)',
          raised:  'rgb(var(--surface-raised-rgb) / <alpha-value>)',
          sunken:  'rgb(var(--surface-sunken-rgb) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay-rgb) / <alpha-value>)',
          deep:    'rgb(var(--surface-deep-rgb) / <alpha-value>)',
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Pure black shell with neutral metallic accents

        brand: {
          50:  '#f2f2f2',
          100: '#dddddd',
          200: '#bfbfbf',
          300: '#9e9e9e',
          400: '#7f7f7f',
          500: '#666666',
          600: '#4c4c4c',
          700: '#343434',
          800: '#1f1f1f',
          900: '#0e0e0e',
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Keep the "blue" token name for existing utility usage, but render it as neutral gray
        blue: {
          50:  '#f1f1f1',
          100: '#d9d9d9',
          200: '#bdbdbd',
          300: '#a1a1a1',
          400: '#c8c8c8',
          500: '#9a9a9a',
          600: '#737373',
          700: '#4f4f4f',
          800: '#2e2e2e',
          900: '#141414',
        },

        // Neutral graphite greys — no blue cast
        rmpg: {
          50:  '#ededed',
          100: '#d6d6d6',
          200: '#b8b8b8',
          300: '#969696',
          400: '#757575',
          500: '#5a5a5a',
          600: '#434343',
          700: '#2d2d2d',
          800: '#1b1b1b',
          900: '#0d0d0d',
          950: '#030303',
        },

        dispatch: {
          emergency: '#dc2626',    // Safety red (not brand)
          urgent:    '#d4a017',    // Brand gold
          routine:   '#a7b1bc',
          scheduled: '#6b7280',
        },
        success: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        status: {
          available:  '#22c55e',
          dispatched: '#d4a017',   // Brand gold
          enroute:    '#d5dde6',
          onscene:    '#a855f7',
          busy:       '#dc2626',   // Safety red
          offduty:    '#6b7280',
        },
      },
    },
  },
  plugins: [],
};
