import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "Tailor your resume to the jobs you want, truthfully.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-border">
          <nav
            aria-label="Main"
            className="mx-auto flex w-full max-w-3xl items-center gap-6 px-4 py-3 text-sm"
          >
            <Link href="/library" className="font-semibold">
              Resume Tailor
            </Link>
            <Link href="/library" className="text-muted hover:text-foreground">
              Library
            </Link>
            <Link href="/resume" className="text-muted hover:text-foreground">
              Resume
            </Link>
            <Link href="/target-sets" className="text-muted hover:text-foreground">
              Target sets
            </Link>
            <Link href="/analysis" className="text-muted hover:text-foreground">
              Analysis
            </Link>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
