import { extractPublicationDateFromTitle, formatFrenchDate, toDateKey } from "@/lib/date";
import type { RssItem } from "@/lib/rss";
import type { SearchTermRecord } from "@/lib/store";
import { normalizeText, slugify } from "@/lib/utils";

export type ParsedJournalCandidate = {
  publicationName: string;
  publicationKey: string;
  publicationDate: Date;
  publicationDateKey: string;
  displayTitle: string;
};

function chooseMatchingTerm(title: string, searchTerms: SearchTermRecord[]) {
  const normalizedTitle = normalizeText(title);

  return searchTerms
    .filter((term) => normalizedTitle.includes(term.normalizedLabel))
    .toSorted((left, right) => right.normalizedLabel.length - left.normalizedLabel.length)[0];
}

function isLikelyPdfJournal(title: string) {
  const normalized = normalizeText(title);
  return normalized.includes("pdf") || normalized.includes("ebook");
}

export function parseJournalCandidate(
  item: RssItem,
  searchTerms: SearchTermRecord[],
): ParsedJournalCandidate | null {
  if (!item.title || !isLikelyPdfJournal(item.title)) {
    return null;
  }

  const matchingTerm = chooseMatchingTerm(item.title, searchTerms);
  const publicationDate = extractPublicationDateFromTitle(item.title);

  if (!matchingTerm || !publicationDate) {
    return null;
  }

  return {
    publicationName: matchingTerm.label,
    publicationKey: slugify(matchingTerm.label),
    publicationDate,
    publicationDateKey: toDateKey(publicationDate),
    displayTitle: `${matchingTerm.label} - ${formatFrenchDate(publicationDate)}`,
  };
}
