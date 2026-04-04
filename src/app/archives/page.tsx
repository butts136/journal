import { JournalCard } from "@/components/journal-card";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getArchiveLabel } from "@/lib/date";
import { getArchivedJournals, type JournalRecord } from "@/lib/store";
import { toManagedFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

function groupArchives(journals: JournalRecord[]) {
  const grouped = new Map<string, Map<string, JournalRecord[]>>();

  journals.forEach((journal) => {
    const date = new Date(`${journal.publicationDate}T12:00:00Z`);
    const year = String(date.getUTCFullYear());
    const month = getArchiveLabel(date);

    if (!grouped.has(year)) {
      grouped.set(year, new Map());
    }

    const months = grouped.get(year)!;

    if (!months.has(month)) {
      months.set(month, []);
    }

    months.get(month)!.push(journal);
  });

  return grouped;
}

export default async function ArchivesPage() {
  await ensureBootstrap();

  const archivedJournals = getArchivedJournals();
  const groups = groupArchives(archivedJournals);

  return (
    <div className="space-y-8">
      <section className="rounded-[34px] border border-white/60 bg-white/84 p-8 shadow-[0_30px_100px_rgba(48,38,23,0.08)]">
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-stone-500">Archives</p>
        <h1 className="mt-3 font-serif text-5xl text-stone-900">Toutes les anciennes éditions</h1>
        <p className="mt-4 max-w-3xl text-base leading-8 text-stone-600">
          Les 30 dernières parutions restent sur l&apos;accueil. Le reste est regroupé ici par année
          puis par mois pour conserver un kiosque lisible même quand le catalogue grossit.
        </p>
      </section>

      {archivedJournals.length === 0 ? (
        <div className="rounded-[32px] border border-dashed border-stone-300 bg-white/70 px-8 py-16 text-center">
          <p className="font-serif text-3xl text-stone-900">Aucune archive pour le moment.</p>
        </div>
      ) : (
        Array.from(groups.entries()).map(([year, months]) => (
          <section key={year} className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-serif text-4xl text-stone-900">{year}</h2>
              <p className="text-sm uppercase tracking-[0.22em] text-stone-500">
                {Array.from(months.values()).reduce((total, journals) => total + journals.length, 0)}{" "}
                éditions
              </p>
            </div>

            <div className="space-y-8">
              {Array.from(months.entries()).map(([month, journals]) => (
                <div key={`${year}-${month}`} className="space-y-4">
                  <div className="border-b border-stone-200/80 pb-3">
                    <h3 className="text-lg font-medium text-stone-700">{month}</h3>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {journals.map((journal) => (
                      <JournalCard
                        key={journal.id}
                        journal={journal}
                        thumbnailUrl={toManagedFileUrl(journal.thumbnailRelativePath)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
