import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { DATABASE_PATH } from "@/lib/constants";

declare global {
  var __journalDb: Database.Database | undefined;
}

function initializeDatabase(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      admin_password_hash TEXT,
      session_secret TEXT NOT NULL,
      poll_interval_seconds INTEGER NOT NULL DEFAULT 180,
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

  const existing = db
    .prepare("SELECT id FROM app_config WHERE id = 1")
    .get({ id: 1 }) as { id: number } | undefined;

  if (!existing) {
    db.prepare(
      `
        INSERT INTO app_config (id, session_secret)
        VALUES (1, ?)
      `,
    ).run(crypto.randomBytes(32).toString("base64url"));
  }
}

export function getDb() {
  if (!global.__journalDb) {
    fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
    global.__journalDb = new Database(DATABASE_PATH);
    initializeDatabase(global.__journalDb);
  }

  return global.__journalDb;
}
