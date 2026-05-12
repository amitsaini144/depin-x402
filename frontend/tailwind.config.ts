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
      colors: {
        base:    "rgb(var(--bg-base) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        card:    "rgb(var(--bg-card) / <alpha-value>)",
        subtle:  "rgb(var(--bg-subtle) / <alpha-value>)",
        line:    "rgb(var(--line) / <alpha-value>)",
        fg:      "rgb(var(--fg) / <alpha-value>)",
        muted:   "rgb(var(--fg-muted) / <alpha-value>)",
        dim:     "rgb(var(--fg-dim) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
export default config;
