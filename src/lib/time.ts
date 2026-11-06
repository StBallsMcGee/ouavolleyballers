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
