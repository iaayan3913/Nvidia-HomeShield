from datetime import datetime
from typing import Protocol

from backend.schemas import Job, Plan, Worker


class Scheduler(Protocol):
    """Contract every solver honours (cuOpt, OR-Tools, mock, and the fallback chain)."""

    def optimise_schedule(self, workers: list[Worker], jobs: list[Job],
                          initial_routes: dict[str, list[str]] | None = None) -> Plan:
        """Assign and order jobs. `initial_routes` (worker_id -> job ids) is an optional warm start."""
        ...

    def replan(self, current: Plan | None, workers: list[Worker], jobs: list[Job],
               now: datetime | None = None) -> Plan:
        """Re-optimise from `now`, keeping started visits and using workers' current positions."""
        ...
