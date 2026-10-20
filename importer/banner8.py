"""Adapter for MTSU's public Banner 8 dynamic schedule.

This is the only module that knows how MTSU's site works: the page addresses, the term drop-down,
and the form fields. When MTSU moves to Banner 9, replace this module with one that offers the same
three things (get_terms, fetch_subject, save_raw) and leave parse.py alone.

The client waits at least three seconds between requests to be polite to the university's server.
"""

import time
from dataclasses import dataclass
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString

from terms import term_id_from_label

BASE_URL = "https://ssb.mtsu.edu/pls/PROD/"
TERM_PAGE_URL = BASE_URL + "bwckschd.p_disp_dyn_sched"
SEARCH_URL = BASE_URL + "bwckschd.p_get_crse_unsec"
MIN_INTERVAL_SECONDS = 3.0
USER_AGENT = "mtsu-degree-planner/0.1 (student project; reads the public class schedule slowly)"


class Banner8Error(Exception):
    """The site did not answer the way the adapter expects."""


@dataclass(frozen=True)
class BannerTerm:
    code: str        # value from the drop-down, sent back as term_in
    label: str       # text shown in the drop-down
    term_id: str     # our id, for example 2026FA
    view_only: bool


class Throttle:
    """Make sure at least `min_interval` seconds pass between calls to wait()."""

    def __init__(self, min_interval, clock=time.monotonic, sleep=time.sleep):
        self.min_interval = min_interval
        self._clock = clock
        self._sleep = sleep
        self._last = None

    def wait(self):
        if self._last is not None:
            remaining = self.min_interval - (self._clock() - self._last)
            if remaining > 0:
                self._sleep(remaining)
        self._last = self._clock()


def _option_text(option):
    """The option's own text. Banner leaves <option> tags unclosed, so the parser nests them."""
    return " ".join("".join(c for c in option.contents if isinstance(c, NavigableString)).split())


def parse_term_options(html):
    """Read the term drop-down from the dynamic schedule page.

    Returns a list of BannerTerm, newest first as listed on the page. Options that are not
    fall, spring, or summer terms are skipped, and so are duplicates of a term id already seen.
    """
    soup = BeautifulSoup(html, "html.parser")
    select = soup.find("select", attrs={"name": "p_term"})
    if select is None:
        for candidate in soup.find_all("select"):
            if any(term_id_from_label(_option_text(o)) for o in candidate.find_all("option")):
                select = candidate
                break
    if select is None:
        raise Banner8Error("The schedule page has no term drop-down. The site layout may have changed.")
    terms = []
    seen = set()
    for option in select.find_all("option"):
        code = (option.get("value") or "").strip()
        label = _option_text(option)
        term_id = term_id_from_label(label)
        if not code or term_id is None or term_id in seen:
            continue
        seen.add(term_id)
        terms.append(BannerTerm(code=code, label=label, term_id=term_id, view_only="view only" in label.lower()))
    if not terms:
        raise Banner8Error("The term drop-down has no fall, spring, or summer terms.")
    return terms


def search_form_data(term_code, subject):
    """The fields the standard Banner 8 class search sends, as a list of pairs (some names repeat)."""
    data = [("term_in", term_code)]
    data += [(name, "dummy") for name in (
        "sel_subj", "sel_day", "sel_schd", "sel_insm", "sel_camp",
        "sel_levl", "sel_sess", "sel_instr", "sel_ptrm", "sel_attr",
    )]
    data += [
        ("sel_subj", subject),
        ("sel_crse", ""),
        ("sel_title", ""),
        ("sel_schd", "%"),
        ("sel_insm", "%"),
        ("sel_from_cred", ""),
        ("sel_to_cred", ""),
        ("sel_camp", "%"),
        ("sel_levl", "%"),
        ("sel_ptrm", "%"),
        ("sel_instr", "%"),
        ("sel_attr", "%"),
        ("begin_hh", "0"), ("begin_mi", "0"), ("begin_ap", "a"),
        ("end_hh", "0"), ("end_mi", "0"), ("end_ap", "a"),
    ]
    return data


class Banner8Client:
    def __init__(self, session=None, min_interval=MIN_INTERVAL_SECONDS, clock=time.monotonic,
                 sleep=time.sleep, timeout=90, retries=2, backoff=10.0):
        if min_interval < MIN_INTERVAL_SECONDS:
            raise ValueError(f"The wait between requests must be at least {MIN_INTERVAL_SECONDS:g} seconds.")
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self.throttle = Throttle(min_interval, clock=clock, sleep=sleep)
        self.timeout = timeout
        self.retries = retries
        self.backoff = backoff
        self._sleep = sleep

    def _request(self, method, url, **kwargs):
        last_error = None
        for attempt in range(self.retries + 1):
            self.throttle.wait()
            try:
                response = self.session.request(method, url, timeout=self.timeout, **kwargs)
                response.raise_for_status()
                return _decode(response)
            except requests.RequestException as error:
                last_error = error
                if attempt < self.retries:
                    self._sleep(self.backoff * (attempt + 1))
        raise Banner8Error(f"Request to {url} failed after {self.retries + 1} tries: {last_error}")

    def get_terms(self):
        """Read the term list and term codes from the dynamic schedule page."""
        return parse_term_options(self._request("GET", TERM_PAGE_URL))

    def fetch_subject(self, term_code, subject):
        """Submit the class search for one term and subject. Returns the raw HTML."""
        return self._request("POST", SEARCH_URL, data=search_form_data(term_code, subject))


def _decode(response):
    content_type = response.headers.get("Content-Type", "")
    if "charset" not in content_type.lower():
        response.encoding = "utf-8"
    return response.text


def raw_path(data_dir, term_id, subject):
    return Path(data_dir) / "schedule" / "raw" / term_id / f"{subject}.html"


def save_raw(data_dir, term_id, subject, html):
    """Save the raw HTML so the parser can run again without asking the site."""
    path = raw_path(data_dir, term_id, subject)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return path
