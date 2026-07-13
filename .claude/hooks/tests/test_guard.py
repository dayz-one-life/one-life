import sys
from pathlib import Path

HOOKS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOOKS))

import guard  # noqa: E402

CONFIG = {
    "baseBranch": "develop",
    "protectedBranches": ["develop", "main"],
    "featurePrefix": "feature/",
    "releasePrefix": "release/",
}


def ctx(**over):
    base = {
        "role": "contributor",
        "branch": "feature/x",
        "config": CONFIG,
        "superpowers": True,
        "changelog_changed": True,
        "claudemd_changed": True,
        "pr_approved": None,
        "staged_files": None,
        "pr_cross_repository": None,
    }
    base.update(over)
    return base


# --- classify ---

def test_classify_git_commit():
    assert classify_kinds('git commit -m "hi"') == ["git-commit"]


def test_classify_pr_create_base():
    actions = guard.classify("gh pr create --base develop --title x --body y")
    assert actions[0]["kind"] == "gh-pr-create"
    assert actions[0]["base"] == "develop"


def test_classify_pr_create_base_equals_form():
    actions = guard.classify("gh pr create --base=main")
    assert actions[0]["base"] == "main"


def test_classify_pr_merge_squash():
    actions = guard.classify("gh pr merge 12 --squash")
    assert actions[0]["kind"] == "gh-pr-merge"
    assert actions[0]["is_squash"] is True
    assert actions[0]["pr_number"] == "12"


def test_classify_chained_commands():
    kinds = [a["kind"] for a in guard.classify("git add -A && git commit -m x && git push")]
    assert kinds == ["git-commit", "git-push"]


def test_classify_ignores_unrelated():
    assert guard.classify("ls -la && echo hi") == []


def test_classify_git_commit_with_c_flags():
    assert classify_kinds('git -c user.email=x -c user.name=y commit -m "hi"') == ["git-commit"]


def test_classify_git_commit_with_dash_C():
    assert classify_kinds("git -C /some/dir commit -m x") == ["git-commit"]


def test_classify_git_push_with_dash_C():
    assert classify_kinds("git -C /repo push") == ["git-push"]


def classify_kinds(cmd):
    return [a["kind"] for a in guard.classify(cmd)]


def test_classify_push_tag_flagged():
    a = guard.classify("git push origin v1.2.3")[0]
    assert a["kind"] == "git-push"
    assert a["is_tag_push"] is True


def test_classify_push_tags_flag():
    a = guard.classify("git push --tags")[0]
    assert a["is_tag_push"] is True


def test_classify_push_branch_not_tag():
    a = guard.classify("git push origin main")[0]
    assert a["is_tag_push"] is False


def test_maintainer_tag_push_allowed_on_main():
    allow, _ = guard.evaluate({"kind": "git-push", "is_tag_push": True}, ctx(role="maintainer", branch="main"))
    assert allow is True


def test_maintainer_branch_push_still_blocked_on_main():
    allow, reason = guard.evaluate({"kind": "git-push", "is_tag_push": False}, ctx(role="maintainer", branch="main"))
    assert allow is False
    assert "protected" in reason


# --- evaluate: superpowers gate ---

def test_blocks_commit_without_superpowers():
    allow, reason = guard.evaluate({"kind": "git-commit"}, ctx(superpowers=False))
    assert allow is False
    assert "Superpowers" in reason


def test_uninitialized_allows_everything():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(role="uninitialized", superpowers=False, branch="main"))
    assert allow is True


# --- evaluate: contributor ---

def test_contributor_blocked_commit_on_develop():
    allow, reason = guard.evaluate({"kind": "git-commit"}, ctx(branch="develop"))
    assert allow is False
    assert "feature/" in reason


def test_contributor_allowed_commit_on_feature():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(branch="feature/x"))
    assert allow is True


def test_contributor_pr_wrong_base_blocked():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "main"}, ctx())
    assert allow is False
    assert "develop" in reason


