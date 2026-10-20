"""End-to-end test of the importer with a fake client, so no request leaves this machine."""

import json
from pathlib import Path

import banner8
import run_import

FIXTURES = Path(__file__).parent / "fixtures"
FALL = (FIXTURES / "banner8-ENGR-2026FA-synthetic.html").read_text(encoding="utf-8")
SPRING = (FIXTURES / "banner8-ENGR-2027SP-synthetic.html").read_text(encoding="utf-8")
NONE = (FIXTURES / "banner8-none-synthetic.html").read_text(encoding="utf-8")


class FakeClient:
    def __init__(self, fail=None):
        self.requests = []
        self.fail = fail or set()
        self.terms = [
            banner8.BannerTerm("202730", "Spring 2027", "2027SP", False),
            banner8.BannerTerm("202680", "Fall 2026", "2026FA", False),
            banner8.BannerTerm("201880", "Fall 2018", "2018FA", False),
        ]

    def get_terms(self):
        return self.terms

    def fetch_subject(self, code, subject):
        self.requests.append((code, subject))
        if (code, subject) in self.fail:
            raise banner8.Banner8Error("down")
        if subject != "ENGR":
            return NONE
        return FALL if code == "202680" else SPRING


def args(tmp_path, *extra):
    return run_import.build_parser().parse_args(["--data-dir", str(tmp_path), "--subjects", "ENGR", "MATH", *extra])


def test_full_run_writes_raw_pages_schedules_index_and_offerings(tmp_path):
    client = FakeClient()
    assert run_import.run(args(tmp_path, "--first", "2026FA"), client=client) == 0
    assert client.requests == [("202680", "ENGR"), ("202680", "MATH"), ("202730", "ENGR"), ("202730", "MATH")]
    assert (tmp_path / "schedule" / "raw" / "2026FA" / "ENGR.html").read_text(encoding="utf-8") == FALL

    fall = json.loads((tmp_path / "schedule" / "2026FA.json").read_text(encoding="utf-8"))
    assert fall["term"] == "2026FA" and fall["term_label"] == "Fall 2026" and fall["banner_term_code"] == "202680"
    assert fall["subjects"] == ["ENGR", "MATH"]
    assert len(fall["sections"]) == 8

    index = json.loads((tmp_path / "schedule" / "index.json").read_text(encoding="utf-8"))
    assert [t["term"] for t in index["terms"]] == ["2026FA", "2027SP"]

    offerings = json.loads((tmp_path / "offerings.json").read_text(encoding="utf-8"))
    assert offerings["terms_covered"] == ["2026FA", "2027SP"]
    assert offerings["courses"]["ENGR 2110"]["fall"] == [2026]
    assert offerings["courses"]["ENGR 2120"]["spring"] == [2027]


def test_the_term_range_limits_the_requests(tmp_path):
    client = FakeClient()
    run_import.run(args(tmp_path, "--first", "2026FA", "--last", "2026FA"), client=client)
    assert {code for code, _ in client.requests} == {"202680"}


def test_an_unchanged_rerun_leaves_files_alone(tmp_path):
    run_import.run(args(tmp_path, "--first", "2026FA"), client=FakeClient())
    path = tmp_path / "schedule" / "2026FA.json"
    first = path.read_text(encoding="utf-8")
    run_import.run(args(tmp_path, "--first", "2026FA"), client=FakeClient())
    assert path.read_text(encoding="utf-8") == first  # same timestamp, so the file was not rewritten


def test_a_failed_request_keeps_the_old_file_and_reports_failure(tmp_path):
    run_import.run(args(tmp_path, "--first", "2026FA", "--last", "2026FA"), client=FakeClient())
    path = tmp_path / "schedule" / "2026FA.json"
    before = path.read_text(encoding="utf-8")
    code = run_import.run(
        args(tmp_path, "--first", "2026FA", "--last", "2026FA"),
        client=FakeClient(fail={("202680", "MATH")}),
    )
    assert code == 1
    assert path.read_text(encoding="utf-8") == before


def test_reparse_uses_saved_pages_only(tmp_path):
    run_import.run(args(tmp_path, "--first", "2026FA"), client=FakeClient())
    (tmp_path / "schedule" / "2026FA.json").unlink()
    code = run_import.run(args(tmp_path, "--reparse"), client=None)
    assert code == 0
    again = json.loads((tmp_path / "schedule" / "2026FA.json").read_text(encoding="utf-8"))
    assert len(again["sections"]) == 8


def test_bad_term_arguments_return_an_error(tmp_path, capsys):
    assert run_import.main(["--first", "fall2026", "--data-dir", str(tmp_path)]) == 2
