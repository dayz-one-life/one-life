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
        GIT_VALUE_FLAGS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace",
                           "--exec-path", "--super-prefix", "--config-env"}
        sub = None
        i = 0
        while i < len(args):
            a = args[i]
            if a in GIT_VALUE_FLAGS:
                i += 2
                continue
            if a.startswith("-"):
                i += 1
                continue
            sub = a
            break
        if sub == "commit":
            return {"kind": "git-commit"}
        if sub == "push":
            sub_args = args[i + 1:]  # everything after the "push" subcommand token
            pos = [a for a in sub_args if not a.startswith("-")]
            refs = pos[1:]  # pos[0] is the remote, if present
            tag_re = r"^(refs/tags/\S+|v?\d+\.\d+[\w.\-]*)$"
            has_tags_flag = ("--tags" in args) or ("--follow-tags" in args)
            is_tag = has_tags_flag or (len(refs) > 0 and all(re.match(tag_re, r) for r in refs))
            return {"kind": "git-push", "is_tag_push": bool(is_tag)}
        if sub == "merge":
            return {"kind": "git-merge"}
        return None
    if prog == "gh":
        nonflags = [a for a in args if not a.startswith("-")]
        if len(nonflags) >= 2 and nonflags[0] == "pr" and nonflags[1] == "create":
            return {"kind": "gh-pr-create", "base": _flag_value(args, "--base", "-B"), "head": _flag_value(args, "--head", "-H")}
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

    if kind == "git-push" and action.get("is_tag_push"):
        return True, ""

    if kind == "git-commit" and ctx.get("staged_files") == [".claude/workflow.json"]:
        return True, ""

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
            if ctx.get("pr_cross_repository") is False:
                return True, ""  # maintainer's own same-repo PR (release / back-merge): no approval or squash gate
            if action.get("is_squash") is not True:
                return False, "Blocked: merge contributions into develop with --squash."
            if ctx["pr_approved"] is not True:
                return False, "Blocked: only approved contributions may be merged. Review it first (reviewing-a-contribution)."
            return True, ""
        return True, ""

    if role == "solo":
        production_branch = cfg.get("productionBranch", "main")
        if kind in ("git-commit", "git-push", "git-merge"):
            if branch in protected:
                return False, f"Blocked: '{branch}' is protected. Changes reach it via PR."
            return True, ""
        if kind == "gh-pr-create":
            base = action.get("base")
            head = action.get("head")
            if base == production_branch:
                return True, ""
            if base == base_branch:
                if head == production_branch:
                    return True, ""  # back-merge main -> develop: no changelog/claudemd gate
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
            if base is None:
                return False, "Blocked: could not determine the PR base branch; resolve it and retry."
            return True, ""
        return True, ""

    return True, ""


import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import workflow_lib as wl  # noqa: E402


def pr_approved(number, cwd=None):
    args = ["pr", "view"]
    if number:
        args.append(str(number))
    args += ["--json", "reviewDecision", "-q", ".reviewDecision"]
    try:
        out = subprocess.run(
            ["gh", *args], cwd=cwd, capture_output=True, text=True
        )
    except OSError:
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip() == "APPROVED"


def pr_cross_repository(number, cwd=None):
    args = ["pr", "view"]
    if number:
        args.append(str(number))
    args += ["--json", "isCrossRepository", "-q", ".isCrossRepository"]
    try:
        out = subprocess.run(["gh", *args], cwd=cwd, capture_output=True, text=True)
    except OSError:
        return None
    if out.returncode != 0:
        return None
    val = out.stdout.strip()
    if val == "true":
        return True
    if val == "false":
        return False
    return None


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
    states = {r.get("state") for r in (data.get("reviews") or [])}
    return bool(states & {"APPROVED", "COMMENTED"})


def gather_context(cwd=None):
    root = wl.repo_root(cwd=cwd)
    if root is None:
        return None
    config = wl.load_config(root)
    canonical = config.get("canonicalRepo") or ""
    role = wl.detect_role(wl.origin_slug(cwd=cwd), canonical, solo=bool(config.get("soloMaintainer")))
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
        "staged_files": wl.staged_files(),
        "pr_cross_repository": None,
        "pr_base": None,
        "pr_head": None,
        "pr_reviewed": None,
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
            num = action.get("pr_number")
            ctx = dict(
                ctx,
                pr_approved=pr_approved(num),
                pr_cross_repository=pr_cross_repository(num),
                pr_base=pr_base(num),
                pr_head=pr_head(num),
                pr_reviewed=pr_reviewed(num),
            )
        allow, reason = evaluate(action, ctx)
        if not allow:
            print(reason, file=sys.stderr)
            sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
