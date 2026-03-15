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
          overlay: 'var(--surface-overlay)',  // #0f1923
          deep:    'var(--surface-deep)',     // #080e18
        },

        // ── RMPG Brand ─────────────────────────────────────
        // Derived from the RMPG brand blue theme
        //   Brand blue (primary accent):               #1a5a9e
        //   Brand navy (deep tones):                   #14427a
        //   Brand gold (eagle beak accent):            #d4a017
        //   Brand light (text):                        #c0d0e0

        brand: {
          50:  '#e8f0fa',    // Lightest tint
          100: '#c8ddf0',
          200: '#90bae0',
          300: '#5a96cc',
          400: '#2068b0',    // Lighter accent
          500: '#1a5a9e',    // Primary — brand blue
          600: '#174e8a',    // Slightly deeper
          700: '#14427a',    // Deep blue
          800: '#0f3460',    // Very deep
          900: '#0a2648',    // Darkest navy
        },

        // Warm gold accent — eagle beak / mountain highlights
        'brand-gold': {
          300: '#f5d060',
          400: '#e8b820',
          500: '#d4a017',    // Primary gold
          600: '#b8880f',
          700: '#936c0a',
        },

        // Deep blue neutrals — navy-tinted CAD console palette
        rmpg: {
          50:  '#e8eef6',    // Light background
          100: '#c0d0e0',    // Light blue-grey
          200: '#8899aa',    // Medium light
          300: '#6b7f96',    // Medium blue-grey
          400: '#4a6280',    // Blue-grey
          500: '#3a5070',    // Mid-dark navy
          600: '#2a3e58',    // Dark navy
          700: '#1e3048',    // Deep navy
          800: '#162236',    // Deeper
          900: '#0d1520',    // Near black navy
          950: '#080e18',    // App background
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
