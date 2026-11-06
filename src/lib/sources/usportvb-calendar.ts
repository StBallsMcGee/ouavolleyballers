/**
 * Fantasy matchup weeks used by USportVB, copied from the site's code (verified 6 Nov 2026).
 * Seasons are labelled by their ending year (2027 = 2026-27). One invalid date in the source
 * ("2024-11-31") has been corrected to 2024-11-30.
 */
export interface CalendarWeek {
  week: number;
  start: string;
  end: string;
}

export const USVB_WEEKS: Record<number, CalendarWeek[]> = {
  2027: [
    { week: 1, start: "2026-10-19", end: "2026-10-25" },
    { week: 2, start: "2026-10-26", end: "2026-11-01" },
    { week: 3, start: "2026-11-02", end: "2026-11-08" },
    { week: 4, start: "2026-11-09", end: "2026-11-15" },
    { week: 5, start: "2026-11-16", end: "2026-11-22" },
    { week: 6, start: "2026-11-23", end: "2026-11-29" },
    { week: 7, start: "2027-01-04", end: "2027-01-10" },
    { week: 8, start: "2027-01-11", end: "2027-01-17" },
    { week: 9, start: "2027-01-18", end: "2027-01-24" },
    { week: 10, start: "2027-01-25", end: "2027-01-31" },
    { week: 11, start: "2027-02-01", end: "2027-02-07" },
    { week: 12, start: "2027-02-08", end: "2027-02-14" },
    { week: 13, start: "2027-02-15", end: "2027-02-21" },
  ],
};

/** "2026-27" for any date from 1 August 2026 to 31 July 2027. */
export function seasonLabelForDate(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function seasonLabelForSourceYear(year: number): string {
  return `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}
