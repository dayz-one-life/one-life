import json
import subprocess
import sys
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS))

import session_start as ss  # noqa: E402

CFG = {"canonicalRepo": "dbd-net/app", "baseBranch": "develop"}


def test_orientation_uninitialized_mentions_setup():
    text = ss.build_orientation("uninitialized", True, {"canonicalRepo": ""})
    assert "workflow-setup" in text


def test_orientation_contributor_lists_start_and_finish():
    text = ss.build_orientation("contributor", True, CFG)
    assert "starting-work" in text
    assert "finishing-a-feature" in text
    assert "Contributor" in text


def test_orientation_maintainer_lists_review_and_release():
    text = ss.build_orientation("maintainer", True, CFG)
    assert "reviewing-a-contribution" in text
    assert "drafting-a-release" in text
    assert "Maintainer" in text


def test_orientation_warns_when_superpowers_missing():
    text = ss.build_orientation("contributor", False, CFG)
    assert "Superpowers" in text


def test_main_emits_additional_context(tmp_path):
    (tmp_path / ".git").mkdir()  # repo_root will still fail w/o real git; main must not crash
    r = subprocess.run(["python3", str(HOOKS / "session_start.py")],
                       input=json.dumps({"hook_event_name": "SessionStart"}),
                       capture_output=True, text=True, cwd=str(tmp_path))
    assert r.returncode == 0
    if r.stdout.strip():
        payload = json.loads(r.stdout)
        assert payload["hookSpecificOutput"]["hookEventName"] == "SessionStart"
