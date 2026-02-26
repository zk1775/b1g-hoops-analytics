import type { NormalizedGameBoxscore } from "@/lib/data/sources/espn";

export type SportsReferenceGameLookup = {
  eventId?: string;
  season?: number;
  homeSlug?: string;
  awaySlug?: string;
  dateEpoch?: number | null;
};

// Hybrid-source foundation:
// Sports-Reference is reserved for historical backfill/reconciliation, but we do not
// rely on it for live ingest. The parser can be added later without changing callers.
export async function fetchSportsReferenceGameBoxscore(
  _lookup: SportsReferenceGameLookup,
): Promise<NormalizedGameBoxscore | null> {
  void _lookup;
  return null;
}
