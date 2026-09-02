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
        sans: ['Arial', 'Helvetica', 'sans-serif'],
        mono: ['Arial', 'monospace'],
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
        // ── Surface tokens (CSS variable backed) ──────────
        surface: {
          base:    'var(--surface-base)',     // #141e2b
          raised:  'var(--surface-raised)',   // #1a2636
          sunken:  'var(--surface-sunken)',   // #0d1520
          overlay: 'var(--surface-overlay)',  // #0a1018
          deep:    'var(--surface-deep)',     // #060c14
          // Hover/active surface. Defined in all four theme blocks of
          // theme-palettes.css but was never bound here, so the 14 existing
          // `bg-surface-hover` usages across the desktop shell and dashcam
          // surfaces emitted no CSS and their hover feedback silently did nothing.
          hover:   'var(--surface-hover)',
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Spillman Flex / Motorola Solutions blue theme
        //   Primary blue (toolbar / accents):   #1a5a9e
        //   Logo charcoal (body / base):        #303030
        //   Logo gold (field labels / accents):  #d4a017
        //   Logo light grey (text):              #d0d0d0

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

        'accent-gold': {
          300: 'rgb(var(--accent-gold-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--accent-gold-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--accent-gold-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--accent-gold-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--accent-gold-700-rgb) / <alpha-value>)',
        },
        'accent-silver': {
          300: 'rgb(var(--accent-silver-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--accent-silver-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--accent-silver-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--accent-silver-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--accent-silver-700-rgb) / <alpha-value>)',
        },

        // ── Foreground roles ───────────────────────────────
        // The rmpg ramp encodes surface ELEVATION and inverts between themes
        // (blue-silver --rmpg-300 is `157 175 194`, day is `70 70 70`), so it
        // is not a text scale. These are: they do not invert, and every step
        // clears WCAG AA 4.5:1 on base/raised/sunken in all four blocks.
        fg: {
          DEFAULT: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
          muted: 'rgb(var(--text-muted-rgb) / <alpha-value>)',
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

        border: {
          DEFAULT: 'var(--border-default)',
          default: 'var(--border-default)',
          subtle:  'var(--border-subtle)',
          strong:  'var(--border-strong)',
          panel:   'var(--border-panel)',
        },

        dispatch: {
          emergency: '#dc2626',
          urgent:    '#d4a017',
          routine:   '#888888',
          scheduled: '#666666',
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
          dispatched: '#d4a017',
          enroute:    '#888888',
          onscene:    '#a855f7',
          busy:       '#dc2626',
          offduty:    '#666666',
        },
        // Override Tailwind default blue to gray (kills ALL text-blue-*, bg-blue-*, border-blue-*)
        blue: {
          50:  '#f5f5f5',
          100: '#e0e0e0',
          200: '#c0c0c0',
          300: '#aaaaaa',
          400: '#999999',
          500: '#888888',
          600: '#666666',
          700: '#444444',
          800: '#333333',
          900: '#222222',
          950: '#111111',
        },
      },
    },
  },
  plugins: [],
};
