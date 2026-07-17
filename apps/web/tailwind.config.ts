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
        tint: v("tint"),
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
        // Legacy aliases — compat only, removed end of R3
        bg: v("bg"),
        panel: v("panel"),
        "panel-2": v("panel-2"),
        line: v("line"),
        bone: v("bone"),
        dim: v("dim"),
        muted: v("muted"),
        amber: v("amber"),
        blood: v("blood"),
        steel: v("steel"),
        wash: v("wash"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Haettenschweiler", "Impact", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
        sans: ["'Helvetica Neue'", "Helvetica", "Arial", "sans-serif"],
        // Compat shim: old handwriting role folds into mono until R2 removes it
        hand: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
