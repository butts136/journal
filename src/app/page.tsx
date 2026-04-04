import Link from "next/link";

import { JournalCard } from "@/components/journal-card";
import { LiveJournalRefresh } from "@/components/live-journal-refresh";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getRecentJournals, getStatusSnapshot } from "@/lib/store";
import { toManagedFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureBootstrap();

  const recentJournals = getRecentJournals();
  const stats = getStatusSnapshot();

  return (
    <div className="space-y-10">
      <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="overflow-hidden rounded-[36px] border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(244,233,216,0.88))] p-8 shadow-[0_30px_100px_rgba(48,38,23,0.10)]">
          <div className="inline-flex rounded-full border border-stone-300/70 bg-white/80 px-4 py-2 text-[0.7rem] uppercase tracking-[0.3em] text-stone-600">
            Edition dynamique
          </div>

          <div className="mt-6 max-w-4xl space-y-4">
            <h1 className="font-serif text-5xl leading-none text-stone-900 sm:text-6xl lg:text-7xl">
              Les 30 journaux les plus récents, prêts à lire dès qu&apos;ils tombent.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-stone-600 sm:text-lg">
              Le flux surveille tes sources RSS, repère les PDF correspondant à tes mots-clés,
              récupère le torrent, extrait le journal et l&apos;affiche en direct sans recharger la
              page.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#recents"
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white"
            >
              Ouvrir les nouveautés
            </Link>
            <Link
              href="/archives"
              className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800"
            >
              Explorer les archives
            </Link>
          </div>
        </div>

        <div className="space-y-5 rounded-[36px] border border-white/60 bg-white/84 p-7 shadow-[0_30px_100px_rgba(48,38,23,0.08)]">
          <LiveJournalRefresh />

          <div className="grid gap-4">
            {[
              { label: "Journaux disponibles", value: stats.readyCount },
              { label: "Importations actives", value: stats.downloadingCount },
              { label: "Flux surveillés", value: stats.feedCount },
              { label: "Termes suivis", value: stats.termCount },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-end justify-between border-b border-stone-200/80 pb-4 last:border-b-0 last:pb-0"
              >
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.26em] text-stone-500">
                    {item.label}
                  </p>
                  <p className="mt-2 font-serif text-4xl text-stone-900">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="recents" className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.28em] text-stone-500">Accueil</p>
            <h2 className="font-serif text-4xl text-stone-900">Journaux récents</h2>
          </div>
          <p className="max-w-xl text-sm leading-7 text-stone-600">
            Les éditions plus anciennes glissent automatiquement dans les archives une fois le cap
            des 30 journaux atteint.
          </p>
        </div>

        {recentJournals.length ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {recentJournals.map((journal) => (
              <JournalCard
                key={journal.id}
                journal={journal}
                thumbnailUrl={toManagedFileUrl(journal.thumbnailRelativePath)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[32px] border border-dashed border-stone-300 bg-white/70 px-8 py-16 text-center">
            <p className="font-serif text-3xl text-stone-900">Aucun journal prêt pour l&apos;instant.</p>
            <p className="mt-3 text-sm leading-7 text-stone-600">
              Configure d&apos;abord un mot-clé et un flux dans les paramètres. Le premier scan fera
              ensuite apparaître les PDF automatiquement.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
