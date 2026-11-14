"use client";
import { useLayoutEffect, useRef } from "react";
import { takeSwipeDirection } from "./swipe-tabs";

/** Each page rises in; after a sideways swipe it slides in from the side instead (fast). */
export function SlideIn({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const dir = takeSwipeDirection();
    if (dir) {
      el.animate(
        [{ transform: `translate3d(${dir === "left" ? 38 : -38}%,0,0)`, opacity: 0 }, { transform: "translate3d(0,0,0)", opacity: 1 }],
        { duration: 220, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    } else {
      el.animate([{ transform: "translateY(8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }, []);
  return <div ref={ref}>{children}</div>;
}
