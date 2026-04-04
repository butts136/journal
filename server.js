const http = require("node:http");
const https = require("node:https");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const Database = require("better-sqlite3");
const { XMLParser } = require("fast-xml-parser");

loadEnvFile(path.join(process.cwd(), ".env.local"));

const APP_NAME = "Le Kiosque";
const RECENT_JOURNALS_LIMIT = 30;
const AUTH_COOKIE_NAME = "journal_admin_session";
const DEFAULT_POLL_INTERVAL_SECONDS = 180;
const PORT = Number(process.env.PORT || 3000);
const DATABASE_PATH =
  process.env.JOURNAL_DB_PATH || path.join(process.cwd(), "data", "journal.sqlite");
const STORAGE_ROOT =
  process.env.JOURNAL_STORAGE_DIR || path.join(process.cwd(), "storage");
const PUBLIC_ROOT = path.join(process.cwd(), "public");
const PDFJS_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const DEFAULT_BASE_PATH = normalizeBasePath(process.env.APP_BASE_PATH || "");

const runtime = {
  db: null,
  eventClients: new Set(),
  scanPromise: null,
  scanInterval: null,
  scanState: {
    running: false,
    lastSuccessAt: null,
    lastError: null,
  },
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: true,
  trimValues: true,
});

const MONTH_NAMES = [
  "Janvier",
  "Fevrier",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Aout",
  "Septembre",
  "Octobre",
  "Novembre",
  "Decembre",
];