def test_contributor_pr_missing_base_blocked():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": None}, ctx())
    assert allow is False


def test_contributor_pr_without_changelog_blocked():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx(changelog_changed=False))
    assert allow is False
    assert "CHANGELOG" in reason


def test_contributor_pr_without_claudemd_blocked():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx(claudemd_changed=False))
    assert allow is False
    assert "CLAUDE.md" in reason


def test_contributor_pr_ok():
    allow, _ = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx())
    assert allow is True


# --- evaluate: maintainer ---

def test_maintainer_blocked_feature_commit():
    allow, reason = guard.evaluate({"kind": "git-commit"}, ctx(role="maintainer", branch="feature/y"))
    assert allow is False
    assert "Fork" in reason


def test_maintainer_blocked_commit_on_main():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(role="maintainer", branch="main"))
    assert allow is False


def test_maintainer_allowed_release_commit():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(role="maintainer", branch="release/1.2.0"))
    assert allow is True


def test_maintainer_merge_must_be_squash():
    allow, reason = guard.evaluate({"kind": "gh-pr-merge", "is_squash": False, "pr_number": "5"}, ctx(role="maintainer", pr_approved=True))
    assert allow is False
    assert "squash" in reason.lower()


def test_maintainer_merge_requires_approval():
    allow, reason = guard.evaluate({"kind": "gh-pr-merge", "is_squash": True, "pr_number": "5"}, ctx(role="maintainer", pr_approved=False))
    assert allow is False
    assert "approv" in reason.lower()


def test_maintainer_merge_ok_when_squash_and_approved():
    allow, _ = guard.evaluate({"kind": "gh-pr-merge", "is_squash": True, "pr_number": "5"}, ctx(role="maintainer", pr_approved=True))
    assert allow is True


def test_classify_push_branch_and_tag_not_exempt():
    a = guard.classify("git push origin main v1.0.0")[0]
    assert a["is_tag_push"] is False


def test_classify_push_refspec_to_branch_not_tag():
    a = guard.classify("git push origin 2.0:main")[0]
    assert a["is_tag_push"] is False


def test_classify_push_refs_tags_is_tag():
    a = guard.classify("git push origin refs/tags/v1.2.3")[0]
    assert a["is_tag_push"] is True


def test_setup_commit_workflow_json_only_allowed_on_main():
    allow, _ = guard.evaluate(
        {"kind": "git-commit"},
        ctx(role="maintainer", branch="main", staged_files=[".claude/workflow.json"]),
    )
    assert allow is True


def test_commit_with_extra_file_still_blocked_on_main():
    allow, reason = guard.evaluate(
        {"kind": "git-commit"},
        ctx(role="maintainer", branch="main", staged_files=[".claude/workflow.json", "README.md"]),
    )
    assert allow is False


def test_same_repo_pr_merge_allowed_without_approval():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": False},
        ctx(role="maintainer", pr_cross_repository=False, pr_approved=False),
    )
    assert allow is True


def test_fork_pr_merge_requires_approval():
    allow, reason = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="maintainer", pr_cross_repository=True, pr_approved=False),
    )
    assert allow is False
    assert "approv" in reason.lower()


def test_fork_pr_merge_ok_when_squash_and_approved():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="maintainer", pr_cross_repository=True, pr_approved=True),
    )
    assert allow is True


def test_unknown_cross_repo_defaults_to_contribution_gate():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="maintainer", pr_cross_repository=None, pr_approved=False),
    )
    assert allow is False


# --- evaluate: solo ---

def test_solo_blocked_commit_on_develop():
    allow, reason = guard.evaluate({"kind": "git-commit"}, ctx(role="solo", branch="develop"))
    assert allow is False
    assert "protected" in reason


def test_solo_blocked_commit_on_main():
    allow, reason = guard.evaluate({"kind": "git-commit"}, ctx(role="solo", branch="main"))
    assert allow is False


