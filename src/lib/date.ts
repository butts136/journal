import { format } from "date-fns";
import { frCA } from "date-fns/locale";

import { normalizeText, titleCase } from "@/lib/utils";

const MONTHS = new Map<string, number>([
  ["jan", 0],
  ["janvier", 0],
  ["january", 0],
  ["fev", 1],
  ["fevr", 1],
  ["fevrier", 1],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["mars", 2],
  ["march", 2],
  ["avr", 3],
  ["avril", 3],
  ["apr", 3],
  ["april", 3],
  ["mai", 4],
  ["may", 4],
  ["jun", 5],
  ["juin", 5],
  ["june", 5],
  ["jul", 6],
  ["juil", 6],
  ["juillet", 6],
  ["july", 6],
  ["aou", 7],
  ["aout", 7],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["septembre", 8],
  ["september", 8],
  ["oct", 9],
  ["octobre", 9],
  ["october", 9],
  ["nov", 10],
  ["novembre", 10],
  ["november", 10],
  ["dec", 11],
  ["decembre", 11],
  ["december", 11],
]);

const DATE_PATTERN =
  /\b(\d{1,2})(?:\s+(\d{1,2}))?\s+(janvier|january|jan|fevrier|february|fevr|fev|feb|mars|march|mar|avril|april|avr|apr|mai|may|juin|june|jun|juillet|july|juil|jul|aout|august|aou|aug|septembre|september|sept|sep|octobre|october|oct|novembre|november|nov|decembre|december|dec)\s+(\d{4})\b/i;

export function extractPublicationDateFromTitle(title: string) {
  const normalized = normalizeText(title);
  const match = normalized.match(DATE_PATTERN);

  if (!match) {
    return null;
  }

  const day = Number(match[2] ?? match[1]);
  const month = MONTHS.get(match[3].toLowerCase());
  const year = Number(match[4]);

  if (month === undefined || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month, day, 12, 0, 0));

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function formatFrenchDate(date: Date) {
  return titleCase(format(date, "dd MMMM yyyy", { locale: frCA }));
}

export function getArchiveLabel(date: Date) {
  return titleCase(format(date, "MMMM yyyy", { locale: frCA }));
}
