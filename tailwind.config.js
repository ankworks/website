/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme tokens let the dark-first palette switch to a high-contrast light mode.
        background: 'rgb(var(--forge-background) / <alpha-value>)',
        surface: 'rgb(var(--forge-surface) / <alpha-value>)',
        elevated: 'rgb(var(--forge-elevated) / <alpha-value>)',
        primary: 'rgb(var(--forge-primary) / <alpha-value>)',
        text: 'rgb(var(--forge-text) / <alpha-value>)',
        muted: 'rgb(var(--forge-muted) / <alpha-value>)',
        border: 'rgb(var(--forge-border) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
