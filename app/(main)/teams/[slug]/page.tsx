type TeamPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function TeamPage({ params }: TeamPageProps) {
  const { slug } = await params;

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Team: {slug}</h1>
      <p className="text-sm text-black/70">Team profile page.</p>
    </section>
  );
}
