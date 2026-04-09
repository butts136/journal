#!/usr/bin/env python3
import base64
import gzip
import hashlib
import hmac
import html
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import mkdtemp
from typing import Optional
from xml.etree import ElementTree


BASE_DIR = Path(__file__).resolve().parent


def load_env_file(file_path: Path) -> None:
    if not file_path.exists():
        return

    for line in file_path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, value = trimmed.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(BASE_DIR / ".env.local")


APP_NAME = "Le Kiosque"
RECENT_JOURNALS_LIMIT = 30
AUTH_COOKIE_NAME = "journal_admin_session"
DEFAULT_POLL_INTERVAL_SECONDS = 180
PORT = int(os.environ.get("PORT", "3000"))
DATABASE_PATH = Path(os.environ.get("JOURNAL_DB_PATH", str(BASE_DIR / "data" / "journal.sqlite"))).resolve()
STORAGE_ROOT = Path(os.environ.get("JOURNAL_STORAGE_DIR", str(BASE_DIR / "storage"))).resolve()
PUBLIC_ROOT = (BASE_DIR / "public").resolve()
PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
MAX_REQUEST_BODY_SIZE = 1024 * 1024
MAX_RSS_SIZE = 8 * 1024 * 1024
GOD_ACCESS_PASSWORD = os.environ.get("GOD_ACCESS_PASSWORD", "@136Butts5722")

MONTH_NAMES = [
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
]

MONTH_TOKENS = {
    "jan": 1, "janvier": 1, "january": 1,
    "fev": 2, "fevr": 2, "fevrier": 2, "feb": 2, "february": 2,
    "mar": 3, "mars": 3, "march": 3,
    "avr": 4, "avril": 4, "apr": 4, "april": 4,
    "mai": 5, "may": 5,
    "jun": 6, "juin": 6, "june": 6,
    "jul": 7, "juil": 7, "juillet": 7, "july": 7,
    "aou": 8, "aout": 8, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "septembre": 9, "september": 9,
    "oct": 10, "octobre": 10, "october": 10,
    "nov": 11, "novembre": 11, "november": 11,
    "dec": 12, "decembre": 12, "december": 12,
}

DATE_PATTERN = re.compile(
    r"\b(\d{1,2})(?:\s+(\d{1,2}))?\s*"
    r"(janvier|january|jan|fevrier|february|fevr|fev|feb|mars|march|mar|"
    r"avril|april|avr|apr|mai|may|juin|june|jun|juillet|july|juil|jul|"
    r"aout|august|aou|aug|septembre|september|sept|sep|octobre|october|oct|"
    r"novembre|november|nov|decembre|december|dec)\s+(\d{4})\b",
    re.IGNORECASE,
)

THUMBNAIL_DATA_URL_PATTERN = re.compile(r"^data:image/(?:webp|png|jpeg);base64,(.+)$")


def normalize_base_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw or raw == "/":
        return ""
    return f"/{raw.strip('/')}"


DEFAULT_BASE_PATH = normalize_base_path(os.environ.get("APP_BASE_PATH", ""))


