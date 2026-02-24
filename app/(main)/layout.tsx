import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/teams", label: "Teams" },
  { href: "/trends", label: "Trends" },
];

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-background/85 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-2.5 sm:px-6">
          <div className="data-panel data-grid-bg rounded-xl p-2.5 sm:p-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2.5">
                <div className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-panel-2">
                  <span className="stat-value text-sm text-accent">B1G</span>
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-wide text-white">
                    B1G Hoops Analytics
                  </p>
                  <p className="hidden text-xs text-muted sm:block">
                    Torvik-style data board, rebuilt for live D1 + ESPN ingestion
                  </p>
                </div>
              </div>

              <nav className="flex flex-wrap items-center gap-2">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className="rounded-md border border-line bg-panel/70 px-2.5 py-1 text-xs font-semibold tracking-wide text-foreground/90 hover:border-accent/40 hover:text-accent"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="side-rail hidden lg:block">
            <div className="space-y-3">
              <div className="data-panel rounded-xl p-3">
                <p className="stat-label">Workspace</p>
                <div className="mt-2 grid gap-1.5">
                  {navItems.map((item) => (
                    <Link
                      key={`rail-${item.href}`}
                      href={item.href}
                      prefetch={false}
                      className="rounded-md border border-line bg-panel/60 px-2.5 py-2 text-xs font-semibold tracking-wide text-foreground/90 hover:border-accent/40 hover:text-accent"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="data-panel rounded-xl p-3">
                <p className="stat-label">Quick Team Views</p>
                <div className="mt-2 grid gap-1.5">
                  <Link
                    href="/teams?sort=record&dir=desc"
                    prefetch={false}
                    className="rounded-md border border-line bg-panel/60 px-2.5 py-2 text-xs text-muted hover:text-accent"
                  >
                    Sort by record
                  </Link>
                  <Link
                    href="/teams?sort=last&dir=desc"
                    prefetch={false}
                    className="rounded-md border border-line bg-panel/60 px-2.5 py-2 text-xs text-muted hover:text-accent"
                  >
                    Recent results first
                  </Link>
                  <Link
                    href="/teams?sort=next&dir=asc"
                    prefetch={false}
                    className="rounded-md border border-line bg-panel/60 px-2.5 py-2 text-xs text-muted hover:text-accent"
                  >
                    Upcoming games first
                  </Link>
                </div>
              </div>

              <div className="data-panel rounded-xl p-3">
                <p className="stat-label">Filters (Desktop)</p>
                <div className="mt-2 space-y-2 text-xs text-muted">
                  <p className="rounded-md border border-line bg-panel/50 px-2.5 py-2">
                    Current scope: Big Ten teams only
                  </p>
                  <p className="rounded-md border border-line bg-panel/50 px-2.5 py-2">
                    Season data is pulled from ESPN and stored in D1
                  </p>
                  <p className="rounded-md border border-line bg-panel/50 px-2.5 py-2">
                    More filters (home/away/date splits) can be added next
                  </p>
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </main>

      <footer className="mt-10 border-t border-line/80">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="data-panel rounded-xl px-4 py-3 text-sm text-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>B1G Hoops Analytics</span>
              <span className="stat-value text-xs text-foreground/80">
                Cloudflare Pages • D1 • Drizzle • ESPN
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
