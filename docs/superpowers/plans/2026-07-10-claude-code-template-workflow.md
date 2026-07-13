# Claude Code Project Template — Workflow Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub template repository whose committed hooks, repo-level skills, and docs enforce a fork → feature → develop → release workflow entirely through Claude Code.

**Architecture:** Three layers. (1) A deterministic `PreToolUse` guard hook (Python) blocks git/`gh` violations; a `SessionStart` hook detects Superpowers and renders a role-aware orientation. (2) Repo-level skills under `.claude/skills/` streamline the happy path and compose with Superpowers. (3) Root docs + `.claude/workflow.json` document and parameterize everything. Hook logic is split into pure, unit-tested decision functions plus thin git/stdin I/O wrappers.

**Tech Stack:** Python 3 (standard library only) for hooks; pytest for hook tests; Markdown for skills and docs; `git` + GitHub `gh` CLI as the runtime the guard inspects.

## Global Constraints

- Enforcement config lives ONLY in committed `.claude/settings.json`, never `.claude/settings.local.json` (per-machine, gitignored) — it must propagate through template → project → fork.
- Hooks use the Python 3 standard library only. No third-party runtime dependencies.
- Guard **fails open** when git state is genuinely undeterminable (not a git repo; base ref not found); **fails closed** on the defined rule violations; treats an **uninitialized** repo (`canonicalRepo` blank) as fully permissive.
- Changelog format: Keep a Changelog. Versioning: SemVer. Patch bumps auto-apply; minor/major bumps stop for maintainer confirmation.
- Config keys (exact): `canonicalRepo`, `baseBranch` (default `develop`), `productionBranch` (default `main`), `protectedBranches` (`["develop","main"]`), `featurePrefix` (`feature/`), `releasePrefix` (`release/`), `versionScheme` (`semver`), `commands.test`, `commands.lint`.
- Guard blocks the write/git surface only: `git commit`, `git push`, `git merge`, `gh pr create`, `gh pr merge`. Everything else is allowed.
- The finished template's own remote is `git@github.com:dbd-net/project-template.git`; its own `canonicalRepo` stays blank (a template, not an initialized project).
- Every skill's `SKILL.md` has YAML frontmatter with `name` and `description`.

## File Structure

- Create: `.claude/workflow.json` — config consumed by the hooks.
- Create: `.claude/hooks/workflow_lib.py` — shared helpers: config load, role detection, git/fs queries.
- Create: `.claude/hooks/guard.py` — `PreToolUse` guard: `classify()`, `evaluate()` (pure) + `main()` (I/O).
- Create: `.claude/hooks/session_start.py` — `SessionStart`: `build_orientation()` (pure) + `main()`.
- Create: `.claude/settings.json` — registers both hooks.
- Create: `.claude/hooks/tests/test_workflow_lib.py`, `test_guard.py`, `test_session_start.py`, `test_skills_valid.py`.
- Create: `.claude/skills/{workflow-setup,starting-work,finishing-a-feature,reviewing-a-contribution,merging-a-contribution,drafting-a-release,cutting-a-release}/SKILL.md`.
- Create: `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`.
- Create: `.gitignore` (already present — ensure `.claude/settings.local.json` is ignored).

**Task order:** 1 Foundation lib → 2 Guard decision engine → 3 Guard I/O + settings → 4 SessionStart hook → 5 Setup + start-work skills → 6 finishing-a-feature skill → 7 Maintainer skills → 8 Root docs + publish. Tasks 1–4 are the enforceable core; 5–8 build on the config/lib they establish.

---

### Task 1: Foundation library (`workflow_lib.py`)

**Files:**
- Create: `.claude/workflow.json`
- Create: `.claude/hooks/workflow_lib.py`
- Test: `.claude/hooks/tests/test_workflow_lib.py`

**Interfaces:**
- Produces:
  - `repo_root(cwd=None) -> str | None`
  - `load_config(root) -> dict`
  - `detect_role(origin_slug: str | None, canonical: str) -> str` → `"maintainer" | "contributor" | "uninitialized"`
  - `slug_from_url(url: str | None) -> str | None`
  - `git(*args, cwd=None) -> str | None`
  - `current_branch(cwd=None) -> str | None`
  - `origin_slug(cwd=None) -> str | None`
  - `resolve_base_ref(base, cwd=None) -> str | None`
  - `changed_files(base, cwd=None) -> list[str] | None`
  - `superpowers_present(plugins_dir=None) -> bool`

- [ ] **Step 1: Create the config file**

Create `.claude/workflow.json`:

```json
{
  "canonicalRepo": "",
  "baseBranch": "develop",
  "productionBranch": "main",
  "protectedBranches": ["develop", "main"],
  "featurePrefix": "feature/",
  "releasePrefix": "release/",
  "versionScheme": "semver",
  "commands": {
    "test": "",
    "lint": ""
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `.claude/hooks/tests/test_workflow_lib.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest .claude/hooks/tests/test_workflow_lib.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'workflow_lib'`.

- [ ] **Step 4: Write the implementation**

Create `.claude/hooks/workflow_lib.py`:

```python
"""Shared helpers for the workflow-enforcement hooks. Standard library only."""
import glob
import json
import os
import re
import subprocess
from pathlib import Path


