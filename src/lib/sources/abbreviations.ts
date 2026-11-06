/** Short team codes shown next to players (our own abbreviations, not an official list). */
export const UNIVERSITY_ABBREVIATIONS: Record<string, string> = {
  Brock: "BRK",
  Guelph: "GPH",
  Lakehead: "LU",
  McMaster: "MAC",
  Nipissing: "NIP",
  Ottawa: "OTT",
  "Queen's": "QU",
  RMC: "RMC",
  Toronto: "TOR",
  "Toronto Metropolitan": "TMU",
  Trent: "TRE",
  Waterloo: "WAT",
  Western: "WES",
  Windsor: "WIN",
  York: "YRK",
  Saskatchewan: "SASK",
  McGill: "MCG",
  Montreal: "MTL",
  Laval: "LAV",
  Sherbrooke: "SHE",
  UQAM: "UQAM",
  UQTR: "UQTR",
  Alberta: "ALB",
  Manitoba: "MAN",
  Winnipeg: "WPG",
  Regina: "REG",
  Brandon: "BDN",
  Dalhousie: "DAL",
  Acadia: "ACA",
  "Saint Mary's": "SMU",
  Memorial: "MUN",
  UNB: "UNB",
  Moncton: "MON",
  "UBC Okanagan": "UBCO",
  "Trinity Western": "TWU",
};

/** Different spellings the source uses for the same university. */
export const UNIVERSITY_ALIASES: Record<string, string> = {
  TMU: "Toronto Metropolitan",
  UBCO: "UBC Okanagan",
  "Montréal": "Montreal",
};

export function canonicalUniversityName(name: string): string {
  const n = name.trim();
  return UNIVERSITY_ALIASES[n] ?? n;
}

export function abbreviate(name: string | null | undefined): string {
  if (!name) return "?";
  return UNIVERSITY_ABBREVIATIONS[canonicalUniversityName(name)] ?? name.slice(0, 4).toUpperCase();
}
