"use client";
import { DayStrip, useDaySwitch } from "@/components/day-strip";
import type { DayTab } from "@/lib/data/days";
import type { ScoringRule } from "@/lib/scoring/engine";
import { LineupEditor, type EditorPlayer } from "./lineup-editor";

/**
 * Day picker plus the lineup for the chosen day. Today and later show the current lineup (which
 * the owner can edit); earlier days show the lineup that was in place on that day, read-only.
 */
export function TeamDays({
  teamId, days, initialDay, today, current, past, slots, editable, rosterLimit, rules, prevHref, nextHref, marks, weekLabel,
}: {
  teamId: string;
  days: DayTab[];
  initialDay: string;
  today: string;
  current: EditorPlayer[];
  past: Record<string, EditorPlayer[]>;
  slots: string[];
  editable: boolean;
  rosterLimit: number;
  rules: ScoringRule[];
  prevHref: string | null;
  nextHref: string | null;
  marks: string[];
  weekLabel: string;
}) {
  const { day, select, ref } = useDaySwitch(days, initialDay);
  const isPast = day < today;
  const label = days.find((d) => d.date === day)?.label ?? day;
  return (
    <>
      <div className="sticky top-14 z-20 lg:static">
        <DayStrip days={days} day={day} today={today} onSelect={select} prevHref={prevHref} nextHref={nextHref} marks={marks} />
      </div>
      <div ref={ref} className="mt-3">
        <LineupEditor
          // Past days are separate snapshots; today and later share one editable lineup, so unsaved
          // moves survive switching between them.
          key={isPast ? `past-${day}` : "current"}
          teamId={teamId}
          players={isPast ? past[day] ?? [] : current}
          slots={slots}
          editable={editable && !isPast}
          rosterLimit={rosterLimit}
          rules={rules}
          day={day}
          dayLabel={label}
          weekLabel={weekLabel}
          isToday={day === today}
          isPast={isPast}
        />
      </div>
    </>
  );
}
