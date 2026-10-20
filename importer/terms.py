"""Term helpers shared by the importer modules.

A term id is a four-digit year plus FA, SP, or SU, for example 2026FA.
Terms run fall, spring, summer inside one academic year.
"""

import re

SEASON_CODES = ["FA", "SP", "SU"]
SEASON_NAMES = {"FA": "fall", "SP": "spring", "SU": "summer"}
LABEL_BY_CODE = {"FA": "Fall", "SP": "Spring", "SU": "Summer"}
CODE_BY_LABEL = {"fall": "FA", "spring": "SP", "summer": "SU"}

_TERM_ID = re.compile(r"^(\d{4})(FA|SP|SU)$")
_TERM_LABEL = re.compile(r"\b(Fall|Spring|Summer)\b[^0-9]*?(\d{4})", re.IGNORECASE)


def parse_term(term_id):
    """Return (year, season code) for a term id, or raise ValueError."""
    match = _TERM_ID.match(term_id)
    if not match:
        raise ValueError(f"Invalid term {term_id!r}. Use a year and FA, SP, or SU, for example 2026FA.")
    return int(match.group(1)), match.group(2)


def term_index(term_id):
    """Position of a term on one line: three terms per academic year."""
    year, code = parse_term(term_id)
    academic_year = year if code == "FA" else year - 1
    return academic_year * 3 + SEASON_CODES.index(code)


def term_from_index(index):
    academic_year, position = divmod(index, 3)
    code = SEASON_CODES[position]
    return f"{academic_year if code == 'FA' else academic_year + 1}{code}"


def term_label(term_id):
    year, code = parse_term(term_id)
    return f"{LABEL_BY_CODE[code]} {year}"


def season_name(term_id):
    return SEASON_NAMES[parse_term(term_id)[1]]


def term_id_from_label(label):
    """Turn a drop-down label such as 'Fall 2026 (View only)' into '2026FA'. Return None if it is not a term."""
    match = _TERM_LABEL.search(label or "")
    if not match:
        return None
    return f"{match.group(2)}{CODE_BY_LABEL[match.group(1).lower()]}"
