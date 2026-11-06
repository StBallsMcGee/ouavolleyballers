import type { University } from "@/lib/data/queries";

/** Plain GET form: works without JavaScript and keeps filters in the URL (shareable). */
export function PlayerFilters({ unis, sp, showStatus = true }: { unis: University[]; sp: Record<string, string | undefined>; showStatus?: boolean }) {
  return (
    <form className="card mb-4 grid grid-cols-2 gap-2 p-3 sm:grid-cols-5" method="get">
      <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name" className="input col-span-2 sm:col-span-1" />
      <select name="uni" defaultValue={sp.uni ?? ""} className="input">
        <option value="">All universities</option>
        {unis.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
      <select name="pos" defaultValue={sp.pos ?? ""} className="input">
        <option value="">All positions</option>
        {["S", "OH", "M", "L"].map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {showStatus ? (
        <select name="status" defaultValue={sp.status ?? "active"} className="input">
          <option value="active">Active players</option>
          <option value="available">Free agents only</option>
          <option value="rostered">On fantasy teams</option>
          <option value="all">Everyone (incl. inactive)</option>
        </select>
      ) : null}
      <button className="btn-secondary">Filter</button>
    </form>
  );
}
