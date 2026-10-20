"""Derive offering patterns from all imported schedule files.

For each course, record the years it ran in fall, spring, and summer. A course counts as regularly
offered in a season if it ran in that season in at least 3 of the last 4 years, and occasionally
offered if it ran in 1 or 2 of them.

"The last 4 years" means the last four years for which a schedule file exists for that season.
A year with no schedule file does not count against a course.
"""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from terms import SEASON_NAMES, parse_term, term_index

RULE = "regular = offered in the season in at least 3 of the last 4 years; occasional = 1 or 2"
WINDOW_YEARS = 4
REGULAR_MIN = 3
SEASON_ORDER = ["fall", "spring", "summer"]
_SCHEDULE_FILE = re.compile(r"^\d{4}(FA|SP|SU)\.json$")


def load_schedules(schedule_dir):
    """Read every <term>.json in the schedule directory. Returns a list of schedule dicts."""
    schedules = []
    for path in sorted(Path(schedule_dir).glob("*.json")):
        if _SCHEDULE_FILE.match(path.name):
            schedules.append(json.loads(path.read_text(encoding="utf-8")))
    return schedules


def derive(schedules, now=None):
    """Build the offerings document from a list of schedule dicts."""
    now = now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    covered = {season: set() for season in SEASON_ORDER}
    years = {}
    term_ids = []
    for schedule in schedules:
        term_id = schedule["term"]
        year, code = parse_term(term_id)
        season = SEASON_NAMES[code]
        covered[season].add(year)
        term_ids.append(term_id)
        for section in schedule.get("sections", []):
            course_years = years.setdefault(section["course"], {s: set() for s in SEASON_ORDER})
            course_years[season].add(year)

    windows = {season: sorted(covered[season])[-WINDOW_YEARS:] for season in SEASON_ORDER}
    courses = {}
    for course in sorted(years):
        entry = {}
        regular, occasional = [], []
        for season in SEASON_ORDER:
            ran = sorted(years[course][season])
            entry[season] = ran
            count = len(set(ran) & set(windows[season]))
            if count >= REGULAR_MIN:
                regular.append(season)
            elif count >= 1:
                occasional.append(season)
        entry["regular_seasons"] = regular
        entry["occasional_seasons"] = occasional
        courses[course] = entry

    ordered = sorted(term_ids, key=term_index)
    return {
        "derived_at": now,
        "terms_covered": [ordered[0], ordered[-1]] if ordered else [],
        "windows": windows,
        "rule": RULE,
        "courses": courses,
    }


def derive_from_directory(data_dir, now=None):
    return derive(load_schedules(Path(data_dir) / "schedule"), now=now)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Derive data/offerings.json from the imported schedule files.")
    parser.add_argument("--data-dir", default="data", help="Folder that holds schedule/ (default: data)")
    args = parser.parse_args(argv)
    result = derive_from_directory(args.data_dir)
    out = Path(args.data_dir) / "offerings.json"
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out} for {len(result['courses'])} courses.")


if __name__ == "__main__":
    main()
