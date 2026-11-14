"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const TABS = ["/", "/team", "/matchup", "/players"] as const;

function tabIndex(path: string): number {
  if (path === "/") return 0;
  if (path === "/team") return 1;
  if (path.startsWith("/matchup")) return 2;
  if (path === "/players") return 3;
  return -1;
}

/** Direction of the swipe that started this navigation, so the new page slides in from that side. */
export function takeSwipeDirection(): "left" | "right" | null {
  const w = window as unknown as { __sideoutSwipe?: "left" | "right" | null };
  const d = w.__sideoutSwipe ?? null;
  w.__sideoutSwipe = null;
  return d;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Swipe sideways to move between the main tabs (Home, My Team, Matchup, Players). The page
 * follows the finger, then flicks away and the next tab slides in. Vertical scrolling, sideways
 * scrolling strips (marked data-noswipe) and dialogs are left alone.
 */
export function SwipeTabs({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<{ x: number; y: number; t: number; mode: "h" | "v" | null; dx: number; active: boolean }>({ x: 0, y: 0, t: 0, mode: null, dx: 0, active: false });
  const idx = tabIndex(path);

  // New page: clear any leftover offset from the swipe that brought us here.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = "";
    el.style.opacity = "";
  }, [path]);

  useEffect(() => {
    if (idx < 0) return;
    for (const n of [idx - 1, idx + 1]) if (TABS[n]) router.prefetch(TABS[n]!);
  }, [idx, router]);

  const target = (dx: number) => (dx < 0 ? TABS[idx + 1] : TABS[idx - 1]);

  const onStart = (e: React.TouchEvent) => {
    if (idx < 0 || e.touches.length !== 1) return;
    const el = e.target as HTMLElement;
    if (el.closest("[data-noswipe], [role=dialog], input, textarea, select, .overflow-x-auto, button[aria-label^='Change team picture']")) return;
    const t = e.touches[0]!;
    g.current = { x: t.clientX, y: t.clientY, t: performance.now(), mode: null, dx: 0, active: true };
  };
  const onMove = (e: React.TouchEvent) => {
    const s = g.current;
    if (!s.active) return;
    const t = e.touches[0]!;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (!s.mode && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) s.mode = Math.abs(dx) > Math.abs(dy) * 1.4 ? "h" : "v";
    if (s.mode !== "h" || !ref.current) return;
    s.dx = dx;
    // Follows the finger; resists at the ends (no tab that way).
    const follow = target(dx) ? dx * 0.6 : dx * 0.15;
    ref.current.style.transform = `translate3d(${follow}px,0,0)`;
    ref.current.style.opacity = String(1 - Math.min(Math.abs(follow) / 700, 0.35));
  };
  const onEnd = () => {
    const s = g.current;
    s.active = false;
    const el = ref.current;
    if (s.mode !== "h" || !el) return;
    const dt = Math.max(performance.now() - s.t, 1);
    const fast = Math.abs(s.dx) / dt > 0.45;
    const to = target(s.dx);
    const from = el.style.transform || "translate3d(0,0,0)";
    if (to && (Math.abs(s.dx) > 70 || (fast && Math.abs(s.dx) > 30))) {
      const dir = s.dx < 0 ? "left" : "right";
      (window as unknown as { __sideoutSwipe?: string }).__sideoutSwipe = dir;
      if (!reduced()) {
        el.animate(
          [{ transform: from, opacity: el.style.opacity || "1" }, { transform: `translate3d(${dir === "left" ? -42 : 42}%,0,0)`, opacity: 0 }],
          { duration: 130, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
        );
      }
      router.push(to);
      // If the next page is slow, never leave the screen blank.
      setTimeout(() => { if (ref.current && tabIndex(window.location.pathname) === idx) { ref.current.getAnimations().forEach((a) => a.cancel()); ref.current.style.transform = ""; ref.current.style.opacity = ""; } }, 2500);
    } else {
      el.animate([{ transform: from, opacity: el.style.opacity || "1" }, { transform: "translate3d(0,0,0)", opacity: 1 }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
      el.style.transform = "";
      el.style.opacity = "";
    }
  };

  return (
    <div ref={ref} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd} style={{ touchAction: "pan-y pinch-zoom" }}>
      {children}
    </div>
  );
}
