"""Tests for the offering-pattern rule."""

import json

import derive_offerings


def schedule(term, courses):
    return {"term": term, "sections": [{"course": c, "crn": f"{term}{i}"} for i, c in enumerate(courses)]}


def make(fall_years, spring_years, runs):
    """Build schedule documents. `runs` maps a term id to the courses that ran."""
    terms = [f"{y}FA" for y in fall_years] + [f"{y}SP" for y in spring_years]
    return [schedule(t, runs.get(t, [])) for t in terms]


def test_three_of_four_years_is_regular_and_one_or_two_is_occasional():
    runs = {
        "2023FA": ["A 1"], "2024FA": ["A 1", "B 1"], "2025FA": ["A 1", "B 1"], "2026FA": ["A 1", "B 1", "C 1"],
        "2024SP": ["A 1"],
    }
    docs = make([2023, 2024, 2025, 2026], [2024, 2025, 2026, 2027], runs)
    result = derive_offerings.derive(docs, now="2026-10-21T14:05:00Z")
    a, b, c = (result["courses"][x] for x in ("A 1", "B 1", "C 1"))
    assert a["regular_seasons"] == ["fall"] and a["occasional_seasons"] == ["spring"]
    assert b["regular_seasons"] == ["fall"]      # 3 of 4 falls
    assert c["regular_seasons"] == [] and c["occasional_seasons"] == ["fall"]  # 1 of 4 falls
    assert a["fall"] == [2023, 2024, 2025, 2026]
    assert a["spring"] == [2024]
    assert a["summer"] == []
    assert result["derived_at"] == "2026-10-21T14:05:00Z"
    assert result["terms_covered"] == ["2023FA", "2027SP"]


def test_only_the_last_four_years_count():
    runs = {f"{y}FA": ["A 1"] for y in (2018, 2019, 2020, 2021, 2022)}
    docs = make(range(2018, 2027), [], runs)
    result = derive_offerings.derive(docs)
    entry = result["courses"]["A 1"]
    assert entry["regular_seasons"] == [] and entry["occasional_seasons"] == []
    assert entry["fall"] == [2018, 2019, 2020, 2021, 2022]
    assert result["windows"]["fall"] == [2023, 2024, 2025, 2026]


def test_a_year_with_no_schedule_file_does_not_count_against_a_course():
    # 2024 has no file. The window is the last four years that do: 2022, 2023, 2025, 2026.
    runs = {"2022FA": ["A 1"], "2023FA": ["A 1"], "2026FA": ["A 1"]}
    docs = make([2020, 2021, 2022, 2023, 2025, 2026], [], runs)
    assert derive_offerings.derive(docs)["courses"]["A 1"]["regular_seasons"] == ["fall"]


def test_summer_is_its_own_season():
    docs = [schedule(f"{y}SU", ["A 1"]) for y in (2023, 2024, 2025)]
    entry = derive_offerings.derive(docs)["courses"]["A 1"]
    assert entry["summer"] == [2023, 2024, 2025]
    assert entry["regular_seasons"] == ["summer"]


def test_read_from_a_folder(tmp_path):
    folder = tmp_path / "schedule"
    folder.mkdir()
    for y in (2024, 2025, 2026):
        (folder / f"{y}FA.json").write_text(json.dumps(schedule(f"{y}FA", ["ENGR 3540"])))
    (folder / "index.json").write_text(json.dumps({"terms": []}))
    result = derive_offerings.derive_from_directory(tmp_path)
    assert list(result["courses"]) == ["ENGR 3540"]
    assert result["courses"]["ENGR 3540"]["regular_seasons"] == ["fall"]
