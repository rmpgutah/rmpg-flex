import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
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
          base:    'rgb(var(--surface-base-rgb) / <alpha-value>)',     // #141e2b / #0d2a4d
          raised:  'rgb(var(--surface-raised-rgb) / <alpha-value>)',   // #1a2636 / #153a6a
          sunken:  'rgb(var(--surface-sunken-rgb) / <alpha-value>)',   // #0d1520 / #081e3d
          overlay: 'rgb(var(--surface-overlay-rgb) / <alpha-value>)',  // #0a1018 / #061630
          deep:    'rgb(var(--surface-deep-rgb) / <alpha-value>)',     // #060c14 / #041022
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Spillman Flex / Motorola Solutions blue theme
        //   Primary blue (toolbar / accents):   #1a5a9e
        //   Logo charcoal (body / base):        #303030
        //   Logo gold (field labels / accents):  #d4a017
        //   Logo light grey (text):              #d0d0d0

        brand: {
          50:  '#f0f5fa',    // Lightest tint
          100: '#d6e4f0',
          200: '#a8c8e8',
          300: '#6ba3d4',
          400: '#3b8ad4',    // Lighter accent
          500: '#1a5a9e',    // Primary — Motorola blue
          600: '#164d87',    // Slightly deeper
          700: '#124070',    // Deep blue
          800: '#0e3359',    // Very deep
          900: '#0a2642',    // Darkest blue
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Neutral steel-blue greys — Spillman Flex dark theme
        rmpg: {
          50:  '#e8edf2',    // Light background
          100: '#d0d8e0',    // Light grey
          200: '#b0bcc8',    // Medium light
          300: '#8a9aaa',    // Medium grey
          400: '#5a6e80',    // Grey
          500: '#3a4e60',    // Mid-dark
          600: '#2a3a4e',    // Dark steel-blue
          700: '#1e3048',    // Deep steel-blue
          800: '#162236',    // Deeper
          900: '#0d1520',    // Near black
          950: '#060c14',    // App background
        },

        dispatch: {
          emergency: '#dc2626',    // Safety red (not brand)
          urgent:    '#d4a017',    // Brand gold
          routine:   '#4a90c4',    // Muted steel blue
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
          enroute:    '#4a90c4',   // Steel blue
          onscene:    '#a855f7',
          busy:       '#dc2626',   // Safety red
          offduty:    '#6b7280',
        },
      },
    },
  },
  plugins: [],
};
