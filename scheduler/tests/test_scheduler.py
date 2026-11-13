"""Run from the repo root: py -m pytest scheduler/tests -q"""
from datetime import timedelta

import pytest

from backend.schemas import Case, Deadlines, HazardType, Job, Severity, Skill
from data.export_roads_geojson import export_fallback
from data.generate_properties import generate_properties
from data.generate_synthetic import generate_jobs, generate_workers
from data.sheffield import FIXTURE_DAY, is_plausible_residential
from scheduler import FallbackScheduler, diff_plans, get_scheduler, validate_plan
from scheduler import ortools as ortools_mod
from scheduler import cuopt as cuopt_mod
from scheduler.core import BaseScheduler
from scheduler.fixtures import case_to_job, demo_emergency_job, load_jobs, load_workers
from scheduler.mock import MockScheduler
from scheduler.travel import HAVERSINE_LABEL, TravelModel, haversine_minutes

SOLVERS = [MockScheduler(time_limit_s=0.5)]
if ortools_mod.available():
    SOLVERS.append(ortools_mod.OrToolsScheduler(time_limit_s=0.5))
EMERGENCY_AT = FIXTURE_DAY.replace(hour=11)


@pytest.fixture(scope="module")
def workers():
    return load_workers()


@pytest.fixture(scope="module")
def jobs():
    return load_jobs()


def test_fixtures_are_deterministic_and_sized():
    assert generate_workers() == generate_workers()
    assert generate_jobs() == generate_jobs()
    assert len(generate_workers()) == 8
    assert len(generate_jobs()) >= 30


def test_every_required_skill_has_a_worker(workers, jobs):
    skills = {s for w in workers for s in w.skills}
    assert {j.required_skill for j in jobs} <= skills


def test_properties_are_plausible():
    props = generate_properties()
    assert 300 <= len(props) <= 500
    assert len({p["id"] for p in props}) == len(props)
    assert all(is_plausible_residential(p["lat"], p["lon"]) for p in props)


def test_roads_fallback_is_labelled():
    roads = export_fallback()
    assert roads["features"] and roads["metadata"]["source"] == "synthetic"


def test_haversine_travel_is_labelled_and_symmetric():
    a, b = (53.37, -1.45), (53.42, -1.46)
    assert haversine_minutes(a, b) == pytest.approx(haversine_minutes(b, a))
    matrix, label = TravelModel().matrix([a, b])
    assert label == HAVERSINE_LABEL and matrix[0][0] == 0 and matrix[0][1] > 0


@pytest.mark.parametrize("solver", SOLVERS, ids=lambda s: s.name)
def test_plan_is_valid_and_fast(solver, workers, jobs):
    plan = solver.optimise_schedule(workers, jobs)
    assert plan.solver == solver.name
    assert validate_plan(plan, workers, jobs) == []
    assert plan.solver_ms < 2000
    assigned = {s.job_id for wp in plan.workers for s in wp.stops}
    assert assigned | set(plan.unassigned_jobs) == {j.id for j in jobs}
    assert all(s.slack_minutes is None or s.slack_minutes >= 0 for wp in plan.workers for s in wp.stops)


@pytest.mark.parametrize("solver", SOLVERS, ids=lambda s: s.name)
def test_emergency_replan(solver, workers, jobs):
    before = solver.optimise_schedule(workers, jobs)
    emergency = demo_emergency_job(EMERGENCY_AT)
    after = solver.replan(before, workers, jobs + [emergency], EMERGENCY_AT)
    assert validate_plan(after, workers, jobs + [emergency]) == []
    assert emergency.id not in after.unassigned_jobs
    owner = next(wp.worker_id for wp in after.workers for s in wp.stops if s.job_id == emergency.id)
    assert Skill.gas in next(w for w in workers if w.id == owner).skills
    # visits that had already started by 11:00 are kept on the same worker in the same order
    for old, new in zip(before.workers, after.workers):
        started = [s.job_id for s in old.stops if s.eta <= EMERGENCY_AT]
        assert [s.job_id for s in new.stops][: len(started)] == started
    assert after.solver_ms < 2500
    assert any(a["job_id"] == emergency.id for a in diff_plans(before, after)["added"])


