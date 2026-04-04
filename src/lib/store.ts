import { getDb } from "@/lib/db";
import { DEFAULT_POLL_INTERVAL_SECONDS, RECENT_JOURNALS_LIMIT } from "@/lib/constants";
import { normalizeText } from "@/lib/utils";

export type FeedRecord = {
  id: number;
  name: string;
  url: string;
  isEnabled: boolean;
};

export type SearchTermRecord = {
  id: number;
  label: string;
  normalizedLabel: string;
  isEnabled: boolean;
};

export type JournalRecord = {
  id: number;
  publicationName: string;
  publicationKey: string;
  publicationDate: string;
  displayTitle: string;
  sourceTitle: string;
  sourceGuid: string | null;
  sourceUrl: string | null;
  sourceFeedId: number | null;
  torrentUrl: string | null;
  infoHash: string | null;
  coverUrl: string | null;
  pdfRelativePath: string | null;
  thumbnailRelativePath: string | null;
  pageCount: number | null;
  fileSize: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type NewJournalInput = {
  publicationName: string;
  publicationKey: string;
  publicationDate: string;
  displayTitle: string;
  sourceTitle: string;
  sourceGuid: string | null;
  sourceUrl: string | null;
  sourceFeedId: number;
  torrentUrl: string | null;
  infoHash: string | null;
  coverUrl: string | null;
};

function mapFeed(row: Record<string, unknown>): FeedRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    url: String(row.url),
    isEnabled: Boolean(row.is_enabled),
  };
}

function mapSearchTerm(row: Record<string, unknown>): SearchTermRecord {
  return {
    id: Number(row.id),
    label: String(row.label),
    normalizedLabel: String(row.normalized_label),
    isEnabled: Boolean(row.is_enabled),
  };
}

