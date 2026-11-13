"""Private records kept outside the event log: resident contacts and operative job progress.

These tables live beside the main store but are never written to `events`, so nothing here
reaches `/api/events`, `/api/stream` or logs.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from threading import RLock

from backend.schemas import utc_now


class PrivateRecords:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.lock = RLock()
        with self.lock:
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS report_contacts (
                    case_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS case_schedule_start (
                    case_id TEXT PRIMARY KEY, start TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS job_progress (
                    job_id TEXT PRIMARY KEY, case_id TEXT, status TEXT NOT NULL, notes TEXT,
                    evidence_count INTEGER, updated_at TEXT NOT NULL
                );
                """
            )

    def save_contact(self, case_id: str, details: dict) -> None:
        with self.lock:
            self.connection.execute(
                "INSERT OR REPLACE INTO report_contacts(case_id,payload,created_at) VALUES(?,?,?)",
                (case_id, json.dumps(details), utc_now().isoformat()),
            )

    def get_contact(self, case_id: str) -> dict | None:
        with self.lock:
            row = self.connection.execute("SELECT payload FROM report_contacts WHERE case_id=?", (case_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_progress(self, job_id: str, case_id: str | None, status: str, notes: str | None,
                      evidence_count: int | None) -> dict:
        record = {"job_id": job_id, "case_id": case_id, "status": status, "notes": notes,
                  "evidence_count": evidence_count, "updated_at": utc_now().isoformat()}
        with self.lock:
            self.connection.execute(
                "INSERT OR REPLACE INTO job_progress(job_id,case_id,status,notes,evidence_count,updated_at) "
                "VALUES(:job_id,:case_id,:status,:notes,:evidence_count,:updated_at)", record,
            )
        return record

    def list_progress(self) -> dict[str, dict]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT job_id,case_id,status,notes,evidence_count,updated_at FROM job_progress").fetchall()
        keys = ("job_id", "case_id", "status", "notes", "evidence_count", "updated_at")
        return {row[0]: dict(zip(keys, row)) for row in rows}

    def schedule_start(self, case_id: str, default: datetime | None = None) -> datetime | None:
        """The case's scheduling-window start: fixed the first time it is planned, then reused."""
        with self.lock:
            row = self.connection.execute("SELECT start FROM case_schedule_start WHERE case_id=?", (case_id,)).fetchone()
            if row:
                return datetime.fromisoformat(row[0])
            if default is not None:
                self.connection.execute("INSERT INTO case_schedule_start(case_id,start) VALUES(?,?)",
                                        (case_id, default.isoformat()))
            return default

    def clear(self) -> None:
        with self.lock:
            self.connection.executescript(
                "DELETE FROM report_contacts; DELETE FROM job_progress; DELETE FROM case_schedule_start;")
