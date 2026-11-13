from datetime import datetime, timedelta
from time import perf_counter
from uuid import uuid4
from backend.schemas import Job, Plan, Stop, Worker, WorkerPlan
class MockScheduler:
    def optimise_schedule(self, workers: list[Worker], jobs: list[Job]) -> Plan:
        started = perf_counter()
        plans = [WorkerPlan(worker_id=w.id) for w in workers]
        for index, job in enumerate(jobs):
            if not plans: break
            worker_plan = plans[index % len(plans)]
            worker = workers[index % len(workers)]
            worker_plan.stops.append(Stop(job_id=job.id, eta=datetime.utcnow() + timedelta(minutes=15 * (index + 1)),
                                          lat=job.lat, lon=job.lon, slack_minutes=30))
        return Plan(id=f"plan-{uuid4().hex[:8]}", solver="mock", solver_ms=(perf_counter()-started)*1000, workers=plans)
if __name__ == "__main__":
    print(MockScheduler().optimise_schedule([Worker(id="w1", name="Demo", skills=[], shift_start=datetime.utcnow(), shift_end=datetime.utcnow(), lat=53.38, lon=-1.47)], []).model_dump_json())
