import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./contexts/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#F8F8F9",
        surface: "#FFFFFF",
        border: "#E4E4E7",
        primary: "#18181B",
        secondary: "#71717A",
        accent: "#D4D4D8",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(0, 0, 0, 0.04)",
        card: "0 1px 2px rgba(0, 0, 0, 0.04), 0 4px 10px rgba(0, 0, 0, 0.03)",
        float: "0 8px 24px rgba(0, 0, 0, 0.08)",
      },
      transitionTimingFunction: {
        sweet: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        enter: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        enter: "enter 0.28s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "enter 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