def test_solo_allowed_commit_on_feature():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(role="solo", branch="feature/x"))
    assert allow is True


def test_solo_allowed_commit_on_release():
    allow, _ = guard.evaluate({"kind": "git-commit"}, ctx(role="solo", branch="release/1.2.0"))
    assert allow is True


def test_solo_pr_create_into_main_allowed():
    allow, _ = guard.evaluate({"kind": "gh-pr-create", "base": "main"}, ctx(role="solo"))
    assert allow is True


def test_solo_pr_create_into_develop_ok():
    allow, _ = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx(role="solo"))
    assert allow is True


def test_solo_pr_create_into_develop_needs_changelog():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx(role="solo", changelog_changed=False))
    assert allow is False
    assert "CHANGELOG" in reason


def test_solo_pr_create_into_develop_needs_claudemd():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "develop"}, ctx(role="solo", claudemd_changed=False))
    assert allow is False
    assert "CLAUDE.md" in reason


def test_solo_pr_create_bad_base_blocked():
    allow, reason = guard.evaluate({"kind": "gh-pr-create", "base": "random"}, ctx(role="solo"))
    assert allow is False


def test_solo_backmerge_pr_create_allowed_without_changelog():
    # main -> develop back-merge must NOT require CHANGELOG/CLAUDE changes
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-create", "base": "develop", "head": "main"},
        ctx(role="solo", changelog_changed=False, claudemd_changed=False),
    )
    assert allow is True


def test_solo_contribution_pr_create_still_gated():
    # feature -> develop still requires the changelog/claudemd gate
    allow, reason = guard.evaluate(
        {"kind": "gh-pr-create", "base": "develop", "head": "feature/x"},
        ctx(role="solo", changelog_changed=False),
    )
    assert allow is False
    assert "CHANGELOG" in reason


def test_classify_pr_create_captures_head():
    a = guard.classify("gh pr create --base develop --head main")[0]
    assert a["base"] == "develop"
    assert a.get("head") == "main"


def test_solo_release_pr_merge_into_main_allowed():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": False},
        ctx(role="solo", pr_base="main", pr_head="release/1.2.0"),
    )
    assert allow is True


def test_solo_back_merge_main_into_develop_allowed():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": False},
        ctx(role="solo", pr_base="develop", pr_head="main"),
    )
    assert allow is True


def test_solo_contribution_merge_needs_squash():
    allow, reason = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": False},
        ctx(role="solo", pr_base="develop", pr_head="feature/x", pr_reviewed=True),
    )
    assert allow is False
    assert "squash" in reason.lower()


def test_solo_contribution_merge_needs_review():
    allow, reason = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="solo", pr_base="develop", pr_head="feature/x", pr_reviewed=False),
    )
    assert allow is False
    assert "review" in reason.lower()


def test_solo_contribution_merge_ok_when_squash_and_reviewed():
    allow, _ = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="solo", pr_base="develop", pr_head="feature/x", pr_reviewed=True),
    )
    assert allow is True


def test_solo_merge_fails_closed_when_base_unknown():
    allow, reason = guard.evaluate(
        {"kind": "gh-pr-merge", "is_squash": True},
        ctx(role="solo", pr_base=None, pr_head=None, pr_reviewed=True),
    )
    assert allow is False
    assert "base" in reason.lower()


import json
import os
import subprocess


def _run_guard(command, cwd):
    event = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    return subprocess.run(
        ["python3", str(HOOKS / "guard.py")],
        input=event,
        capture_output=True,
        text=True,
        cwd=cwd,
    )


