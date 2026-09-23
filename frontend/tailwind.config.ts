import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // 60 — paper
        base:    "rgb(var(--bg-base) / <alpha-value>)",
        card:    "rgb(var(--bg-card) / <alpha-value>)",
        subtle:  "rgb(var(--bg-subtle) / <alpha-value>)",
        line:    "rgb(var(--line) / <alpha-value>)",
        // 30 — ink
        ink:        "rgb(var(--ink) / <alpha-value>)",
        "ink-line": "rgb(var(--ink-line) / <alpha-value>)",
        "on-ink":   "rgb(var(--on-ink) / <alpha-value>)",
        "on-ink-muted": "rgb(var(--on-ink-muted) / <alpha-value>)",
        fg:      "rgb(var(--fg) / <alpha-value>)",
        muted:   "rgb(var(--fg-muted) / <alpha-value>)",
        dim:     "rgb(var(--fg-dim) / <alpha-value>)",
        // 10 — accent
        accent:      "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-strong": "rgb(var(--accent-strong) / <alpha-value>)",
        pos:     "rgb(var(--pos) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
