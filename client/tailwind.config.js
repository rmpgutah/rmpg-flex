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
        // ── Surface tokens (CSS variable backed) ──────────
        surface: {
          base:    'var(--surface-base)',     // #141e2b
          raised:  'var(--surface-raised)',   // #1a2636
          sunken:  'var(--surface-sunken)',   // #0d1520
          overlay: 'var(--surface-overlay)',  // #0a1018
          deep:    'var(--surface-deep)',     // #060c14
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Spillman Flex / Motorola Solutions blue theme
        //   Primary blue (toolbar / accents):   #1a5a9e
        //   Logo charcoal (body / base):        #303030
        //   Logo gold (field labels / accents):  #d4a017
        //   Logo light grey (text):              #d0d0d0

        brand: {
          50:  '#f5f5f5',
          100: '#e0e0e0',
          200: '#c0c0c0',
          300: '#aaaaaa',
          400: '#999999',    // Lighter accent
          500: '#888888',    // Primary — neutral gray
          600: '#666666',
          700: '#444444',
          800: '#333333',
          900: '#222222',
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
