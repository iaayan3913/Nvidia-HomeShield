from datetime import datetime, timedelta, timezone
from time import perf_counter
from uuid import uuid4
from backend.schemas import Job, Plan, Stop, Worker, WorkerPlan
class MockScheduler:
    def optimise_schedule(self, workers: list[Worker], jobs: list[Job]) -> Plan:
        started = perf_counter()
        plans = [WorkerPlan(worker_id=w.id) for w in workers]
        unassigned: list[str] = []
        for index, job in enumerate(jobs):
            eligible = [(worker, plan) for worker, plan in zip(workers, plans)
                        if job.required_skill in worker.skills or not worker.skills]
            if not eligible:
                unassigned.append(job.id)
                continue
            worker, worker_plan = eligible[index % len(eligible)]
            worker_plan.stops.append(Stop(job_id=job.id, eta=datetime.now(timezone.utc) + timedelta(minutes=15 * (index + 1)),
                                          lat=job.lat, lon=job.lon, slack_minutes=30))
        conflicts = [f"No suitably skilled worker for {job_id}" for job_id in unassigned]
        return Plan(id=f"plan-{uuid4().hex[:8]}", solver="mock", solver_ms=(perf_counter()-started)*1000,
                    workers=plans, unassigned_jobs=unassigned, conflicts=conflicts)
if __name__ == "__main__":
    print(MockScheduler().optimise_schedule([Worker(id="w1", name="Demo", skills=[], shift_start=datetime.utcnow(), shift_end=datetime.utcnow(), lat=53.38, lon=-1.47)], []).model_dump_json())
