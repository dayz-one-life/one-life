import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens — use these in all new code
        paper: v("paper"),
        ink: v("ink"),
        red: v("red"),
        "red-deep": v("red-deep"),
        yellow: v("yellow"),
        blue: v("blue"),
        bone: v("bone"),
        dark: v("dark"),
        hairline: v("hairline"),
        "hairline-2": v("hairline-2"),
        archive: v("archive"),
        "dark-line": v("dark-line"),
        dash: v("dash"),
        "ink-soft": v("ink-soft"),
        "ink-muted": v("ink-muted"),
        "cream-muted": v("cream-muted"),
        "cream-dim": v("cream-dim"),
        "red-soft": v("red-soft"),
        discord: v("discord"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Haettenschweiler", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
        sans: ["'Helvetica Neue'", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
