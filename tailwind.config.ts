import type { Config } from "tailwindcss";

// Visual identity for "Sideout": light, phone-first. Navy ink, coral accent, green for positive points.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        court: { 950: "#0b1020", 900: "#111833", 800: "#1a2347", 700: "#26305c", 600: "#3a4578" },
        coral: { 50: "#fff1ec", 100: "#ffe0d6", 400: "#ff8a6b", 500: "#ff6b4a", 600: "#e5532f", 700: "#c2401f" },
        mint: { 400: "#4fe0b6", 500: "#22c99a" },
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
