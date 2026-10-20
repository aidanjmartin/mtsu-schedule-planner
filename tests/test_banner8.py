"""Tests for the Banner 8 adapter. No test touches the network: a fake session stands in for requests."""

from pathlib import Path

import pytest
import requests

import banner8

FIXTURES = Path(__file__).parent / "fixtures"


class FakeClock:
    def __init__(self):
        self.now = 1000.0
        self.sleeps = []

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


class FakeResponse:
    def __init__(self, text, status=200):
        self.text = text
        self.status_code = status
        self.headers = {"Content-Type": "text/html"}
        self.encoding = None

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def make_client(responses, clock=None, **kwargs):
    clock = clock or FakeClock()
    session = FakeSession(responses)
    client = banner8.Banner8Client(session=session, clock=clock.time, sleep=clock.sleep, **kwargs)
    return client, session, clock


def test_term_options_are_read_from_the_dropdown():
    html = (FIXTURES / "banner8-terms-synthetic.html").read_text(encoding="utf-8")
    terms = banner8.parse_term_options(html)
    by_id = {t.term_id: t for t in terms}
    assert by_id["2026FA"].code == "202680"
    assert by_id["2027SP"].label == "Spring 2027"
    assert by_id["2027FA"].view_only is True
    assert by_id["2026FA"].view_only is False
    assert "None" not in [t.label for t in terms]
    assert all("Intersession" not in t.label for t in terms)
    assert by_id["2007FA"].code == "200780"


def test_missing_dropdown_fails_loudly():
    with pytest.raises(banner8.Banner8Error):
        banner8.parse_term_options("<html><body>Maintenance</body></html>")


def test_search_form_matches_the_standard_banner_8_fields():
    data = banner8.search_form_data("202680", "ENGR")
    names = [k for k, _ in data]
    assert data[0] == ("term_in", "202680")
    for name in ("sel_subj", "sel_day", "sel_schd", "sel_insm", "sel_camp", "sel_levl", "sel_sess", "sel_instr", "sel_ptrm", "sel_attr"):
        assert (name, "dummy") in data
    assert names.index("sel_subj") < data.index(("sel_subj", "ENGR"))
    assert ("sel_subj", "ENGR") in data
    assert ("sel_crse", "") in data and ("sel_title", "") in data
    assert ("sel_schd", "%") in data and ("sel_levl", "%") in data
    # the dummy values come before the real ones for every repeated field
    assert data.index(("sel_subj", "dummy")) < data.index(("sel_subj", "ENGR"))


def test_fetch_posts_the_search_form():
    client, session, _ = make_client([FakeResponse("<html>ok</html>")])
    html = client.fetch_subject("202680", "MATH")
    assert html == "<html>ok</html>"
    method, url, kwargs = session.calls[0]
    assert method == "POST"
    assert url == "https://ssb.mtsu.edu/pls/PROD/bwckschd.p_get_crse_unsec"
    assert ("sel_subj", "MATH") in kwargs["data"]


def test_get_terms_reads_the_term_page():
    html = (FIXTURES / "banner8-terms-synthetic.html").read_text(encoding="utf-8")
    client, session, _ = make_client([FakeResponse(html)])
    assert len(client.get_terms()) == 8
    assert session.calls[0][:2] == ("GET", "https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched")


def test_at_least_three_seconds_pass_between_requests():
    client, _, clock = make_client([FakeResponse("a"), FakeResponse("b"), FakeResponse("c")])
    times = []
    original = client._request

    def spy(*args, **kwargs):
        result = original(*args, **kwargs)
        times.append(clock.now)
        return result

    client._request = spy
    for subject in ("ENGR", "MATH", "PHYS"):
        client.fetch_subject("202680", subject)
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert all(gap >= 3.0 for gap in gaps), gaps


def test_the_wait_cannot_be_set_below_three_seconds():
    with pytest.raises(ValueError):
        banner8.Banner8Client(session=FakeSession([]), min_interval=2.0)


def test_failed_requests_retry_with_a_pause_then_give_up():
    client, session, clock = make_client(
        [requests.ConnectionError("down"), requests.ConnectionError("down"), requests.ConnectionError("down")],
        retries=2, backoff=10.0,
    )
    with pytest.raises(banner8.Banner8Error):
        client.fetch_subject("202680", "ENGR")
    assert len(session.calls) == 3
    assert sum(clock.sleeps) >= 3 * 3.0 - 3.0  # every retry also respects the three-second spacing


def test_a_retry_can_succeed():
    client, session, _ = make_client([FakeResponse("", status=503), FakeResponse("<html>ok</html>")])
    assert client.fetch_subject("202680", "ENGR") == "<html>ok</html>"
    assert len(session.calls) == 2


def test_raw_pages_are_saved_under_term_and_subject(tmp_path):
    path = banner8.save_raw(tmp_path, "2026FA", "ENGR", "<html>raw</html>")
    assert path == tmp_path / "schedule" / "raw" / "2026FA" / "ENGR.html"
    assert path.read_text(encoding="utf-8") == "<html>raw</html>"
