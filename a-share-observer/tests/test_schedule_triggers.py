"""Guard A-share daily workflow triggers against top-of-hour scheduling regressions.

GitHub Actions schedules use UTC. These checks keep Beijing local sequencing
and keep event.schedule dispatch selectors aligned with their actual cron strings.
"""
from pathlib import Path
import re

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"


def crons(name):
    content = (WORKFLOWS / name).read_text(encoding="utf-8")
    return re.findall(r"^\s*- cron: '([^']+)'", content, flags=re.MULTILINE)


def test_no_scheduled_workflow_starts_on_the_hour():
    for workflow in WORKFLOWS.glob("*.yml"):
        lines = crons(workflow.name)
        for cron in lines:
            minute, *_ = cron.split()
            assert minute.isdigit() and 0 < int(minute) < 60, (
                f"{workflow.name} has an exact-hour or unsupported cron trigger: {cron}"
            )


def test_daily_collectors_keep_beijing_order_and_weekend_modes():
    assert crons("update.yml") == [
        "7 8 * * 1-5", "49 8 * * 1-5", "49 8 * * 6"
    ]
    assert crons("representatives.yml") == ["18 8 * * 1-5"]
    assert crons("sectors.yml") == [
        "7 8 * * 0", "34 8 * * 1-5", "9 9 * * 1-5"
    ]
    assert crons("global-direct.yml") == ["23 10 * * 1-5"]
    assert crons("recover-daily.yml") == ["26 9 * * 1-5", "16 10 * * 1-5"]
    assert crons("etf-state-shares.yml") == ["15 1 * * 1-5"]
    assert crons("funds-observer.yml") == ["30 1 * * 1-5", "45 1 * * 1"]

    updates = (WORKFLOWS / "update.yml").read_text(encoding="utf-8")
    sectors = (WORKFLOWS / "sectors.yml").read_text(encoding="utf-8")
    assert "github.event.schedule == '49 8 * * 6'" in updates, (
        "Saturday refresh would incorrectly run as normal daily collection"
    )
    assert "github.event.schedule == '7 8 * * 0'" in sectors
    assert "github.event.schedule != '7 8 * * 0'" in sectors
    assert "github.event.schedule == '45 1 * * 1'" in (
        WORKFLOWS / "funds-observer.yml"
    ).read_text(encoding="utf-8")
