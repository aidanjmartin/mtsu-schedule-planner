"""Turn the raw Banner 8 class listing into the schedule format described in docs/DATA_FORMAT.md.

The parser reads the standard "datadisplaytable" layout: each section has a title link
("Title - CRN - SUBJ NUM - SEC"), a few detail lines, and a table of meeting times with the columns
Type, Time, Days, Where, Date Range, Schedule Type, and Instructors.
"""

import re
from datetime import datetime

from bs4 import BeautifulSoup

SOURCE_URL = "https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched"
VALID_DAYS = set("MTWRFSU")


class ParseError(Exception):
    """The page is not a class listing the parser understands."""


def parse_time_range(text):
    """'9:40 am - 11:05 am' -> ('09:40', '11:05'). Returns None for TBA or anything unreadable."""
    match = re.match(r"^\s*(\d{1,2}):(\d{2})\s*([ap])m?\s*-\s*(\d{1,2}):(\d{2})\s*([ap])m?\s*$", text or "", re.IGNORECASE)
    if not match:
        return None
    h1, m1, p1, h2, m2, p2 = match.groups()
    return _to_24h(int(h1), int(m1), p1), _to_24h(int(h2), int(m2), p2)


def _to_24h(hour, minute, meridiem):
    hour = hour % 12
    if meridiem.lower() == "p":
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def parse_date_range(text):
    """'Aug 24, 2026 - Dec 11, 2026' -> ('2026-08-24', '2026-12-11'). Returns (None, None) when unreadable."""
    parts = [p.strip() for p in (text or "").split(" - ")]
    if len(parts) != 2:
        return None, None
    try:
        return tuple(datetime.strptime(p, "%b %d, %Y").strftime("%Y-%m-%d") for p in parts)
    except ValueError:
        return None, None


def parse_days(text):
    """Return the day letters (M, T, W, R, F, S, U) in the text. Blank or TBA gives an empty string."""
    letters = "".join((text or "").upper().split())
    if not letters or any(c not in VALID_DAYS for c in letters):
        return ""
    return "".join(dict.fromkeys(letters))


def clean_instructors(text):
    """Remove the (P) primary markers and tidy spaces. Names stay as listed."""
    text = re.sub(r"\(\s*P\s*\)", "", text or "")
    text = re.sub(r"\s+,", ",", text)
    return " ".join(text.split())


def parse_credits(text):
    """'3.000' -> 3, '1.000 TO 3.000' -> 1 (the lowest value). Returns None if unreadable."""
    match = re.match(r"^\s*(\d+(?:\.\d+)?)", text or "")
    if not match:
        return None
    value = float(match.group(1))
    return int(value) if value == int(value) else value


def _cell_text(cell):
    return " ".join(cell.get_text(" ").replace("\xa0", " ").split())


def _detail_lines(cell):
    """Text lines of the detail cell, leaving out the nested meeting table."""
    clone = BeautifulSoup(str(cell), "html.parser")
    for table in clone.find_all("table"):
        table.decompose()
    text = clone.get_text("\n").replace("\xa0", " ")
    return [" ".join(line.split()) for line in text.split("\n") if line.strip()]


def _parse_meetings(table):
    rows = table.find_all("tr")
    if not rows:
        return [], {"schedule_type": None, "instructor": ""}
    headers = [_cell_text(th).lower() for th in rows[0].find_all(["th", "td"])]
    column = {name: i for i, name in enumerate(headers)}
    required = ("time", "days", "where", "date range")
    if any(name not in column for name in required):
        raise ParseError(f"The meeting table has unexpected columns: {headers}")

    meetings = []
    first_schedule_type = None
    instructors = []
    for row in rows[1:]:
        cells = row.find_all("td")
        if len(cells) < len(headers):
            continue

        def value(name):
            return _cell_text(cells[column[name]]) if name in column else ""

        if "exam" in value("type").lower():
            continue
        if first_schedule_type is None and value("schedule type"):
            first_schedule_type = value("schedule type")
        who = clean_instructors(value("instructors"))
        if who and who not in instructors:
            instructors.append(who)
        times = parse_time_range(value("time"))
        days = parse_days(value("days"))
        if times is None or not days:
            continue  # TBA or online with no meeting time
        start_date, end_date = parse_date_range(value("date range"))
        meetings.append({
            "days": days,
            "start": times[0],
            "end": times[1],
            "location": value("where"),
            "start_date": start_date,
            "end_date": end_date,
        })
    return meetings, {"schedule_type": first_schedule_type, "instructor": "; ".join(instructors)}


def _parse_title(text):
    """'Title - CRN - SUBJ NUM - SEC' -> (title, crn, course, section). The title may contain ' - '."""
    parts = text.rsplit(" - ", 3)
    if len(parts) != 4:
        raise ParseError(f"Cannot read the section heading: {text!r}")
    title, crn, course, section = (p.strip() for p in parts)
    if not re.fullmatch(r"\d{4,6}", crn) or not re.fullmatch(r"[A-Z]{2,5} \S+", course):
        raise ParseError(f"Cannot read the section heading: {text!r}")
    return title, crn, course, section


def parse_sections(html):
    """Parse one saved listing page into a list of section dicts.

    Raises ParseError when the page is neither a listing nor a clean "no classes found" page,
    so a changed site layout fails loudly instead of producing an empty schedule.
    """
    soup = BeautifulSoup(html, "html.parser")
    titles = soup.find_all("th", class_="ddtitle")
    if not titles:
        if "no classes were found" in soup.get_text(" ").lower():
            return []
        raise ParseError("The page has no section headings and no 'no classes found' message.")

    sections = []
    for th in titles:
        link = th.find("a")
        title, crn, course, section = _parse_title(_cell_text(link or th))
        row = th.find_parent("tr")
        detail_row = row.find_next_sibling("tr")
        detail = detail_row.find("td", class_="dddefault") if detail_row else None
        if detail is None:
            raise ParseError(f"Section {crn} has no detail cell.")

        schedule_type = None
        method = None
        credits = None
        part_of_term = "1"
        for line in _detail_lines(detail):
            if re.search(r"Schedule Type$", line):
                schedule_type = re.sub(r"\s*Schedule Type$", "", line)
            elif re.search(r"Instructional Method$", line):
                method = re.sub(r"\s*Instructional Method$", "", line)
            elif re.fullmatch(r"[\d.]+(?: TO [\d.]+)? Credits?", line, re.IGNORECASE):
                credits = parse_credits(line)
            elif line.lower().startswith("part of term"):
                part_of_term = line.split(":", 1)[-1].strip() or "1"

        table = detail.find("table")
        meetings, extra = ([], {"schedule_type": None, "instructor": ""}) if table is None else _parse_meetings(table)
        sections.append({
            "crn": crn,
            "course": course,
            "section": section,
            "title": title,
            "credits": credits,
            "schedule_type": schedule_type or extra["schedule_type"] or "",
            "instructional_method": method or "",
            "part_of_term": part_of_term,
            "instructor": extra["instructor"],
            "meetings": meetings,
        })
    return sections


def build_schedule(term_id, term_label, banner_term_code, subjects, sections, imported_at):
    """Assemble the schedule file for one term. Sections are sorted and repeated CRNs are dropped."""
    unique = {}
    for section in sections:
        unique.setdefault(section["crn"], section)
    ordered = sorted(unique.values(), key=lambda s: (s["course"], s["section"], s["crn"]))
    return {
        "term": term_id,
        "term_label": term_label,
        "banner_term_code": banner_term_code,
        "imported_at": imported_at,
        "source": SOURCE_URL,
        "subjects": list(subjects),
        "sections": ordered,
    }
