/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Mona Sans"', 'system-ui', '-apple-system', 'sans-serif'],
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
        codigix: {
          navy: '#0b1120',
          'navy-dark': '#060a12',
          red: '#e02626'
        }
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 10px 25px -5px rgba(15, 23, 42, 0.05)',
        'card-hover': '0 20px 35px -10px rgba(15, 23, 42, 0.1), 0 1px 3px 0 rgba(15, 23, 42, 0.05)',
        'glow-indigo': '0 0 25px -3px rgba(99, 102, 241, 0.3)',
        'glow-cyan': '0 0 25px -3px rgba(6, 182, 212, 0.3)',
        'glow-emerald': '0 0 25px -3px rgba(16, 185, 129, 0.3)'
      },
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
  plugins: []
};
