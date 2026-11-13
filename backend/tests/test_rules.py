from datetime import datetime
from agent.rules import add_working_days
def test_working_days_skip_weekend():
    assert add_working_days(datetime(2026, 11, 13), 1).weekday() == 0