const MONTH_TOKENS = new Map([
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

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeBasePath(value) {
  const raw = String(value || "").trim();

  if (!raw || raw === "/") {
    return "";
  }

  return `/${raw.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\[\]().,_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readCookies(request) {
  const raw = request.headers.cookie || "";
  const entries = raw.split(/;\s*/).filter(Boolean);
  const cookies = {};

  for (const entry of entries) {
    const index = entry.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = entry.slice(0, index);
    const value = entry.slice(index + 1);
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function createSignedCookie(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verifySignedCookie(token, secret) {
  if (!token || !secret) {
    return null;
  }

  const [data, signature] = token.split(".");

  if (!data || !signature) {
    return null;
  }

  const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  if (signature.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));

  if (!payload || payload.exp < Date.now()) {
    return null;
  }

  return payload;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.startsWith("scrypt$")) {
    return false;
  }

  const [, salt, hash] = storedHash.split("$");

  if (!salt || !hash) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, 64).toString("base64url");
  return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

function initializeDatabase(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      admin_password_hash TEXT,
      session_secret TEXT NOT NULL,
      poll_interval_seconds INTEGER NOT NULL DEFAULT 180,
      max_journal_age_days INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rss_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS search_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL UNIQUE,
      normalized_label TEXT NOT NULL UNIQUE,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publication_name TEXT NOT NULL,
      publication_key TEXT NOT NULL,
      publication_date TEXT NOT NULL,
      display_title TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_guid TEXT,
      source_url TEXT,
      source_feed_id INTEGER,
      torrent_url TEXT,
      info_hash TEXT,
      cover_url TEXT,
      pdf_relative_path TEXT,
      thumbnail_relative_path TEXT,
      page_count INTEGER,
      file_size INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(publication_key, publication_date),
      UNIQUE(source_guid),
      UNIQUE(info_hash),
      FOREIGN KEY (source_feed_id) REFERENCES rss_feeds(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_journals_publication_date ON journals(publication_date DESC);
    CREATE INDEX IF NOT EXISTS idx_journals_status ON journals(status);
  `);

  const existing = db.prepare("SELECT id FROM app_config WHERE id = 1").get();
  if (!existing) {
    db.prepare(
      "INSERT INTO app_config (id, session_secret) VALUES (1, ?)",
    ).run(crypto.randomBytes(32).toString("base64url"));
  }

  const appConfigColumns = db.prepare("PRAGMA table_info(app_config)").all();
  const hasMaxJournalAge = appConfigColumns.some((column) => column.name === "max_journal_age_days");

  if (!hasMaxJournalAge) {
    db.exec("ALTER TABLE app_config ADD COLUMN max_journal_age_days INTEGER");
  }
}

function getDb() {
  if (!runtime.db) {
    ensureDir(path.dirname(DATABASE_PATH));
    runtime.db = new Database(DATABASE_PATH);
    initializeDatabase(runtime.db);
  }

  return runtime.db;
}

function getAppConfig() {
  const row = getDb()
    .prepare(
      "SELECT admin_password_hash, session_secret, poll_interval_seconds, max_journal_age_days FROM app_config WHERE id = 1",
    )
    .get();

  return {
    adminPasswordHash: row.admin_password_hash,
    sessionSecret: row.session_secret,
    pollIntervalSeconds: row.poll_interval_seconds || DEFAULT_POLL_INTERVAL_SECONDS,
    maxJournalAgeDays:
      typeof row.max_journal_age_days === "number" && row.max_journal_age_days > 0
        ? row.max_journal_age_days
        : null,
  };
}

function isConfigured() {
  return Boolean(getAppConfig().adminPasswordHash);
}

function setAdminPassword(password) {
  const passwordHash = hashPassword(password);
  getDb()
    .prepare(
      "UPDATE app_config SET admin_password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    )
    .run(passwordHash);
}

function setMaxJournalAgeDays(value) {
  const parsed = Number(value);
  const maxJournalAgeDays = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;

  getDb()
    .prepare(
      "UPDATE app_config SET max_journal_age_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    )
    .run(maxJournalAgeDays);
}

function getEnabledFeeds() {
  return getDb().prepare("SELECT * FROM rss_feeds WHERE is_enabled = 1 ORDER BY id ASC").all();
}

function getAllFeeds() {
  return getDb()
    .prepare("SELECT * FROM rss_feeds ORDER BY created_at ASC, id ASC")
    .all();
}

function seedFeedsIfEmpty(urls) {
  const cleaned = [...new Set(urls.map((url) => url.trim()).filter(Boolean))];

  if (!cleaned.length) {
    return;
  }

  const count = getDb().prepare("SELECT COUNT(*) AS count FROM rss_feeds").get().count;
  if (count > 0) {
    return;
  }

  const statement = getDb().prepare("INSERT OR IGNORE INTO rss_feeds (name, url) VALUES (?, ?)");
  cleaned.forEach((url, index) => {
    statement.run(`Flux RSS ${index + 1}`, url);
  });
}

function addFeed(name, url) {
  const cleanName = String(name || "").trim();
  const cleanUrl = String(url || "").trim();

  if (!cleanName || !cleanUrl) {
    return;
  }

  getDb()
    .prepare("INSERT OR IGNORE INTO rss_feeds (name, url) VALUES (?, ?)")
    .run(cleanName, cleanUrl);
}

function removeFeed(id) {
  getDb().prepare("DELETE FROM rss_feeds WHERE id = ?").run(id);
}

function getEnabledSearchTerms() {
  return getDb()
    .prepare("SELECT * FROM search_terms WHERE is_enabled = 1 ORDER BY id ASC")
    .all();
}

function getAllSearchTerms() {
  return getDb()
    .prepare("SELECT * FROM search_terms ORDER BY created_at ASC, id ASC")
    .all();
}

function addSearchTerm(label) {
  const cleanLabel = String(label || "").trim();
  const normalizedLabel = normalizeText(cleanLabel);

  if (!cleanLabel || !normalizedLabel) {
    return;
  }

  getDb()
    .prepare("INSERT OR IGNORE INTO search_terms (label, normalized_label) VALUES (?, ?)")
    .run(cleanLabel, normalizedLabel);
}

function removeSearchTerm(id) {
  getDb().prepare("DELETE FROM search_terms WHERE id = ?").run(id);
}

function createJournalIfMissing(input) {
  const existing = getDb()
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
    .get(input);

  if (existing) {
    return { id: existing.id, created: false };
  }

  const result = getDb()
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
        VALUES (@publicationName, @publicationKey, @publicationDate, @displayTitle, @sourceTitle,
                @sourceGuid, @sourceUrl, @sourceFeedId, @torrentUrl, @infoHash, @coverUrl, 'queued')
      `,
    )
    .run(input);

  return { id: Number(result.lastInsertRowid), created: true };
}

function updateJournalStatus(id, status, extra = {}) {
  const fields = { status, ...extra };
  const columns = Object.keys(fields)
    .map((key) => `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)} = @${key}`)
    .join(", ");

  getDb()
    .prepare(`UPDATE journals SET ${columns}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    .run({ id, ...fields });
}

function getJournalById(id) {
  return getDb().prepare("SELECT * FROM journals WHERE id = ?").get(id) || null;
}

function getRecentJournals(limit = RECENT_JOURNALS_LIMIT) {
  return getDb()
    .prepare(
      `
        SELECT *
        FROM journals
        WHERE status = 'ready'
        ORDER BY publication_date DESC, id DESC
        LIMIT ?
      `,
    )
    .all(limit);
}

function getArchivedJournals(offset = RECENT_JOURNALS_LIMIT) {
  return getDb()
    .prepare(
      `
        SELECT *
        FROM journals
        WHERE status = 'ready'
        ORDER BY publication_date DESC, id DESC
        LIMIT -1 OFFSET ?
      `,
    )
    .all(offset);
}

function getStatusSnapshot() {
  const db = getDb();
  const readyCount = db.prepare("SELECT COUNT(*) AS count FROM journals WHERE status = 'ready'").get()
    .count;
  const downloadingCount = db
    .prepare("SELECT COUNT(*) AS count FROM journals WHERE status = 'downloading'")
    .get().count;

  return {
    readyCount,
    downloadingCount,
    feedCount: getAllFeeds().length,
    termCount: getAllSearchTerms().length,
    scanRunning: runtime.scanState.running,
    lastSuccessAt: runtime.scanState.lastSuccessAt,
    lastError: runtime.scanState.lastError,
  };
}

function toDateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(dateKey) {
  if (!dateKey) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function formatFrenchDate(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")} ${
    MONTH_NAMES[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
}

function getArchiveLabel(date) {
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function extractPublicationDateFromTitle(title) {
  const normalized = normalizeText(title);
  const match = normalized.match(DATE_PATTERN);

  if (!match) {
    return null;
  }

  const day = Number(match[2] || match[1]);
  const month = MONTH_TOKENS.get(match[3].toLowerCase());
  const year = Number(match[4]);

  if (month === undefined || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) {
    return "Taille inconnue";
  }

  const units = ["o", "Ko", "Mo", "Go", "To"];
  let current = size;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isJournalTooOld(publicationDate, maxJournalAgeDays) {
  if (!maxJournalAgeDays || !(publicationDate instanceof Date)) {
    return false;
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const ageLimitUtc = todayUtc - (maxJournalAgeDays - 1) * 24 * 60 * 60 * 1000;

  return publicationDate.getTime() < ageLimitUtc;
}

function buildJournalStoragePaths(publicationKey, dateKey) {
  const relativeDir = path.posix.join("journals", publicationKey, dateKey);
  const absoluteDir = path.join(STORAGE_ROOT, relativeDir);

  return {
    relativeDir,
    absoluteDir,
    pdfRelativePath: path.posix.join(relativeDir, "journal.pdf"),
    pdfAbsolutePath: path.join(absoluteDir, "journal.pdf"),
  };
}

function resolveManagedPath(relativePath) {
  const root = path.resolve(STORAGE_ROOT);
  const absolutePath = path.resolve(STORAGE_ROOT, relativePath);

  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Chemin hors du stockage gere.");
  }

  return absolutePath;
}

function toManagedFileUrl(relativePath, basePath = "") {
  if (!relativePath) {
    return null;
  }

  return withBasePath(basePath, `/files/${relativePath.split("/").map(encodeURIComponent).join("/")}`);
}

function getBasePath(request) {
  const forwardedPrefix = request && request.headers ? request.headers["x-forwarded-prefix"] : "";
  return normalizeBasePath(forwardedPrefix || DEFAULT_BASE_PATH);
}

function withBasePath(basePath, target = "/") {
  if (!target) {
    return basePath || "/";
  }

  if (/^https?:\/\//i.test(target)) {
    return target;
  }

  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedTarget = target.startsWith("/") ? target : `/${target}`;

  if (!normalizedBasePath) {
    return normalizedTarget;
  }

  if (normalizedTarget === "/") {
    return `${normalizedBasePath}/`;
  }

  if (normalizedTarget.startsWith(`${normalizedBasePath}/`) || normalizedTarget === normalizedBasePath) {
    return normalizedTarget;
  }

  return `${normalizedBasePath}${normalizedTarget}`;
}

function buildThumbnailRelativePath(pdfRelativePath) {
  if (!pdfRelativePath) {
    return null;
  }

  const parsed = path.posix.parse(pdfRelativePath);
  return path.posix.join(parsed.dir, `${parsed.name}.thumb.webp`);
}

function getJournalThumbnailRelativePath(journal) {
  if (!journal || !journal.pdf_relative_path) {
    return null;
  }

  const preferredPath = journal.thumbnail_relative_path || buildThumbnailRelativePath(journal.pdf_relative_path);

  if (!preferredPath) {
    return null;
  }

  try {
    return fs.existsSync(resolveManagedPath(preferredPath)) ? preferredPath : null;
  } catch {
    return null;
  }
}

function getAttrValue(raw, key) {
  if (!raw) {
    return null;
  }

  const entries = Array.isArray(raw) ? raw : [raw];
  const match = entries.find((entry) => entry && entry.name === key);
  return match && match.value ? String(match.value) : null;
}

function withQuery(urlString, query) {
  const target = new URL(urlString);
  if (target.searchParams.get("t") === "search") {
    target.searchParams.set("q", query);
  }
  return target.toString();
}

function fetchUrlText(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Trop de redirections RSS."));
      return;
    }

    const target = new URL(urlString);
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      target,
      {
        method: "GET",
        headers: {
          "user-agent": "Le-Kiosque-Lite/1.0",
          accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
        },
        timeout: 15000,
      },
      (response) => {
        const statusCode = response.statusCode || 0;

        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
          response.resume();
          const nextUrl = new URL(response.headers.location, target).toString();
          fetchUrlText(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Flux RSS inaccessible: ${statusCode}`));
          return;
        }

        let stream = response;
        const encoding = String(response.headers["content-encoding"] || "").toLowerCase();

        if (encoding.includes("gzip")) {
          stream = response.pipe(zlib.createGunzip());
        } else if (encoding.includes("deflate")) {
          stream = response.pipe(zlib.createInflate());
        } else if (encoding.includes("br")) {
          stream = response.pipe(zlib.createBrotliDecompress());
        }

        const chunks = [];
        let totalSize = 0;

        stream.on("data", (chunk) => {
          totalSize += chunk.length;

          if (totalSize > 8 * 1024 * 1024) {
            request.destroy(new Error("Flux RSS trop volumineux."));
            return;
          }

          chunks.push(chunk);
        });

        stream.on("end", () => {
          resolve(Buffer.concat(chunks).toString("utf8"));
        });

        stream.on("error", reject);
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Flux RSS trop lent ou indisponible."));
    });

    request.on("error", reject);
    request.end();
  });
}

async function fetchRssItems(feedUrl, query) {
  const targetUrl = query ? withQuery(feedUrl, query) : feedUrl;
  const xml = await fetchUrlText(targetUrl);
  const parsed = parser.parse(xml);
  const rawItems = parsed && parsed.rss && parsed.rss.channel ? parsed.rss.channel.item || [] : [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.filter(Boolean).map((item) => ({
    title: String(item.title || ""),
    guid: item.guid ? String(item.guid) : null,
    pubDate: item.pubDate ? String(item.pubDate) : null,
    comments: item.comments ? String(item.comments) : null,
    link: item.link ? String(item.link) : null,
    enclosureUrl: item.enclosure && item.enclosure.url ? String(item.enclosure.url) : null,
    size: item.size ? Number(item.size) : null,
    coverUrl: getAttrValue(item["torznab:attr"], "coverurl"),
    infoHash: getAttrValue(item["torznab:attr"], "infohash"),
  }));
}

function isQueryableSearchFeed(feedUrl) {
  try {
    return new URL(feedUrl).searchParams.get("t") === "search";
  } catch {
    return false;
  }
}

function parseJournalCandidate(item, searchTerms) {
  const normalizedTitle = normalizeText(item.title);

  if (!normalizedTitle.includes("pdf") && !normalizedTitle.includes("ebook")) {
    return null;
  }

  const publicationDate = extractPublicationDateFromTitle(item.title);
  if (!publicationDate) {
    return null;
  }

  const matchingTerm = searchTerms
    .filter((term) => normalizedTitle.includes(term.normalized_label))
    .sort((left, right) => right.normalized_label.length - left.normalized_label.length)[0];

  if (!matchingTerm) {
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

function getCommandProbe() {
  return process.platform === "win32"
    ? { command: "where", args: [] }
    : { command: "which", args: [] };
}

function commandExists(commandName) {
  const probe = getCommandProbe();

  return new Promise((resolve) => {
    const child = spawn(probe.command, [...probe.args, commandName], {
      stdio: "ignore",
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function runExternalCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `La commande externe ${command} a echoue (code ${code}).`,
        ),
      );
    });
  });
}

async function findLargestPdf(dirPath) {
  const stack = [dirPath];
  let bestMatch = null;

  while (stack.length) {
    const currentDir = stack.pop();
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
        continue;
      }

      const stat = await fsp.stat(fullPath);
      if (!bestMatch || stat.size > bestMatch.size) {
        bestMatch = {
          path: fullPath,
          size: stat.size,
          name: entry.name,
        };
      }
    }
  }

  return bestMatch;
}

async function downloadWithTransmissionCli(sourceUrl, outputPath) {
  const workDir = await fsp.mkdtemp(path.join(path.dirname(outputPath), "torrent-"));

  try {
    await runExternalCommand(
      "transmission-cli",
      ["-w", workDir, "-er", sourceUrl],
      workDir,
    );

    const pdf = await findLargestPdf(workDir);
    if (!pdf) {
      throw new Error("Aucun fichier PDF n'a ete trouve dans le torrent.");
    }

    await fsp.copyFile(pdf.path, outputPath);
    return {
      bytes: pdf.size,
      fileName: pdf.name,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadWithAria2(sourceUrl, outputPath) {
  const workDir = await fsp.mkdtemp(path.join(path.dirname(outputPath), "torrent-"));

  try {
    await runExternalCommand(
      "aria2c",
      [
        "--dir",
        workDir,
        "--seed-time=0",
        "--follow-torrent=true",
        "--bt-save-metadata=false",
        "--auto-file-renaming=false",
        sourceUrl,
      ],
      workDir,
    );

    const pdf = await findLargestPdf(workDir);
    if (!pdf) {
      throw new Error("Aucun fichier PDF n'a ete trouve dans le torrent.");
    }

    await fsp.copyFile(pdf.path, outputPath);
    return {
      bytes: pdf.size,
      fileName: pdf.name,
    };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadLargestPdfFromTorrent(sourceUrl, outputPath) {
  ensureDir(path.dirname(outputPath));

  if (await commandExists("transmission-cli")) {
    return downloadWithTransmissionCli(sourceUrl, outputPath);
  }

  if (await commandExists("aria2c")) {
    return downloadWithAria2(sourceUrl, outputPath);
  }

  throw new Error(
    "Aucun client torrent systeme disponible. Installe transmission-cli ou aria2c.",
  );
}

function broadcastEvent(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const response of [...runtime.eventClients]) {
    try {
      response.write(message);
    } catch {
      runtime.eventClients.delete(response);
    }
  }
}

async function processFeedItem(feedId, item) {
  const parsed = parseJournalCandidate(item, getEnabledSearchTerms());
  if (!parsed) {
    return;
  }

  const { maxJournalAgeDays } = getAppConfig();

  if (isJournalTooOld(parsed.publicationDate, maxJournalAgeDays)) {
    return;
  }

  const journal = createJournalIfMissing({
    publicationName: parsed.publicationName,
    publicationKey: parsed.publicationKey,
    publicationDate: parsed.publicationDateKey,
    displayTitle: parsed.displayTitle,
    sourceTitle: item.title,
    sourceGuid: item.guid,
    sourceUrl: item.comments || item.link,
    sourceFeedId: feedId,
    torrentUrl: item.enclosureUrl || item.link,
    infoHash: item.infoHash,
    coverUrl: item.coverUrl,
  });

  if (!journal.created) {
    return;
  }

  if (!item.enclosureUrl && !item.link) {
    updateJournalStatus(journal.id, "error", {
      errorMessage: "Le torrent ne fournit aucun lien exploitable.",
    });
    return;
  }

  updateJournalStatus(journal.id, "downloading", { errorMessage: null });

  try {
    const storagePaths = buildJournalStoragePaths(parsed.publicationKey, parsed.publicationDateKey);
    const download = await downloadLargestPdfFromTorrent(
      item.enclosureUrl || item.link,
      storagePaths.pdfAbsolutePath,
    );

    updateJournalStatus(journal.id, "ready", {
      pdfRelativePath: storagePaths.pdfRelativePath,
      thumbnailRelativePath: null,
      pageCount: null,
      fileSize: download.bytes,
      errorMessage: null,
    });

    broadcastEvent("journal-updated", {
      id: journal.id,
      title: parsed.displayTitle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Echec inconnu.";
    updateJournalStatus(journal.id, "error", { errorMessage: message });
    broadcastEvent("journal-error", { id: journal.id, message });
  }
}

async function scanFeed(feed, termLabel) {
  const items = await fetchRssItems(feed.url, termLabel);

  for (const item of items) {
    await processFeedItem(feed.id, item);
  }
}

async function runScanCycle() {
  const feeds = getEnabledFeeds();
  const terms = getEnabledSearchTerms();

  if (!feeds.length || !terms.length) {
    return;
  }

  runtime.scanState.running = true;
  runtime.scanState.lastError = null;
  broadcastEvent("scan-started", { time: Date.now() });

  try {
    for (const feed of feeds) {
      if (isQueryableSearchFeed(feed.url)) {
        for (const term of terms) {
          await scanFeed(feed, term.label);
        }
      } else {
        await scanFeed(feed);
      }
    }

    runtime.scanState.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    runtime.scanState.lastError =
      error instanceof Error ? error.message : "Echec inconnu pendant le scan.";
    throw error;
  } finally {
    runtime.scanState.running = false;
    broadcastEvent("scan-finished", {
      time: Date.now(),
      error: runtime.scanState.lastError,
    });
  }
}

async function triggerScanNow() {
  if (runtime.scanPromise) {
    return runtime.scanPromise;
  }

  runtime.scanPromise = runScanCycle().finally(() => {
    runtime.scanPromise = null;
  });

  return runtime.scanPromise;
}

function getDefaultFeedUrls() {
  return String(process.env.DEFAULT_RSS_FEEDS || "")
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function ensureBootstrap() {
  ensureDir(STORAGE_ROOT);
  ensureDir(path.join(process.cwd(), "data"));
  seedFeedsIfEmpty(getDefaultFeedUrls());

  if (runtime.scanInterval) {
    return;
  }

  triggerScanNow().catch(() => {});
  runtime.scanInterval = setInterval(() => {
    triggerScanNow().catch(() => {});
  }, getAppConfig().pollIntervalSeconds * 1000);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > 1024 * 1024) {
        reject(new Error("Corps de requete trop volumineux."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    request.on("error", reject);
  });
}

async function readForm(request) {
  const body = await readRequestBody(request);
  return Object.fromEntries(new URLSearchParams(body));
}

async function readJson(request) {
  const body = await readRequestBody(request);

  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}

function isAdminAuthenticated(request) {
  if (!isConfigured()) {
    return false;
  }

  const cookies = readCookies(request);
  const payload = verifySignedCookie(cookies[AUTH_COOKIE_NAME], getAppConfig().sessionSecret);
  return Boolean(payload && payload.role === "admin");
}

function adminCookieHeader(basePath = "") {
  const token = createSignedCookie(
    {
      role: "admin",
      exp: Date.now() + 14 * 24 * 60 * 60 * 1000,
    },
    getAppConfig().sessionSecret,
  );

  const cookiePath = withBasePath(basePath, "/");

  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(
    token,
  )}; HttpOnly; Path=${cookiePath}; SameSite=Lax; Max-Age=1209600`;
}

function clearAdminCookieHeader(basePath = "") {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; Path=${withBasePath(basePath, "/")}; SameSite=Lax; Max-Age=0`;
}

function sendHtml(response, statusCode, html, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(html);
}

function sendText(response, statusCode, text, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(text);
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, {
    location,
    ...headers,
  });
  response.end();
}

function getFlash(searchParams) {
  const type = searchParams.get("type");
  const text = searchParams.get("message");

  if (!type || !text) {
    return "";
  }

  return `<div class="flash flash-${escapeHtml(type)}">${escapeHtml(text)}</div>`;
}

function renderShell({ title, body, currentPath = "/", scripts = [], bodyClass = "", basePath = "" }) {
  const configured = isConfigured();
  const settingsHref = configured ? withBasePath(basePath, "/settings") : withBasePath(basePath, "/setup");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | ${APP_NAME}</title>
    <link rel="stylesheet" href="${escapeHtml(withBasePath(basePath, "/static/styles.css"))}" />
  </head>
  <body class="${escapeHtml(bodyClass)}" data-base-path="${escapeHtml(basePath)}">
    <div class="page-shell">
      <header class="topbar">
        <a class="brand" href="${escapeHtml(withBasePath(basePath, "/"))}">
          <span class="brand-mark">LK</span>
          <span>
            <strong>${APP_NAME}</strong>
            <small>Lecteur de journaux PDF</small>
          </span>
        </a>
        <nav class="nav">
          <a class="${currentPath === "/" ? "is-active" : ""}" href="${escapeHtml(withBasePath(basePath, "/"))}">Accueil</a>
          <a class="${currentPath === "/archives" ? "is-active" : ""}" href="${escapeHtml(withBasePath(basePath, "/archives"))}">Archives</a>
          <a class="${currentPath === "/settings" || currentPath === "/setup" ? "is-active" : ""}" href="${settingsHref}">Parametres</a>
        </nav>
      </header>
      <main class="page-content">${body}</main>
    </div>
    ${scripts.map((src) => `<script src="${escapeHtml(withBasePath(basePath, src))}"></script>`).join("\n")}
  </body>
</html>`;
}

function renderJournalCard(journal, options = {}) {
  const basePath = options.basePath || "";
  const pdfUrl = toManagedFileUrl(journal.pdf_relative_path, basePath);
  const thumbRelativePath = getJournalThumbnailRelativePath(journal);
  const thumbUrl = toManagedFileUrl(thumbRelativePath, basePath);
  const date = parseDateKey(journal.publication_date);
  const meta = [
    date ? formatFrenchDate(date) : journal.publication_date,
    journal.file_size ? formatBytes(journal.file_size) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const classes = ["journal-card"];

  if (options.featured) {
    classes.push("is-featured");
  }

  return `<a class="${classes.join(" ")}" href="${escapeHtml(withBasePath(basePath, `/journal/${journal.id}`))}" data-journal-id="${journal.id}" data-pdf-url="${escapeHtml(
    pdfUrl || "",
  )}" data-thumb-url="${escapeHtml(thumbUrl || "")}">
    <div class="journal-thumb">
      ${options.featured ? '<span class="journal-badge">Plus recent</span>' : ""}
      <canvas aria-hidden="true"></canvas>
      <div class="journal-thumb-fallback">PDF</div>
    </div>
    <div class="journal-copy">
      <strong>${escapeHtml(journal.display_title)}</strong>
      <span>${escapeHtml(meta)}</span>
    </div>
  </a>`;
}

function renderJournalGrid(journals, basePath = "") {
  if (!journals.length) {
    return `<div class="empty-state">
      <strong>Aucun journal pret.</strong>
      <p>Ajoute un terme de recherche et un flux RSS dans Parametres pour commencer l'ingestion.</p>
    </div>`;
  }

  return `<div class="journal-grid">${journals
    .map((journal, index) => renderJournalCard(journal, { featured: index === 0, basePath }))
    .join("")}</div>`;
}

function renderHomePage(searchParams, basePath) {
  const journals = getRecentJournals();

  return renderShell({
    title: "Accueil",
    currentPath: "/",
    bodyClass: "catalog-body",
    basePath,
    scripts: [PDFJS_URL, "/static/app.js"],
    body: `
      ${getFlash(searchParams)}
      <section class="section-head">
        <h2>Dernieres editions</h2>
        <a href="${escapeHtml(withBasePath(basePath, "/archives"))}">Voir les archives</a>
      </section>
      ${renderJournalGrid(journals, basePath)}
    `,
  });
}

function groupArchivedJournals(journals) {
  const groups = new Map();

  journals.forEach((journal) => {
    const date = parseDateKey(journal.publication_date);
    if (!date) {
      return;
    }

    const year = String(date.getUTCFullYear());
    const month = getArchiveLabel(date);

    if (!groups.has(year)) {
      groups.set(year, new Map());
    }

    const months = groups.get(year);
    if (!months.has(month)) {
      months.set(month, []);
    }

    months.get(month).push(journal);
  });

  return groups;
}

function renderArchivesPage(searchParams, basePath) {
  const groups = groupArchivedJournals(getArchivedJournals());
  const sections = [...groups.entries()]
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([year, months]) => {
      const monthBlocks = [...months.entries()].map(
        ([month, journals]) => `<section class="archive-month">
          <h3>${escapeHtml(month)}</h3>
          ${renderJournalGrid(journals, basePath)}
        </section>`,
      );

      return `<section class="archive-year">
        <h2>${escapeHtml(year)}</h2>
        ${monthBlocks.join("")}
      </section>`;
    })
    .join("");

  return renderShell({
    title: "Archives",
    currentPath: "/archives",
    bodyClass: "catalog-body",
    basePath,
    scripts: [PDFJS_URL, "/static/app.js"],
    body: `
      <section class="hero hero-compact">
        <div>
          <span class="eyebrow">Classement historique</span>
          <h1>Archives par annee et par mois</h1>
          <p>Les 30 plus recents restent sur l'accueil. Le reste est range ici.</p>
        </div>
      </section>
      ${getFlash(searchParams)}
      ${sections || '<div class="empty-state"><strong>Aucune archive.</strong></div>'}
    `,
  });
}

function renderSetupPage(searchParams, basePath) {
  if (isConfigured()) {
    return null;
  }

  return renderShell({
    title: "Configuration initiale",
    currentPath: "/setup",
    basePath,
    body: `
      <section class="panel narrow">
        <span class="eyebrow">Premier lancement</span>
        <h1>Choisir le mot de passe administrateur</h1>
        <p>Il sera chiffre localement avec <code>scrypt</code> et servira a proteger les Parametres.</p>
        ${getFlash(searchParams)}
        <form method="post" action="${escapeHtml(withBasePath(basePath, "/setup"))}" class="stack-form">
          <label>Mot de passe
            <input type="password" name="password" required minlength="8" autocomplete="new-password" />
          </label>
          <label>Confirmation
            <input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password" />
          </label>
          <button type="submit">Activer l'administration</button>
        </form>
      </section>
    `,
  });
}

function renderSettingsPage(request, searchParams, basePath) {
  if (!isConfigured()) {
    return null;
  }

  if (!isAdminAuthenticated(request)) {
    return renderShell({
      title: "Connexion admin",
      currentPath: "/settings",
      basePath,
      body: `
        <section class="panel narrow">
          <span class="eyebrow">Zone protegee</span>
          <h1>Connexion administrateur</h1>
          ${getFlash(searchParams)}
          <form method="post" action="${escapeHtml(withBasePath(basePath, "/login"))}" class="stack-form">
            <label>Mot de passe
              <input type="password" name="password" required autocomplete="current-password" />
            </label>
            <button type="submit">Se connecter</button>
          </form>
        </section>
      `,
    });
  }

  const snapshot = getStatusSnapshot();
  const terms = getAllSearchTerms();
  const feeds = getAllFeeds();
  const config = getAppConfig();

  return renderShell({
    title: "Parametres",
    currentPath: "/settings",
    basePath,
    body: `
      <section class="hero hero-compact">
        <div>
          <span class="eyebrow">Administration</span>
          <h1>Pilotage des flux et des termes de recherche</h1>
          <p>Les accents sont ignores pendant la recherche. "Montreal" et "Montr&eacute;al" seront traites pareil.</p>
        </div>
        <div class="hero-stats">
          <div><strong>${snapshot.readyCount}</strong><span>prets</span></div>
          <div><strong>${snapshot.downloadingCount}</strong><span>en cours</span></div>
          <div><strong>${snapshot.scanRunning ? "Oui" : "Non"}</strong><span>scan actif</span></div>
          <div><strong>${escapeHtml(snapshot.lastError || "Aucune")}</strong><span>derniere erreur</span></div>
        </div>
      </section>
      ${getFlash(searchParams)}
      <div class="settings-grid">
        <section class="panel">
          <h2>Termes de recherche</h2>
          <form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/search-terms"))}" class="inline-form">
            <input type="text" name="label" placeholder="Journal de Montreal" required />
            <button type="submit">Ajouter</button>
          </form>
          <div class="chip-list">
            ${terms
              .map(
                (term) => `<form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/search-terms/delete"))}" class="chip-form">
                  <input type="hidden" name="id" value="${term.id}" />
                  <span>${escapeHtml(term.label)}</span>
                  <button type="submit">Supprimer</button>
                </form>`,
              )
              .join("") || "<p class=\"muted\">Aucun terme.</p>"}
          </div>
        </section>
        <section class="panel">
          <h2>Flux RSS / Torznab</h2>
          <form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/feeds"))}" class="stack-form">
            <label>Nom
              <input type="text" name="name" placeholder="Prowlarr #1" required />
            </label>
            <label>URL
              <input type="url" name="url" placeholder="https://..." required />
            </label>
            <button type="submit">Ajouter le flux</button>
          </form>
          <div class="feed-list">
            ${feeds
              .map(
                (feed) => `<form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/feeds/delete"))}" class="feed-item">
                  <input type="hidden" name="id" value="${feed.id}" />
                  <div>
                    <strong>${escapeHtml(feed.name)}</strong>
                    <span>${escapeHtml(feed.url)}</span>
                  </div>
                  <button type="submit">Supprimer</button>
                </form>`,
              )
              .join("") || "<p class=\"muted\">Aucun flux.</p>"}
          </div>
        </section>
      </div>
      <section class="panel">
        <h2>Limite de fraicheur</h2>
        <p>Bloque l'ingestion des journaux plus vieux que X jours par rapport a aujourd'hui. Laisse vide pour ne fixer aucune limite.</p>
        <form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/retention"))}" class="inline-form">
          <input type="number" min="1" step="1" name="maxJournalAgeDays" value="${escapeHtml(
            config.maxJournalAgeDays ? String(config.maxJournalAgeDays) : "",
          )}" placeholder="30" />
          <button type="submit">Enregistrer</button>
        </form>
      </section>
      <section class="panel">
        <h2>Actions</h2>
        <div class="action-row">
          <form method="post" action="${escapeHtml(withBasePath(basePath, "/settings/scan"))}">
            <button type="submit">Lancer un scan immediat</button>
          </form>
          <form method="post" action="${escapeHtml(withBasePath(basePath, "/logout"))}">
            <button type="submit" class="button-secondary">Se deconnecter</button>
          </form>
        </div>
      </section>
    `,
  });
}

function renderReaderPage(journal, basePath) {
  const pdfUrl = toManagedFileUrl(journal.pdf_relative_path, basePath);

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(journal.display_title)} | ${APP_NAME}</title>
    <link rel="stylesheet" href="${escapeHtml(withBasePath(basePath, "/static/styles.css"))}" />
  </head>
  <body class="reader-body" data-base-path="${escapeHtml(basePath)}">
    <div class="reader-screen">
      <header class="reader-toolbar">
        <div class="reader-toolbar-main">
          <a class="reader-control-button back-link" href="${escapeHtml(withBasePath(basePath, "/"))}">Retour</a>
          <strong class="reader-title">${escapeHtml(journal.display_title)}</strong>
        </div>
        <div class="reader-toolbar-actions">
          <span class="reader-status" id="reader-status">Chargement...</span>
          <button type="button" class="reader-control-button" id="mode-cycle-button">2 pages</button>
          <div class="reader-zoom-strip" id="zoom-control">
            <span class="reader-zoom-label">Zoom</span>
            <input id="zoom-range" class="reader-zoom-range" type="range" min="35" max="250" step="5" value="100" />
            <span id="zoom-value" class="reader-zoom-value">100%</span>
          </div>
          <button type="button" class="reader-icon-button" id="fullscreen-toggle-button" aria-label="Plein ecran" title="Plein ecran">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10V4h6v2H6v4H4Zm10-6h6v6h-2V6h-4V4ZM6 16h4v2H4v-6h2v4Zm12-4h2v6h-6v-2h4v-4Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </header>
      <main id="reader-root" class="reader-stage" data-pdf-url="${escapeHtml(pdfUrl)}">
        <div class="reader-viewport" id="reader-viewport">
          <div class="reader-pan-stage" id="reader-pan-stage">
            <div class="reader-pages mode-spread"></div>
          </div>
        </div>
      </main>
    </div>
    <script src="${PDFJS_URL}"></script>
    <script src="${escapeHtml(withBasePath(basePath, "/static/reader.js?v=9"))}"></script>
  </body>
</html>`;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function serveFile(request, response, filePath) {
  try {
    const stat = await fsp.stat(filePath);

    if (!stat.isFile()) {
      sendText(response, 404, "Not Found");
      return;
    }

    const rangeHeader = request && request.headers ? request.headers.range : null;

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : stat.size - 1;

        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end >= start &&
          end < stat.size
        ) {
          response.writeHead(206, {
            "content-type": contentTypeFor(filePath),
            "content-length": end - start + 1,
            "cache-control": "public, max-age=3600",
            "accept-ranges": "bytes",
            "content-range": `bytes ${start}-${end}/${stat.size}`,
          });

          fs.createReadStream(filePath, { start, end }).pipe(response);
          return;
        }
      }
    }

    response.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "content-length": stat.size,
      "cache-control": "public, max-age=3600",
      "accept-ranges": "bytes",
    });

    fs.createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, "Not Found");
  }
}

function requireAdmin(request, response, basePath) {
  if (!isConfigured()) {
    redirect(response, withBasePath(basePath, "/setup"));
    return false;
  }

  if (!isAdminAuthenticated(request)) {
    redirect(response, withBasePath(basePath, "/settings?type=error&message=Connexion%20requise"));
    return false;
  }

  return true;
}

async function handleGet(request, response, url) {
  const basePath = getBasePath(request);

  if (url.pathname === "/") {
    sendHtml(response, 200, renderHomePage(url.searchParams, basePath));
    return;
  }

  if (url.pathname === "/archives") {
    sendHtml(response, 200, renderArchivesPage(url.searchParams, basePath));
    return;
  }

  if (url.pathname === "/setup") {
    const html = renderSetupPage(url.searchParams, basePath);
    if (!html) {
      redirect(response, withBasePath(basePath, "/settings"));
      return;
    }
    sendHtml(response, 200, html);
    return;
  }

  if (url.pathname === "/settings") {
    const html = renderSettingsPage(request, url.searchParams, basePath);
    if (!html) {
      redirect(response, withBasePath(basePath, "/setup"));
      return;
    }
    sendHtml(response, 200, html);
    return;
  }

  if (url.pathname === "/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(`event: connected\ndata: {"ok":true}\n\n`);
    runtime.eventClients.add(response);

    const heartbeat = setInterval(() => {
      try {
        response.write(`event: ping\ndata: {"time":${Date.now()}}\n\n`);
      } catch {
        clearInterval(heartbeat);
        runtime.eventClients.delete(response);
      }
    }, 25000);

    request.on("close", () => {
      clearInterval(heartbeat);
      runtime.eventClients.delete(response);
    });
    return;
  }

  if (url.pathname === "/health") {
    sendText(response, 200, "ok");
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    const relativePath = decodeURIComponent(url.pathname.slice("/static/".length));
    const filePath = path.resolve(PUBLIC_ROOT, relativePath);

    if (filePath !== PUBLIC_ROOT && !filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    await serveFile(request, response, filePath);
    return;
  }

  if (url.pathname.startsWith("/files/")) {
    const relativePath = decodeURIComponent(url.pathname.slice("/files/".length)).replace(/\\/g, "/");

    try {
      await serveFile(request, response, resolveManagedPath(relativePath));
    } catch {
      sendText(response, 404, "Not Found");
    }
    return;
  }

  const readerMatch = /^\/journal\/(\d+)$/.exec(url.pathname);
  if (readerMatch) {
    const journal = getJournalById(Number(readerMatch[1]));

    if (!journal || journal.status !== "ready" || !journal.pdf_relative_path) {
      sendText(response, 404, "Journal introuvable");
      return;
    }

    sendHtml(response, 200, renderReaderPage(journal, basePath));
    return;
  }

  sendText(response, 404, "Not Found");
}

async function handlePost(request, response, url) {
  const basePath = getBasePath(request);

  if (url.pathname === "/api/thumbnail") {
    const payload = await readJson(request);
    const journalId = Number(payload.journalId);
    const imageDataUrl = String(payload.imageDataUrl || "");

    if (!Number.isInteger(journalId) || journalId <= 0 || !imageDataUrl.startsWith("data:image/")) {
      sendJson(response, 400, { ok: false, error: "Requete miniature invalide." });
      return;
    }

    const match = imageDataUrl.match(/^data:(image\/(?:webp|png|jpeg));base64,(.+)$/);
    if (!match) {
      sendJson(response, 400, { ok: false, error: "Format miniature non supporte." });
      return;
    }

    const journal = getJournalById(journalId);
    if (!journal || !journal.pdf_relative_path) {
      sendJson(response, 404, { ok: false, error: "Journal introuvable." });
      return;
    }

    const thumbnailRelativePath = buildThumbnailRelativePath(journal.pdf_relative_path);
    const thumbnailAbsolutePath = resolveManagedPath(thumbnailRelativePath);

    ensureDir(path.dirname(thumbnailAbsolutePath));
    await fsp.writeFile(thumbnailAbsolutePath, Buffer.from(match[2], "base64"));

    updateJournalStatus(journal.id, journal.status, {
      thumbnailRelativePath,
    });

    sendJson(response, 200, {
      ok: true,
      thumbnailUrl: toManagedFileUrl(thumbnailRelativePath, basePath),
    });
    return;
  }

  if (url.pathname === "/setup") {
    if (isConfigured()) {
      redirect(response, withBasePath(basePath, "/settings"));
      return;
    }

    const form = await readForm(request);

    if (!form.password || String(form.password).length < 8) {
      redirect(response, withBasePath(basePath, "/setup?type=error&message=Mot%20de%20passe%20trop%20court"));
      return;
    }

    if (form.password !== form.confirmPassword) {
      redirect(
        response,
        withBasePath(basePath, "/setup?type=error&message=La%20confirmation%20ne%20correspond%20pas"),
      );
      return;
    }

    setAdminPassword(form.password);
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Configuration%20terminee"), {
      "Set-Cookie": adminCookieHeader(basePath),
    });
    return;
  }

  if (url.pathname === "/login") {
    if (!isConfigured()) {
      redirect(response, withBasePath(basePath, "/setup"));
      return;
    }

    const form = await readForm(request);
    const valid = verifyPassword(String(form.password || ""), getAppConfig().adminPasswordHash);

    if (!valid) {
      redirect(response, withBasePath(basePath, "/settings?type=error&message=Mot%20de%20passe%20invalide"));
      return;
    }

    redirect(response, withBasePath(basePath, "/settings?type=success&message=Connexion%20etablie"), {
      "Set-Cookie": adminCookieHeader(basePath),
    });
    return;
  }

  if (url.pathname === "/logout") {
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Session%20fermee"), {
      "Set-Cookie": clearAdminCookieHeader(basePath),
    });
    return;
  }

  if (!requireAdmin(request, response, basePath)) {
    return;
  }

  if (url.pathname === "/settings/search-terms") {
    const form = await readForm(request);
    addSearchTerm(form.label);
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Terme%20ajoute"));
    return;
  }

  if (url.pathname === "/settings/search-terms/delete") {
    const form = await readForm(request);
    removeSearchTerm(Number(form.id));
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Terme%20supprime"));
    return;
  }

  if (url.pathname === "/settings/feeds") {
    const form = await readForm(request);
    addFeed(form.name, form.url);
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Flux%20ajoute"));
    return;
  }

  if (url.pathname === "/settings/feeds/delete") {
    const form = await readForm(request);
    removeFeed(Number(form.id));
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Flux%20supprime"));
    return;
  }

  if (url.pathname === "/settings/scan") {
    triggerScanNow().catch(() => {});
    redirect(response, withBasePath(basePath, "/settings?type=success&message=Scan%20declenche"));
    return;
  }

  if (url.pathname === "/settings/retention") {
    const form = await readForm(request);
    setMaxJournalAgeDays(form.maxJournalAgeDays);
    redirect(
      response,
      withBasePath(basePath, "/settings?type=success&message=Limite%20de%20fraicheur%20mise%20a%20jour"),
    );
    return;
  }

  sendText(response, 404, "Not Found");
}

const server = http.createServer(async (request, response) => {
  try {
    ensureBootstrap();
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" || request.method === "HEAD") {
      await handleGet(request, response, url);
      return;
    }

    if (request.method === "POST") {
      await handlePost(request, response, url);
      return;
    }

    sendText(response, 405, "Method Not Allowed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur interne";
    sendText(response, 500, message);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`${APP_NAME} en ecoute sur http://0.0.0.0:${PORT}`);
});
