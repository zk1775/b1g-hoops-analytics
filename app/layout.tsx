import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "B1G Hoops Analytics",
  description: "Big Ten men’s basketball analytics and game data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
