/**
 * OUA.TV streams OUA games. School websites link each game to "https://oua.tv/?school=<School>"
 * (e.g. ?school=Western); the home school produces the broadcast.
 */
export const OUA_TV_URL = "https://oua.tv/";

export function ouaTvUrl(homeSchoolName?: string | null): string {
  return homeSchoolName ? `${OUA_TV_URL}?school=${encodeURIComponent(homeSchoolName)}` : OUA_TV_URL;
}
