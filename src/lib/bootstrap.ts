import { DEFAULT_POLL_INTERVAL_SECONDS } from "@/lib/constants";
import { broadcastEvent } from "@/lib/events";
import { parseJournalCandidate } from "@/lib/journal-parser";
import { generatePdfArtifacts } from "@/lib/pdf";
import { fetchRssItems, isQueryableSearchFeed, type RssItem } from "@/lib/rss";
import {
  createJournalIfMissing,
  getAppConfig,
  getEnabledFeeds,
  getEnabledSearchTerms,
  markJournalDownloading,
  markJournalError,
  markJournalReady,
  seedFeedsIfEmpty,
} from "@/lib/store";
import { buildJournalStoragePaths, ensureStorageStructure } from "@/lib/storage";
import { downloadLargestPdfFromTorrent } from "@/lib/torrent";

declare global {
  var __journalBootstrapStarted: boolean | undefined;
  var __journalBootstrapInterval: NodeJS.Timeout | undefined;
  var __journalBootstrapScanPromise: Promise<void> | undefined;
}

function getDefaultFeedUrls() {
  const raw = process.env.DEFAULT_RSS_FEEDS ?? "";

  return raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function processItem(feedId: number, item: RssItem) {
  const searchTerms = getEnabledSearchTerms();
  const parsed = parseJournalCandidate(item, searchTerms);

  if (!parsed) {
    return;
  }

  const created = createJournalIfMissing({
    publicationName: parsed.publicationName,
    publicationKey: parsed.publicationKey,
    publicationDate: parsed.publicationDateKey,
    displayTitle: parsed.displayTitle,
    sourceTitle: item.title,
    sourceGuid: item.guid,
    sourceUrl: item.comments ?? item.link,
    sourceFeedId: feedId,
    torrentUrl: item.enclosureUrl ?? item.link,
    infoHash: item.infoHash,
    coverUrl: item.coverUrl,
  });

  if (!created.created) {
    return;
  }

  if (!item.enclosureUrl && !item.link) {
    markJournalError(created.id, "Le torrent ne fournit aucun lien exploitable.");
    return;
  }

  markJournalDownloading(created.id);

  try {
    const paths = buildJournalStoragePaths(parsed.publicationKey, parsed.publicationDateKey);
    const download = await downloadLargestPdfFromTorrent(
      item.enclosureUrl ?? item.link ?? "",
      paths.pdfAbsolutePath,
    );
    const artifacts = await generatePdfArtifacts(paths.pdfAbsolutePath, paths.thumbnailAbsolutePath);

    markJournalReady(
      created.id,
      paths.pdfRelativePath,
      paths.thumbnailRelativePath,
      artifacts.pageCount,
      download.bytes,
    );

    broadcastEvent("journal-updated", {
      id: created.id,
      title: parsed.displayTitle,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Echec inconnu pendant l'ingestion du PDF.";
    markJournalError(created.id, message);
    broadcastEvent("journal-error", {
      id: created.id,
      message,
    });
  }
}

async function scanFeed(feed: { id: number; url: string }, termLabel?: string) {
  const items = await fetchRssItems(feed.url, termLabel);

  for (const item of items) {
    await processItem(feed.id, item);
  }
}

async function runScanCycle() {
  const feeds = getEnabledFeeds();
  const searchTerms = getEnabledSearchTerms();

  if (!feeds.length || !searchTerms.length) {
    return;
  }

  for (const feed of feeds) {
    if (isQueryableSearchFeed(feed.url)) {
      for (const term of searchTerms) {
        await scanFeed(feed, term.label);
      }
      continue;
    }

    await scanFeed(feed);
  }
}

export async function triggerScanNow() {
  if (global.__journalBootstrapScanPromise) {
    return global.__journalBootstrapScanPromise;
  }

  global.__journalBootstrapScanPromise = runScanCycle().finally(() => {
    global.__journalBootstrapScanPromise = undefined;
  });

  return global.__journalBootstrapScanPromise;
}

export async function ensureBootstrap() {
  await ensureStorageStructure();
  seedFeedsIfEmpty(getDefaultFeedUrls());

  if (global.__journalBootstrapStarted) {
    return;
  }

  global.__journalBootstrapStarted = true;
  await triggerScanNow();

  const pollIntervalSeconds =
    getAppConfig().pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;

  global.__journalBootstrapInterval = setInterval(() => {
    void triggerScanNow();
  }, pollIntervalSeconds * 1000);
}
