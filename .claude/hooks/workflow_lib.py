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


def detect_role(origin_slug_value, canonical, solo=False):
    if not canonical:
        return "uninitialized"
    if solo:
        return "solo"
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


def staged_files(cwd=None):
    out = git("diff", "--cached", "--name-only", cwd=cwd)
    if out is None:
        return []
    return [line for line in out.splitlines() if line]
