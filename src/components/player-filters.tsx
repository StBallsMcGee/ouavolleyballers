import type { University } from "@/lib/data/queries";

/** Plain GET form: works without JavaScript and keeps filters in the URL. */
export function PlayerFilters({ unis, sp, showStatus = true }: { unis: University[]; sp: Record<string, string | undefined>; showStatus?: boolean }) {
  const oua = unis.filter((u) => u.short_name && u.short_name.length <= 4);
  return (
    <form className="space-y-2 border-b border-gray-200 bg-white px-4 py-3 sm:mb-3 sm:rounded-xl sm:border" method="get">
      <input name="q" defaultValue={sp.q ?? ""} placeholder="Search players" className="input" />
      <div className="flex gap-2 overflow-x-auto">
        <select name="pos" defaultValue={sp.pos ?? ""} className="input w-auto shrink-0">
          <option value="">All positions</option>
          {["S", "OH", "M", "L"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select name="uni" defaultValue={sp.uni ?? ""} className="input w-auto shrink-0">
          <option value="">All teams</option>
          {oua.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {showStatus ? (
          <select name="status" defaultValue={sp.status ?? "active"} className="input w-auto shrink-0">
            <option value="active">Active</option>
            <option value="available">Free agents</option>
            <option value="rostered">Rostered</option>
            <option value="all">All (incl. inactive)</option>
          </select>
        ) : null}
        <select name="week" defaultValue={sp.week ?? ""} className="input w-auto shrink-0">
          <option value="">Any schedule</option>
          <option value="playing">Playing this week</option>
        </select>
        <button className="btn-primary shrink-0 px-5">Go</button>
      </div>
    </form>
  );
}