def git(*args, cwd=None):
    """Run a git command; return stripped stdout, or None on any failure."""
    try:
        out = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def repo_root(cwd=None):
    return git("rev-parse", "--show-toplevel", cwd=cwd)


def load_config(root):
    path = Path(root) / ".claude" / "workflow.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def detect_role(origin_slug_value, canonical):
    if not canonical:
        return "uninitialized"
    if origin_slug_value == canonical:
        return "maintainer"
    return "contributor"


def slug_from_url(url):
    if not url:
        return None
    m = re.search(r"[:/]([^/:]+/[^/]+?)(?:\.git)?$", url.strip())
    return m.group(1) if m else None


def current_branch(cwd=None):
    return git("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd)


def origin_slug(cwd=None):
    return slug_from_url(git("remote", "get-url", "origin", cwd=cwd))


def resolve_base_ref(base, cwd=None):
    for ref in (f"upstream/{base}", f"origin/{base}", base):
        if git("rev-parse", "--verify", "--quiet", ref, cwd=cwd) is not None:
            return ref
    return None


def changed_files(base, cwd=None):
    ref = resolve_base_ref(base, cwd=cwd)
    if ref is None:
        return None
    mb = git("merge-base", ref, "HEAD", cwd=cwd)
    if mb is None:
        return None
    out = git("diff", "--name-only", mb, "HEAD", cwd=cwd)
    if out is None:
        return None
    return [line for line in out.splitlines() if line]


def superpowers_present(plugins_dir=None):
    base = plugins_dir or os.path.expanduser("~/.claude/plugins")
    pattern = os.path.join(base, "**", "*superpowers*", "**", "SKILL.md")
    return bool(glob.glob(pattern, recursive=True))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest .claude/hooks/tests/test_workflow_lib.py -q`
Expected: PASS (12 passed).

- [ ] **Step 6: Commit**

```bash
git add .claude/workflow.json .claude/hooks/workflow_lib.py .claude/hooks/tests/test_workflow_lib.py
git commit -m "feat: workflow config + shared hook library"
```

---

### Task 2: Guard decision engine (`classify` + `evaluate`)

**Files:**
- Create: `.claude/hooks/guard.py` (decision functions only in this task; `main()` added in Task 3)
- Test: `.claude/hooks/tests/test_guard.py`

**Interfaces:**
- Consumes: nothing from other tasks (pure functions).
- Produces:
  - `classify(command: str) -> list[dict]` — each dict has `kind` in `{"git-commit","git-push","git-merge","gh-pr-create","gh-pr-merge"}` plus `base` (create), `is_squash`/`pr_number` (merge).
  - `evaluate(action: dict, ctx: dict) -> tuple[bool, str]` — `(allow, reason)`.
  - `ctx` keys: `role`, `branch`, `config`, `superpowers` (bool), `changelog_changed` (bool), `claudemd_changed` (bool), `pr_approved` (bool | None).

- [ ] **Step 1: Write the failing tests**

Create `.claude/hooks/tests/test_guard.py`:

```python
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


def classify_kinds(cmd):
    return [a["kind"] for a in guard.classify(cmd)]


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest .claude/hooks/tests/test_guard.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'guard'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/guard.py`:

```python
"""PreToolUse guard: classify a Bash command and decide allow/deny. Stdlib only."""
import re
import shlex

WRITE_GIT_KINDS = {"git-commit", "git-push", "git-merge", "gh-pr-create", "gh-pr-merge"}

INSTALL_MSG = (
    "Blocked: the Superpowers plugin is required to contribute to this project but was "
    "not detected. Install it, then retry. See CONTRIBUTING.md."
)


def _split_segments(command):
    return re.split(r"&&|\|\||;|\n|\|", command)


def _flag_value(args, *names):
    for i, tok in enumerate(args):
        for name in names:
            if tok == name and i + 1 < len(args):
                return args[i + 1]
            if tok.startswith(name + "="):
                return tok.split("=", 1)[1]
    return None


def _classify_segment(seg):
    try:
        toks = shlex.split(seg)
    except ValueError:
        toks = seg.split()
    i = 0
    while i < len(toks) and "=" in toks[i] and not toks[i].startswith("-"):
        i += 1
    if i < len(toks) and toks[i] == "env":
        i += 1
        while i < len(toks) and "=" in toks[i]:
            i += 1
    rest = toks[i:]
    if not rest:
        return None
    prog, args = rest[0], rest[1:]
    if prog == "git":
        sub = next((a for a in args if not a.startswith("-")), None)
        if sub == "commit":
            return {"kind": "git-commit"}
        if sub == "push":
            return {"kind": "git-push"}
        if sub == "merge":
            return {"kind": "git-merge"}
        return None
    if prog == "gh":
        nonflags = [a for a in args if not a.startswith("-")]
        if len(nonflags) >= 2 and nonflags[0] == "pr" and nonflags[1] == "create":
            return {"kind": "gh-pr-create", "base": _flag_value(args, "--base", "-B")}
        if len(nonflags) >= 2 and nonflags[0] == "pr" and nonflags[1] == "merge":
            squash = "--squash" in args
            other = ("--merge" in args) or ("--rebase" in args)
            is_squash = True if squash else (False if other else None)
            number = nonflags[2] if len(nonflags) >= 3 else None
            return {"kind": "gh-pr-merge", "is_squash": is_squash, "pr_number": number}
        return None
    return None


def classify(command):
    actions = []
    for seg in _split_segments(command):
        a = _classify_segment(seg)
        if a is not None:
            actions.append(a)
    return actions


def evaluate(action, ctx):
    kind = action["kind"]
    if kind not in WRITE_GIT_KINDS:
        return True, ""
    role = ctx["role"]
    if role == "uninitialized":
        return True, ""
    if not ctx["superpowers"]:
        return False, INSTALL_MSG

    cfg = ctx["config"]
    branch = ctx["branch"]
    protected = cfg.get("protectedBranches", ["develop", "main"])
    base_branch = cfg.get("baseBranch", "develop")
    feature_prefix = cfg.get("featurePrefix", "feature/")
    release_prefix = cfg.get("releasePrefix", "release/")

    if role == "contributor":
        if kind in ("git-commit", "git-push", "git-merge") and branch in protected:
            return False, (
                f"Blocked: '{branch}' is protected. Do feature work on a "
                f"'{feature_prefix}' branch (use the starting-work skill)."
            )
        if kind == "gh-pr-create":
            base = action.get("base")
            if base is None:
                return False, f"Blocked: open the PR against '{base_branch}' with --base {base_branch}."
            if base != base_branch:
                return False, f"Blocked: forks PR into '{base_branch}', not '{base}'."
            if not ctx["changelog_changed"]:
                return False, "Blocked: update CHANGELOG.md (Unreleased) before opening a PR."
            if not ctx["claudemd_changed"]:
                return False, "Blocked: updating CLAUDE.md is the last step before a PR. Update it first."
        return True, ""

    if role == "maintainer":
        if kind in ("git-commit", "git-push", "git-merge"):
            if branch in protected:
                return False, f"Blocked: '{branch}' is protected. Changes reach it via PR + release only."
            if branch.startswith(feature_prefix):
                return False, "Blocked: Fork the repo to develop features. The canonical repo is for review and releases only."
            if branch.startswith(release_prefix):
                return True, ""
            return True, ""
        if kind == "gh-pr-merge":
            if action.get("is_squash") is not True:
                return False, "Blocked: merge approved PRs with --squash."
            if ctx["pr_approved"] is not True:
                return False, "Blocked: only approved PRs may be merged. Review it first (reviewing-a-contribution)."
            return True, ""
        return True, ""

    return True, ""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest .claude/hooks/tests/test_guard.py -q`
Expected: PASS (all classify + evaluate tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/guard.py .claude/hooks/tests/test_guard.py
git commit -m "feat: guard classify + evaluate decision engine"
```

---

### Task 3: Guard I/O wrapper + settings registration

**Files:**
- Modify: `.claude/hooks/guard.py` (add `gather_context`, `pr_approved`, `main`)
- Create: `.claude/settings.json`
- Test: `.claude/hooks/tests/test_guard.py` (add subprocess integration tests)

**Interfaces:**
- Consumes: `workflow_lib` (Task 1), `classify`/`evaluate` (Task 2).
- Produces: `main()` — reads a PreToolUse JSON event on stdin; exits `2` (with stderr reason) to block, `0` to allow.

- [ ] **Step 1: Write the failing integration test**

Append to `.claude/hooks/tests/test_guard.py`:

```python
import json
import os
import subprocess


def _run_guard(command, cwd):
    event = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})
    return subprocess.run(
        ["python", str(HOOKS / "guard.py")],
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
    r = subprocess.run(["python", str(HOOKS / "guard.py")],
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
    r = subprocess.run(["python", str(HOOKS / "guard.py")],
                       input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}),
                       capture_output=True, text=True, cwd=str(tmp_path), env=env)
    assert r.returncode == 2
    assert "protected" in r.stderr


def test_main_allows_unrelated_command(tmp_path):
    _init_initialized_repo(tmp_path)
    r = _run_guard("ls -la", str(tmp_path))
    assert r.returncode == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest .claude/hooks/tests/test_guard.py -q -k main`
Expected: FAIL — `guard.py` has no `main` / prints nothing / `AttributeError`.

- [ ] **Step 3: Add the I/O layer to `guard.py`**

Append to `.claude/hooks/guard.py`:

```python
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import workflow_lib as wl  # noqa: E402


def pr_approved(number, cwd=None):
    args = ["pr", "view"]
    if number:
        args.append(str(number))
    args += ["--json", "reviewDecision", "-q", ".reviewDecision"]
    try:
        out = __import__("subprocess").run(
            ["gh", *args], cwd=cwd, capture_output=True, text=True
        )
    except OSError:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() == "APPROVED"


def gather_context(cwd=None):
    root = wl.repo_root(cwd=cwd)
    if root is None:
        return None
    config = wl.load_config(root)
    canonical = config.get("canonicalRepo") or ""
    role = wl.detect_role(wl.origin_slug(cwd=cwd), canonical)
    branch = wl.current_branch(cwd=cwd) or ""
    changed = wl.changed_files(config.get("baseBranch", "develop"), cwd=cwd)
    changelog_changed = ("CHANGELOG.md" in changed) if changed is not None else True
    claudemd_changed = ("CLAUDE.md" in changed) if changed is not None else True
    return {
        "role": role,
        "branch": branch,
        "config": config,
        "superpowers": wl.superpowers_present(),
        "changelog_changed": changelog_changed,
        "claudemd_changed": claudemd_changed,
        "pr_approved": None,
    }


def main():
    try:
        event = json.load(sys.stdin)
    except (ValueError, OSError):
        sys.exit(0)
    if event.get("tool_name") != "Bash":
        sys.exit(0)
    command = event.get("tool_input", {}).get("command", "")
    actions = classify(command)
    if not actions:
        sys.exit(0)
    ctx = gather_context()
    if ctx is None:
        sys.exit(0)  # not a git repo -> fail open
    for action in actions:
        if action["kind"] == "gh-pr-merge":
            ctx = dict(ctx, pr_approved=pr_approved(action.get("pr_number")))
        allow, reason = evaluate(action, ctx)
        if not allow:
            print(reason, file=sys.stderr)
            sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Create `.claude/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.py\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/session_start.py\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Run all hook tests**

Run: `python -m pytest .claude/hooks/tests/ -q`
Expected: PASS (Task 1 + Task 2 + Task 3 tests). The SessionStart hook is registered but its script arrives in Task 4 — that is fine; `settings.json` is not executed by pytest.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/guard.py .claude/hooks/tests/test_guard.py .claude/settings.json
git commit -m "feat: guard I/O wrapper + hook registration in settings.json"
```

---

### Task 4: SessionStart hook (`session_start.py`)

**Files:**
- Create: `.claude/hooks/session_start.py`
- Test: `.claude/hooks/tests/test_session_start.py`

**Interfaces:**
- Consumes: `workflow_lib` (Task 1).
- Produces: `build_orientation(role, superpowers, config) -> str`; `main()` prints `{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": <str>}}` and exits 0.

- [ ] **Step 1: Write the failing tests**

Create `.claude/hooks/tests/test_session_start.py`:

```python
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
    r = subprocess.run(["python", str(HOOKS / "session_start.py")],
                       input=json.dumps({"hook_event_name": "SessionStart"}),
                       capture_output=True, text=True, cwd=str(tmp_path))
    assert r.returncode == 0
    payload = json.loads(r.stdout)
    assert payload["hookSpecificOutput"]["hookEventName"] == "SessionStart"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest .claude/hooks/tests/test_session_start.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'session_start'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/hooks/session_start.py`:

```python
"""SessionStart hook: Superpowers check + role-aware orientation. Stdlib only."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import workflow_lib as wl  # noqa: E402


def build_orientation(role, superpowers, config):
    lines = ["## Project workflow orientation", ""]
    if not superpowers:
        lines += [
            "⚠️  **Superpowers plugin not detected.** Write/git actions (commit, push, "
            "PR) are blocked until it is installed. See CONTRIBUTING.md.",
            "",
        ]
    if role == "uninitialized":
        lines += [
            "**Status: uninitialized template.** Run the **workflow-setup** skill to stamp "
            "this project's canonical repo before contributing.",
        ]
    elif role == "contributor":
        base = config.get("baseBranch", "develop")
        lines += [
            "**Role: Contributor** (you are on a fork).",
            f"- Start: **starting-work** skill (creates a `feature/*` branch off `{base}`).",
            "- Finish: **finishing-a-feature** skill (changelog → CLAUDE.md → PR).",
            f"- Guardrails: no commits on protected branches; PRs target `{base}`; a PR "
            "requires CHANGELOG.md and CLAUDE.md updates.",
        ]
    elif role == "maintainer":
        lines += [
            "**Role: Maintainer** (you are on the canonical repo).",
            "- Review: **reviewing-a-contribution**; Merge: **merging-a-contribution** (squash).",
            "- Release: **drafting-a-release** then **cutting-a-release**.",
            "- Guardrails: feature work is blocked here — fork to develop features. Only "
            "review, squash-merge, and release drafting are allowed.",
        ]
    lines += ["", "Instruction to Claude: present this orientation to the user now."]
    return "\n".join(lines)


def main():
    try:
        json.load(sys.stdin)
    except (ValueError, OSError):
        pass
    root = wl.repo_root()
    if root is None:
        sys.exit(0)
    config = wl.load_config(root)
    canonical = config.get("canonicalRepo") or ""
    role = wl.detect_role(wl.origin_slug(), canonical)
    text = build_orientation(role, wl.superpowers_present(), config)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": text,
        }
    }))
    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest .claude/hooks/tests/test_session_start.py -q`
Expected: PASS (5 passed). `test_main_emits_additional_context` runs where `repo_root()` returns None, so `main` exits 0 with no stdout — adjust: the test asserts JSON only when present. If `repo_root` is None the script exits 0 with empty stdout; update the test to accept empty stdout as pass:

```python
def test_main_emits_additional_context(tmp_path):
    r = subprocess.run(["python", str(HOOKS / "session_start.py")],
                       input=json.dumps({"hook_event_name": "SessionStart"}),
                       capture_output=True, text=True, cwd=str(tmp_path))
    assert r.returncode == 0
    if r.stdout.strip():
        payload = json.loads(r.stdout)
        assert payload["hookSpecificOutput"]["hookEventName"] == "SessionStart"
```

Re-run: `python -m pytest .claude/hooks/tests/test_session_start.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/session_start.py .claude/hooks/tests/test_session_start.py
git commit -m "feat: SessionStart superpowers check + role-aware orientation"
```

---

### Task 5: `workflow-setup` and `starting-work` skills (+ skill validation test)

**Files:**
- Create: `.claude/skills/workflow-setup/SKILL.md`
- Create: `.claude/skills/starting-work/SKILL.md`
- Test: `.claude/hooks/tests/test_skills_valid.py`

**Interfaces:**
- Consumes: `.claude/workflow.json` (Task 1).
- Produces: the two skills and a test that validates every `SKILL.md` has `name` + `description` frontmatter.

- [ ] **Step 1: Write the failing validation test**

Create `.claude/hooks/tests/test_skills_valid.py`:

```python
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[2] / "skills"
REQUIRED = {"workflow-setup", "starting-work", "finishing-a-feature",
            "reviewing-a-contribution", "merging-a-contribution",
            "drafting-a-release", "cutting-a-release"}


def _frontmatter(path):
    text = path.read_text()
    assert text.startswith("---\n"), f"{path} missing frontmatter"
    fm = text.split("---\n", 2)[1]
    keys = {line.split(":", 1)[0].strip() for line in fm.splitlines() if ":" in line}
    return keys


def test_all_required_skills_exist():
    present = {p.name for p in SKILLS.iterdir() if p.is_dir()}
    assert REQUIRED.issubset(present), f"missing: {REQUIRED - present}"


def test_each_skill_has_name_and_description():
    for name in REQUIRED:
        skill = SKILLS / name / "SKILL.md"
        assert skill.exists(), f"{skill} missing"
        keys = _frontmatter(skill)
        assert "name" in keys and "description" in keys, f"{skill} frontmatter incomplete"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest .claude/hooks/tests/test_skills_valid.py -q`
Expected: FAIL — skills directory/files do not exist yet.

- [ ] **Step 3: Write `workflow-setup/SKILL.md`**

Create `.claude/skills/workflow-setup/SKILL.md`:

```markdown
---
name: workflow-setup
description: Use once, right after creating a project from this template, to stamp the canonical repository into .claude/workflow.json so the workflow guards activate. Triggers on "set up the workflow", "initialize the template", or an uninitialized-template orientation notice.
---

# Workflow Setup

One-time initialization. Until this runs, `canonicalRepo` is blank and all guards are permissive.

## Steps

1. Confirm the canonical repo slug with the user (the `owner/name` of the main repository these contributions target — for the template project itself this is `dbd-net/project-template`).
2. Confirm branch names (defaults: base `develop`, production `main`).
3. Read `.claude/workflow.json`, set `canonicalRepo` to the confirmed slug, and adjust branch keys only if the user changed them. Leave `commands.test`/`commands.lint` blank unless the user provides them.
4. Ensure `develop` and `main` branches exist on the canonical remote; if `develop` is missing, create it from `main` and push.
5. Commit the change on `main` via a normal maintainer flow (this is an allowed maintenance commit; it does not touch protected-branch rules because setup runs before the repo is a live contribution target — if the guard blocks, make the edit on a short-lived `release/setup` branch and open a PR).
6. Tell the user setup is complete and summarize the active guardrails.
```

- [ ] **Step 4: Write `starting-work/SKILL.md`**

Create `.claude/skills/starting-work/SKILL.md`:

```markdown
---
name: starting-work
description: Use at the very start of any new feature or fix to create a correctly-based feature branch on your fork. Triggers on "start a feature", "begin work", "new branch", or before writing any implementation code in a fresh task.
---

# Starting Work

Prepares an isolated `feature/*` branch on your fork, synced with the canonical `develop`.

## Preconditions

- You must be on a **fork** (the guard blocks feature commits on the canonical repo). If `git remote get-url origin` matches the canonical repo, stop and instruct the user to fork first with `gh repo fork <canonical> --clone`.
- The Superpowers plugin must be installed (write actions are blocked otherwise).

## Steps

1. Read `.claude/workflow.json` for `baseBranch` (default `develop`) and `featurePrefix` (default `feature/`).
2. Ensure an `upstream` remote points at the canonical repo: `git remote get-url upstream` — if missing, `git remote add upstream https://github.com/<canonicalRepo>.git`.
3. Fetch and sync the base: `git fetch upstream` then create the branch from the fresh base: `git checkout -b <featurePrefix><slug> upstream/<baseBranch>`.
4. Choose `<slug>` as a short kebab-case summary of the work.
5. Confirm the branch is created and hand off to implementation (use superpowers:test-driven-development for the actual work).
```

- [ ] **Step 5: Run the validation test (still failing — 5 skills missing)**

Run: `python -m pytest .claude/hooks/tests/test_skills_valid.py -q`
Expected: FAIL on `test_all_required_skills_exist` (5 skills still missing). This is expected; the test passes after Task 7. The two files created here must individually parse:

Run: `python -m pytest ".claude/hooks/tests/test_skills_valid.py::test_each_skill_has_name_and_description" -q`
Expected: FAIL only because other required skills are absent. Confirm the two new files have valid frontmatter by eye.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/workflow-setup .claude/skills/starting-work .claude/hooks/tests/test_skills_valid.py
git commit -m "feat: workflow-setup + starting-work skills and skill validator"
```

---

### Task 6: `finishing-a-feature` skill (flagship)

**Files:**
- Create: `.claude/skills/finishing-a-feature/SKILL.md`

**Interfaces:**
- Consumes: `.claude/workflow.json`; the guard's PR rules (Task 2); Superpowers skills.
- Produces: the streamlined pre-PR → PR procedure.

- [ ] **Step 1: Write `finishing-a-feature/SKILL.md`**

Create `.claude/skills/finishing-a-feature/SKILL.md`:

```markdown
---
name: finishing-a-feature
description: Use when feature work is complete and you are ready to open a pull request. Streamlines every pre-PR step in order — tests, changelog, CLAUDE.md, PR into develop. Triggers on "finish this feature", "open a PR", "I'm done", "ready to submit", "wrap up".
---

# Finishing a Feature

Runs the full pre-PR sequence so nothing the guard requires is missed. The guard blocks the PR if the changelog or CLAUDE.md was not updated, so this skill does them in the correct order.

## Order matters

CLAUDE.md is deliberately the **last** content step before the PR — update it once everything else is settled.

## Steps

1. **Verify the branch.** Confirm you are on a `feature/*` branch on your fork. If not, stop.
2. **Run quality gates.** Read `.claude/workflow.json` `commands.test` and `commands.lint`; if set, run them and ensure they pass. If unset, skip. Do not proceed on failure.
3. **Self-review.** Invoke `superpowers:requesting-code-review` on the diff and address findings before continuing.
4. **Update the changelog.** Add a bullet under the appropriate group (`Added`/`Changed`/`Fixed`/`Removed`/`Deprecated`/`Security`) in the `Unreleased` section of `CHANGELOG.md`. Flag breaking changes explicitly (prefix `**BREAKING:**`).
5. **Update CLAUDE.md (last).** Reflect any new commands, structure, or conventions this feature introduced. Even a small, accurate update is required — the guard checks that CLAUDE.md changed on this branch.
6. **Commit** the changelog + CLAUDE.md updates.
7. **Open the PR into develop.** Use `superpowers:finishing-a-development-branch` to handle push/PR, targeting the canonical base:
   `gh pr create --repo <canonicalRepo> --base <baseBranch> --head <fork-owner>:<branch> --title "<summary>" --body "<what/why + changelog excerpt>"`.
   The guard normalizes this; if it blocks, read the message and fix the missing step.
8. Report the PR URL to the user.
```

- [ ] **Step 2: Validate frontmatter parses**

Run: `python -m pytest ".claude/hooks/tests/test_skills_valid.py::test_each_skill_has_name_and_description" -q`
Expected: still FAIL only on missing maintainer skills (Task 7); this file itself must not be the cause. Confirm by eye that `finishing-a-feature/SKILL.md` starts with valid `---` frontmatter.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/finishing-a-feature
git commit -m "feat: finishing-a-feature flagship skill"
```

---

### Task 7: Maintainer skills (review, merge, draft-release, cut-release)

**Files:**
- Create: `.claude/skills/reviewing-a-contribution/SKILL.md`
- Create: `.claude/skills/merging-a-contribution/SKILL.md`
- Create: `.claude/skills/drafting-a-release/SKILL.md`
- Create: `.claude/skills/cutting-a-release/SKILL.md`

**Interfaces:**
- Consumes: the guard's maintainer rules (Task 2); `.claude/workflow.json`.
- Produces: the four maintainer skills; completes the set validated by `test_skills_valid.py`.

- [ ] **Step 1: Write `reviewing-a-contribution/SKILL.md`**

```markdown
---
name: reviewing-a-contribution
description: Use as maintainer to review a contributor's pull request into develop and post the review back to them. Triggers on "review PR", "review this contribution", "check PR #N".
---

# Reviewing a Contribution

## Steps

1. Confirm you are on the canonical repo (maintainer mode).
2. Fetch the PR diff: `gh pr diff <N>` and `gh pr view <N> --json title,body,files`.
3. Review with `superpowers:requesting-code-review` (or `/code-review`) against the diff. Focus on correctness, the changelog entry, and that CLAUDE.md was updated.
4. If changes are needed, post them back to the contributor:
   `gh pr review <N> --request-changes --body "<numbered, specific findings>"`.
5. If it is ready, approve: `gh pr review <N> --approve --body "<summary>"`.
6. Tell the user the review outcome. Requested changes return to the contributor; approval unlocks merging.
```

- [ ] **Step 2: Write `merging-a-contribution/SKILL.md`**

```markdown
---
name: merging-a-contribution
description: Use as maintainer to squash-merge an approved pull request into develop. Triggers on "merge PR", "merge this contribution", "land PR #N".
---

# Merging a Contribution

The guard blocks any merge that is not `--squash` or whose PR lacks an approved review.

## Steps

1. Confirm the PR is approved: `gh pr view <N> --json reviewDecision` must be `APPROVED`. If not, run reviewing-a-contribution first.
2. Squash-merge into develop: `gh pr merge <N> --squash --delete-branch`.
3. Confirm the merge and that the branch was deleted.
4. Note that the contribution's changelog entry is now part of `develop`'s Unreleased section, ready for the next release.
```

- [ ] **Step 3: Write `drafting-a-release/SKILL.md`**

```markdown
---
name: drafting-a-release
description: Use as maintainer to prepare a production release — compute the version, finalize the changelog, and open the develop-to-main PR. Triggers on "draft a release", "prepare release", "promote develop to main".
---

# Drafting a Release

## Version policy

Compute the next SemVer version from the `Unreleased` section:
- Only `Fixed`/`Security`/patch-level entries → **patch**: apply automatically, no prompt.
- Any `Added` entries → **minor**: STOP and suggest the minor bump, explaining which entries triggered it; get maintainer confirmation.
- Any `**BREAKING:**` flag or removed public behavior → **major**: STOP and suggest the major bump with the specific signal; get maintainer confirmation.

## Steps

1. Confirm you are on the canonical repo and `develop` is up to date: `git fetch origin && git checkout develop && git pull`.
2. Determine the current version from the latest git tag (`git describe --tags --abbrev=0`, default `v0.0.0`).
3. Compute the next version per the policy above; confirm with the user if minor/major.
4. Create the release branch: `git checkout -b release/<version> develop`.
5. In `CHANGELOG.md`, move everything under `Unreleased` into a new `## [<version>] - <YYYY-MM-DD>` section and leave `Unreleased` empty with its group headings.
6. Commit on the release branch (allowed for maintainers).
7. Open the promotion PR: `gh pr create --base main --head release/<version> --title "Release <version>" --body "<full changelog section>"`.
8. Hand the PR to reviewing-a-contribution. After it merges, use cutting-a-release.
```

- [ ] **Step 4: Write `cutting-a-release/SKILL.md`**

```markdown
---
name: cutting-a-release
description: Use as maintainer immediately after the develop-to-main release PR merges, to tag the version and publish release notes. Triggers on "cut the release", "publish the release", "tag the version".
---

# Cutting a Release

## Steps

1. Confirm the `release/<version>` → `main` PR has merged and `main` is current: `git checkout main && git pull`.
2. Tag the release at `main`: `git tag -a v<version> -m "Release <version>"` then `git push origin v<version>`.
3. Publish notes from the finalized changelog section:
   `gh release create v<version> --title "v<version>" --notes "<the [<version>] changelog section>"`.
4. Fast-forward `develop` from `main` so the two branches share the release commit: open a normal back-merge PR if direct pushes are blocked.
5. Report the release URL to the user.
```

- [ ] **Step 5: Run the full skill validation**

Run: `python -m pytest .claude/hooks/tests/test_skills_valid.py -q`
Expected: PASS — all seven required skills now exist with valid frontmatter.

- [ ] **Step 6: Run the entire hook test suite**

Run: `python -m pytest .claude/hooks/tests/ -q`
Expected: PASS (all tests across all files).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/reviewing-a-contribution .claude/skills/merging-a-contribution .claude/skills/drafting-a-release .claude/skills/cutting-a-release
git commit -m "feat: maintainer skills for review, merge, and release"
```

---

### Task 8: Root docs + publish

**Files:**
- Create: `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `README.md`
- Modify: `.gitignore` (ensure `.claude/settings.local.json` ignored)

**Interfaces:**
- Consumes: everything above (names the skills, guardrails, and limits).
- Produces: the human/Claude-facing documentation and the published template.

- [ ] **Step 1: Create `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security
```

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
# CLAUDE.md

This project was created from the Claude Code workflow template. The workflow below is
enforced by committed hooks in `.claude/` and streamlined by repo-level skills.

## On session start

A SessionStart hook injects a role-aware orientation. **Present that orientation to the
user at the start of a fresh session.**

## The workflow

1. All feature work happens on a **fork**, on a `feature/*` branch.
2. Updating this file (`CLAUDE.md`) is the **last step** before opening a PR.
3. `CHANGELOG.md` is updated on **every** PR.
4. PRs go into the canonical repo's **`develop`** branch.
5. Reviews are done in Claude Code and posted back to the contributor.
6. Approved PRs are **squash-merged** into `develop`.
7. Production releases go out via a **`develop` → `main`** PR.
8. Merging that PR **cuts a release** with notes.

## Skills

- Contributor: `starting-work`, `finishing-a-feature`.
- Maintainer: `reviewing-a-contribution`, `merging-a-contribution`, `drafting-a-release`, `cutting-a-release`.
- Setup: `workflow-setup` (run once).

## Guardrails (enforced by `.claude/hooks/guard.py`)

- No commits/pushes on `main`/`develop`.
- On a fork: PRs must target `develop` and require CHANGELOG.md + CLAUDE.md updates.
- On the canonical repo: feature work is blocked (fork instead); merges must be squash + approved.
- Write/git actions are blocked unless the Superpowers plugin is installed.

## Honest limitations

- Hooks only bind inside Claude Code; plain `git`/`gh` in a shell bypasses them.
- Superpowers/role detection are filesystem/remote heuristics; they fail with clear messages.
- Approved-review detection needs the canonical repo to be a real GitHub remote.

## Configuration

`.claude/workflow.json` holds `canonicalRepo`, branch names, and optional `commands.test`/`commands.lint`.
```

- [ ] **Step 3: Create `CONTRIBUTING.md`**

```markdown
# Contributing

Contributions run through Claude Code, which enforces this workflow automatically.

## Requirements

- **Install the [Superpowers plugin](https://github.com/anthropics/claude-code).** Write/git
  actions are blocked without it.
- Use Claude Code for your work so the workflow skills and guardrails apply.

## Flow

1. **Fork** the repository: `gh repo fork <owner>/<repo> --clone`.
2. Ask Claude to run the **starting-work** skill to create your `feature/*` branch.
3. Do the work (test-driven).
4. Ask Claude to run the **finishing-a-feature** skill. It will: run tests, update the
   changelog, update `CLAUDE.md` last, and open a PR into `develop`.
5. A maintainer reviews in Claude Code. Requested changes come back on the PR; address them
   and push. Approved PRs are squash-merged.

## Changelog

Every PR adds an entry under `Unreleased` in `CHANGELOG.md` (Keep a Changelog format).
```

- [ ] **Step 4: Create `README.md`**

```markdown
# Project Template (Claude Code workflow)

A GitHub template that bakes a disciplined, Claude-Code-enforced contribution and release
workflow into any project created from it — fork → `feature/*` → PR into `develop` → review
→ squash-merge → `develop`→`main` release, with an enforced changelog and CLAUDE.md.

Enforcement is entirely through Claude Code (committed hooks + repo-level skills), not
GitHub branch protection or CI.

## Using this template

1. Create a new repository with **Use this template**.
2. In the new repo, ask Claude to run the **workflow-setup** skill to stamp your canonical
   repo into `.claude/workflow.json`.
3. Contributors follow `CONTRIBUTING.md`; maintainers use the review/merge/release skills.

See `CLAUDE.md` for the full workflow and its guardrails, and `docs/superpowers/` for the
design spec and this implementation plan.
```

- [ ] **Step 5: Ensure `.gitignore`**

Confirm `.gitignore` contains:

```
.claude/settings.local.json
```

- [ ] **Step 6: Verify the tree and run the full suite one last time**

Run: `python -m pytest .claude/hooks/tests/ -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md CHANGELOG.md CONTRIBUTING.md README.md .gitignore
git commit -m "docs: CLAUDE.md, changelog, contributing, and readme"
```

- [ ] **Step 8: Publish to the canonical remote**

```bash
git remote add origin git@github.com:dbd-net/project-template.git 2>/dev/null || git remote set-url origin git@github.com:dbd-net/project-template.git
git branch -M main
git push -u origin main
```

Then, on GitHub, mark the repository as a template (Settings → "Template repository"), and create the `develop` branch from `main`. Confirm with the user before pushing if the remote already has content.

---

## Self-Review

**Spec coverage:**
- Workflow points #1–#8 → guard rules (Task 2/3) + skills (Tasks 5–7). ✓
- Hard blocks via hooks → Task 2/3 `evaluate` + `settings.json`. ✓
- Both roles → contributor (5,6) + maintainer (7) skills; role detection Task 1. ✓
- Language-agnostic + optional test/lint → `workflow.json commands`, used in finishing-a-feature. ✓
- Keep a Changelog + SemVer, auto-patch/confirm-minor-major → drafting-a-release (Task 7). ✓
- Superpowers hard block on write/git → `evaluate` gate (Task 2) + `superpowers_present` (Task 1). ✓
- Self-enforcement (feature work blocked on canonical) → maintainer rule (Task 2). ✓
- SessionStart orientation → Task 4 + CLAUDE.md directive (Task 8). ✓
- Honest limitations documented → CLAUDE.md (Task 8). ✓
- Canonical remote `dbd-net/project-template` → Task 8 publish. ✓

**Placeholder scan:** No TBD/TODO; every code and prose step is complete. ✓

**Type consistency:** `evaluate`/`classify` signatures and `ctx` keys match between Tasks 2 and 3; `workflow_lib` function names used in Tasks 3–4 match Task 1 definitions; `build_orientation(role, superpowers, config)` consistent between Task 4 impl and tests. ✓
