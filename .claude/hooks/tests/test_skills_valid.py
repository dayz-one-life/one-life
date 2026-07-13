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
