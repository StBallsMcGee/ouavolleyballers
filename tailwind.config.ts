import type { Config } from "tailwindcss";

// Visual identity for "Sideout": deep navy court, coral accent, teal for positive numbers.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        court: { 950: "#0b1020", 900: "#111833", 800: "#1a2347", 700: "#26305c", 600: "#3a4578" },
        coral: { 400: "#ff8a6b", 500: "#ff6b4a", 600: "#e5532f" },
        mint: { 400: "#4fe0b6", 500: "#22c99a" },
        sand: { 100: "#f7f3ea", 200: "#ece4d2" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
