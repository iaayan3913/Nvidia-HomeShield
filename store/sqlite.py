"""Thread-safe SQLite persistence for the single-process demo deployment."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Iterator

from backend.schemas import AgentEvent, Approval, Case, CaseStatus, Plan, utc_now


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.lock = RLock()
        with self.lock:
            self.connection.execute("PRAGMA foreign_keys=ON")
            self.connection.execute("PRAGMA journal_mode=WAL")
            self._create_tables()

    def _create_tables(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS cases (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS case_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, status TEXT NOT NULL,
                changed_at TEXT NOT NULL, summary TEXT NOT NULL,
                FOREIGN KEY(case_id) REFERENCES cases(id)
            );
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, case_id TEXT,
                type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY, case_id TEXT NOT NULL, action TEXT NOT NULL,
                status TEXT NOT NULL, payload TEXT NOT NULL, requested_at TEXT NOT NULL,
                UNIQUE(case_id, action, status)
            );
            CREATE INDEX IF NOT EXISTS events_sequence_idx ON events(sequence);
            CREATE INDEX IF NOT EXISTS events_case_idx ON events(case_id);
            """
        )

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                yield self.connection
            except Exception:
                self.connection.rollback()
                raise
            else:
                self.connection.commit()

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    def save_case(self, case: Case, history_summary: str = "Case saved") -> Case:
        case.updated_at = utc_now()
        payload = case.model_dump_json()
        with self.transaction() as db:
            existing = db.execute("SELECT payload FROM cases WHERE id=?", (case.id,)).fetchone()
            db.execute(
                "INSERT INTO cases(id,payload,created_at,updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
                (case.id, payload, case.created_at.isoformat(), case.updated_at.isoformat()),
            )
            previous_status = Case.model_validate_json(existing[0]).status if existing else None
            if previous_status != case.status:
                db.execute(
                    "INSERT INTO case_history(case_id,status,changed_at,summary) VALUES(?,?,?,?)",
                    (case.id, case.status.value, case.updated_at.isoformat(), history_summary),
                )
        return case

    def get_case(self, case_id: str) -> Case | None:
        with self.lock:
            row = self.connection.execute("SELECT payload FROM cases WHERE id=?", (case_id,)).fetchone()
        return Case.model_validate_json(row[0]) if row else None

    def list_cases(self) -> list[Case]:
        with self.lock:
            rows = self.connection.execute("SELECT payload FROM cases ORDER BY created_at DESC").fetchall()
        return [Case.model_validate_json(row[0]) for row in rows]

    def case_history(self, case_id: str) -> list[dict]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT status,changed_at,summary FROM case_history WHERE case_id=? ORDER BY id", (case_id,)
            ).fetchall()
        return [dict(row) for row in rows]

    def add_event(self, event: AgentEvent) -> AgentEvent:
        safe_json = event.model_dump_json()
        with self.transaction() as db:
            db.execute(
                "INSERT OR IGNORE INTO events(id,case_id,type,payload,created_at) VALUES(?,?,?,?,?)",
                (event.id, event.case_id, event.type, safe_json, event.created_at.isoformat()),
            )
        return event

    def list_events(self, after_sequence: int = 0, limit: int = 500) -> list[tuple[int, AgentEvent]]:
        with self.lock:
            rows = self.connection.execute(
                "SELECT sequence,payload FROM events WHERE sequence>? ORDER BY sequence LIMIT ?",
                (after_sequence, min(limit, 1000)),
            ).fetchall()
        return [(row[0], AgentEvent.model_validate_json(row[1])) for row in rows]

    def save_plan(self, plan: Plan) -> Plan:
        with self.transaction() as db:
            db.execute(
                "INSERT INTO plans(id,payload,created_at) VALUES(?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                (plan.id, plan.model_dump_json(), plan.created_at.isoformat()),
            )
        return plan

    def latest_plan(self) -> Plan | None:
        with self.lock:
            row = self.connection.execute("SELECT payload FROM plans ORDER BY created_at DESC LIMIT 1").fetchone()
        return Plan.model_validate_json(row[0]) if row else None

    def list_plans(self) -> list[Plan]:
        with self.lock:
            rows = self.connection.execute("SELECT payload FROM plans ORDER BY created_at DESC").fetchall()
        return [Plan.model_validate_json(row[0]) for row in rows]

    def request_approval(self, approval: Approval) -> Approval:
        with self.transaction() as db:
            existing = db.execute(
                "SELECT payload FROM approvals WHERE case_id=? AND action=? ORDER BY requested_at DESC LIMIT 1",
                (approval.case_id, approval.action),
            ).fetchone()
            if existing:
                return Approval.model_validate_json(existing[0])
            db.execute(
                "INSERT INTO approvals(id,case_id,action,status,payload,requested_at) VALUES(?,?,?,?,?,?)",
                (approval.id, approval.case_id, approval.action, approval.status.value,
                 approval.model_dump_json(), approval.requested_at.isoformat()),
            )
        return approval

    def get_approval(self, approval_id: str) -> Approval | None:
        with self.lock:
            row = self.connection.execute("SELECT payload FROM approvals WHERE id=?", (approval_id,)).fetchone()
        return Approval.model_validate_json(row[0]) if row else None

    def list_approvals(self, status: str | None = None) -> list[Approval]:
        query = "SELECT payload FROM approvals"
        params: tuple = ()
        if status:
            query += " WHERE status=?"
            params = (status,)
        query += " ORDER BY requested_at DESC"
        with self.lock:
            rows = self.connection.execute(query, params).fetchall()
        return [Approval.model_validate_json(row[0]) for row in rows]

    def save_approval(self, approval: Approval) -> Approval:
        with self.transaction() as db:
            db.execute(
                "UPDATE approvals SET status=?,payload=? WHERE id=?",
                (approval.status.value, approval.model_dump_json(), approval.id),
            )
        return approval


class CaseStore(Store):
    """Backward-compatible early-scaffold API."""

    def __init__(self, path: str = "homeshield.sqlite3"):
        super().__init__(path)

    def save(self, case: Case) -> Case:
        return self.save_case(case)

    def list(self) -> list[Case]:
        return self.list_cases()