function mapJournal(row: Record<string, unknown>): JournalRecord {
  return {
    id: Number(row.id),
    publicationName: String(row.publication_name),
    publicationKey: String(row.publication_key),
    publicationDate: String(row.publication_date),
    displayTitle: String(row.display_title),
    sourceTitle: String(row.source_title),
    sourceGuid: row.source_guid ? String(row.source_guid) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    sourceFeedId: row.source_feed_id ? Number(row.source_feed_id) : null,
    torrentUrl: row.torrent_url ? String(row.torrent_url) : null,
    infoHash: row.info_hash ? String(row.info_hash) : null,
    coverUrl: row.cover_url ? String(row.cover_url) : null,
    pdfRelativePath: row.pdf_relative_path ? String(row.pdf_relative_path) : null,
    thumbnailRelativePath: row.thumbnail_relative_path
      ? String(row.thumbnail_relative_path)
      : null,
    pageCount: row.page_count ? Number(row.page_count) : null,
    fileSize: row.file_size ? Number(row.file_size) : null,
    status: String(row.status),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getAppConfig() {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT admin_password_hash, session_secret, poll_interval_seconds FROM app_config WHERE id = 1",
    )
    .get() as {
    admin_password_hash: string | null;
    session_secret: string;
    poll_interval_seconds: number;
  };

  return {
    adminPasswordHash: row.admin_password_hash,
    sessionSecret: row.session_secret,
    pollIntervalSeconds: row.poll_interval_seconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

export function isApplicationConfigured() {
  return Boolean(getAppConfig().adminPasswordHash);
}

export function setAdminPasswordHash(passwordHash: string) {
  const db = getDb();
  db.prepare(
    `
      UPDATE app_config
      SET admin_password_hash = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
  ).run(passwordHash);
}

export function getEnabledFeeds(): FeedRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM rss_feeds WHERE is_enabled = 1 ORDER BY id ASC")
    .all()
    .map((row) => mapFeed(row as Record<string, unknown>));
}

export function getAllFeeds(): FeedRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM rss_feeds ORDER BY created_at ASC, id ASC")
    .all()
    .map((row) => mapFeed(row as Record<string, unknown>));
}

export function seedFeedsIfEmpty(urls: string[]) {
  const db = getDb();
  const trimmedUrls = Array.from(
    new Set(
      urls
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  );

  if (!trimmedUrls.length) {
    return;
  }

  const existingCount = db
    .prepare("SELECT COUNT(*) AS count FROM rss_feeds")
    .get() as { count: number };

  if (existingCount.count > 0) {
    return;
  }

  const insert = db.prepare(
    `
      INSERT INTO rss_feeds (name, url)
      VALUES (?, ?)
    `,
  );

  trimmedUrls.forEach((url, index) => {
    insert.run(`Flux RSS ${index + 1}`, url);
  });
}

export function addFeed(name: string, url: string) {
  const db = getDb();
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();

  if (!trimmedName || !trimmedUrl) {
    return;
  }

  db.prepare(
    `
      INSERT OR IGNORE INTO rss_feeds (name, url)
      VALUES (?, ?)
    `,
  ).run(trimmedName, trimmedUrl);
}

export function removeFeed(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM rss_feeds WHERE id = ?").run(id);
}

export function getEnabledSearchTerms(): SearchTermRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM search_terms WHERE is_enabled = 1 ORDER BY id ASC")
    .all()
    .map((row) => mapSearchTerm(row as Record<string, unknown>));
}

export function getAllSearchTerms(): SearchTermRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM search_terms ORDER BY created_at ASC, id ASC")
    .all()
    .map((row) => mapSearchTerm(row as Record<string, unknown>));
}

export function addSearchTerm(label: string) {
  const db = getDb();
  const trimmedLabel = label.trim();
  const normalizedLabel = normalizeText(trimmedLabel);

  if (!trimmedLabel || !normalizedLabel) {
    return;
  }

  db.prepare(
    `
      INSERT OR IGNORE INTO search_terms (label, normalized_label)
      VALUES (?, ?)
    `,
  ).run(trimmedLabel, normalizedLabel);
}

export function removeSearchTerm(id: number) {
  const db = getDb();
  db.prepare("DELETE FROM search_terms WHERE id = ?").run(id);
}

export function createJournalIfMissing(input: NewJournalInput) {
  const db = getDb();
  const existing = db
    .prepare(
      `
        SELECT id
        FROM journals
        WHERE (source_guid IS NOT NULL AND source_guid = @sourceGuid)
           OR (info_hash IS NOT NULL AND info_hash = @infoHash)
           OR (publication_key = @publicationKey AND publication_date = @publicationDate)
        LIMIT 1
      `,
    )
    .get({
      sourceGuid: input.sourceGuid,
      infoHash: input.infoHash,
      publicationKey: input.publicationKey,
      publicationDate: input.publicationDate,
    }) as { id: number } | undefined;

  if (existing) {
    return { id: existing.id, created: false };
  }

  const result = db
    .prepare(
      `
        INSERT INTO journals (
          publication_name,
          publication_key,
          publication_date,
          display_title,
          source_title,
          source_guid,
          source_url,
          source_feed_id,
          torrent_url,
          info_hash,
          cover_url,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
      `,
    )
    .run(
      input.publicationName,
      input.publicationKey,
      input.publicationDate,
      input.displayTitle,
      input.sourceTitle,
      input.sourceGuid,
      input.sourceUrl,
      input.sourceFeedId,
      input.torrentUrl,
      input.infoHash,
      input.coverUrl,
    );

  return { id: Number(result.lastInsertRowid), created: true };
}

export function markJournalDownloading(id: number) {
  const db = getDb();
  db.prepare(
    `
      UPDATE journals
      SET status = 'downloading',
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).run(id);
}

export function markJournalReady(
  id: number,
  pdfRelativePath: string,
  thumbnailRelativePath: string,
  pageCount: number,
  fileSize: number,
) {
  const db = getDb();
  db.prepare(
    `
      UPDATE journals
      SET status = 'ready',
          pdf_relative_path = ?,
          thumbnail_relative_path = ?,
          page_count = ?,
          file_size = ?,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).run(pdfRelativePath, thumbnailRelativePath, pageCount, fileSize, id);
}

export function markJournalError(id: number, message: string) {
  const db = getDb();
  db.prepare(
    `
      UPDATE journals
      SET status = 'error',
          error_message = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
  ).run(message, id);
}

export function getJournalById(id: number): JournalRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM journals WHERE id = ?").get(id);
  return row ? mapJournal(row as Record<string, unknown>) : null;
}

export function getRecentJournals(limit = RECENT_JOURNALS_LIMIT): JournalRecord[] {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT *
        FROM journals
        WHERE status = 'ready'
        ORDER BY publication_date DESC, id DESC
        LIMIT ?
      `,
    )
    .all(limit)
    .map((row) => mapJournal(row as Record<string, unknown>));
}

export function getArchivedJournals(offset = RECENT_JOURNALS_LIMIT): JournalRecord[] {
  const db = getDb();
  return db
    .prepare(
      `
        SELECT *
        FROM journals
        WHERE status = 'ready'
        ORDER BY publication_date DESC, id DESC
        LIMIT -1 OFFSET ?
      `,
    )
    .all(offset)
    .map((row) => mapJournal(row as Record<string, unknown>));
}

export function getStatusSnapshot() {
  const db = getDb();
  const ready = db
    .prepare("SELECT COUNT(*) AS count FROM journals WHERE status = 'ready'")
    .get() as { count: number };
  const downloading = db
    .prepare(
      "SELECT COUNT(*) AS count FROM journals WHERE status = 'downloading'",
    )
    .get() as { count: number };

  return {
    readyCount: ready.count,
    downloadingCount: downloading.count,
    feedCount: getAllFeeds().length,
    termCount: getAllSearchTerms().length,
  };
}
