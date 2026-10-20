"""Parser tests. They run against synthetic HTML in tests/fixtures that mirrors the Banner 8 layout.
Replace the fixtures with real saved pages when the importer first runs against MTSU."""

from pathlib import Path

import pytest

import parse

FIXTURES = Path(__file__).parent / "fixtures"


def read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def fall():
    return {s["crn"]: s for s in parse.parse_sections(read("banner8-ENGR-2026FA-synthetic.html"))}


@pytest.fixture(scope="module")
def spring():
    return {s["crn"]: s for s in parse.parse_sections(read("banner8-ENGR-2027SP-synthetic.html"))}


def test_fall_sample_has_every_section(fall):
    assert sorted(fall) == ["90001", "90002", "90003", "90004", "90005", "90006", "90007", "90008"]


def test_single_meeting_section(fall):
    assert fall["90001"] == {
        "crn": "90001",
        "course": "ENGR 2110",
        "section": "001",
        "title": "Engineering Statics",
        "credits": 3,
        "schedule_type": "Lecture",
        "instructional_method": "Traditional",
        "part_of_term": "1",
        "instructor": "Jane Smith",
        "meetings": [{
            "days": "TR", "start": "09:40", "end": "11:05", "location": "KOM 220",
            "start_date": "2026-08-24", "end_date": "2026-12-11",
        }],
    }


def test_multiple_meeting_rows_and_instructors(fall):
    s = fall["90002"]
    assert s["credits"] == 4
    assert s["instructor"] == "Jane Smith, Bob Jones"
    assert [(m["days"], m["start"], m["end"], m["location"]) for m in s["meetings"]] == [
        ("M", "13:00", "15:30", "KOM 300"),
        ("W", "13:00", "15:30", "KOM 310"),
    ]


def test_lab_section_uses_the_section_level_schedule_type(fall):
    s = fall["90003"]
    assert s["course"] == "ENGR 3511"
    assert s["section"] == "101"
    assert s["schedule_type"] == "Laboratory"
    assert s["credits"] == 0
    assert s["meetings"][0]["days"] == "T"


def test_online_section_with_tba_time_has_no_meetings(fall):
    s = fall["90004"]
    assert s["meetings"] == []
    assert s["schedule_type"] == "Online"
    assert s["instructional_method"] == "Online"
    assert s["instructor"] == "Carla Diaz"


def test_title_with_a_dash_and_variable_credits(fall):
    s = fall["90005"]
    assert s["title"] == "Special Topics - Robotics"
    assert s["course"] == "ENGR 4950"
    assert s["credits"] == 1  # lowest value of a 1 TO 3 range
    assert s["meetings"][0]["start"] == "12:00" and s["meetings"][0]["end"] == "12:50"
    assert s["meetings"][0]["days"] == "MWF"
    assert s["instructor"] == "TBA"


def test_tba_time_in_person_section(fall):
    s = fall["90006"]
    assert s["meetings"] == []
    assert s["schedule_type"] == "Independent Study"


def test_split_date_ranges_are_kept_and_exam_rows_are_skipped(fall):
    s = fall["90007"]
    assert len(s["meetings"]) == 2
    assert s["meetings"][0]["end_date"] == "2026-10-16"
    assert s["meetings"][1]["start_date"] == "2026-10-19"
    assert s["meetings"][1]["location"] == "KOM 221"


def test_section_without_a_meeting_table(fall):
    s = fall["90008"]
    assert s["meetings"] == []
    assert s["instructor"] == ""
    assert s["schedule_type"] == "Seminar"


def test_spring_sample(spring):
    assert sorted(spring) == ["91001", "91002", "91003"]
    assert spring["91001"]["meetings"][0]["start_date"] == "2027-01-11"
    assert spring["91002"]["meetings"][0]["start"] == "12:30" and spring["91002"]["meetings"][0]["end"] == "13:20"
    assert spring["91003"]["meetings"][0]["start"] == "17:30"
    assert spring["91003"]["meetings"][0]["end"] == "20:00"


def test_no_classes_page_gives_an_empty_list():
    assert parse.parse_sections(read("banner8-none-synthetic.html")) == []


def test_unrecognized_page_fails_loudly():
    with pytest.raises(parse.ParseError):
        parse.parse_sections("<html><body><p>Service unavailable</p></body></html>")


def test_unexpected_meeting_columns_fail_loudly():
    html = read("banner8-ENGR-2027SP-synthetic.html").replace(">Date Range<", ">Dates<")
    with pytest.raises(parse.ParseError):
        parse.parse_sections(html)


@pytest.mark.parametrize("text,expected", [
    ("9:40 am - 11:05 am", ("09:40", "11:05")),
    ("12:00 pm - 12:50 pm", ("12:00", "12:50")),
    ("12:30 am - 1:20 am", ("00:30", "01:20")),
    ("11:30 am - 1:00 pm", ("11:30", "13:00")),
    ("5:30 pm - 8:00 pm", ("17:30", "20:00")),
    ("TBA", None),
    ("", None),
])
def test_time_ranges(text, expected):
    assert parse.parse_time_range(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("MWF", "MWF"), ("TR", "TR"), ("TBA", ""), ("", ""), ("M W", "MW"), ("S", "S"),
])
def test_days(text, expected):
    assert parse.parse_days(text) == expected


def test_date_ranges():
    assert parse.parse_date_range("Aug 24, 2026 - Dec 11, 2026") == ("2026-08-24", "2026-12-11")
    assert parse.parse_date_range("TBA") == (None, None)


def test_build_schedule_sorts_and_drops_repeated_crns():
    sections = parse.parse_sections(read("banner8-ENGR-2026FA-synthetic.html"))
    schedule = parse.build_schedule("2026FA", "Fall 2026", "202680", ["ENGR"], sections + sections, "2026-10-21T14:00:00Z")
    assert schedule["term"] == "2026FA"
    assert schedule["banner_term_code"] == "202680"
    assert schedule["source"] == "https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched"
    courses = [s["course"] for s in schedule["sections"]]
    assert courses == sorted(courses)
    assert len(schedule["sections"]) == 8
    assert set(schedule) == {"term", "term_label", "banner_term_code", "imported_at", "source", "subjects", "sections"}
