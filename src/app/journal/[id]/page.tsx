import Link from "next/link";
import { notFound } from "next/navigation";

import { PdfReader } from "@/components/pdf-reader";
import { ensureBootstrap } from "@/lib/bootstrap";
import { getJournalById } from "@/lib/store";
import { toManagedFileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function JournalReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureBootstrap();

  const { id } = await params;
  const journal = getJournalById(Number(id));

  if (!journal || !journal.pdfRelativePath) {
    notFound();
  }

  const fileUrl = toManagedFileUrl(journal.pdfRelativePath);

  if (!fileUrl) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[34px] border border-white/60 bg-white/84 p-8 shadow-[0_30px_100px_rgba(48,38,23,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.28em] text-stone-500">Lecteur PDF</p>
            <h1 className="mt-3 font-serif text-5xl text-stone-900">{journal.displayTitle}</h1>
            <p className="mt-3 max-w-3xl text-base leading-8 text-stone-600">
              Bascule entre un défilement vertical classique et une lecture horizontale conçue pour
              préparer d&apos;autres modes plus tard.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800"
            >
              Retour accueil
            </Link>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white"
            >
              Ouvrir le PDF brut
            </a>
          </div>
        </div>
      </section>

      <PdfReader fileUrl={fileUrl} />
    </div>
  );
}
