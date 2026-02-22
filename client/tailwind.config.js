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
          base:    'var(--surface-base)',     // #1a1a1a
          raised:  'var(--surface-raised)',   // #1e1e1e
          sunken:  'var(--surface-sunken)',   // #141414
          overlay: 'var(--surface-overlay)',  // #111111
          deep:    'var(--surface-deep)',     // #0a0a0a
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Derived from the official Rocky Mountain Protective Group logo.
        //   Logo red (eagle feathers / mountain peaks): #bc1010
        //   Logo charcoal (eagle body / mountain base):  #303030
        //   Logo gold (eagle beak accent):               #d4a017
        //   Logo light grey (text):                      #d0d0d0

        brand: {
          50:  '#fdf1f1',    // Lightest tint
          100: '#fce0e0',
          200: '#f7b8b8',
          300: '#ef7a7a',
          400: '#d93030',    // Lighter accent
          500: '#bc1010',    // Primary — logo eagle red
          600: '#a00e0e',    // Slightly deeper
          700: '#8a0c0c',    // Deep crimson
          800: '#6e0a0a',    // Very deep
          900: '#520808',    // Darkest crimson
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Neutral charcoal greys — logo body / mountain base
        rmpg: {
          50:  '#f0f0f0',    // Light background
          100: '#e0e0e0',    // Light grey (logo text)
          200: '#c8c8c8',    // Medium light (logo text)
          300: '#a0a0a0',    // Medium grey
          400: '#707070',    // Grey
          500: '#484848',    // Mid-dark grey
          600: '#383838',    // Dark charcoal
          700: '#303030',    // Logo charcoal (eagle/mountain)
          800: '#202020',    // Deeper
          900: '#141414',    // Near black
          950: '#0a0e14',    // App background
        },

        dispatch: {
          emergency: '#bc1010',    // Brand red
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
          busy:       '#bc1010',   // Brand red
          offduty:    '#6b7280',
        },
      },
    },
  },
  plugins: [],
};
