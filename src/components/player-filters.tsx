import type { University } from "@/lib/data/queries";

/** Search box plus a collapsible "Filters" panel. Plain GET form: works without JavaScript. */
export function PlayerFilters({ unis, sp, showStatus = true }: { unis: University[]; sp: Record<string, string | undefined>; showStatus?: boolean }) {
  const oua = unis.filter((u) => u.short_name && u.short_name.length <= 4);
  const active = [sp.pos, sp.uni, sp.week, showStatus && sp.status && sp.status !== "active" ? sp.status : undefined].filter(Boolean).length;
  return (
    <form className="border-b border-gray-200 bg-white px-4 py-3 sm:mb-3 sm:rounded-xl sm:border" method="get">
      <div className="flex gap-2">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search players" className="input min-w-0 flex-1" />
        <button className="btn-primary shrink-0 px-4">Go</button>
      </div>
      <details className="mt-2" open={active > 0}>
        <summary className="cursor-pointer select-none text-xs font-bold text-gray-600">Filters{active ? ` (${active})` : ""}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select name="pos" defaultValue={sp.pos ?? ""} className="input">
            <option value="">All positions</option>
            {["S", "OH", "M", "L"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select name="uni" defaultValue={sp.uni ?? ""} className="input">
            <option value="">All teams</option>
            {oua.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select name="week" defaultValue={sp.week ?? ""} className="input">
            <option value="">Any schedule</option>
            <option value="playing">Plays this week</option>
          </select>
          {showStatus ? (
            <select name="status" defaultValue={sp.status ?? "active"} className="input">
              <option value="active">Active</option>
              <option value="available">Free agents</option>
              <option value="rostered">Rostered</option>
              <option value="all">All</option>
            </select>
          ) : null}
        </div>
      </details>
    </form>
  );
}
