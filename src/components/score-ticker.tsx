"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A team's total that celebrates new points: when it goes up (e.g. on the live refresh), the
 * number counts up and a faint "+2.4" floats up above it. The last value seen is remembered for
 * this browser tab, so coming back to the matchup also shows what was gained since.
 */
export function ScoreTicker({ value, storageKey, className = "" }: { value: number; storageKey: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const [gain, setGain] = useState<{ amount: number; id: number } | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    let prev = last.current;
    if (prev === null) {
      try {
        const saved = sessionStorage.getItem(`score:${storageKey}`);
        prev = saved === null ? null : Number(saved);
      } catch {
        prev = null;
      }
    }
    last.current = value;
    try { sessionStorage.setItem(`score:${storageKey}`, String(value)); } catch { /* private mode */ }
    if (prev === null || !Number.isFinite(prev) || value <= prev + 0.001) {
      setShown(value);
      return;
    }
    const from = prev;
    const amount = Math.round((value - from) * 10) / 10;
    setGain({ amount, id: Date.now() });
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    // Count up over ~0.9 s.
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min((t - start) / 900, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (value - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, storageKey]);

  return (
    <span className={`relative inline-block ${className}`}>
      {gain ? (
        <span
          key={gain.id}
          className="score-gain pointer-events-none absolute -top-1 left-1/2 whitespace-nowrap text-lg font-black text-gold-200"
          onAnimationEnd={() => setGain(null)}
          aria-hidden
        >
          +{gain.amount.toFixed(1)}
        </span>
      ) : null}
      <span className="tabular-nums">{shown.toFixed(1)}</span>
      {gain ? <span className="sr-only">Gained {gain.amount.toFixed(1)} points</span> : null}
    </span>
  );
}
