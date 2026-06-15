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
      full: '9999px',
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
          // Light Mode colors: #0d2a4d #153a6a #081e3d #061630 #041022
          base:    'rgb(var(--surface-base-rgb) / <alpha-value>)',
          raised:  'rgb(var(--surface-raised-rgb) / <alpha-value>)',
          sunken:  'rgb(var(--surface-sunken-rgb) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay-rgb) / <alpha-value>)',
          deep:    'rgb(var(--surface-deep-rgb) / <alpha-value>)',
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Pure black shell with neutral metallic accents

        brand: {
          50:  'rgb(var(--brand-50-rgb) / <alpha-value>)',
          100: 'rgb(var(--brand-100-rgb) / <alpha-value>)',
          200: 'rgb(var(--brand-200-rgb) / <alpha-value>)',
          300: 'rgb(var(--brand-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--brand-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--brand-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--brand-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--brand-700-rgb) / <alpha-value>)',
          800: 'rgb(var(--brand-800-rgb) / <alpha-value>)',
          900: 'rgb(var(--brand-900-rgb) / <alpha-value>)',
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: 'rgb(var(--brand-gold-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--brand-gold-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--brand-gold-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--brand-gold-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--brand-gold-700-rgb) / <alpha-value>)',
        },

        // Keep the "blue" token name for existing utility usage, but render it as neutral gray
        blue: {
          50:  'rgb(var(--blue-50-rgb) / <alpha-value>)',
          100: 'rgb(var(--blue-100-rgb) / <alpha-value>)',
          200: 'rgb(var(--blue-200-rgb) / <alpha-value>)',
          300: 'rgb(var(--blue-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--blue-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--blue-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--blue-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--blue-700-rgb) / <alpha-value>)',
          800: 'rgb(var(--blue-800-rgb) / <alpha-value>)',
          900: 'rgb(var(--blue-900-rgb) / <alpha-value>)',
        },

        // Neutral graphite greys — no blue cast
        rmpg: {
          50:  'rgb(var(--rmpg-50-rgb) / <alpha-value>)',
          100: 'rgb(var(--rmpg-100-rgb) / <alpha-value>)',
          200: 'rgb(var(--rmpg-200-rgb) / <alpha-value>)',
          300: 'rgb(var(--rmpg-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--rmpg-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--rmpg-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--rmpg-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--rmpg-700-rgb) / <alpha-value>)',
          800: 'rgb(var(--rmpg-800-rgb) / <alpha-value>)',
          900: 'rgb(var(--rmpg-900-rgb) / <alpha-value>)',
          950: 'rgb(var(--rmpg-950-rgb) / <alpha-value>)',
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
