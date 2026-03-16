/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
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
        // ── Surface tokens (CSS variable backed) ──────────
        surface: {
          base:    'var(--surface-base)',     // #141e2b
          raised:  'var(--surface-raised)',   // #1a2636
          sunken:  'var(--surface-sunken)',   // #0d1520
          overlay: 'var(--surface-overlay)',  // #0a1018
          deep:    'var(--surface-deep)',     // #060c14
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Spillman Flex / Motorola Solutions CAD aesthetic
        //   Brand blue (Motorola primary):      #1a5a9e
        //   Steel-blue surfaces:                #141e2b / #1a2636
        //   Gold accent:                        #d4a017

        brand: {
          50:  '#e8f0fa',    // Lightest tint
          100: '#c4d9f0',
          200: '#8db8e0',
          300: '#5a94cc',
          400: '#2570b5',    // Lighter accent
          500: '#1a5a9e',    // Primary — Motorola blue
          600: '#164d88',    // Slightly deeper
          700: '#144a7e',    // Deep blue
          800: '#0e3a6e',    // Very deep
          900: '#0a2a52',    // Darkest navy
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Steel-blue greys — Spillman Flex console tones
        rmpg: {
          50:  '#d0d8e0',    // Light steel
          100: '#b0bcc8',    // Light grey-blue
          200: '#8a9ab0',    // Medium light
          300: '#6a7e96',    // Medium steel-blue
          400: '#4a6278',    // Grey-blue
          500: '#3a5068',    // Mid-dark steel
          600: '#2a3e58',    // Dark steel-blue
          700: '#1e3048',    // Deep steel
          800: '#162236',    // Deeper navy
          900: '#0d1520',    // Near black-navy
          950: '#060c14',    // App background
        },

        dispatch: {
          emergency: '#dc2626',    // Red (emergencies only)
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
          busy:       '#ef4444',   // Red
          offduty:    '#6b7280',
        },
      },
    },
  },
  plugins: [],
};
