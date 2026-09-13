"""
Minimal SQLite persistence layer.

Two tables:
  telemetry - periodic vehicle snapshots (throttled, not every tick)
  events    - emergency / hazard events for the control-room history view

Kept as plain synchronous sqlite3 calls since write volume is low
(a few rows per second at most) - no need for an async DB driver here.
"""
from __future__ import annotations

import os
import sqlite3
import time

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "fognet.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            vehicle_id TEXT NOT NULL,
            x REAL, y REAL,
            speed_kmh REAL,
            heading_deg REAL,
            hazard_status TEXT,
            visibility_m REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            type TEXT NOT NULL,
            vehicle_id TEXT NOT NULL,
            location TEXT,
            status TEXT
        )
        """
    )
    conn.commit()
    conn.close()


def log_telemetry(rows: list[dict]):
    if not rows:
        return
    conn = get_connection()
    conn.executemany(
        """INSERT INTO telemetry (timestamp, vehicle_id, x, y, speed_kmh, heading_deg, hazard_status, visibility_m)
           VALUES (:timestamp, :vehicle_id, :x, :y, :speed_kmh, :heading_deg, :hazard_status, :visibility_m)""",
        rows,
    )
    conn.commit()
    conn.close()


def log_event(event: dict):
    conn = get_connection()
    conn.execute(
        """INSERT INTO events (timestamp, type, vehicle_id, location, status)
           VALUES (:timestamp, :type, :vehicle_id, :location, :status)""",
        event,
    )
    conn.commit()
    conn.close()


def fetch_recent_events(limit: int = 50, offset: int = 0) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM events ORDER BY timestamp DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def fetch_recent_telemetry(limit: int = 50, offset: int = 0) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