def test_impossible_job_is_reported_not_crashed(workers):
    late = Job(id="j-late", case_id="c-late", required_skill=Skill.general, lat=53.37, lon=-1.45,
               latest=FIXTURE_DAY.replace(hour=6))
    plan = MockScheduler().optimise_schedule(workers, [late])
    assert plan.unassigned_jobs == ["j-late"]
    assert "deadline passed" in plan.conflicts[0]


def test_fallback_chain_survives_a_broken_solver(workers, jobs):
    class Broken(BaseScheduler):
        name = "broken"

        def _solve(self, problem, initial):
            raise RuntimeError("GPU on fire")

    chain = FallbackScheduler([Broken(), MockScheduler()])
    plan = chain.optimise_schedule(workers, jobs)
    assert plan.solver == "mock"
    assert "GPU on fire" in chain.last_meta["fallback_from"][0]


def test_get_scheduler_always_ends_in_mock():
    assert get_scheduler("mock").chain[-1].name == "mock"
    assert get_scheduler().chain[-1].name == "mock"


def test_explicit_cuopt_reports_unavailability_and_can_disable_fallback(monkeypatch):
    monkeypatch.setattr(cuopt_mod, "available", lambda: False)
    monkeypatch.setattr(cuopt_mod, "status", lambda: "cuopt unavailable: ImportError: test")
    fallback = get_scheduler("cuopt", allow_fallback=True)
    assert fallback.chain and fallback.initial_failures == ["cuopt unavailable: ImportError: test"]
    strict = get_scheduler("cuopt", allow_fallback=False)
    assert strict.chain == []
    with pytest.raises(RuntimeError, match="cuopt unavailable: ImportError: test"):
        strict.optimise_schedule([], [])


def test_case_to_job_for_emergency():
    case = Case(id="c1", hazard_type=HazardType.gas, severity=Severity.emergency, is_emergency=True,
                summary="gas smell", property_id="p-110",
                deadlines=Deadlines(make_safe_by=EMERGENCY_AT + timedelta(hours=24)))
    job = case_to_job(case, now=EMERGENCY_AT)
    assert job.required_skill == Skill.gas and job.priority == 5
    assert job.latest <= EMERGENCY_AT + timedelta(hours=2)


def test_legacy_backend_call_still_works():
    plan = MockScheduler().optimise_schedule([], [])
    assert plan.workers == [] and plan.unassigned_jobs == []


def test_service_adds_emergency_case_and_replans():
    from scheduler.service import SchedulingService
    service = SchedulingService(scheduler=FallbackScheduler([MockScheduler()]))
    before = service.current_plan()
    case = Case(id="c-gas", hazard_type=HazardType.gas, severity=Severity.emergency, is_emergency=True,
                summary="gas smell, flat in S2")  # no property_id: service picks a stable one
    plan, diff = service.add_case(case)
    assert case.property_id is not None
    assert "job-c-gas" not in plan.unassigned_jobs
    assert diff["added"][0]["job_id"] == "job-c-gas"
    assert plan.id != before.id


def test_cuopt_route_rows_map_locations_back_to_jobs():
    from scheduler.cuopt import routes_from_rows
    # 2 workers (locations 0-1), 3 jobs (locations 2-4); documented get_route() columns.
    rows = [
        {"route": 0, "arrival_stamp": 0.0, "truck_id": 0, "location": 0},   # worker 0 start
        {"route": 4, "arrival_stamp": 12.0, "truck_id": 0, "location": 4},  # job 2
        {"route": 2, "arrival_stamp": 90.0, "truck_id": 0, "location": 2},  # job 0
        {"route": 1, "arrival_stamp": 0.0, "truck_id": 1, "location": 1},   # worker 1 start
        {"route": 3, "arrival_stamp": 20.0, "truck_id": 1, "location": 3},  # job 1
    ]
    assert routes_from_rows(rows, n_workers=2, n_jobs=3) == [[2, 0], [1]]