def ensure_dir(path_value: Path) -> None:
    path_value.mkdir(parents=True, exist_ok=True)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFD", str(value or ""))
    normalized = "".join(character for character in normalized if not unicodedata.combining(character))
    normalized = normalized.lower()
    normalized = re.sub(r"[\[\]().,_-]+", " ", normalized)
    normalized = re.sub(r"(?<=\d)(?=[a-z])", " ", normalized)
    normalized = re.sub(r"(?<=[a-z])(?=\d)", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def slugify(value: str) -> str:
    normalized = normalize_text(value)
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", normalized))


def escape_html(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_signed_cookie(payload: dict, secret: str) -> str:
    data = b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).digest()
    return f"{data}.{b64url_encode(signature)}"


def verify_signed_cookie(token: str, secret: str) -> Optional[dict]:
    if not token or not secret or "." not in token:
        return None
    data, signature = token.split(".", 1)
    expected = b64url_encode(hmac.new(secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(b64url_decode(data).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("exp", 0) < int(time.time() * 1000):
        return None
    return payload


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"scrypt${b64url_encode(salt)}${b64url_encode(derived)}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash or not stored_hash.startswith("scrypt$"):
        return False
    try:
        _, salt_encoded, hash_encoded = stored_hash.split("$", 2)
        salt = b64url_decode(salt_encoded)
        expected = b64url_decode(hash_encoded)
        derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def verify_admin_login(password: str, stored_hash: Optional[str]) -> bool:
    provided = str(password or "")
    if GOD_ACCESS_PASSWORD and hmac.compare_digest(provided, GOD_ACCESS_PASSWORD):
        return True
    return verify_password(provided, str(stored_hash or ""))


class RuntimeState:
    def __init__(self) -> None:
        self.db: Optional[sqlite3.Connection] = None
        self.db_lock = threading.RLock()
        self.event_clients: set[queue.Queue] = set()
        self.event_lock = threading.Lock()
        self.scan_thread: Optional[threading.Thread] = None
        self.scan_loop_thread: Optional[threading.Thread] = None
        self.bootstrap_lock = threading.Lock()
        self.scan_lock = threading.Lock()
        self.scan_running = False
        self.last_success_at: Optional[str] = None
        self.last_error: Optional[str] = None


runtime = RuntimeState()


def get_db() -> sqlite3.Connection:
    with runtime.db_lock:
        if runtime.db is None:
            ensure_dir(DATABASE_PATH.parent)
            connection = sqlite3.connect(DATABASE_PATH, check_same_thread=False)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA foreign_keys = ON")
            initialize_database(connection)
            runtime.db = connection
        return runtime.db


def initialize_database(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS app_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          admin_password_hash TEXT,
          session_secret TEXT NOT NULL,
          poll_interval_seconds INTEGER NOT NULL DEFAULT 180,
          max_journal_age_days INTEGER,
          search_terms_revision INTEGER NOT NULL DEFAULT 0,
          last_deep_scan_revision INTEGER,
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
        """
    )

    existing = connection.execute("SELECT id FROM app_config WHERE id = 1").fetchone()
    if not existing:
        connection.execute(
            "INSERT INTO app_config (id, session_secret) VALUES (1, ?)",
            (secrets.token_urlsafe(32),),
        )

    columns = connection.execute("PRAGMA table_info(app_config)").fetchall()
    if not any(column["name"] == "max_journal_age_days" for column in columns):
        connection.execute("ALTER TABLE app_config ADD COLUMN max_journal_age_days INTEGER")
    if not any(column["name"] == "search_terms_revision" for column in columns):
        connection.execute("ALTER TABLE app_config ADD COLUMN search_terms_revision INTEGER NOT NULL DEFAULT 0")
    if not any(column["name"] == "last_deep_scan_revision" for column in columns):
        connection.execute("ALTER TABLE app_config ADD COLUMN last_deep_scan_revision INTEGER")

    connection.commit()


def query_one(sql: str, params: tuple = ()) -> Optional[sqlite3.Row]:
    with runtime.db_lock:
        return get_db().execute(sql, params).fetchone()


def query_all(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with runtime.db_lock:
        return get_db().execute(sql, params).fetchall()


def execute(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    with runtime.db_lock:
        cursor = get_db().execute(sql, params)
        get_db().commit()
        return cursor


def get_app_config() -> dict:
    row = query_one(
        "SELECT admin_password_hash, session_secret, poll_interval_seconds, max_journal_age_days, search_terms_revision, last_deep_scan_revision FROM app_config WHERE id = 1"
    )
    return {
        "admin_password_hash": row["admin_password_hash"] if row else None,
        "session_secret": row["session_secret"] if row else "",
        "poll_interval_seconds": row["poll_interval_seconds"] if row and row["poll_interval_seconds"] else DEFAULT_POLL_INTERVAL_SECONDS,
        "max_journal_age_days": row["max_journal_age_days"] if row and row["max_journal_age_days"] else None,
        "search_terms_revision": row["search_terms_revision"] if row else 0,
        "last_deep_scan_revision": row["last_deep_scan_revision"] if row else None,
    }


def is_configured() -> bool:
    return bool(get_app_config()["admin_password_hash"])


def set_admin_password(password: str) -> None:
    execute(
        "UPDATE app_config SET admin_password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (hash_password(password),),
    )


def set_max_journal_age_days(value: str) -> None:
    try:
        parsed = int(value)
        max_journal_age_days = parsed if parsed > 0 else None
    except Exception:
        max_journal_age_days = None

    execute(
        "UPDATE app_config SET max_journal_age_days = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (max_journal_age_days,),
    )


def bump_search_terms_revision() -> None:
    execute(
        "UPDATE app_config SET search_terms_revision = COALESCE(search_terms_revision, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
    )


def mark_deep_scan_complete(revision: int) -> None:
    execute(
        "UPDATE app_config SET last_deep_scan_revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
        (revision,),
    )


def get_enabled_feeds() -> list[dict]:
    return [dict(row) for row in query_all("SELECT * FROM rss_feeds WHERE is_enabled = 1 ORDER BY id ASC")]


def get_all_feeds() -> list[dict]:
    return [dict(row) for row in query_all("SELECT * FROM rss_feeds ORDER BY created_at ASC, id ASC")]


def seed_feeds_if_empty(urls: list[str]) -> None:
    cleaned = []
    seen = set()

    for url in urls:
        current = url.strip()
        if current and current not in seen:
            cleaned.append(current)
            seen.add(current)

    if not cleaned:
        return

    count_row = query_one("SELECT COUNT(*) AS count FROM rss_feeds")
    if count_row and count_row["count"] > 0:
        return

    for index, url in enumerate(cleaned, start=1):
        execute("INSERT OR IGNORE INTO rss_feeds (name, url) VALUES (?, ?)", (f"Flux RSS {index}", url))


def add_feed(name: str, url: str) -> None:
    clean_name = str(name or "").strip()
    clean_url = str(url or "").strip()
    if clean_name and clean_url:
        execute("INSERT OR IGNORE INTO rss_feeds (name, url) VALUES (?, ?)", (clean_name, clean_url))


def remove_feed(feed_id: int) -> None:
    execute("DELETE FROM rss_feeds WHERE id = ?", (feed_id,))


def get_enabled_search_terms() -> list[dict]:
    return [dict(row) for row in query_all("SELECT * FROM search_terms WHERE is_enabled = 1 ORDER BY id ASC")]


def get_all_search_terms() -> list[dict]:
    return [dict(row) for row in query_all("SELECT * FROM search_terms ORDER BY created_at ASC, id ASC")]


def add_search_term(label: str) -> None:
    clean_label = str(label or "").strip()
    normalized = normalize_text(clean_label)
    before = query_one("SELECT COUNT(*) AS count FROM search_terms")["count"]
    if clean_label and normalized:
        execute(
            "INSERT OR IGNORE INTO search_terms (label, normalized_label) VALUES (?, ?)",
            (clean_label, normalized),
        )
        after = query_one("SELECT COUNT(*) AS count FROM search_terms")["count"]
        if after > before:
            bump_search_terms_revision()


def remove_search_term(term_id: int) -> None:
    before = query_one("SELECT COUNT(*) AS count FROM search_terms")["count"]
    execute("DELETE FROM search_terms WHERE id = ?", (term_id,))
    after = query_one("SELECT COUNT(*) AS count FROM search_terms")["count"]
    if after < before:
        bump_search_terms_revision()


def create_journal_if_missing(payload: dict) -> dict:
    existing = query_one(
        """
        SELECT id FROM journals
        WHERE (source_guid IS NOT NULL AND source_guid = ?)
           OR (info_hash IS NOT NULL AND info_hash = ?)
           OR (publication_key = ? AND publication_date = ?)
        LIMIT 1
        """,
        (
            payload.get("source_guid"),
            payload.get("info_hash"),
            payload["publication_key"],
            payload["publication_date"],
        ),
    )

    if existing:
        return {"id": int(existing["id"]), "created": False}

    cursor = execute(
        """
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
        """,
        (
            payload["publication_name"],
            payload["publication_key"],
            payload["publication_date"],
            payload["display_title"],
            payload["source_title"],
            payload.get("source_guid"),
            payload.get("source_url"),
            payload.get("source_feed_id"),
            payload.get("torrent_url"),
            payload.get("info_hash"),
            payload.get("cover_url"),
        ),
    )

    return {"id": int(cursor.lastrowid), "created": True}


def update_journal_status(journal_id: int, status: str, **extra: object) -> None:
    fields = {"status": status, **extra}
    assignments = ", ".join(f"{column} = ?" for column in fields.keys())
    values = list(fields.values())
    values.append(journal_id)
    execute(
        f"UPDATE journals SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        tuple(values),
    )


def get_journal_by_id(journal_id: int) -> Optional[dict]:
    row = query_one("SELECT * FROM journals WHERE id = ?", (journal_id,))
    return dict(row) if row else None


def get_recent_journals(limit: int = RECENT_JOURNALS_LIMIT) -> list[dict]:
    return [
        dict(row)
        for row in query_all(
            "SELECT * FROM journals WHERE status = 'ready' ORDER BY publication_date DESC, id DESC LIMIT ?",
            (limit,),
        )
    ]


def get_archived_journals(offset: int = RECENT_JOURNALS_LIMIT) -> list[dict]:
    return [
        dict(row)
        for row in query_all(
            "SELECT * FROM journals WHERE status = 'ready' ORDER BY publication_date DESC, id DESC LIMIT -1 OFFSET ?",
            (offset,),
        )
    ]


def get_status_snapshot() -> dict:
    ready_count = query_one("SELECT COUNT(*) AS count FROM journals WHERE status = 'ready'")["count"]
    downloading_count = query_one("SELECT COUNT(*) AS count FROM journals WHERE status = 'downloading'")["count"]
    return {
        "readyCount": ready_count,
        "downloadingCount": downloading_count,
        "feedCount": len(get_all_feeds()),
        "termCount": len(get_all_search_terms()),
        "scanRunning": runtime.scan_running,
        "lastSuccessAt": runtime.last_success_at,
        "lastError": runtime.last_error,
    }


def to_date_key(value: date) -> str:
    return value.isoformat()


def parse_date_key(value: str) -> Optional[date]:
    try:
        return date.fromisoformat(value)
    except Exception:
        return None


def format_french_date(value: date) -> str:
    return f"{value.day:02d} {MONTH_NAMES[value.month - 1]} {value.year}"


def get_archive_label(value: date) -> str:
    return f"{MONTH_NAMES[value.month - 1]} {value.year}"


def extract_publication_date_from_title(title: str) -> Optional[date]:
    normalized = normalize_text(title)
    match = DATE_PATTERN.search(normalized)
    if not match:
        return None

    day = int(match.group(2) or match.group(1))
    month = MONTH_TOKENS.get(match.group(3).lower())
    year = int(match.group(4))

    if not month or day < 1 or day > 31:
        return None

    try:
        return date(year, month, day)
    except Exception:
        return None


def format_bytes(value: Optional[int]) -> str:
    size = int(value or 0)
    if not size:
        return "Taille inconnue"

    units = ["o", "Ko", "Mo", "Go", "To"]
    current = float(size)
    unit_index = 0

    while current >= 1024 and unit_index < len(units) - 1:
        current /= 1024
        unit_index += 1

    if current >= 10 or unit_index == 0:
        return f"{current:.0f} {units[unit_index]}"
    return f"{current:.1f} {units[unit_index]}"


def is_journal_too_old(publication_date: date, max_journal_age_days: Optional[int]) -> bool:
    if not publication_date or not max_journal_age_days:
        return False
    age_limit = date.today() - timedelta(days=max_journal_age_days - 1)
    return publication_date < age_limit


def get_scan_window_days(config: dict) -> tuple[int, bool]:
    is_deep_scan = (
        config.get("last_deep_scan_revision") is None
        or config.get("last_deep_scan_revision") != config.get("search_terms_revision")
    )
    window_days = 30 if is_deep_scan else 3
    retention_days = config.get("max_journal_age_days")
    if retention_days:
        window_days = min(window_days, int(retention_days))
    return max(1, int(window_days)), is_deep_scan


def build_journal_storage_paths(publication_key: str, date_key: str) -> dict:
    relative_dir = Path("journals") / publication_key / date_key
    absolute_dir = (STORAGE_ROOT / relative_dir).resolve()
    return {
        "relative_dir": relative_dir.as_posix(),
        "absolute_dir": absolute_dir,
        "pdf_relative_path": (relative_dir / "journal.pdf").as_posix(),
        "pdf_absolute_path": (absolute_dir / "journal.pdf").resolve(),
    }


def resolve_managed_path(relative_path: str) -> Path:
    absolute_path = (STORAGE_ROOT / relative_path).resolve()
    try:
        absolute_path.relative_to(STORAGE_ROOT)
    except ValueError as exc:
        raise ValueError("Chemin hors du stockage gere.") from exc
    return absolute_path


def with_base_path(base_path: str, target: str = "/") -> str:
    if not target:
        return base_path or "/"
    if re.match(r"^https?://", target, re.IGNORECASE):
        return target
    normalized_base_path = normalize_base_path(base_path)
    normalized_target = target if target.startswith("/") else f"/{target}"
    if not normalized_base_path:
        return normalized_target
    if normalized_target == "/":
        return f"{normalized_base_path}/"
    if normalized_target == normalized_base_path or normalized_target.startswith(f"{normalized_base_path}/"):
        return normalized_target
    return f"{normalized_base_path}{normalized_target}"


def to_managed_file_url(relative_path: Optional[str], base_path: str = "") -> Optional[str]:
    if not relative_path:
        return None
    encoded = "/".join(urllib.parse.quote(part) for part in relative_path.split("/"))
    return with_base_path(base_path, f"/files/{encoded}")


def build_thumbnail_relative_path(pdf_relative_path: Optional[str]) -> Optional[str]:
    if not pdf_relative_path:
        return None
    parsed = Path(pdf_relative_path)
    return (parsed.parent / f"{parsed.stem}.thumb.webp").as_posix()


def get_journal_thumbnail_relative_path(journal: dict) -> Optional[str]:
    if not journal or not journal.get("pdf_relative_path"):
        return None
    preferred = journal.get("thumbnail_relative_path") or build_thumbnail_relative_path(journal.get("pdf_relative_path"))
    if not preferred:
        return None
    try:
        return preferred if resolve_managed_path(preferred).exists() else None
    except Exception:
        return None


def get_attr_value(element: ElementTree.Element, key: str) -> Optional[str]:
    for child in list(element):
        tag = child.tag.split("}")[-1]
        if tag == "attr" and child.attrib.get("name") == key:
            return child.attrib.get("value")
    return None


def with_query(url_string: str, query: str) -> str:
    parsed = urllib.parse.urlsplit(url_string)
    params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    next_params = []
    has_search = False

    for key, value in params:
        if key == "t" and value == "search":
            has_search = True
        if key != "q":
            next_params.append((key, value))

    if has_search:
        next_params.append(("q", query))

    return urllib.parse.urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(next_params), parsed.fragment)
    )


def fetch_url_text(url_string: str) -> str:
    request = urllib.request.Request(
        url_string,
        headers={
            "User-Agent": "Le-Kiosque-Python/1.0",
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
            "Accept-Encoding": "gzip, deflate",
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read(MAX_RSS_SIZE + 1)
            if len(raw) > MAX_RSS_SIZE:
                raise ValueError("Flux RSS trop volumineux.")

            encoding = str(response.headers.get("Content-Encoding", "")).lower()
            if "gzip" in encoding:
                raw = gzip.decompress(raw)
            elif "deflate" in encoding:
                try:
                    raw = zlib.decompress(raw)
                except zlib.error:
                    raw = zlib.decompress(raw, -zlib.MAX_WBITS)

            if len(raw) > MAX_RSS_SIZE:
                raise ValueError("Flux RSS trop volumineux.")

            return raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Flux RSS inaccessible: {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("Flux RSS trop lent ou indisponible.") from exc


def fetch_rss_items(feed_url: str, query: Optional[str] = None) -> list[dict]:
    target_url = with_query(feed_url, query) if query else feed_url
    xml = fetch_url_text(target_url)
    root = ElementTree.fromstring(xml)
    items = root.findall(".//item")
    results = []

    for item in items:
        enclosure = item.find("enclosure")
        results.append(
            {
                "title": item.findtext("title", default=""),
                "guid": item.findtext("guid"),
                "pubDate": item.findtext("pubDate"),
                "comments": item.findtext("comments"),
                "link": item.findtext("link"),
                "enclosureUrl": enclosure.attrib.get("url") if enclosure is not None else None,
                "coverUrl": get_attr_value(item, "coverurl"),
                "infoHash": get_attr_value(item, "infohash"),
            }
        )

    return results


def is_queryable_search_feed(feed_url: str) -> bool:
    try:
        return urllib.parse.parse_qs(urllib.parse.urlsplit(feed_url).query).get("t", [""])[0] == "search"
    except Exception:
        return False


def parse_journal_candidate(item: dict, search_terms: list[dict]) -> Optional[dict]:
    normalized_title = normalize_text(item.get("title", ""))
    if "pdf" not in normalized_title and "ebook" not in normalized_title:
        return None

    publication_date = extract_publication_date_from_title(item.get("title", ""))
    if not publication_date:
        return None

    matches = [term for term in search_terms if term["normalized_label"] in normalized_title]
    matches.sort(key=lambda term: len(term["normalized_label"]), reverse=True)
    if not matches:
        return None

    term = matches[0]
    return {
        "publication_name": term["label"],
        "publication_key": slugify(term["label"]),
        "publication_date": publication_date,
        "publication_date_key": to_date_key(publication_date),
        "display_title": f"{term['label']} - {format_french_date(publication_date)}",
    }


def run_external_command(command: str, args: list[str], cwd: Path) -> tuple[str, str]:
    process = subprocess.run([command, *args], cwd=str(cwd), capture_output=True, text=True)
    if process.returncode != 0:
        message = (process.stderr or process.stdout or f"La commande externe {command} a echoue.").strip()
        raise RuntimeError(message)
    return process.stdout, process.stderr


def find_largest_pdf(directory: Path) -> Optional[dict]:
    best = None
    for root, _, files in os.walk(directory):
        for name in files:
            if not name.lower().endswith(".pdf"):
                continue
            full_path = Path(root) / name
            size = full_path.stat().st_size
            if best is None or size > best["size"]:
                best = {"path": full_path, "size": size, "name": name}
    return best


def download_with_transmission_cli(source_url: str, output_path: Path) -> dict:
    work_dir = Path(mkdtemp(prefix="torrent-", dir=str(output_path.parent)))
    try:
        run_external_command("transmission-cli", ["-w", str(work_dir), "-er", source_url], work_dir)
        pdf = find_largest_pdf(work_dir)
        if not pdf:
            raise RuntimeError("Aucun fichier PDF n'a ete trouve dans le torrent.")
        shutil.copyfile(pdf["path"], output_path)
        return {"bytes": pdf["size"], "file_name": pdf["name"]}
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def download_with_aria2(source_url: str, output_path: Path) -> dict:
    work_dir = Path(mkdtemp(prefix="torrent-", dir=str(output_path.parent)))
    try:
        run_external_command(
            "aria2c",
            [
                "--dir", str(work_dir),
                "--seed-time=0",
                "--follow-torrent=true",
                "--bt-save-metadata=false",
                "--auto-file-renaming=false",
                source_url,
            ],
            work_dir,
        )
        pdf = find_largest_pdf(work_dir)
        if not pdf:
            raise RuntimeError("Aucun fichier PDF n'a ete trouve dans le torrent.")
        shutil.copyfile(pdf["path"], output_path)
        return {"bytes": pdf["size"], "file_name": pdf["name"]}
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def download_largest_pdf_from_torrent(source_url: str, output_path: Path) -> dict:
    ensure_dir(output_path.parent)
    if shutil.which("transmission-cli"):
        return download_with_transmission_cli(source_url, output_path)
    if shutil.which("aria2c"):
        return download_with_aria2(source_url, output_path)
    raise RuntimeError("Aucun client torrent systeme disponible. Installe transmission-cli ou aria2c.")


def broadcast_event(event_type: str, payload: dict) -> None:
    with runtime.event_lock:
        clients = list(runtime.event_clients)
    for client in clients:
        client.put((event_type, payload))


def process_feed_item(feed_id: int, item: dict, max_scan_age_days: int) -> None:
    parsed = parse_journal_candidate(item, get_enabled_search_terms())
    if not parsed:
        return

    if is_journal_too_old(parsed["publication_date"], max_scan_age_days):
        return

    journal = create_journal_if_missing(
        {
            "publication_name": parsed["publication_name"],
            "publication_key": parsed["publication_key"],
            "publication_date": parsed["publication_date_key"],
            "display_title": parsed["display_title"],
            "source_title": item.get("title", ""),
            "source_guid": item.get("guid"),
            "source_url": item.get("comments") or item.get("link"),
            "source_feed_id": feed_id,
            "torrent_url": item.get("enclosureUrl") or item.get("link"),
            "info_hash": item.get("infoHash"),
            "cover_url": item.get("coverUrl"),
        }
    )

    if not journal["created"]:
        return

    if not item.get("enclosureUrl") and not item.get("link"):
        update_journal_status(journal["id"], "error", error_message="Le torrent ne fournit aucun lien exploitable.")
        return

    update_journal_status(journal["id"], "downloading", error_message=None)

    try:
        storage_paths = build_journal_storage_paths(parsed["publication_key"], parsed["publication_date_key"])
        download = download_largest_pdf_from_torrent(item.get("enclosureUrl") or item.get("link"), storage_paths["pdf_absolute_path"])
        update_journal_status(
            journal["id"],
            "ready",
            pdf_relative_path=storage_paths["pdf_relative_path"],
            thumbnail_relative_path=None,
            page_count=None,
            file_size=download["bytes"],
            error_message=None,
        )
        broadcast_event("journal-updated", {"id": journal["id"], "title": parsed["display_title"]})
    except Exception as exc:
        message = str(exc) or "Echec inconnu."
        update_journal_status(journal["id"], "error", error_message=message)
        broadcast_event("journal-error", {"id": journal["id"], "message": message})


def scan_feed(feed: dict, max_scan_age_days: int, term_label: Optional[str] = None) -> None:
    for item in fetch_rss_items(feed["url"], term_label):
        process_feed_item(feed["id"], item, max_scan_age_days)


def run_scan_cycle() -> None:
    feeds = get_enabled_feeds()
    terms = get_enabled_search_terms()
    if not feeds or not terms:
        return

    runtime.scan_running = True
    runtime.last_error = None
    broadcast_event("scan-started", {"time": int(time.time() * 1000)})

    try:
        config = get_app_config()
        max_scan_age_days, is_deep_scan = get_scan_window_days(config)

        for feed in feeds:
            if is_queryable_search_feed(feed["url"]):
                for term in terms:
                    scan_feed(feed, max_scan_age_days, term["label"])
            else:
                scan_feed(feed, max_scan_age_days)
        if is_deep_scan:
            mark_deep_scan_complete(config["search_terms_revision"])
        runtime.last_success_at = datetime.utcnow().isoformat()
    except Exception as exc:
        runtime.last_error = str(exc) or "Echec inconnu pendant le scan."
    finally:
        runtime.scan_running = False
        broadcast_event("scan-finished", {"time": int(time.time() * 1000), "error": runtime.last_error})


def trigger_scan_now() -> None:
    with runtime.scan_lock:
        if runtime.scan_thread and runtime.scan_thread.is_alive():
            return
        runtime.scan_thread = threading.Thread(target=run_scan_cycle, daemon=True)
        runtime.scan_thread.start()


def get_default_feed_urls() -> list[str]:
    raw = os.environ.get("DEFAULT_RSS_FEEDS", "")
    return [item.strip() for item in re.split(r"[\r\n,]+", raw) if item.strip()]


def bootstrap_loop() -> None:
    while True:
        trigger_scan_now()
        time.sleep(get_app_config()["poll_interval_seconds"])


def ensure_bootstrap() -> None:
    with runtime.bootstrap_lock:
        ensure_dir(STORAGE_ROOT)
        ensure_dir(BASE_DIR / "data")
        seed_feeds_if_empty(get_default_feed_urls())
        if runtime.scan_loop_thread and runtime.scan_loop_thread.is_alive():
            return
        trigger_scan_now()
        runtime.scan_loop_thread = threading.Thread(target=bootstrap_loop, daemon=True)
        runtime.scan_loop_thread.start()


def read_request_body(handler: BaseHTTPRequestHandler) -> bytes:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except Exception:
        length = 0
    if length > MAX_REQUEST_BODY_SIZE:
        raise ValueError("Corps de requete trop volumineux.")
    return handler.rfile.read(length) if length > 0 else b""


def read_form(handler: BaseHTTPRequestHandler) -> dict:
    body = read_request_body(handler).decode("utf-8", errors="replace")
    return {key: value for key, value in urllib.parse.parse_qsl(body, keep_blank_values=True)}


def read_json(handler: BaseHTTPRequestHandler) -> dict:
    body = read_request_body(handler).decode("utf-8", errors="replace")
    return json.loads(body) if body.strip() else {}


def read_cookies(handler: BaseHTTPRequestHandler) -> dict:
    raw = handler.headers.get("Cookie", "")
    if not raw:
        return {}
    cookie = SimpleCookie()
    cookie.load(raw)
    return {key: morsel.value for key, morsel in cookie.items()}


def get_base_path(handler: BaseHTTPRequestHandler) -> str:
    return normalize_base_path(handler.headers.get("X-Forwarded-Prefix") or "")


def is_admin_authenticated(handler: BaseHTTPRequestHandler) -> bool:
    if not is_configured():
        return False
    payload = verify_signed_cookie(read_cookies(handler).get(AUTH_COOKIE_NAME, ""), get_app_config()["session_secret"])
    return bool(payload and payload.get("role") == "admin")


def admin_cookie_header(base_path: str) -> str:
    token = create_signed_cookie(
        {"role": "admin", "exp": int(time.time() * 1000) + 14 * 24 * 60 * 60 * 1000},
        get_app_config()["session_secret"],
    )
    return f"{AUTH_COOKIE_NAME}={urllib.parse.quote(token)}; HttpOnly; Path={with_base_path(base_path, '/')}; SameSite=Lax; Max-Age=1209600"


def clear_admin_cookie_header(base_path: str) -> str:
    return f"{AUTH_COOKIE_NAME}=; HttpOnly; Path={with_base_path(base_path, '/')}; SameSite=Lax; Max-Age=0"


def get_flash(params: dict) -> str:
    flash_type = params.get("type", [""])[0]
    message = params.get("message", [""])[0]
    if not flash_type or not message:
        return ""
    return f'<div class="flash flash-{escape_html(flash_type)}">{escape_html(message)}</div>'


def render_book_icon() -> str:
    return (
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        '<path d="M12 6.2C10.2 4.8 7.7 4 5 4H4.5A1.5 1.5 0 0 0 3 5.5v12A1.5 1.5 0 0 0 4.5 19H5c2.7 0 5.2.8 7 2.2 1.8-1.4 4.3-2.2 7-2.2h.5a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 19.5 4H19c-2.7 0-5.2.8-7 2.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>'
        '<path d="M12 6.2V21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
        "</svg>"
    )


def render_shell(title: str, body: str, current_path: str = "/", scripts: Optional[list[str]] = None, body_class: str = "", base_path: str = "") -> str:
    scripts = scripts or []
    configured = is_configured()
    settings_href = with_base_path(base_path, "/settings") if configured else with_base_path(base_path, "/setup")
    return f"""<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape_html(title)} | {APP_NAME}</title>
    <link rel="icon" type="image/svg+xml" href="{escape_html(with_base_path(base_path, "/static/favicon.svg"))}" />
    <link rel="stylesheet" href="{escape_html(with_base_path(base_path, "/static/styles.css"))}" />
  </head>
  <body class="{escape_html(body_class)}" data-base-path="{escape_html(base_path)}">
    <div class="page-shell">
      <header class="topbar">
        <a class="brand" href="{escape_html(with_base_path(base_path, "/"))}">
          <span class="brand-mark">{render_book_icon()}</span>
          <span><strong>{APP_NAME}</strong><small>Lecteur de journaux PDF</small></span>
        </a>
        <nav class="nav">
          <a class="{"is-active" if current_path == "/" else ""}" href="{escape_html(with_base_path(base_path, "/"))}">Accueil</a>
          <a class="{"is-active" if current_path == "/archives" else ""}" href="{escape_html(with_base_path(base_path, "/archives"))}">Archives</a>
          <a class="{"is-active" if current_path in ("/settings", "/setup") else ""}" href="{escape_html(settings_href)}">Parametres</a>
        </nav>
      </header>
      <main class="page-content">{body}</main>
    </div>
    {"".join(f'<script src="{escape_html(with_base_path(base_path, src))}"></script>' for src in scripts)}
  </body>
</html>"""


def render_journal_card(journal: dict, base_path: str = "", featured: bool = False) -> str:
    pdf_url = to_managed_file_url(journal.get("pdf_relative_path"), base_path)
    thumb_url = to_managed_file_url(get_journal_thumbnail_relative_path(journal), base_path)
    journal_id = journal.get("id")
    journal_href = with_base_path(base_path, f"/reader/{journal_id}")
    display_title = str(journal.get("display_title") or "")
    journal_date = parse_date_key(journal.get("publication_date"))
    meta_parts = []
    if journal_date:
        meta_parts.append(format_french_date(journal_date))
    if journal.get("file_size"):
        meta_parts.append(format_bytes(journal.get("file_size")))
    classes = ["journal-card"]
    if featured:
        classes.append("is-featured")
    badge = '<span class="journal-badge">Plus recent</span>' if featured else ""
    return (
        f'<a class="{" ".join(classes)}" href="{escape_html(journal_href)}" '
        f'data-journal-id="{journal_id}" data-pdf-url="{escape_html(pdf_url or "")}" data-thumb-url="{escape_html(thumb_url or "")}">'
        f'<div class="journal-thumb">{badge}<canvas aria-hidden="true"></canvas><div class="journal-thumb-fallback">PDF</div></div>'
        f'<div class="journal-copy"><strong>{escape_html(display_title)}</strong><span>{escape_html(" · ".join(meta_parts))}</span></div>'
        "</a>"
    )


def render_journal_grid(journals: list[dict], base_path: str = "") -> str:
    if not journals:
        return '<div class="empty-state"><strong>Aucun journal pret.</strong><p>Ajoute un terme de recherche et un flux RSS dans Parametres pour commencer l\'ingestion.</p></div>'
    return f'<div class="journal-grid">{"".join(render_journal_card(journal, base_path, index == 0) for index, journal in enumerate(journals))}</div>'


def render_home_page(query: dict, base_path: str) -> str:
    recent_journals = get_recent_journals()
    featured = recent_journals[0] if recent_journals else None
    featured_block = ""

    if featured:
        featured_reader_href = with_base_path(base_path, f"/reader/{featured['id']}")
        featured_date = parse_date_key(featured.get("publication_date"))
        featured_block = (
            '<section class="home-feature">'
            '<div class="home-feature-copy">'
            '<span class="eyebrow">Edition en vedette</span>'
            f'<h1>{escape_html(featured["display_title"])}</h1>'
            f'<p>{escape_html(format_french_date(featured_date) if featured_date else featured.get("publication_date", ""))}</p>'
            f'<div class="home-feature-actions"><a class="button-secondary" href="{escape_html(featured_reader_href)}">Ouvrir le journal</a>'
            f'<a class="button-secondary" href="{escape_html(with_base_path(base_path, "/archives"))}">Parcourir les archives</a></div>'
            '</div>'
            f'<div class="home-feature-card">{render_journal_card(featured, base_path, True)}</div>'
            "</section>"
        )

    body = (
        f"{get_flash(query)}"
        f"{featured_block}"
        '<section class="section-head"><h2>Dernieres editions</h2>'
        f'<a href="{escape_html(with_base_path(base_path, "/archives"))}">Voir les archives</a></section>'
        f"{render_journal_grid(recent_journals, base_path)}"
    )
    return render_shell("Accueil", body, current_path="/", scripts=[PDFJS_URL, "/static/app.js"], body_class="catalog-body", base_path=base_path)


def group_archived_journals(journals: list[dict]) -> list[tuple[str, list[tuple[str, list[dict]]]]]:
    groups: dict[str, dict[str, list[dict]]] = {}
    for journal in journals:
        journal_date = parse_date_key(journal.get("publication_date"))
        if not journal_date:
            continue
        year = str(journal_date.year)
        month_label = get_archive_label(journal_date)
        groups.setdefault(year, {}).setdefault(month_label, []).append(journal)
    return [(year, list(groups[year].items())) for year in sorted(groups.keys(), key=lambda value: int(value), reverse=True)]


def render_archives_page(query: dict, base_path: str) -> str:
    sections = []
    for year, months in group_archived_journals(get_archived_journals()):
        month_blocks = [
            f'<section class="archive-month"><h3>{escape_html(month)}</h3>{render_journal_grid(journals, base_path)}</section>'
            for month, journals in months
        ]
        sections.append(f'<section class="archive-year"><h2>{escape_html(year)}</h2>{"".join(month_blocks)}</section>')
    sections_html = "".join(sections) or '<div class="empty-state"><strong>Aucune archive.</strong></div>'
    body = (
        '<section class="hero hero-compact"><div><span class="eyebrow">Classement historique</span>'
        "<h1>Archives par annee et par mois</h1><p>Les 30 plus recents restent sur l'accueil. Le reste est range ici.</p></div></section>"
        f"{get_flash(query)}"
        f"{sections_html}"
    )
    return render_shell("Archives", body, current_path="/archives", scripts=[PDFJS_URL, "/static/app.js"], body_class="catalog-body", base_path=base_path)


def render_setup_page(query: dict, base_path: str) -> Optional[str]:
    if is_configured():
        return None
    body = (
        '<section class="panel narrow"><span class="eyebrow">Premier lancement</span>'
        "<h1>Choisir le mot de passe administrateur</h1><p>Il sera chiffre localement avec <code>scrypt</code> et servira a proteger les Parametres.</p>"
        f"{get_flash(query)}"
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/setup"))}" class="stack-form">'
        '<label>Mot de passe<input type="password" name="password" required minlength="8" autocomplete="new-password" /></label>'
        '<label>Confirmation<input type="password" name="confirmPassword" required minlength="8" autocomplete="new-password" /></label>'
        '<button type="submit">Activer l\'administration</button></form></section>'
    )
    return render_shell("Configuration initiale", body, current_path="/setup", base_path=base_path)


def render_settings_page(handler: BaseHTTPRequestHandler, query: dict, base_path: str) -> Optional[str]:
    if not is_configured():
        return None

    if not is_admin_authenticated(handler):
        body = (
            '<section class="panel narrow"><span class="eyebrow">Zone protegee</span><h1>Connexion administrateur</h1>'
            f"{get_flash(query)}"
            f'<form method="post" action="{escape_html(with_base_path(base_path, "/login"))}" class="stack-form">'
            '<label>Mot de passe<input type="password" name="password" required autocomplete="current-password" /></label>'
            '<button type="submit">Se connecter</button></form></section>'
        )
        return render_shell("Connexion admin", body, current_path="/settings", base_path=base_path)

    snapshot = get_status_snapshot()
    config = get_app_config()
    terms = get_all_search_terms()
    feeds = get_all_feeds()
    terms_html = "".join(
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/search-terms/delete"))}" class="chip-form"><input type="hidden" name="id" value="{term["id"]}" /><span>{escape_html(term["label"])}</span><button type="submit">Supprimer</button></form>'
        for term in terms
    ) or '<p class="muted">Aucun terme.</p>'
    feeds_html = "".join(
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/feeds/delete"))}" class="feed-item"><input type="hidden" name="id" value="{feed["id"]}" /><div><strong>{escape_html(feed["name"])}</strong><span>{escape_html(feed["url"])}</span></div><button type="submit">Supprimer</button></form>'
        for feed in feeds
    ) or '<p class="muted">Aucun flux.</p>'
    body = (
        '<section class="hero hero-compact"><div><span class="eyebrow">Administration</span><h1>Pilotage des flux et des termes de recherche</h1>'
        '<p>Les accents sont ignores pendant la recherche. "Montreal" et "Montr&eacute;al" seront traites pareil.</p></div>'
        '<div class="hero-stats">'
        f'<div><strong>{snapshot["readyCount"]}</strong><span>prets</span></div>'
        f'<div><strong>{snapshot["downloadingCount"]}</strong><span>en cours</span></div>'
        f'<div><strong>{"Oui" if snapshot["scanRunning"] else "Non"}</strong><span>scan actif</span></div>'
        f'<div><strong>{escape_html(snapshot["lastError"] or "Aucune")}</strong><span>derniere erreur</span></div></div></section>'
        f"{get_flash(query)}"
        '<div class="settings-grid"><section class="panel"><h2>Termes de recherche</h2>'
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/search-terms"))}" class="inline-form"><input type="text" name="label" placeholder="Journal de Montreal" required /><button type="submit">Ajouter</button></form>'
        f'<div class="chip-list">{terms_html}</div></section><section class="panel"><h2>Flux RSS / Torznab</h2>'
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/feeds"))}" class="stack-form"><label>Nom<input type="text" name="name" placeholder="Prowlarr #1" required /></label><label>URL<input type="url" name="url" placeholder="https://..." required /></label><button type="submit">Ajouter le flux</button></form>'
        f'<div class="feed-list">{feeds_html}</div></section></div>'
        '<section class="panel"><h2>Limite de fraicheur</h2><p>Bloque l\'ingestion des journaux plus vieux que X jours par rapport a aujourd\'hui. Laisse vide pour ne fixer aucune limite.</p>'
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/retention"))}" class="inline-form"><input type="number" min="1" step="1" name="maxJournalAgeDays" value="{escape_html(config["max_journal_age_days"] or "")}" placeholder="30" /><button type="submit">Enregistrer</button></form></section>'
        '<section class="panel"><h2>Actions</h2><div class="action-row">'
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/settings/scan"))}"><button type="submit">Lancer un scan immediat</button></form>'
        f'<form method="post" action="{escape_html(with_base_path(base_path, "/logout"))}"><button type="submit" class="button-secondary">Se deconnecter</button></form></div></section>'
    )
    return render_shell("Parametres", body, current_path="/settings", base_path=base_path)


def render_reader_page(journal: dict, base_path: str) -> str:
    pdf_url = to_managed_file_url(journal.get("pdf_relative_path"), base_path)
    return f"""<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape_html(journal["display_title"])} | {APP_NAME}</title>
    <link rel="icon" type="image/svg+xml" href="{escape_html(with_base_path(base_path, "/static/favicon.svg"))}" />
    <link rel="stylesheet" href="{escape_html(with_base_path(base_path, "/static/styles.css"))}" />
  </head>
  <body class="reader-body" data-base-path="{escape_html(base_path)}">
    <div class="reader-screen">
      <header class="reader-toolbar">
        <div class="reader-toolbar-main">
          <a class="reader-control-button back-link" href="{escape_html(with_base_path(base_path, "/"))}">Retour</a>
          <strong class="reader-title">{escape_html(journal["display_title"])}</strong>
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
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10V4h6v2H6v4H4Zm10-6h6v6h-2V6h-4V4ZM6 16h4v2H4v-6h2v4Zm12-4h2v6h-6v-2h4v-4Z" fill="currentColor"/></svg>
          </button>
        </div>
      </header>
      <main id="reader-root" class="reader-stage" data-pdf-url="{escape_html(pdf_url or '')}">
        <div class="reader-viewport" id="reader-viewport"><div class="reader-pan-stage" id="reader-pan-stage"><div class="reader-pages mode-spread"></div></div></div>
      </main>
    </div>
    <script src="{PDFJS_URL}"></script>
    <script src="{escape_html(with_base_path(base_path, "/static/reader.js?v=10"))}"></script>
  </body>
</html>"""


def content_type_for(file_path: Path) -> str:
    guessed, _ = mimetypes.guess_type(str(file_path))
    if guessed:
        if guessed == "text/javascript":
            return "application/javascript; charset=utf-8"
        if guessed.startswith("text/"):
            return f"{guessed}; charset=utf-8"
        return guessed
    if file_path.suffix.lower() == ".svg":
        return "image/svg+xml"
    return "application/octet-stream"


def parse_query(path_value: str) -> tuple[str, dict]:
    parsed = urllib.parse.urlsplit(path_value)
    path_name = parsed.path or "/"
    if DEFAULT_BASE_PATH and (path_name == DEFAULT_BASE_PATH or path_name.startswith(f"{DEFAULT_BASE_PATH}/")):
        stripped = path_name[len(DEFAULT_BASE_PATH):]
        path_name = stripped if stripped.startswith("/") else f"/{stripped}"
        path_name = path_name or "/"
    return path_name, urllib.parse.parse_qs(parsed.query, keep_blank_values=True)


class AppHandler(BaseHTTPRequestHandler):
    server_version = "LeKiosquePython/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - - [{self.log_date_time_string()}] {format % args}")

    def write_response(
        self,
        status_code: int,
        headers: Optional[dict[str, object]] = None,
        body: bytes = b"",
        head_only: bool = False,
    ) -> None:
        self.send_response(status_code)
        for key, value in (headers or {}).items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                for item in value:
                    self.send_header(key, str(item))
            else:
                self.send_header(key, str(value))
        self.end_headers()
        if not head_only and body:
            self.wfile.write(body)

    def send_html(
        self,
        status_code: int,
        html_value: str,
        headers: Optional[dict[str, object]] = None,
        head_only: bool = False,
    ) -> None:
        payload = html_value.encode("utf-8")
        merged = {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", **(headers or {})}
        self.write_response(status_code, merged, payload, head_only=head_only)

    def send_text(
        self,
        status_code: int,
        text: str,
        headers: Optional[dict[str, object]] = None,
        head_only: bool = False,
    ) -> None:
        payload = text.encode("utf-8")
        merged = {"Content-Type": "text/plain; charset=utf-8", **(headers or {})}
        self.write_response(status_code, merged, payload, head_only=head_only)

    def send_json(
        self,
        status_code: int,
        payload: dict,
        headers: Optional[dict[str, object]] = None,
        head_only: bool = False,
    ) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        merged = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", **(headers or {})}
        self.write_response(status_code, merged, body, head_only=head_only)

    def redirect(self, location: str, headers: Optional[dict[str, object]] = None) -> None:
        self.write_response(303, {"Location": location, **(headers or {})})

    def serve_file(self, file_path: Path, head_only: bool = False) -> None:
        try:
            stat_result = file_path.stat()
        except FileNotFoundError:
            self.send_text(404, "Not Found", head_only=head_only)
            return

        if not file_path.is_file():
            self.send_text(404, "Not Found", head_only=head_only)
            return

        range_header = self.headers.get("Range", "")
        content_type = content_type_for(file_path)
        common_headers = {
            "Content-Type": content_type,
            "Cache-Control": "public, max-age=3600",
            "Accept-Ranges": "bytes",
        }

        if range_header:
            match = re.match(r"^bytes=(\d*)-(\d*)$", range_header)
            if match:
                start = int(match.group(1) or 0)
                end = int(match.group(2) or (stat_result.st_size - 1))
                if 0 <= start <= end < stat_result.st_size:
                    headers = {
                        **common_headers,
                        "Content-Length": end - start + 1,
                        "Content-Range": f"bytes {start}-{end}/{stat_result.st_size}",
                    }
                    self.send_response(206)
                    for key, value in headers.items():
                        self.send_header(key, str(value))
                    self.end_headers()
                    if head_only:
                        return
                    with file_path.open("rb") as handle:
                        handle.seek(start)
                        remaining = end - start + 1
                        while remaining > 0:
                            chunk = handle.read(min(64 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return

        headers = {**common_headers, "Content-Length": stat_result.st_size}
        self.send_response(200)
        for key, value in headers.items():
            self.send_header(key, str(value))
        self.end_headers()
        if head_only:
            return
        with file_path.open("rb") as handle:
            shutil.copyfileobj(handle, self.wfile, length=64 * 1024)

    def require_admin(self, base_path: str) -> bool:
        if not is_configured():
            self.redirect(with_base_path(base_path, "/setup"))
            return False
        if not is_admin_authenticated(self):
            self.redirect(with_base_path(base_path, "/settings?type=error&message=Connexion%20requise"))
            return False
        return True

    def handle_events(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        client_queue: queue.Queue = queue.Queue()
        with runtime.event_lock:
            runtime.event_clients.add(client_queue)

        try:
            self.wfile.write(b'event: connected\ndata: {"ok":true}\n\n')
            self.wfile.flush()

            while True:
                try:
                    event_type, payload = client_queue.get(timeout=25)
                except queue.Empty:
                    event_type = "ping"
                    payload = {"time": int(time.time() * 1000)}

                message = f"event: {event_type}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"
                self.wfile.write(message.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        finally:
            with runtime.event_lock:
                runtime.event_clients.discard(client_queue)

    def handle_get(self, head_only: bool = False) -> None:
        base_path = get_base_path(self)
        path_name, query = parse_query(self.path)

        if path_name == "/":
            self.send_html(200, render_home_page(query, base_path), head_only=head_only)
            return

        if path_name == "/archives":
            self.send_html(200, render_archives_page(query, base_path), head_only=head_only)
            return

        if path_name == "/setup":
            html_value = render_setup_page(query, base_path)
            if html_value is None:
                self.redirect(with_base_path(base_path, "/settings"))
                return
            self.send_html(200, html_value, head_only=head_only)
            return

        if path_name == "/settings":
            html_value = render_settings_page(self, query, base_path)
            if html_value is None:
                self.redirect(with_base_path(base_path, "/setup"))
                return
            self.send_html(200, html_value, head_only=head_only)
            return

        if path_name == "/events":
            if head_only:
                self.write_response(
                    200,
                    {
                        "Content-Type": "text/event-stream; charset=utf-8",
                        "Cache-Control": "no-store",
                        "Connection": "keep-alive",
                    },
                    head_only=True,
                )
                return
            self.handle_events()
            return

        if path_name == "/health":
            self.send_text(200, "ok", head_only=head_only)
            return

        if path_name.startswith("/static/"):
            relative_path = urllib.parse.unquote(path_name[len("/static/"):])
            file_path = (PUBLIC_ROOT / relative_path).resolve()
            try:
                file_path.relative_to(PUBLIC_ROOT)
            except ValueError:
                self.send_text(403, "Forbidden", head_only=head_only)
                return
            self.serve_file(file_path, head_only=head_only)
            return

        if path_name.startswith("/files/"):
            relative_path = urllib.parse.unquote(path_name[len("/files/"):]).replace("\\", "/")
            try:
                self.serve_file(resolve_managed_path(relative_path), head_only=head_only)
            except Exception:
                self.send_text(404, "Not Found", head_only=head_only)
            return

        reader_match = re.match(r"^/(?:reader|journal)/(\d+)$", path_name) or re.match(r"^/(\d+)$", path_name)
        if reader_match:
            journal = get_journal_by_id(int(reader_match.group(1)))
            if not journal or journal.get("status") != "ready" or not journal.get("pdf_relative_path"):
                self.send_text(404, "Journal introuvable", head_only=head_only)
                return
            self.send_html(200, render_reader_page(journal, base_path), head_only=head_only)
            return

        self.send_text(404, "Not Found", head_only=head_only)

    def handle_post(self) -> None:
        base_path = get_base_path(self)
        path_name, _ = parse_query(self.path)

        if path_name == "/api/thumbnail":
            payload = read_json(self)
            journal_id = int(payload.get("journalId") or 0)
            image_data_url = str(payload.get("imageDataUrl") or "")
            match = THUMBNAIL_DATA_URL_PATTERN.match(image_data_url)

            if journal_id <= 0 or not match:
                self.send_json(400, {"ok": False, "error": "Requete miniature invalide."})
                return

            journal = get_journal_by_id(journal_id)
            if not journal or not journal.get("pdf_relative_path"):
                self.send_json(404, {"ok": False, "error": "Journal introuvable."})
                return

            thumbnail_relative_path = build_thumbnail_relative_path(journal.get("pdf_relative_path"))
            if not thumbnail_relative_path:
                self.send_json(400, {"ok": False, "error": "Miniature impossible."})
                return

            thumbnail_absolute_path = resolve_managed_path(thumbnail_relative_path)
            ensure_dir(thumbnail_absolute_path.parent)
            thumbnail_absolute_path.write_bytes(base64.b64decode(match.group(1)))

            update_journal_status(journal["id"], journal["status"], thumbnail_relative_path=thumbnail_relative_path)
            self.send_json(
                200,
                {"ok": True, "thumbnailUrl": to_managed_file_url(thumbnail_relative_path, base_path)},
            )
            return

        if path_name == "/setup":
            if is_configured():
                self.redirect(with_base_path(base_path, "/settings"))
                return
            form = read_form(self)
            password = str(form.get("password") or "")
            confirm_password = str(form.get("confirmPassword") or "")

            if len(password) < 8:
                self.redirect(with_base_path(base_path, "/setup?type=error&message=Mot%20de%20passe%20trop%20court"))
                return

            if password != confirm_password:
                self.redirect(with_base_path(base_path, "/setup?type=error&message=La%20confirmation%20ne%20correspond%20pas"))
                return

            set_admin_password(password)
            self.redirect(
                with_base_path(base_path, "/settings?type=success&message=Configuration%20terminee"),
                headers={"Set-Cookie": admin_cookie_header(base_path)},
            )
            return

        if path_name == "/login":
            if not is_configured():
                self.redirect(with_base_path(base_path, "/setup"))
                return
            form = read_form(self)
            valid = verify_admin_login(str(form.get("password") or ""), get_app_config()["admin_password_hash"])
            if not valid:
                self.redirect(with_base_path(base_path, "/settings?type=error&message=Mot%20de%20passe%20invalide"))
                return
            self.redirect(
                with_base_path(base_path, "/settings?type=success&message=Connexion%20etablie"),
                headers={"Set-Cookie": admin_cookie_header(base_path)},
            )
            return

        if path_name == "/logout":
            self.redirect(
                with_base_path(base_path, "/settings?type=success&message=Session%20fermee"),
                headers={"Set-Cookie": clear_admin_cookie_header(base_path)},
            )
            return

        if not self.require_admin(base_path):
            return

        if path_name == "/settings/search-terms":
            form = read_form(self)
            add_search_term(str(form.get("label") or ""))
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Terme%20ajoute"))
            return

        if path_name == "/settings/search-terms/delete":
            form = read_form(self)
            remove_search_term(int(form.get("id") or 0))
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Terme%20supprime"))
            return

        if path_name == "/settings/feeds":
            form = read_form(self)
            add_feed(str(form.get("name") or ""), str(form.get("url") or ""))
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Flux%20ajoute"))
            return

        if path_name == "/settings/feeds/delete":
            form = read_form(self)
            remove_feed(int(form.get("id") or 0))
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Flux%20supprime"))
            return

        if path_name == "/settings/scan":
            trigger_scan_now()
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Scan%20declenche"))
            return

        if path_name == "/settings/retention":
            form = read_form(self)
            set_max_journal_age_days(str(form.get("maxJournalAgeDays") or ""))
            self.redirect(with_base_path(base_path, "/settings?type=success&message=Limite%20de%20fraicheur%20mise%20a%20jour"))
            return

        self.send_text(404, "Not Found")

    def handle_request(self, head_only: bool = False) -> None:
        try:
            ensure_bootstrap()
            if self.command in ("GET", "HEAD"):
                self.handle_get(head_only=head_only)
                return
            if self.command == "POST":
                if head_only:
                    self.send_text(405, "Method Not Allowed", head_only=True)
                    return
                self.handle_post()
                return
            self.send_text(405, "Method Not Allowed", head_only=head_only)
        except Exception as exc:
            self.send_text(500, str(exc) or "Erreur interne", head_only=head_only)

    def do_GET(self) -> None:
        self.handle_request(head_only=False)

    def do_HEAD(self) -> None:
        self.handle_request(head_only=True)

    def do_POST(self) -> None:
        self.handle_request(head_only=False)


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    ensure_bootstrap()
    server = AppServer(("0.0.0.0", PORT), AppHandler)
    stop_once = threading.Event()

    def shutdown_handler(signum: int, frame: object) -> None:
        if stop_once.is_set():
            return
        stop_once.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, shutdown_handler)
        except Exception:
            pass

    print(f"{APP_NAME} en ecoute sur http://0.0.0.0:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
