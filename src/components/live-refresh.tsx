"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * While games are on, quietly reloads the page's numbers every minute (only when the screen is
 * visible), so live points move without pulling to refresh.
 */
export function LiveRefresh({ active, everyMs = 60_000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setAt(new Date());
    };
    const id = setInterval(tick, everyMs);
    const onShow = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [active, everyMs, router]);
  if (!active) return null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-red-600" role="status">
      <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" /></span>
      LIVE · points update every few minutes · refreshed {at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </div>
  );
}
