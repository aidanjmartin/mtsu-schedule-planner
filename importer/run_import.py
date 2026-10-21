"""Command line entry point for the schedule importer.

Examples (run from the repository root):

    python importer/run_import.py                          # every term from Fall 2018 to the newest listed
    python importer/run_import.py --first 2026FA --last 2027SP
    python importer/run_import.py --subjects ENGR MATH
    python importer/run_import.py --reparse                # parse saved HTML again, with no web requests

For each term and subject the importer saves the raw HTML under data/schedule/raw/<term>/<subject>.html,
parses it into data/schedule/<term>.json, lists the terms in data/schedule/index.json, and finally
writes data/offerings.json. It waits at least three seconds between web requests.
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import banner8
import derive_offerings
import parse
from terms import term_index, term_label

DEFAULT_SUBJECTS = ["ENGR", "MATH", "PHYS", "CHEM", "CSCI"]
DEFAULT_FIRST = "2018FA"
VOLATILE_KEYS = ("imported_at", "derived_at")

log = logging.getLogger("import")


def write_json_if_changed(path, document):
    """Write a JSON file only when its content changed, ignoring the timestamp fields.

    This keeps monthly runs from creating commits when the schedule has not changed.
    """
    path = Path(path)
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old = None
        if old is not None:
            strip = lambda d: {k: v for k, v in d.items() if k not in VOLATILE_KEYS}  # noqa: E731
            if strip(old) == strip(document):
                return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def select_terms(available, first, last):
    """Pick the terms from `available` (BannerTerm list) between first and last, oldest first."""
    lo = term_index(first)
    hi = term_index(last) if last else None
    chosen = [t for t in available if term_index(t.term_id) >= lo and (hi is None or term_index(t.term_id) <= hi)]
    return sorted(chosen, key=lambda t: term_index(t.term_id))


def parse_term_files(data_dir, term_id, term_name, banner_code, subjects, imported_at):
    """Parse the saved HTML for one term. Returns the schedule dict, or None if a subject file is missing."""
    sections = []
    for subject in subjects:
        path = banner8.raw_path(data_dir, term_id, subject)
        if not path.exists():
            log.error("Missing saved page %s", path)
            return None
        try:
            sections += parse.parse_sections(path.read_text(encoding="utf-8"))
        except parse.ParseError as error:
            log.error("%s %s: %s", term_id, subject, error)
            return None
    return parse.build_schedule(term_id, term_name, banner_code, subjects, sections, imported_at)


def write_index(data_dir):
    """List the schedule terms on disk so the web page knows which files to load."""
    schedule_dir = Path(data_dir) / "schedule"
    entries = []
    for path in schedule_dir.glob("*.json"):
        if path.name == "index.json":
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        entries.append({"term": doc["term"], "term_label": doc.get("term_label", term_label(doc["term"]))})
    entries.sort(key=lambda e: term_index(e["term"]))
    write_json_if_changed(schedule_dir / "index.json", {"terms": entries})


def run(args, client=None):
    data_dir = Path(args.data_dir)
    subjects = args.subjects
    imported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    failures = 0

    if args.reparse:
        raw_root = data_dir / "schedule" / "raw"
        found = sorted((p.name for p in raw_root.iterdir() if p.is_dir()), key=term_index) if raw_root.exists() else []
        wanted = [t for t in found if term_index(t) >= term_index(args.first) and (not args.last or term_index(t) <= term_index(args.last))]
        plan = []
        for term_id in wanted:
            existing = data_dir / "schedule" / f"{term_id}.json"
            code = json.loads(existing.read_text(encoding="utf-8")).get("banner_term_code", "") if existing.exists() else ""
            plan.append((term_id, term_label(term_id), code))
    else:
        client = client or banner8.Banner8Client(min_interval=args.min_interval)
        available = client.get_terms()
        log.info("The site lists %d terms, from %s to %s.", len(available),
                 min(available, key=lambda t: term_index(t.term_id)).label,
                 max(available, key=lambda t: term_index(t.term_id)).label)
        chosen = select_terms(available, args.first, args.last)
        if not chosen:
            log.error("No listed term falls between %s and %s.", args.first, args.last or "the newest term")
            return 1
        plan = [(t.term_id, term_label(t.term_id), t.code) for t in chosen]

    if not args.include_summer:
        plan = [entry for entry in plan if not entry[0].endswith("SU")]

    for term_id, name, code in plan:
        log.info("Term %s (%s)", term_id, name)
        if not args.reparse:
            ok = True
            for subject in subjects:
                try:
                    html = client.fetch_subject(code, subject)
                except banner8.Banner8Error as error:
                    log.error("%s %s: %s", term_id, subject, error)
                    ok = False
                    break
                banner8.save_raw(data_dir, term_id, subject, html)
                log.info("  saved %s %s (%d bytes)", term_id, subject, len(html))
            if not ok:
                failures += 1
                continue
        schedule = parse_term_files(data_dir, term_id, name, code, subjects, imported_at)
        if schedule is None:
            failures += 1
            continue
        changed = write_json_if_changed(data_dir / "schedule" / f"{term_id}.json", schedule)
        log.info("  %d sections (%s)", len(schedule["sections"]), "updated" if changed else "unchanged")

    if (data_dir / "schedule").exists():
        write_index(data_dir)
        offerings = derive_offerings.derive_from_directory(data_dir)
        changed = write_json_if_changed(data_dir / "offerings.json", offerings)
        log.info("Offering patterns for %d courses (%s).", len(offerings["courses"]), "updated" if changed else "unchanged")
    if failures:
        log.error("%d term(s) did not finish. Their schedule files were left as they were.", failures)
    return 1 if failures else 0


def build_parser():
    parser = argparse.ArgumentParser(description="Import MTSU class schedules and derive offering patterns.")
    parser.add_argument("--first", default=DEFAULT_FIRST, help="first term to import, for example 2018FA (default: %(default)s)")
    parser.add_argument("--last", default=None, help="last term to import, for example 2027SP (default: the newest term listed)")
    parser.add_argument("--subjects", nargs="+", default=DEFAULT_SUBJECTS, help="subject codes (default: %(default)s)")
    parser.add_argument("--data-dir", default="data", help="data folder (default: %(default)s)")
    parser.add_argument("--min-interval", type=float, default=banner8.MIN_INTERVAL_SECONDS,
                        help="seconds to wait between web requests; the minimum is 3 (default: %(default)s)")
    parser.add_argument("--include-summer", action="store_true", help="also import summer terms (skipped by default)")
    parser.add_argument("--reparse", action="store_true", help="parse the saved HTML again without any web requests")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    try:
        term_index(args.first)
        if args.last:
            term_index(args.last)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
