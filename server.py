#!/usr/bin/env python3
"""VoiceMate local demo server: static PWA hosting + SQLite sync API."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import sqlite3
import time

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "voicemate.db"


def connect():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS translations (
          id TEXT PRIMARY KEY, hindi TEXT NOT NULL, santhali TEXT NOT NULL,
          ol_chiki TEXT, lesson TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lessons (
          id TEXT PRIMARY KEY, class_name TEXT NOT NULL, subject TEXT NOT NULL,
          topic TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS worksheets (
          id TEXT PRIMARY KEY, lesson TEXT NOT NULL, question_count INTEGER NOT NULL,
          difficulty TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
        );
    """)
    return db


class VoiceMateHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > 2_000_000:
            raise ValueError("Payload too large")
        return json.loads(self.rfile.read(size) or b"{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            with connect() as db:
                translations = db.execute("SELECT COUNT(*) FROM translations").fetchone()[0]
            return self.send_json({"online": True, "database": "SQLite", "translations": translations, "time": int(time.time())})
        if path == "/api/snapshot":
            with connect() as db:
                payload = {
                    "history": [dict(row) for row in db.execute("SELECT * FROM translations ORDER BY created_at DESC")],
                    "lessons": [dict(row) for row in db.execute("SELECT * FROM lessons ORDER BY created_at DESC")],
                    "worksheets": [dict(row) for row in db.execute("SELECT * FROM worksheets ORDER BY created_at DESC")]
                }
            return self.send_json(payload)
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/sync":
            return self.send_json({"error": "Not found"}, 404)
        try:
            data = self.read_json()
            with connect() as db:
                for item in data.get("history", []):
                    db.execute("INSERT OR REPLACE INTO translations VALUES (?,?,?,?,?,?)", (
                        str(item.get("id", "")), str(item.get("hindi", "")), str(item.get("santhali", "")),
                        str(item.get("olChiki", "")), str(item.get("lesson", "")), str(item.get("at", ""))))
                for item in data.get("lessons", []):
                    db.execute("INSERT OR REPLACE INTO lessons VALUES (?,?,?,?,?,?)", (
                        str(item.get("id", "")), str(item.get("className", "")), str(item.get("subject", "")),
                        str(item.get("topic", "")), str(item.get("desc", "")), str(item.get("createdAt", ""))))
                for item in data.get("worksheets", []):
                    db.execute("INSERT OR REPLACE INTO worksheets VALUES (?,?,?,?,?)", (
                        str(item.get("id", "")), str(item.get("lesson", "")), int(item.get("questionCount", 0)),
                        str(item.get("difficulty", "")), str(item.get("createdAt", ""))))
                db.execute("INSERT OR REPLACE INTO app_state VALUES (?,?,?)", ("settings", json.dumps(data.get("settings", {}), ensure_ascii=False), int(time.time())))
            return self.send_json({"ok": True, "syncedAt": int(time.time()), "database": "SQLite"})
        except (ValueError, TypeError, json.JSONDecodeError, sqlite3.Error) as error:
            return self.send_json({"ok": False, "error": str(error)}, 400)


if __name__ == "__main__":
    connect().close()
    address = ("127.0.0.1", 8000)
    print(f"VoiceMate running at http://{address[0]}:{address[1]}")
    print(f"SQLite database: {DB_PATH}")
    ThreadingHTTPServer(address, VoiceMateHandler).serve_forever()
