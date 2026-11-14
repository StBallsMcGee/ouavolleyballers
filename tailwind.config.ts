import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

// Visual identity for "Sideout": dark charcoal, phone-first. Navy and gold accents, bright pastel
// gradient tiles. The grey scale is turned around for the dark theme (gray-900 = near-white text,
// gray-50/100/200 = slightly raised charcoal surfaces and lines), and the light tints of the
// status colours are dark tints, so every screen follows the theme without per-page changes.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        court: { 950: "#0b1020", 900: "#111833", 800: "#1a2347", 700: "#26305c", 600: "#3a4578" },
        brand: { 50: "#eef4ff", 100: "#dce7fd", 200: "#bed2fb", 300: "#91b3f6", 400: "#5b8def", 500: "#2f6fe0", 600: "#1f5bcc", 700: "#1a49a6", 800: "#173c85", 900: "#122d63", 950: "#0b1d42" },
        gold: { 50: "#fffbeb", 100: "#fef1c3", 200: "#fde68a", 300: "#fcd34d", 400: "#f9c22e", 500: "#eab308", 600: "#ca8a04", 700: "#a16207", 800: "#7c4a03" },
        mint: { 400: "#4fe0b6", 500: "#22c99a" },
        surface: { DEFAULT: "#1d1f26", 2: "#252831", 3: "#2e323c" },
        charcoal: { DEFAULT: "#131419", 900: "#0e0f13" },
        gray: { 50: "#252831", 100: "#2c3039", 200: "#363a45", 300: "#4a4f5c", 400: "#7d8290", 500: "#a2a7b3", 600: "#c0c4cd", 700: "#d5d8df", 800: "#e6e8ed", 900: "#f5f6f8", 950: "#ffffff" },
        emerald: { ...colors.emerald, 50: "#0f2a20", 100: "#143b2d", 200: "#1d5240", 600: "#34d399", 700: "#4ade80", 800: "#86efac", 900: "#bbf7d0" },
        red: { ...colors.red, 50: "#2d1518", 100: "#3d1a1e", 200: "#5b2328", 600: "#f87171", 700: "#fca5a5", 800: "#fecaca", 900: "#fee2e2" },
        amber: { ...colors.amber, 50: "#2c2310", 100: "#3a2e12", 200: "#5c4613", 700: "#fcd34d", 800: "#fde68a", 900: "#fef3c7" },
        sand: { 100: "#f7f3ea", 200: "#ece4d2" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      // Short, springy motion: pages rise in, sheets slide up, dialogs pop, panels grow open.
      keyframes: {
        "page-in": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        pop: { "0%": { opacity: "0", transform: "scale(.9)" }, "70%": { opacity: "1", transform: "scale(1.03)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        "pop-out": { from: { opacity: "1", transform: "scale(1)" }, to: { opacity: "0", transform: "scale(.94)" } },
        "slide-up": { from: { transform: "translateY(100%)" }, to: { transform: "none" } },
        "slide-down": { from: { transform: "none" }, to: { transform: "translateY(100%)" } },
        grow: { from: { opacity: "0", transform: "scaleY(.9)", transformOrigin: "top" }, to: { opacity: "1", transform: "none", transformOrigin: "top" } },
      },
      animation: {
        "page-in": "page-in .24s cubic-bezier(.2,.8,.2,1) both",
        "fade-in": "fade-in .2s ease-out both",
        "fade-out": "fade-out .18s ease-in both",
        pop: "pop .26s cubic-bezier(.2,.8,.2,1) both",
        "pop-out": "pop-out .16s ease-in both",
        "slide-up": "slide-up .28s cubic-bezier(.2,.8,.2,1) both",
        "slide-down": "slide-down .2s ease-in both",
        grow: "grow .2s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
