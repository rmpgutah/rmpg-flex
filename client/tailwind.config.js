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
          // Deep navy blue surfaces — no pure black
          base:    'rgb(var(--surface-base-rgb) / <alpha-value>)',
          raised:  'rgb(var(--surface-raised-rgb) / <alpha-value>)',
          sunken:  'rgb(var(--surface-sunken-rgb) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay-rgb) / <alpha-value>)',
          deep:    'rgb(var(--surface-deep-rgb) / <alpha-value>)',
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Deep navy blue shell with gold accents

        brand: {
          50:  '#e6eef8',
          100: '#c0d4ec',
          200: '#8ab0d8',
          300: '#5a90c4',
          400: '#3a78b4',
          500: '#2a6098',
          600: '#1e4a78',
          700: '#163860',
          800: '#102a4a',
          900: '#0a1e3c',
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Blue token — actual blue tones for the blue theme
        blue: {
          50:  '#e6eef8',
          100: '#c0d4ec',
          200: '#8ab0d8',
          300: '#5a90c4',
          400: '#3a78b4',
          500: '#2a6098',
          600: '#1e4a78',
          700: '#163860',
          800: '#102a4a',
          900: '#0a1e3c',
        },

        // RMPG navy blue palette
        rmpg: {
          50:  '#e6eef8',
          100: '#c0d4ec',
          200: '#8ab0d8',
          300: '#5a90c4',
          400: '#3a78b4',
          500: '#2a6098',
          600: '#1e4a78',
          700: '#163860',
          800: '#102a4a',
          900: '#0a1e3c',
          950: '#061835',
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
