"""Database setup for the integrated Smart Farm feature modules.

All tables live in the existing ``smart_farm.db`` used by the rest of the
application. They reuse the ``farmers`` table (created in ``app.py``) for
ownership / authentication, so no parallel user table is introduced.
"""
from __future__ import annotations

import json
import os
import sqlite3

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP_DATA_DIR = os.path.abspath(os.environ.get('SMART_FARM_DATA_DIR', BASE_DIR))
os.makedirs(APP_DATA_DIR, exist_ok=True)
DATABASE_FILE = os.path.join(APP_DATA_DIR, 'smart_farm.db')
DATA_DIR = os.path.join(BASE_DIR, 'frontend', 'features', 'data')

SCHEMA = '''
    CREATE TABLE IF NOT EXISTS schemes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        title_hi TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        eligibility TEXT NOT NULL DEFAULT '',
        benefits TEXT NOT NULL DEFAULT '',
        required_documents TEXT NOT NULL DEFAULT '',
        application_process TEXT NOT NULL DEFAULT '',
        official_url TEXT NOT NULL DEFAULT '',
        department TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        states TEXT NOT NULL DEFAULT 'All',
        farmer_categories TEXT NOT NULL DEFAULT 'All',
        active INTEGER NOT NULL DEFAULT 1,
        source_note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_schemes_filter ON schemes(active, category);

    CREATE TABLE IF NOT EXISTS scheme_bookmarks (
        scheme_id INTEGER NOT NULL,
        farmer_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(scheme_id, farmer_id)
    );

    CREATE TABLE IF NOT EXISTS diagnosis_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id TEXT NOT NULL,
        crop TEXT NOT NULL,
        image_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'demo',
        result_label TEXT NOT NULL DEFAULT '',
        confidence REAL,
        symptoms TEXT NOT NULL DEFAULT '',
        prevention TEXT NOT NULL DEFAULT '',
        treatment TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_diagnosis_owner ON diagnosis_history(farmer_id, created_at);

    CREATE TABLE IF NOT EXISTS saved_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        crop TEXT NOT NULL DEFAULT '',
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        area_acres REAL,
        boundary TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_fields_owner ON saved_fields(farmer_id, created_at);

    CREATE TABLE IF NOT EXISTS radio_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        title_hi TEXT NOT NULL DEFAULT '',
        host TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'Farming Tips',
        description TEXT NOT NULL DEFAULT '',
        audio_url TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'Hindi',
        published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS saved_programs (
        program_id INTEGER NOT NULL,
        farmer_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(program_id, farmer_id)
    );

    CREATE TABLE IF NOT EXISTS post_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        farmer_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'other',
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(post_id, farmer_id)
    );

    CREATE TABLE IF NOT EXISTS comment_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL,
        farmer_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_replies_comment ON comment_replies(comment_id);

    CREATE TABLE IF NOT EXISTS notifications_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        link TEXT NOT NULL DEFAULT '',
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notif_v2_owner ON notifications_v2(farmer_id, read);
'''

# Extra columns added to pre-existing tables by the Chaupal feature.
POST_COLUMNS = (
    ('media_kind', "TEXT NOT NULL DEFAULT 'none'"),
    ('category', "TEXT NOT NULL DEFAULT 'General'"),
    ('report_count', 'INTEGER NOT NULL DEFAULT 0'),
)


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(DATABASE_FILE)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys = ON')
    return db


def init_feature_db() -> None:
    with get_db() as db:
        db.executescript(SCHEMA)
        for column, definition in POST_COLUMNS:
            try:
                db.execute(f'ALTER TABLE posts ADD COLUMN {column} {definition}')
            except sqlite3.OperationalError:
                pass
    _seed_schemes()
    _seed_radio()


def _read_seed(name: str):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


SCHEME_COLUMNS = (
    'slug', 'title', 'title_hi', 'summary', 'description', 'eligibility', 'benefits',
    'required_documents', 'application_process', 'official_url', 'department',
    'category', 'states', 'farmer_categories', 'source_note',
)


def _seed_schemes() -> None:
    records = _read_seed('schemes.json')
    if not records:
        return
    placeholders = ', '.join('?' for _ in SCHEME_COLUMNS)
    sql = (
        f"INSERT INTO schemes ({', '.join(SCHEME_COLUMNS)}) VALUES ({placeholders}) "
        "ON CONFLICT(slug) DO NOTHING"
    )
    with get_db() as db:
        for scheme in records:
            db.execute(sql, tuple(scheme.get(column, '') for column in SCHEME_COLUMNS))


def _seed_radio() -> None:
    records = _read_seed('radio.json')
    if not records:
        return
    with get_db() as db:
        existing = db.execute('SELECT COUNT(*) AS count FROM radio_programs').fetchone()['count']
        if existing:
            return
        columns = ('title', 'title_hi', 'host', 'category', 'description', 'audio_url', 'duration_seconds', 'language')
        placeholders = ', '.join('?' for _ in columns)
        sql = f"INSERT INTO radio_programs ({', '.join(columns)}) VALUES ({placeholders})"
        for program in records:
            db.execute(sql, (
                program['title'], program.get('title_hi', ''), program.get('host', ''),
                program.get('category', 'Farming Tips'), program.get('description', ''),
                program.get('audio_url', ''), int(program.get('duration_seconds', 0)),
                program.get('language', 'Hindi'),
            ))
