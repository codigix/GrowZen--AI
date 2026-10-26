/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Golos Text"', 'system-ui', 'sans-serif'] },
      colors: { codigix: { navy: '#1e2b4a', 'navy-dark': '#141d32', red: '#e02626' } }
    }
  },
  plugins: []
};
