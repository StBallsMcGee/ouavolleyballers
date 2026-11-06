-- Matchup weeks always run Monday to Sunday (league time zone). The database refuses any other shape.
alter table public.matchup_weeks
  add constraint matchup_weeks_monday_to_sunday
  check (extract(isodow from starts_on) = 1 and ends_on = starts_on + 6);
