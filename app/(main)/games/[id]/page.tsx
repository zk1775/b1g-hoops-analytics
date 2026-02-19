type GamePageProps = {
  params: Promise<{ id: string }>;
};

export default async function GamePage({ params }: GamePageProps) {
  const { id } = await params;

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Game: {id}</h1>
      <p className="text-sm text-black/70">Game detail page.</p>
    </section>
  );
}
