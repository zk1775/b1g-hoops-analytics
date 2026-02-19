export type B1GTeam = {
  name: string;
  shortName: string;
  slug: string;
  conference: "Big Ten";
  aliases: string[];
};

export const B1G_TEAMS: B1GTeam[] = [
  {
    name: "Illinois",
    shortName: "ILL",
    slug: "illinois",
    conference: "Big Ten",
    aliases: ["illinois fighting illini", "fighting illini", "uiuc"],
  },
  {
    name: "Indiana",
    shortName: "IU",
    slug: "indiana",
    conference: "Big Ten",
    aliases: ["indiana hoosiers", "hoosiers"],
  },
  {
    name: "Iowa",
    shortName: "IOWA",
    slug: "iowa",
    conference: "Big Ten",
    aliases: ["iowa hawkeyes", "hawkeyes"],
  },
  {
    name: "Maryland",
    shortName: "MD",
    slug: "maryland",
    conference: "Big Ten",
    aliases: ["maryland terrapins", "terrapins"],
  },
  {
    name: "Michigan",
    shortName: "MICH",
    slug: "michigan",
    conference: "Big Ten",
    aliases: ["michigan wolverines", "wolverines"],
  },
  {
    name: "Michigan State",
    shortName: "MSU",
    slug: "michigan-state",
    conference: "Big Ten",
    aliases: ["michigan state spartans", "spartans"],
  },
  {
    name: "Minnesota",
    shortName: "MINN",
    slug: "minnesota",
    conference: "Big Ten",
    aliases: ["minnesota golden gophers", "golden gophers"],
  },
  {
    name: "Nebraska",
    shortName: "NEB",
    slug: "nebraska",
    conference: "Big Ten",
    aliases: ["nebraska cornhuskers", "cornhuskers"],
  },
  {
    name: "Northwestern",
    shortName: "NU",
    slug: "northwestern",
    conference: "Big Ten",
    aliases: ["northwestern wildcats", "wildcats"],
  },
  {
    name: "Ohio State",
    shortName: "OSU",
    slug: "ohio-state",
    conference: "Big Ten",
    aliases: ["ohio state buckeyes", "buckeyes"],
  },
  {
    name: "Oregon",
    shortName: "ORE",
    slug: "oregon",
    conference: "Big Ten",
    aliases: ["oregon ducks", "ducks"],
  },
  {
    name: "Penn State",
    shortName: "PSU",
    slug: "penn-state",
    conference: "Big Ten",
    aliases: ["penn state nittany lions", "nittany lions"],
  },
  {
    name: "Purdue",
    shortName: "PUR",
    slug: "purdue",
    conference: "Big Ten",
    aliases: ["purdue boilermakers", "boilermakers"],
  },
  {
    name: "Rutgers",
    shortName: "RUTG",
    slug: "rutgers",
    conference: "Big Ten",
    aliases: ["rutgers scarlet knights", "scarlet knights"],
  },
  {
    name: "UCLA",
    shortName: "UCLA",
    slug: "ucla",
    conference: "Big Ten",
    aliases: ["ucla bruins", "bruins"],
  },
  {
    name: "USC",
    shortName: "USC",
    slug: "usc",
    conference: "Big Ten",
    aliases: ["usc trojans", "southern california", "trojans"],
  },
  {
    name: "Washington",
    shortName: "WASH",
    slug: "washington",
    conference: "Big Ten",
    aliases: ["washington huskies", "huskies"],
  },
  {
    name: "Wisconsin",
    shortName: "WIS",
    slug: "wisconsin",
    conference: "Big Ten",
    aliases: ["wisconsin badgers", "badgers"],
  },
];

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function slugifyTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-+/g, "-");
}

export const B1G_SLUGS = new Set(B1G_TEAMS.map((team) => team.slug));

const aliasToSlug = new Map<string, string>();
for (const team of B1G_TEAMS) {
  aliasToSlug.set(normalizeKey(team.name), team.slug);
  aliasToSlug.set(normalizeKey(team.shortName), team.slug);
  for (const alias of team.aliases) {
    aliasToSlug.set(normalizeKey(alias), team.slug);
  }
}

export function normalizeToKnownB1GSlug(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const key = normalizeKey(candidate);
    const slug = aliasToSlug.get(key);
    if (slug) {
      return slug;
    }
  }
  return null;
}

export function getB1GTeamBySlug(slug: string) {
  return B1G_TEAMS.find((team) => team.slug === slug);
}
