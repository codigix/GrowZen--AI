import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Mona Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      colors: {
        // Ubold (default skin) palette: the Tailwind colour names the app already uses now carry Ubold's colours.
        // primary #6658dd, secondary #4a81d4, success #1abc9c, info #43bfe5, warning #f7b84b, danger #f1556c, text #4c4c5c.
        indigo: { 50: '#f3f2fc', 100: '#e3e1f9', 200: '#c8c3f3', 300: '#a9a1ec', 400: '#887de4', 500: '#6658dd', 600: '#5c4fc7', 700: '#4c42a6', 800: '#3d3585', 900: '#2e2863' },
        violet: { 50: '#f5f3fd', 100: '#e8e5fa', 200: '#d1cbf6', 300: '#b7aef1', 400: '#9a8fec', 500: '#7e6fe6', 600: '#7164cf', 700: '#5e53ac', 800: '#4c438a', 900: '#393267' },
        blue: { 50: '#f1f5fc', 100: '#dee8f7', 200: '#bed2f0', 300: '#9ab8e7', 400: '#729ddd', 500: '#4a81d4', 600: '#4374bf', 700: '#38619f', 800: '#2c4d7f', 900: '#213a5f' },
        sky: { 50: '#f1f5fc', 100: '#dee8f7', 200: '#bed2f0', 300: '#9ab8e7', 400: '#729ddd', 500: '#4a81d4', 600: '#4374bf', 700: '#38619f', 800: '#2c4d7f', 900: '#213a5f' },
        cyan: { 50: '#f0fafd', 100: '#ddf3fa', 200: '#bbe8f6', 300: '#96dbf0', 400: '#6ccdeb', 500: '#43bfe5', 600: '#3cacce', 700: '#328fac', 800: '#287389', 900: '#1e5667' },
        teal: { 50: '#edfaf7', 100: '#d6f3ed', 200: '#ade7db', 300: '#7fd9c8', 400: '#4ccbb2', 500: '#1abc9c', 600: '#17a98c', 700: '#148d75', 800: '#10715e', 900: '#0c5546' },
        emerald: { 50: '#edfaf7', 100: '#d6f3ed', 200: '#ade7db', 300: '#7fd9c8', 400: '#4ccbb2', 500: '#1abc9c', 600: '#17a98c', 700: '#148d75', 800: '#10715e', 900: '#0c5546' },
        green: { 50: '#edfaf7', 100: '#d6f3ed', 200: '#ade7db', 300: '#7fd9c8', 400: '#4ccbb2', 500: '#1abc9c', 600: '#17a98c', 700: '#148d75', 800: '#10715e', 900: '#0c5546' },
        amber: { 50: '#fef9f1', 100: '#fef2df', 200: '#fce5be', 300: '#fbd79a', 400: '#f9c873', 500: '#f7b84b', 600: '#dea644', 700: '#b98a38', 800: '#946e2d', 900: '#6f5322' },
        yellow: { 50: '#fef9f1', 100: '#fef2df', 200: '#fce5be', 300: '#fbd79a', 400: '#f9c873', 500: '#f7b84b', 600: '#dea644', 700: '#b98a38', 800: '#946e2d', 900: '#6f5322' },
        orange: { 50: '#fef9f1', 100: '#fef2df', 200: '#fce5be', 300: '#fbd79a', 400: '#f9c873', 500: '#f7b84b', 600: '#dea644', 700: '#b98a38', 800: '#946e2d', 900: '#6f5322' },
        red: { 50: '#fef1f3', 100: '#fce0e5', 200: '#fac2ca', 300: '#f7a0ad', 400: '#f47a8c', 500: '#f1556c', 600: '#d94c61', 700: '#b54051', 800: '#913341', 900: '#6c2631' },
        rose: { 50: '#fef1f3', 100: '#fce0e5', 200: '#fac2ca', 300: '#f7a0ad', 400: '#f47a8c', 500: '#f1556c', 600: '#d94c61', 700: '#b54051', 800: '#913341', 900: '#6c2631' },
        slate: { 50: '#f6f7fb', 100: '#eef2f7', 200: '#e7e9eb', 300: '#dbe0e5', 400: '#9ba6b7', 500: '#7b8a9c', 600: '#667787', 700: '#4c4c5c', 800: '#38414a', 900: '#313a46', 950: '#232b34' },
        gray: { 50: '#f6f7fb', 100: '#eef2f7', 200: '#e7e9eb', 300: '#dbe0e5', 400: '#9ba6b7', 500: '#7b8a9c', 600: '#667787', 700: '#4c4c5c', 800: '#38414a', 900: '#313a46', 950: '#232b34' },
        body: '#f5f6f8',
        topbar: { DEFAULT: '#38414a', item: '#adb5bf', field: '#3f4952' },
        growzen: {
          50: '#f3f2fc',
          100: '#e3e1f9',
          200: '#c8c3f3',
          300: '#a9a1ec',
          400: '#887de4',
          500: '#6658dd',
          600: '#5c4fc7',
          700: '#4c42a6',
          800: '#3d3585',
          900: '#2e2863',
          cyan: '#43bfe5',
          emerald: '#1abc9c',
          accent: '#7e6fe6'
        },
        // Dark surfaces, darkest to lightest.
        ink: { 1: '#050811', 2: '#070b14', 3: '#080d18', 4: '#090e1b', 5: '#0a0f1d', 6: '#0c1222', 7: '#0c1322', 8: '#0d1424', 9: '#0e1626', 10: '#0e1627', 11: '#10192e' },
        success: { DEFAULT: '#169c80', soft: '#e1f6f1' },
        danger: '#f1556c',
        codigix: {
          navy: '#0b1120',
          'navy-dark': '#060a12',
          red: '#e02626'
        }
      },
      // `rounded` is the app's standard corner (was rounded-xl / rounded-2xl everywhere).
      borderRadius: { DEFAULT: '0.3rem', lg: '0.3rem', xl: '0.4rem', '2xl': '0.5rem', '3xl': '0.75rem' },
      fontSize: Object.fromEntries(['9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '14.5', '15', '16', '17', '18', '20', '22', '24', '26', '32', '34', '62'].map(n => [n, `${n}px`])),
      boxShadow: {
        'card': '0 1px 4px 0 rgba(130, 143, 163, 0.15)',
        'card-hover': '0 2px 10px 0 rgba(130, 143, 163, 0.25)',
        'card-glow': '0 2px 10px 0 rgba(130, 143, 163, 0.25)',
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
