# Solo Maintainer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `soloMaintainer` mode that lets one person run the whole workflow (feature work, contribution merge, release, back-merge) from a single clone without swapping remotes, while preserving the structural guardrails.

**Architecture:** A new `solo` role in the guard holds the union of contributor + maintainer permissions. It is selected by a `soloMaintainer` config flag, independent of which remote is `origin`. The `contributor` and `maintainer` code paths are left untouched, so team behavior is unchanged when the flag is off.

**Tech Stack:** Python 3 (stdlib only — `subprocess`, `json`), pytest. Hooks live in `.claude/hooks/`; tests in `.claude/hooks/tests/`.

## Global Constraints

- Python standard library only — no third-party imports in `guard.py` / `workflow_lib.py`.
- The flag key is exactly `soloMaintainer`; the config default is `false`.
- The new role string is exactly `"solo"`.
- Protected branches (`main`/`develop`) remain PR-only for every role including `solo`.
- Contribution merges into `develop` under `solo` require `--squash` AND a posted review (`APPROVED` or `COMMENTED`, and not `CHANGES_REQUESTED`).
- Do not modify the existing `contributor` or `maintainer` branches of `evaluate()`.
- Run tests with: `python3 -m pytest .claude/hooks/tests/ -v` (run from repo root).

---

### Task 1: `detect_role` learns the `solo` flag

**Files:**
- Modify: `.claude/hooks/workflow_lib.py:38-43` (`detect_role`)
- Test: `.claude/hooks/tests/test_workflow_lib.py`

**Interfaces:**
- Produces: `detect_role(origin_slug_value, canonical, solo=False) -> str`. Returns `"uninitialized"` if `canonical` is falsy; else `"solo"` if `solo` is true; else `"maintainer"` if `origin_slug_value == canonical`; else `"contributor"`.

- [ ] **Step 1: Write the failing tests**

Add to `.claude/hooks/tests/test_workflow_lib.py`:

```python
def test_detect_role_solo_when_flag_set():
    assert wl.detect_role("alice/app", "dbd-net/app", solo=True) == "solo"


def test_detect_role_solo_overrides_maintainer_match():
    assert wl.detect_role("dbd-net/app", "dbd-net/app", solo=True) == "solo"


def test_detect_role_solo_still_uninitialized_without_canonical():
    assert wl.detect_role("dbd-net/app", "", solo=True) == "uninitialized"


def test_detect_role_defaults_solo_false():
    assert wl.detect_role("dbd-net/app", "dbd-net/app") == "maintainer"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest .claude/hooks/tests/test_workflow_lib.py -k solo -v`
Expected: FAIL — `detect_role() got an unexpected keyword argument 'solo'`

- [ ] **Step 3: Implement the change**

Replace `.claude/hooks/workflow_lib.py` lines 38-43 with:

```python
def detect_role(origin_slug_value, canonical, solo=False):
    if not canonical:
        return "uninitialized"
    if solo:
        return "solo"
    if origin_slug_value == canonical:
        return "maintainer"
    return "contributor"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest .claude/hooks/tests/test_workflow_lib.py -v`
