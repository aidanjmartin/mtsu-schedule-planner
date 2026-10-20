"""Tests for tools/build.py."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

import build

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def data_dir(tmp_path):
    data = tmp_path / "data"
    (data / "catalogs").mkdir(parents=True)
    (data / "schedule").mkdir()
    shutil.copy(FIXTURES / "catalog-small.json", data / "catalogs" / "2026-27.json")
    shutil.copy(FIXTURES / "offerings-small.json", data / "offerings.json")
    shutil.copy(FIXTURES / "schedule-small.json", data / "schedule" / "2026FA.json")
    (data / "schedule" / "index.json").write_text('{"terms": []}')
    (data / "schedule" / "raw").mkdir()
    return data


def test_build_inlines_scripts_styles_and_data(tmp_path, data_dir):
    out, data = build.build(ROOT / "web", data_dir, tmp_path / "planner.html")
    html = out.read_text(encoding="utf-8")
    assert '<link rel="stylesheet"' not in html and "<style>" in html
    assert 'src="app.js"' not in html
    assert html.count('<script src="https://cdnjs.cloudflare.com') == 3, "the three graph libraries stay as CDN tags"
    assert "<script src=" in html and "unpkg" not in html
    assert list(data["catalogs"]) == ["2026-27"]
    assert list(data["schedules"]) == ["2026FA"], "index.json and raw/ are not schedule terms"
    block = re.search(r'<script type="application/json" id="planner-data">(.*?)</script>', html, re.S).group(1)
    parsed = json.loads(block)
    assert parsed["catalogs"]["2026-27"]["catalog_year"] == "test-small"
    assert parsed["offerings"]["courses"]["ENGR 3530"]["regular_seasons"] == ["fall", "spring"]


def test_bundled_script_has_no_import_or_export_lines(tmp_path, data_dir):
    out, _ = build.build(ROOT / "web", data_dir, tmp_path / "planner.html")
    script = re.search(r'<script type="module">\n(.*?)\n</script>', out.read_text(encoding="utf-8"), re.S).group(1)
    assert not re.search(r"^(import|export)\s", script, re.M)
    for name in ("terms", "prereqs", "validate", "critical_path", "planner", "timetable", "whatif"):
        assert f"__m_engine_{name}" in script


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is not installed")
def test_bundled_script_is_valid_javascript_and_the_engine_runs(tmp_path, data_dir):
    out, _ = build.build(ROOT / "web", data_dir, tmp_path / "planner.html")
    script = re.search(r'<script type="module">\n(.*?)\n</script>', out.read_text(encoding="utf-8"), re.S).group(1)
    path = tmp_path / "bundle.mjs"
    path.write_text(script, encoding="utf-8")
    assert subprocess.run(["node", "--check", str(path)], capture_output=True).returncode == 0

    # Run the engine part of the bundle (everything before the page module) and plan the fixture.
    engine_only = script.split("const __m_app = ")[0]
    probe = tmp_path / "probe.mjs"
    probe.write_text(
        engine_only
        + "\nconst catalog = " + (FIXTURES / "catalog-small.json").read_text()
        + ";\nconst plan = __m_engine_planner.planTerms({ catalog, student: { start_term: '2026FA', completed: [], options: {} } });"
        + "\nconsole.log(plan.graduation_term);\n",
        encoding="utf-8",
    )
    result = subprocess.run(["node", str(probe)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "2030SP"


def test_schedule_terms_keeps_only_the_newest(tmp_path, data_dir):
    for term in ("2025FA", "2026SP"):
        shutil.copy(data_dir / "schedule" / "2026FA.json", data_dir / "schedule" / f"{term}.json")
    _, data = build.build(ROOT / "web", data_dir, tmp_path / "planner.html", schedule_terms=2)
    assert sorted(data["schedules"]) == ["2026FA", "2026SP"]


def test_an_unsupported_export_form_fails_the_build(tmp_path, data_dir):
    web = tmp_path / "web"
    shutil.copytree(ROOT / "web", web)
    (web / "engine" / "terms.js").write_text("const a = 1;\nexport { a };\n")
    with pytest.raises(build.BuildError):
        build.build(web, data_dir, tmp_path / "planner.html")


def test_json_for_html_cannot_end_the_script_block():
    text = build.json_for_html({"note": "</script><b>"})
    assert "</" not in text and "<" not in text
    assert json.loads(text)["note"] == "</script><b>"
