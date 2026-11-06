"use client";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";

/** Button that runs a server action and shows the result inline. */
export function ActionButton({ action, label, confirmText, className = "btn-secondary" }: { action: () => Promise<ActionResult>; label: string; confirmText?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className={className} disabled={pending} onClick={() => { if (confirmText && !confirm(confirmText)) return; start(async () => { const r = await action(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? "Done." : r.error }); }); }}>
        {pending ? "Working…" : label}
      </button>
      {msg ? <span className={`text-xs ${msg.ok ? "text-mint-400" : "text-red-300"}`}>{msg.text}</span> : null}
    </span>
  );
}
