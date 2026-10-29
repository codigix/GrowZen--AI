import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Mona Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        growzen: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          cyan: '#06b6d4',
          emerald: '#10b981',
          accent: '#8b5cf6'
        },
        // Dark surfaces, darkest to lightest.
        ink: { 1: '#050811', 2: '#070b14', 3: '#080d18', 4: '#090e1b', 5: '#0a0f1d', 6: '#0c1222', 7: '#0c1322', 8: '#0d1424', 9: '#0e1626', 10: '#0e1627', 11: '#10192e' },
        success: { DEFAULT: '#006300', soft: '#e7f6e7' },
        danger: '#d03b3b',
        codigix: {
          navy: '#0b1120',
          'navy-dark': '#060a12',
          red: '#e02626'
        }
      },
      // `rounded` is the app's standard corner (was rounded-xl / rounded-2xl everywhere).
      borderRadius: { DEFAULT: '0.75rem' },
      fontSize: Object.fromEntries(['9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '14.5', '15', '16', '17', '18', '20', '22', '24', '26', '32', '34', '62'].map(n => [n, `${n}px`])),
      boxShadow: {
        'card': '0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 10px 25px -5px rgba(15, 23, 42, 0.05)',
        'card-hover': '0 20px 35px -10px rgba(15, 23, 42, 0.1), 0 1px 3px 0 rgba(15, 23, 42, 0.05)',
        'card-glow': '0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(79, 70, 229, 0.18)',
        'glow-indigo': '0 0 25px -3px rgba(99, 102, 241, 0.3)',
        'glow-cyan': '0 0 25px -3px rgba(6, 182, 212, 0.3)',
        'glow-emerald': '0 0 25px -3px rgba(16, 185, 129, 0.3)'
      },
      backgroundImage: ({ theme }) => ({
        'gradient-brand': `linear-gradient(135deg, ${theme('colors.indigo.600')} 0%, ${theme('colors.sky.600')} 50%, ${theme('colors.emerald.600')} 100%)`,
        'ambient-mesh': `radial-gradient(at 15% 0%, ${theme('colors.indigo.500')}0f 0px, transparent 45%), radial-gradient(at 90% 5%, ${theme('colors.sky.500')}0d 0px, transparent 45%)`
      }),
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      }
    }
  },
  plugins: [
    // Thin light scrollbars everywhere, and a utility to hide them.
    plugin(({ addBase, addUtilities, theme }) => {
      addBase({
        '::-webkit-scrollbar': { width: '6px', height: '6px' },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: theme('colors.slate.300'), borderRadius: theme('borderRadius.full') },
        '::-webkit-scrollbar-thumb:hover': { background: theme('colors.slate.400') }
      });
      addUtilities({
        '.no-scrollbar': { '-ms-overflow-style': 'none', 'scrollbar-width': 'none' },
        '.no-scrollbar::-webkit-scrollbar': { display: 'none' }
      });
    })
  ]
};
