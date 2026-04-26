/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      // Etapa 2 will wire the Claude Design tokens into Tailwind's theme.
      // For now, default is enough — the design ships its own CSS variables.
    },
  },
  plugins: [],
};
