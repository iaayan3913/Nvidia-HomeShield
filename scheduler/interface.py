from typing import Protocol
from backend.schemas import Job, Plan, Worker
class Scheduler(Protocol):
    def optimise_schedule(self, workers: list[Worker], jobs: list[Job]) -> Plan: ...
