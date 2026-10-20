# Data Format

All data files are JSON. Course identifiers use the subject, one space, and the number: `"ENGR 3540"`. Terms use a four-digit year and a season code: `2026FA`, `2027SP`, `2027SU`.

## Catalog file: `data/catalogs/<year>.json`

```json
{
  "catalog_year": "2026-27",
  "program": "Mechatronics Engineering, B.S.",
  "total_hours": 128,
  "sources": [
    "https://catalog.mtsu.edu/mime/media/view/49/12672/"
  ],
  "standing_hours": { "sophomore": 30, "junior": 60, "senior": 90 },
  "milestones": [
    { "id": "senior-design", "label": "Senior design", "courses": ["ENGR 4580", "ENGR 4590"] }
  ],
  "courses": {
    "ENGR 3540": {
      "title": "Course title from the catalog",
      "credits": 3,
      "components": ["ENGR 3540"],
      "prereqs": {
        "all": [
          "MATH 3120",
          "ENGR 3520",
          { "course": "ENGR 3530", "concurrent_ok": true }
        ]
      },
      "standing": null,
      "suggested_term": "senior-fall",
      "notes": "Academic map and course description agree."
    },
    "CHEM 1110": {
      "title": "Course title from the catalog",
      "credits": 4,
      "components": ["CHEM 1110", "CHEM 1111"],
      "prereqs": null,
      "standing": null,
      "suggested_term": "freshman-fall",
      "notes": "Planned as one unit: lecture CHEM 1110 plus lab CHEM 1111."
    }
  },
  "requirements": [
    { "id": "major-core", "type": "all", "courses": ["ENGR 1100", "ENGR 2100"] },
    {
      "id": "engr-elective",
      "type": "choose",
      "count": 1,
      "options": ["ENGR 4540", "ENGR 4550", "ENGR 4560"],
      "suggested_term": "junior-spring"
    },
    {
      "id": "tbc-history",
      "type": "placeholder",
      "label": "History and Civic Learning",
      "hours": 6,
      "suggested_terms": ["junior-summer", "senior-spring"]
    }
  ]
}
```

### Field rules

- `credits`: total hours for the planning unit, including any lab component.
- `components`: the course numbers that need a section in the schedule. A lecture and its required lab form one unit with two components.
- `prereqs`: `null`, or an expression built from:
  - a course identifier string, meaning "completed in an earlier term";
  - an object `{ "course": "...", "concurrent_ok": true, "min_grade": "C" }`, where `concurrent_ok` allows the same term and `min_grade` is recorded but not enforced in the proof of concept;
  - `{ "all": [ ... ] }` and `{ "any": [ ... ] }`, which nest.
- `standing`: `null`, `"junior"`, or `"senior"`, checked against completed hours using `standing_hours`.
- `suggested_term`: the academic map position, `<year>-<season>` with year `freshman`, `sophomore`, `junior`, or `senior` and season `fall`, `spring`, or `summer`. Used for graph layout and as the baseline plan.
- `notes`: required whenever sources disagree or a value needs a human check. Start such notes with `CHECK:`.
- `requirements`: every course in `courses` must appear in exactly one requirement. Placeholder requirements reserve hours only.

## Schedule file: `data/schedule/<term_code>.json`

```json
{
  "term": "2026FA",
  "term_label": "Fall 2026",
  "banner_term_code": "value from the term dropdown",
  "imported_at": "2026-10-21T14:00:00Z",
  "source": "https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched",
  "subjects": ["ENGR", "MATH", "PHYS", "CHEM", "CSCI"],
  "sections": [
    {
      "crn": "12345",
      "course": "ENGR 3540",
      "section": "001",
      "title": "Title as listed",
      "credits": 3,
      "schedule_type": "Lecture",
      "instructional_method": "Face-to-face",
      "part_of_term": "1",
      "instructor": "Name as listed",
      "meetings": [
        {
          "days": "TR",
          "start": "09:40",
          "end": "11:05",
          "location": "Building and room as listed",
          "start_date": "2026-08-24",
          "end_date": "2026-12-11"
        }
      ]
    }
  ]
}
```

- `days` uses M, T, W, R, F, S, U. Online sections with no meeting time have an empty `meetings` list and never conflict.
- Times are 24-hour local time.
- Two meetings overlap only when their days share a letter, their times overlap, and their date ranges overlap.

## Offering patterns: `data/offerings.json`

```json
{
  "derived_at": "2026-10-21T14:05:00Z",
  "terms_covered": ["2018FA", "2026FA"],
  "rule": "regular = offered in the season in at least 3 of the last 4 years; occasional = 1 or 2",
  "courses": {
    "ENGR 3540": {
      "fall": [2022, 2023, 2024, 2025, 2026],
      "spring": [],
      "summer": [],
      "regular_seasons": ["fall"],
      "occasional_seasons": []
    }
  }
}
```

## What-if edits

Saved in browser state and in exported files as an ordered list. Each edit applies on top of the previous ones.

```json
[
  { "type": "set_prereqs", "course": "ENGR 4580", "prereqs": { "all": ["ENGR 3590"] } },
  { "type": "set_seasons", "course": "ENGR 3530", "regular_seasons": ["fall"] },
  { "type": "set_credits", "course": "ENGR 2100", "credits": 3 },
  { "type": "move_requirement", "course": "ENGR 3970", "to": "engr-elective" },
  {
    "type": "set_meeting_pattern",
    "course": "ENGR 3510",
    "term": "2027SP",
    "meetings": [{ "days": "W", "start": "13:00", "end": "16:00" }]
  }
]
```

## Student state

```json
{
  "catalog_year": "2026-27",
  "start_term": "2026FA",
  "completed": ["MATH 1730", "ENGL 1010"],
  "in_progress": [],
  "options": { "summer_allowed": false, "max_credits": 18, "summer_max_credits": 8 },
  "edits": []
}
```