def _init_initialized_repo(path):
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "t@t.dev"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "T"], check=True)
    subprocess.run(["git", "-C", str(path), "remote", "add", "origin", "git@github.com:dbd-net/app.git"], check=True)
    claude = path / ".claude"
    claude.mkdir()
    (claude / "workflow.json").write_text(json.dumps({
        "canonicalRepo": "dbd-net/app", "baseBranch": "develop",
        "protectedBranches": ["develop", "main"], "featurePrefix": "feature/", "releasePrefix": "release/",
    }))
    (path / "CHANGELOG.md").write_text("x\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    subprocess.run(["git", "-C", str(path), "branch", "-M", "main"], check=True)


def test_main_passthrough_non_bash(tmp_path):
    r = subprocess.run(["python3", str(HOOKS / "guard.py")],
                       input=json.dumps({"tool_name": "Read", "tool_input": {}}),
                       capture_output=True, text=True, cwd=str(tmp_path))
    assert r.returncode == 0


def test_main_blocks_maintainer_commit_on_main(tmp_path):
    env = dict(os.environ, HOME=str(tmp_path))  # no superpowers under fake HOME, but main branch blocks first
    _init_initialized_repo(tmp_path)
    # ensure superpowers present so we reach the branch rule
    sp = tmp_path / ".claude" / "plugins" / "mkt" / "superpowers" / "skills" / "s"
    sp.mkdir(parents=True)
    (sp / "SKILL.md").write_text("x")
    r = subprocess.run(["python3", str(HOOKS / "guard.py")],
                       input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}),
                       capture_output=True, text=True, cwd=str(tmp_path), env=env)
    assert r.returncode == 2
    assert "protected" in r.stderr


def test_main_allows_unrelated_command(tmp_path):
    _init_initialized_repo(tmp_path)
    r = _run_guard("ls -la", str(tmp_path))
    assert r.returncode == 0


def test_main_blocks_unapproved_squash_merge(tmp_path):
    _init_initialized_repo(tmp_path)
    sp = tmp_path / ".claude" / "plugins" / "mkt" / "superpowers" / "skills" / "s"
    sp.mkdir(parents=True)
    (sp / "SKILL.md").write_text("x")
    env = dict(os.environ, HOME=str(tmp_path))
    r = subprocess.run(
        ["python3", str(HOOKS / "guard.py")],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "gh pr merge 5 --squash"}}),
        capture_output=True, text=True, cwd=str(tmp_path), env=env,
    )
    assert r.returncode == 2
    assert "approv" in r.stderr.lower()


def test_main_fail_open_outside_git_repo(tmp_path):
    r = subprocess.run(
        ["python3", str(HOOKS / "guard.py")],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}),
        capture_output=True, text=True, cwd=str(tmp_path),
    )
    assert r.returncode == 0


def _init_solo_repo(path):
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "t@t.dev"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "T"], check=True)
    subprocess.run(["git", "-C", str(path), "remote", "add", "origin", "git@github.com:dbd-net/app.git"], check=True)
    claude = path / ".claude"
    claude.mkdir()
    (claude / "workflow.json").write_text(json.dumps({
        "canonicalRepo": "dbd-net/app", "baseBranch": "develop", "productionBranch": "main",
        "protectedBranches": ["develop", "main"], "featurePrefix": "feature/", "releasePrefix": "release/",
        "soloMaintainer": True,
    }))
    (path / "CHANGELOG.md").write_text("x\n")
    subprocess.run(["git", "-C", str(path), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "-qm", "init"], check=True)
    subprocess.run(["git", "-C", str(path), "branch", "-M", "main"], check=True)
    subprocess.run(["git", "-C", str(path), "checkout", "-q", "-b", "feature/x"], check=True)
    sp = path / ".claude" / "plugins" / "mkt" / "superpowers" / "skills" / "s"
    sp.mkdir(parents=True)
    (sp / "SKILL.md").write_text("x")


def test_solo_flag_allows_feature_commit_from_canonical_clone(tmp_path):
    _init_solo_repo(tmp_path)
    env = dict(os.environ, HOME=str(tmp_path))
    r = subprocess.run(
        ["python3", str(HOOKS / "guard.py")],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}),
        capture_output=True, text=True, cwd=str(tmp_path), env=env,
    )
    assert r.returncode == 0
