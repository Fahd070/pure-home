/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Cairo', 'sans-serif'] }
    }
  },
  plugins: []
};
