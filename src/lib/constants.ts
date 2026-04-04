import path from "node:path";

export const APP_NAME = "Le Kiosque";
export const RECENT_JOURNALS_LIMIT = 30;
export const AUTH_COOKIE_NAME = "journal_admin_session";
export const DEFAULT_POLL_INTERVAL_SECONDS = 180;
export const DATABASE_PATH =
  process.env.JOURNAL_DB_PATH ?? path.join(process.cwd(), "data", "journal.sqlite");
export const STORAGE_ROOT =
  process.env.JOURNAL_STORAGE_DIR ?? path.join(process.cwd(), "storage");