Expected: PASS (all, including the existing `detect_role` tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/workflow_lib.py .claude/hooks/tests/test_workflow_lib.py
git commit -m "feat: detect_role supports solo flag"
```

---

### Task 2: `solo` role branch in `evaluate()`

**Files:**
- Modify: `.claude/hooks/guard.py:152-154` (insert new branch after the `maintainer` branch, before the final `return True, ""`)
- Test: `.claude/hooks/tests/test_guard.py`

**Interfaces:**
- Consumes: `ctx` dict keys `role`, `branch`, `config`, `changelog_changed`, `claudemd_changed`, and (for merges) `pr_base`, `pr_head`, `pr_reviewed`. The merge keys are read with `.get()` so absence is treated as `None`.
- Consumes: `action` dict keys `kind`, `base` (for `gh-pr-create`), `is_squash` (for `gh-pr-merge`).
- Produces: for `role == "solo"`, `evaluate()` returns `(allow: bool, reason: str)` per the rules below. Reads `production_branch = cfg.get("productionBranch", "main")`.

- [ ] **Step 1: Write the failing tests**

Add to `.claude/hooks/tests/test_guard.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest .claude/hooks/tests/test_guard.py -k solo -v`
Expected: FAIL — the `solo` role falls through to the final `return True, ""`, so the "blocked" assertions fail (allow is True when it should be False).

- [ ] **Step 3: Implement the solo branch**

In `.claude/hooks/guard.py`, insert this block immediately after the `if role == "maintainer":` block ends (after its `return True, ""` at line 152) and before the final module-level `return True, ""` at line 154:

```python
    if role == "solo":
        production_branch = cfg.get("productionBranch", "main")
        if kind in ("git-commit", "git-push", "git-merge"):
            if branch in protected:
                return False, f"Blocked: '{branch}' is protected. Changes reach it via PR."
            return True, ""
        if kind == "gh-pr-create":
            base = action.get("base")
            if base == production_branch:
                return True, ""
            if base == base_branch:
                if not ctx["changelog_changed"]:
                    return False, "Blocked: update CHANGELOG.md (Unreleased) before opening a PR."
                if not ctx["claudemd_changed"]:
                    return False, "Blocked: updating CLAUDE.md is the last step before a PR. Update it first."
                return True, ""
            return False, f"Blocked: PR into '{base_branch}' or '{production_branch}'."
        if kind == "gh-pr-merge":
            base = ctx.get("pr_base")
            head = ctx.get("pr_head")
            if base == production_branch:
                return True, ""
            if base == base_branch and head == production_branch:
                return True, ""
            if base == base_branch:
                if action.get("is_squash") is not True:
                    return False, "Blocked: merge contributions into develop with --squash."
                if ctx.get("pr_reviewed") is not True:
                    return False, "Blocked: post a review first (a COMMENTED review satisfies solo mode)."
                return True, ""
            return True, ""
        return True, ""
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest .claude/hooks/tests/test_guard.py -v`
Expected: PASS (all solo tests plus the untouched contributor/maintainer tests)

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/guard.py .claude/hooks/tests/test_guard.py
git commit -m "feat: solo role permissions in guard evaluate"
```

---

### Task 3: PR context signals + `gather_context` wiring

**Files:**
- Modify: `.claude/hooks/guard.py` — add helpers near `pr_approved` (after line 198); wire `gather_context` (lines 201-222) and `main` (line 242).
- Test: `.claude/hooks/tests/test_guard.py`

**Interfaces:**
- Produces: `pr_reviewed(number, cwd=None) -> bool | None` — `True` if the PR has a review with state `APPROVED` or `COMMENTED` and `reviewDecision != "CHANGES_REQUESTED"`; `False` if changes requested or no qualifying review; `None` on gh error.
- Produces: `pr_base(number, cwd=None) -> str | None` and `pr_head(number, cwd=None) -> str | None` — the PR base/head branch names, `None` on gh error.
- Produces: `gather_context` returns a dict that additionally contains `pr_base: None`, `pr_head: None`, `pr_reviewed: None`, and computes `role` via `detect_role(..., solo=bool(config.get("soloMaintainer")))`.

- [ ] **Step 1: Write the failing test**

This verifies the flag flips the role end-to-end: with `origin == canonical` and `soloMaintainer` on, a commit on a `feature/*` branch is allowed (a `maintainer` would be blocked with "Fork").

Add to `.claude/hooks/tests/test_guard.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest .claude/hooks/tests/test_guard.py::test_solo_flag_allows_feature_commit_from_canonical_clone -v`
Expected: FAIL — `gather_context` does not yet pass `solo=` to `detect_role`, so role is `maintainer` and the feature-branch commit is blocked (returncode 2).

- [ ] **Step 3: Add the PR helper functions**

In `.claude/hooks/guard.py`, immediately after `pr_cross_repository` (after line 198), add:

```python
def _pr_field(number, field, cwd=None):
    args = ["pr", "view"]
    if number:
        args.append(str(number))
    args += ["--json", field, "-q", f".{field}"]
    try:
        out = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True)
    except OSError:
        return None
    if out.returncode != 0:
        return None
    val = out.stdout.strip()
    return val or None


def pr_base(number, cwd=None):
    return _pr_field(number, "baseRefName", cwd=cwd)


def pr_head(number, cwd=None):
    return _pr_field(number, "headRefName", cwd=cwd)


def pr_reviewed(number, cwd=None):
    args = ["pr", "view"]
    if number:
        args.append(str(number))
    args += ["--json", "reviews,reviewDecision"]
    try:
        out = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True)
    except OSError:
        return None
    if out.returncode != 0:
        return None
    try:
        data = json.loads(out.stdout)
    except ValueError:
        return None
    if data.get("reviewDecision") == "CHANGES_REQUESTED":
        return False
    states = {r.get("state") for r in data.get("reviews", [])}
    return bool(states & {"APPROVED", "COMMENTED"})
```

- [ ] **Step 4: Wire `gather_context`**

In `.claude/hooks/guard.py`, change the `role` line in `gather_context` (line 207) from:

```python
    role = wl.detect_role(wl.origin_slug(cwd=cwd), canonical)
```

to:

```python
    role = wl.detect_role(wl.origin_slug(cwd=cwd), canonical, solo=bool(config.get("soloMaintainer")))
```

Then add three keys to the returned dict (alongside `pr_approved`/`pr_cross_repository`, around lines 219-221):

```python
        "pr_base": None,
        "pr_head": None,
        "pr_reviewed": None,
```

- [ ] **Step 5: Wire `main` to compute the signals for merges**

In `.claude/hooks/guard.py`, change the `gh-pr-merge` context enrichment in `main` (line 242) from:

```python
            ctx = dict(ctx, pr_approved=pr_approved(num), pr_cross_repository=pr_cross_repository(num))
```

to:

```python
            ctx = dict(
                ctx,
                pr_approved=pr_approved(num),
                pr_cross_repository=pr_cross_repository(num),
                pr_base=pr_base(num),
                pr_head=pr_head(num),
                pr_reviewed=pr_reviewed(num),
            )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest .claude/hooks/tests/ -v`
Expected: PASS (all, including the new end-to-end solo test)

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/guard.py .claude/hooks/tests/test_guard.py
git commit -m "feat: solo role context signals and gather_context wiring"
```

---

### Task 4: Config flag default + `starting-work` skill solo-awareness

**Files:**
- Modify: `.claude/workflow.json`
- Modify: `.claude/skills/starting-work/SKILL.md`

**Interfaces:**
- Consumes: the `soloMaintainer` flag read by `gather_context` (Task 3).
- Produces: committed config default `"soloMaintainer": false`; a `starting-work` precondition that branches in place when `soloMaintainer` is set.

- [ ] **Step 1: Add the config default**

In `.claude/workflow.json`, add a `soloMaintainer` key (default off). After the `"versionScheme"` line, add:

```json
  "soloMaintainer": false,
```

Verify the file is still valid JSON:

Run: `python3 -c "import json; json.load(open('.claude/workflow.json'))" && echo OK`
Expected: `OK`

- [ ] **Step 2: Update the `starting-work` skill precondition**

In `.claude/skills/starting-work/SKILL.md`, replace the first bullet under `## Preconditions`:

Find:

```markdown
- You must be on a **fork** (the guard blocks feature commits on the canonical repo). If `git remote get-url origin` matches the canonical repo, stop and instruct the user to fork first with `gh repo fork <canonical> --clone`.
```

Replace with:

```markdown
- **Unless `soloMaintainer` is `true` in `.claude/workflow.json`:** you must be on a **fork** (the guard blocks feature commits on the canonical repo). If `git remote get-url origin` matches the canonical repo, stop and instruct the user to fork first with `gh repo fork <canonical> --clone`.
- **When `soloMaintainer` is `true`:** no fork is required. Work directly in the canonical clone (`origin` = canonical); the `solo` role permits `feature/*` commits in place. Skip the fork check and the `upstream` setup — `origin` already points at the canonical repo.
```

- [ ] **Step 3: Run the skills-valid test**

Run: `python3 -m pytest .claude/hooks/tests/test_skills_valid.py -v`
Expected: PASS (the SKILL.md frontmatter is unchanged, so it stays valid)

- [ ] **Step 4: Run the full suite**

Run: `python3 -m pytest .claude/hooks/tests/ -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add .claude/workflow.json .claude/skills/starting-work/SKILL.md
git commit -m "feat: soloMaintainer config default and starting-work awareness"
```

---

## After implementation

Once all tasks pass, this feature is finished through the normal workflow (already on `feature/solo-maintainer-mode`): run `finishing-a-feature` to update CHANGELOG.md + CLAUDE.md and open the PR into `develop`.

**Note on enabling the flag:** `soloMaintainer` ships as `false`. To actually use solo mode after merge, set it to `true` locally. The cleanest setup is to run from a canonical clone (`origin = canonical`) so every skill works with no remote swapping.
