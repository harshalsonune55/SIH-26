#!/usr/bin/env python3
"""VoiceMate local demo server: static PWA hosting + SQLite sync API."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import os
import re
import sqlite3
import threading
import time

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "voicemate.db"

# ---------------------------------------------------------------------------
# Hindi -> Santhali (Ol Chiki) machine translation using AI4Bharat IndicTrans2.
# NOTE: Meta's NLLB-200 checkpoints on Hugging Face do NOT support sat_Olck,
# so IndicTrans2 (which covers all 22 scheduled Indian languages) is used.
# Optional: if transformers/torch/IndicTransToolkit are missing, /api/translate
# returns 503 and the web app falls back to the curated phrasebook.
# Bigger/better model:  VOICEMATE_MODEL=ai4bharat/indictrans2-indic-indic-1B python3 server.py
# Skip loading with:    VOICEMATE_NO_MODEL=1 python3 server.py
# ---------------------------------------------------------------------------
MODEL_NAME = os.environ.get("VOICEMATE_MODEL", "ai4bharat/indictrans2-indic-indic-dist-320M")
SRC_LANG, TGT_LANG = "hin_Deva", "sat_Olck"
_mt = {"tok": None, "model": None, "ip": None, "device": "cpu", "error": None, "loading": False}
_mt_lock = threading.Lock()
_cache = {}


def load_model():
    """Load the model once (thread-safe). Returns True when ready."""
    if _mt["model"] is not None:
        return True
    with _mt_lock:
        if _mt["model"] is not None:
            return True
        if os.environ.get("VOICEMATE_NO_MODEL"):
            _mt["error"] = "Model disabled (VOICEMATE_NO_MODEL is set)"
            return False
        try:
            _mt["loading"] = True
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            from IndicTransToolkit.processor import IndicProcessor
            print(f"Loading translation model {MODEL_NAME} (first run downloads it)...", flush=True)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _mt["tok"] = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
            _mt["model"] = AutoModelForSeq2SeqLM.from_pretrained(MODEL_NAME, trust_remote_code=True).to(device).eval()
            _mt["ip"] = IndicProcessor(inference=True)
            _mt["device"] = device
            _mt["error"] = None
            print("Translation model ready.", flush=True)
        except Exception as error:  # missing packages, no internet on first run, out of memory...
            _mt["error"] = f"{type(error).__name__}: {error}"
            print("Translation model unavailable:", _mt["error"], flush=True)
        finally:
            _mt["loading"] = False
    return _mt["model"] is not None


# Ol Chiki -> Roman transliteration (rule-based, one-to-one letter mapping).
# The model only outputs Ol Chiki script, so this gives teachers a readable Roman line.
_OL_CHIKI_ROMAN = {
    "ᱚ": "o", "ᱛ": "t", "ᱜ": "g", "ᱝ": "ng", "ᱞ": "l", "ᱟ": "a", "ᱠ": "k", "ᱡ": "j",
    "ᱢ": "m", "ᱣ": "w", "ᱤ": "i", "ᱥ": "s", "ᱦ": "h", "ᱧ": "ñ", "ᱨ": "r", "ᱩ": "u",
    "ᱪ": "ch", "ᱫ": "d", "ᱬ": "ṇ", "ᱭ": "y", "ᱮ": "e", "ᱯ": "p", "ᱰ": "ḍ", "ᱱ": "n",
    "ᱲ": "ṛ", "ᱳ": "o", "ᱴ": "ṭ", "ᱵ": "b", "ᱶ": "v", "ᱷ": "h",
    "ᱸ": "ṅ", "ᱹ": "", "ᱺ": "ṅ", "ᱻ": "", "ᱼ": "'", "ᱽ": "",
    "᱾": ".", "᱿": ".",
}
_OL_CHIKI_ROMAN.update({chr(0x1C50 + i): str(i) for i in range(10)})


def ol_chiki_to_roman(text):
    roman = "".join(_OL_CHIKI_ROMAN.get(ch, ch) for ch in text).replace("।", ".")
    return re.sub(r"(^|[.?!]\s+)([a-zñṇḍṛṭ])", lambda m: m.group(1) + m.group(2).upper(), roman)


def split_sentences(text):
    parts = re.split(r"(?<=[।?!.\n])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def translate_hindi(text):
    """Translate Hindi text to Santhali (Ol Chiki) with IndicTrans2."""
    import torch
    tok, model, ip, device = _mt["tok"], _mt["model"], _mt["ip"], _mt["device"]
    sentences = split_sentences(text)
    batch = ip.preprocess_batch(sentences, src_lang=SRC_LANG, tgt_lang=TGT_LANG)
    inputs = tok(batch, truncation=True, padding="longest", max_length=256,
                 return_tensors="pt", return_attention_mask=True).to(device)
    with torch.no_grad():
        generated = model.generate(**inputs, use_cache=True, min_length=0,
                                   max_length=256, num_beams=5, num_return_sequences=1)
    decoded = tok.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True)
    return " ".join(t.strip() for t in ip.postprocess_batch(decoded, lang=TGT_LANG))


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
            return self.send_json({"online": True, "database": "SQLite", "translations": translations, "time": int(time.time()),
                                   "model": MODEL_NAME, "modelReady": _mt["model"] is not None, "modelLoading": _mt["loading"], "modelError": _mt["error"]})
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
        if urlparse(self.path).path == "/api/translate":
            try:
                text = str(self.read_json().get("text", "")).strip()
                if not text:
                    return self.send_json({"ok": False, "error": "Empty text"}, 400)
                if len(text) > 2000:
                    return self.send_json({"ok": False, "error": "Text too long (max 2000 characters)"}, 400)
                if text in _cache:
                    return self.send_json({"ok": True, "olChiki": _cache[text], "roman": ol_chiki_to_roman(_cache[text]), "cached": True, "model": MODEL_NAME})
                if not load_model():
                    return self.send_json({"ok": False, "error": _mt["error"] or "Translation model not ready"}, 503)
                result = translate_hindi(text)
                if len(_cache) > 500:
                    _cache.clear()
                _cache[text] = result
                return self.send_json({"ok": True, "olChiki": result, "roman": ol_chiki_to_roman(result), "cached": False, "model": MODEL_NAME})
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                return self.send_json({"ok": False, "error": str(error)}, 400)
            except Exception as error:
                return self.send_json({"ok": False, "error": f"{type(error).__name__}: {error}"}, 500)
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
    threading.Thread(target=load_model, daemon=True).start()  # warm up so the first translation is fast
    ThreadingHTTPServer(address, VoiceMateHandler).serve_forever()