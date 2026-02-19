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
      <header className="border-b border-black/10">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 py-10">{children}</main>
      <footer className="border-t border-black/10">
        <div className="mx-auto max-w-5xl px-6 py-4 text-sm text-black/70">
          B1G Hoops Analytics
        </div>
      </footer>
    </div>
  );
}
