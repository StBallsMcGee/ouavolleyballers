/** Date helpers. All league dates use the league's time zone (Toronto), not the viewer's. */
export const LEAGUE_TZ = "America/Toronto";

export function localDate(d: Date = new Date(), tz = LEAGUE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  // Plain dates ("2026-11-07") are calendar days: format them at noon UTC to avoid shifting a day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : LEAGUE_TZ, ...opts }).format(d);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: LEAGUE_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Minutes the time zone is ahead of UTC at that moment (Toronto in November: -300). */
function tzOffsetMinutes(at: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** The instant a calendar day starts in the league's time zone, e.g. "2026-11-07" -> 05:00Z. */
export function startOfDayIso(isoDate: string, tz = LEAGUE_TZ): string {
  const guess = new Date(`${isoDate}T00:00:00Z`);
  const offset = tzOffsetMinutes(new Date(guess.getTime() + 12 * 3600_000), tz);
  return new Date(guess.getTime() - offset * 60_000).toISOString();
}

/** The last moment of a calendar day in the league's time zone (one second before midnight). */
export function endOfDayIso(isoDate: string, tz = LEAGUE_TZ): string {
  return new Date(new Date(startOfDayIso(addDays(isoDate, 1), tz)).getTime() - 1000).toISOString();
}

/** A valid "YYYY-MM-DD" from a URL parameter, or null. */
export function parseDay(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(new Date(`${s}T12:00:00Z`).getTime()) ? null : s;
}
