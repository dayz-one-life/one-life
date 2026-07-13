import json
import subprocess
import sys
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS))

import workflow_lib as wl  # noqa: E402


def test_slug_from_ssh_url():
    assert wl.slug_from_url("git@github.com:dbd-net/project-template.git") == "dbd-net/project-template"


def test_slug_from_https_url_with_git_suffix():
    assert wl.slug_from_url("https://github.com/dbd-net/project-template.git") == "dbd-net/project-template"


def test_slug_from_https_url_no_suffix():
    assert wl.slug_from_url("https://github.com/owner/repo") == "owner/repo"


def test_slug_from_none():
    assert wl.slug_from_url(None) is None


def test_detect_role_uninitialized_when_canonical_blank():
    assert wl.detect_role("owner/repo", "") == "uninitialized"


def test_detect_role_maintainer_when_origin_matches_canonical():
    assert wl.detect_role("dbd-net/app", "dbd-net/app") == "maintainer"


def test_detect_role_contributor_when_origin_differs():
    assert wl.detect_role("alice/app", "dbd-net/app") == "contributor"


def test_load_config_reads_json(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    (claude / "workflow.json").write_text(json.dumps({"baseBranch": "develop"}))
    assert wl.load_config(str(tmp_path))["baseBranch"] == "develop"


def test_load_config_missing_returns_empty(tmp_path):
    assert wl.load_config(str(tmp_path)) == {}


def _init_repo(path):
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "t@t.dev"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "T"], check=True)


def test_current_branch_and_changed_files(tmp_path):
    _init_repo(tmp_path)
    (tmp_path / "CHANGELOG.md").write_text("base\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qm", "base"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "branch", "develop"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "checkout", "-q", "-b", "feature/x"], check=True)
    (tmp_path / "CHANGELOG.md").write_text("changed\n")
    subprocess.run(["git", "-C", str(tmp_path), "commit", "-qam", "edit"], check=True)
    assert wl.current_branch(cwd=str(tmp_path)) == "feature/x"
    assert "CHANGELOG.md" in wl.changed_files("develop", cwd=str(tmp_path))


def test_superpowers_present_detects_glob(tmp_path):
    skill = tmp_path / "plugins" / "cache" / "mkt" / "superpowers" / "1.0" / "skills" / "s"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("x")
    assert wl.superpowers_present(plugins_dir=str(tmp_path / "plugins")) is True


def test_superpowers_absent(tmp_path):
    (tmp_path / "plugins").mkdir()
    assert wl.superpowers_present(plugins_dir=str(tmp_path / "plugins")) is False


def test_staged_files_lists_staged(tmp_path):
    _init_repo(tmp_path)
    (tmp_path / "a.txt").write_text("x\n")
    subprocess.run(["git", "-C", str(tmp_path), "add", "a.txt"], check=True)
    assert wl.staged_files(cwd=str(tmp_path)) == ["a.txt"]


def test_detect_role_solo_when_flag_set():
    assert wl.detect_role("alice/app", "dbd-net/app", solo=True) == "solo"


def test_detect_role_solo_overrides_maintainer_match():
    assert wl.detect_role("dbd-net/app", "dbd-net/app", solo=True) == "solo"


def test_detect_role_solo_still_uninitialized_without_canonical():
    assert wl.detect_role("dbd-net/app", "", solo=True) == "uninitialized"


def test_detect_role_defaults_solo_false():
    assert wl.detect_role("dbd-net/app", "dbd-net/app") == "maintainer"
