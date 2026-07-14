import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "hsl(var(--bg))",
        panel: "hsl(var(--panel))",
        "panel-2": "hsl(var(--panel-2))",
        line: "hsl(var(--line))",
        bone: "hsl(var(--bone))",
        dim: "hsl(var(--dim))",
        muted: "hsl(var(--muted))",
        amber: "hsl(var(--amber))",
        blood: "hsl(var(--blood))",
        steel: "hsl(var(--steel))",
        wash: "hsl(var(--wash))",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        hand: ["var(--font-hand)", "cursive"],
        serif: ["'Iowan Old Style'", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
