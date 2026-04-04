import Link from "next/link";

import type { JournalRecord } from "@/lib/store";
import { cn } from "@/lib/utils";

function formatBytes(value: number | null) {
  if (!value) {
    return null;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} Ko`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
}

export function JournalCard({
  journal,
  thumbnailUrl,
  compact = false,
}: {
  journal: JournalRecord;
  thumbnailUrl: string | null;
  compact?: boolean;
}) {
  return (
    <Link
      href={`/journal/${journal.id}`}
      className={cn(
        "group relative overflow-hidden rounded-[28px] border border-white/50 bg-white/85 shadow-[0_24px_80px_rgba(36,31,21,0.08)] backdrop-blur transition-transform duration-300 hover:-translate-y-1",
        compact ? "rounded-[24px]" : "",
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(224,180,109,0.18),transparent_45%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative">
        <div className="aspect-[4/5] overflow-hidden bg-[linear-gradient(180deg,#f3e7d4_0%,#e3d5bf_100%)]">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={journal.displayTitle}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm uppercase tracking-[0.28em] text-stone-500">
              PDF
            </div>
          )}
        </div>

        <div className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between gap-3 text-[0.7rem] uppercase tracking-[0.24em] text-stone-500">
            <span>{journal.pageCount ? `${journal.pageCount} pages` : "Edition PDF"}</span>
            <span>{formatBytes(journal.fileSize) ?? "Pret"}</span>
          </div>

          <h3 className="font-serif text-xl leading-tight text-stone-900">{journal.displayTitle}</h3>

          <p className="line-clamp-2 text-sm leading-6 text-stone-600">{journal.sourceTitle}</p>
        </div>
      </div>
    </Link>
  );
}
