# VoiceMate — full offline-first prototype

VoiceMate is an installable Hindi ↔ Santhali classroom assistant prototype for the SIH mother-tongue education problem. Teachers can transcribe Hindi speech, translate classroom phrases, collect a student response, prepare lessons, create bilingual worksheets, and review progress.

## Run it

Run the included application server:

```bash
python3 server.py
```

Open `http://127.0.0.1:8000`. This enables PWA installation, service-worker caching, the online status check, SQLite storage, and sync. Opening `index.html` directly still supports the core local interface but cannot use service workers or the sync API.

## Included

- Dedicated Hindi transcription workspace with interim speech-to-text, edit, copy, clear, and send-to-translator controls
- Hindi → Santhali classroom translation and browser speech playback
- Two-way student-response demonstration
- Searchable offline lesson library and teacher-created lessons
- Bilingual worksheet generation, local saving, printing, and PDF export
- Searchable translation history and CSV export
- Progress dashboard driven by locally stored classroom activity
- Teacher profile, translation preferences, backups, restore, and reset
- Installable PWA with cached application assets
- Offline change queue and automatic/manual online synchronization
- Responsive desktop, tablet, and phone layouts

## Connectivity

- **Offline:** the interface, phrasebook, lessons, history, worksheets, and settings work from the device. The service worker caches application assets after the first server load. Changes are queued locally.
- **Online/local network:** `GET /api/health` reports server availability. `POST /api/sync` writes queued data to SQLite. Tapping the connection badge triggers a manual sync; reconnection triggers an automatic sync.
- **No server available:** the app stays in local mode and does not discard changes.

## Dataset used

The current repository uses `data/phrasebook.json`: a small, manually assembled set of classroom demonstration phrases in Hindi, Ol Chiki, and Romanized Santhali. It is **not** a machine-learning training corpus and must be reviewed by native Santhali educators before real classroom use.

No external dataset or pretrained translation model is bundled. A production build should connect a validated Hindi–Santhali parallel corpus and evaluated ASR/NMT/TTS models.

## Database used

- **Device storage:** browser `localStorage` provides immediate offline persistence and the pending-sync queue.
- **Application server:** Python's built-in `sqlite3` module stores synchronized translations, lessons, worksheets, and settings in `voicemate.db`.
- **Production upgrade path:** replace SQLite with PostgreSQL and authenticated user/school records while retaining the same sync contract.

## API

- `GET /api/health` — connectivity and database status
- `GET /api/snapshot` — synchronized server data
- `POST /api/sync` — idempotent lesson, translation, worksheet, and settings synchronization

The speech-recognition option uses the browser's Web Speech API when supported. Manual transcription remains available everywhere.
