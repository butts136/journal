import type { Metadata } from "next";
import Link from "next/link";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import { APP_NAME } from "@/lib/constants";

import "./globals.css";

const bodyFont = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: `${APP_NAME} | Lecteur de journaux PDF`,
  description:
    "Lecteur web de journaux PDF avec surveillance RSS, ingestion torrent et lecture verticale ou horizontale.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${bodyFont.variable} ${displayFont.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(228,191,136,0.35),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(125,102,70,0.16),transparent_30%),linear-gradient(180deg,#f6efe5_0%,#f2eadf_48%,#efe7dc_100%)]" />
        <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.045] [background-image:linear-gradient(to_right,#241e1510_1px,transparent_1px),linear-gradient(to_bottom,#241e1510_1px,transparent_1px)] [background-size:24px_24px]" />

        <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-4 pb-10 pt-4 sm:px-6 lg:px-10">
          <header className="sticky top-4 z-40">
            <div className="flex items-center justify-between rounded-full border border-white/60 bg-white/82 px-4 py-3 shadow-[0_24px_70px_rgba(42,34,20,0.09)] backdrop-blur md:px-6">
              <Link href="/" className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-900 text-sm font-semibold tracking-[0.28em] text-white">
                  LK
                </div>
                <div>
                  <p className="font-serif text-2xl leading-none text-stone-900">{APP_NAME}</p>
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-stone-500">
                    Journaux PDF en direct
                  </p>
                </div>
              </Link>

              <nav className="flex items-center gap-2 text-sm text-stone-700">
                <Link href="/" className="rounded-full px-4 py-2 transition hover:bg-stone-100">
                  Accueil
                </Link>
                <Link href="/archives" className="rounded-full px-4 py-2 transition hover:bg-stone-100">
                  Archives
                </Link>
                <Link href="/settings" className="rounded-full px-4 py-2 transition hover:bg-stone-100">
                  Parametres
                </Link>
              </nav>
            </div>
          </header>

          <main className="flex-1 pt-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
