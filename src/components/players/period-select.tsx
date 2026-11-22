"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** "Season stats" / "Week 5" picker for the Leaders view; keeps the other choices in the address. */
export function PeriodSelect({ value, options }: { value: string; options: Array<{ value: string; label: string }> }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Stats period</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("period", e.target.value);
          start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
        }}
        className="appearance-none rounded-full bg-transparent py-1 pl-2 pr-6 text-right text-[12px] font-extrabold uppercase tracking-wide text-gold-300 outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
      >
        {options.map((o) => <option key={o.value} value={o.value} className="bg-surface text-gray-900">{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute right-1.5 text-[10px] text-gold-300" aria-hidden>▾</span>
    </label>
  );
}
