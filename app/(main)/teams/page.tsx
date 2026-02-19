import Link from "next/link";

const sampleTeams = [
  { slug: "purdue", name: "Purdue" },
  { slug: "michigan-state", name: "Michigan State" },
  { slug: "ucla", name: "UCLA" },
];

export default function TeamsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Teams</h1>
      <ul className="space-y-2">
        {sampleTeams.map((team) => (
          <li key={team.slug}>
            <Link href={`/teams/${team.slug}`} className="text-sm hover:underline">
              {team.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
