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
