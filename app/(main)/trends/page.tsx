export default function TrendsPage() {
  return (
    <section className="space-y-6">
      <div className="data-panel data-grid-bg rounded-2xl p-5 sm:p-6">
        <p className="stat-label">Trends Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Trends</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Trend analysis UI is next. This page will host tempo, efficiency, shot profile, and
          rolling performance views by team/date window.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="data-panel rounded-xl p-4 lg:col-span-2">
          <p className="stat-label">Planned Modules</p>
          <ul className="mt-3 space-y-2 text-sm text-foreground/90">
            <li className="rounded-lg border border-line bg-panel/50 px-3 py-2">
              Rolling offensive / defensive efficiency
            </li>
            <li className="rounded-lg border border-line bg-panel/50 px-3 py-2">
              Opponent-adjusted game splits
            </li>
            <li className="rounded-lg border border-line bg-panel/50 px-3 py-2">
              Home / away / neutral performance segments
            </li>
            <li className="rounded-lg border border-line bg-panel/50 px-3 py-2">
              Recent form table (last 5 / last 10)
            </li>
          </ul>
        </div>

        <div className="data-panel rounded-xl p-4">
          <p className="stat-label">Data Status</p>
          <p className="mt-2 text-sm text-muted">
            Team and game ingestion is live. Trend derivations can now be computed from the existing
            D1 game + boxscore tables.
          </p>
        </div>
      </div>
    </section>
  );
}
