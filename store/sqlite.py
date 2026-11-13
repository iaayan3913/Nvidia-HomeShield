"""Small persistence seam; the in-memory store remains the default for the live mock."""
import json
import sqlite3
from backend.schemas import Case

class CaseStore:
    def __init__(self, path: str = "homeshield.sqlite3"):
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.execute("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        self.connection.commit()
    def save(self, case: Case) -> Case:
        self.connection.execute("INSERT OR REPLACE INTO cases VALUES (?, ?)",
                                (case.id, json.dumps(case.model_dump(mode="json"))))
        self.connection.commit()
        return case
    def list(self) -> list[Case]:
        rows = self.connection.execute("SELECT payload FROM cases").fetchall()
        return [Case.model_validate_json(row[0]) for row in rows]
