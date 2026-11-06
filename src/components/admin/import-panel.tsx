"use client";
import { useState, useTransition } from "react";
import { refreshFromUsportvb } from "@/app/actions";

export function ImportPanel({ canRun }: { canRun: boolean }) {
  const [report, setReport] = useState<string | null>(null);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const [pending, start] = useTransition();
  const run = (apply: boolean) =>
    start(async () => {
      setState(null);
      const r = await refreshFromUsportvb(apply);
      setReport(r.markdown ?? null);
      setState({ ok: r.ok, text: r.ok ? (apply ? "Refresh applied. Rosters, lineups and results now match USportVB." : "Preview ready. Nothing has been saved. Review the report below.") : r.error ?? "Blocked by validation errors (see report)." });
      setPreviewed(!apply && r.ok);
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-secondary" disabled={!canRun || pending} onClick={() => run(false)}>{pending ? "Working… (about 30 seconds)" : "1. Preview refresh"}</button>
        <button className="btn-primary" disabled={!canRun || pending || !previewed} onClick={() => confirm("Apply the refresh? Sideout rosters, lineups and pre-switch results will be updated to match USportVB.") && run(true)}>2. Apply refresh</button>
      </div>
      {state ? <p className={`text-sm ${state.ok ? "text-mint-400" : "text-red-300"}`}>{state.text}</p> : null}
      {report ? <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl bg-court-950 p-4 text-xs text-slate-300">{report}</pre> : null}
    </div>
  );
}
