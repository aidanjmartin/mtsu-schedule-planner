# MTSU Mechatronics Degree Planner: Proof of Concept Specification

## Purpose

Students in the Mechatronics Engineering B.S. program fall behind on the prerequisite chain into senior design (ENGR 4580 in fall, then ENGR 4590 in spring). A one-semester slip early in the chain can become a one-year slip when the downstream courses run only once a year. MTSU's existing tools show section times only for terms open for registration and do not model hypothetical changes.

This proof of concept answers four questions for one student or one hypothetical change:

1. Which courses sit on the critical path to senior design and graduation, and how many semesters can each one slip?
2. Given the courses a student has completed, what term-by-term plan gets them to graduation soonest?
3. For the next term, which section combinations fit together without time overlaps, and which course pairs cannot fit at all?
4. If the department changes a course (prerequisites, offered terms, required or elective status, meeting pattern), how do the answers to 1 through 3 change?

## Scope

In scope:

- Mechatronics Engineering B.S., catalog year 2026-27. The data format supports more catalog years; earlier years come later.
- Every student starts in MATH 1910 (Calculus I). Students who start in precalculus are out of scope.
- Fall and spring terms only. Summer terms are out of scope for planning and for the schedule import.
- Courses with subject ENGR, MATH, PHYS, CHEM, and CSCI. Section times come from MTSU's public schedule.
- General education (True Blue Core) requirements as placeholders with credit hours and preferred terms. The planner reserves hours for them but does not schedule their sections.
- A single web page that runs entirely in the browser. No server, no accounts, and no student data leaves the device.

Out of scope for the proof of concept: career-track elective optimization, the buddy system, minors, transfer credit rules, grade-based rules beyond pass/fail, and department-wide forecasts.

## Components

### 1. Catalog data (hand-encoded)

One file per catalog year, in the format defined in `DATA_FORMAT.md`. Prerequisites come from the course descriptions at catalog.mtsu.edu, reached through the Requirements section of the program page (https://www.mtsu.edu/program/mechatronics-engineering-b-s/), cross-checked against the academic map notes. When the two sources disagree, the file uses the course description and records the disagreement in a `notes` field. Nothing is silently resolved.

### 2. Schedule importer (Python)

Reads MTSU's public Banner 8 dynamic schedule at `https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched`:

- Reads the term list and term codes from that page's term dropdown.
- Submits the class search form (`bwckschd.p_get_crse_unsec`) once per term and subject, waiting at least 3 seconds between requests.
- Saves the raw HTML for each request and parses it into the schedule format in `DATA_FORMAT.md`.
- Covers fall and spring terms from Fall 2018 through the newest term listed, for the five subjects in scope. Summer terms are skipped unless the importer runs with `--include-summer`.

Where it runs: this cloud workspace cannot reach ssb.mtsu.edu. The importer runs as a GitHub Actions workflow (manual trigger plus a monthly schedule) that commits the parsed files back to the repository. If GitHub's servers are blocked, the fallback is running the same script on the owner's computer.

Known risk: MTSU is moving registration to Banner 9 (SSB9) during the 2026-27 academic year. As of October 20, 2026, the old dynamic schedule page lists terms from Fall 2007 through Spring 2027 (view only), so it still covers every term the proof of concept needs. The importer keeps all site-specific logic in one adapter module so a Banner 9 adapter can replace it without touching the parser output format.

### 3. Offering patterns (derived)

A script reads all imported terms and records, for each course, the years it ran in fall, spring, and summer. A course counts as regularly offered in a season if it ran in that season in at least 3 of the last 4 years, and occasionally offered if it ran in 1 or 2 of them. The planner uses regular offerings by default. Every pattern can be overridden in the what-if panel.

### 4. Planning engine (JavaScript, browser and Node)

Pure functions with no page dependencies, so tests run in Node.

- **Validation.** Detects prerequisite cycles, references to unknown courses, and requirements that no course satisfies.
- **Critical path and slack.** Given a start term, completed courses, offering patterns, and a target graduation term, a forward pass computes each course's earliest possible term and a backward pass computes its latest allowable term. Slack is the number of terms between them. Courses with zero slack form the critical path. Prerequisites marked "may be taken concurrently" allow the same term.
- **Term-by-term planner.** Each term, the planner takes every course that is offered that term and has its prerequisites met, sorts them by least slack and then by longest chain of courses that depend on them, and fills the term up to the credit limit (default 18 in fall and spring, 0 in summer unless the student allows summer, then 8). It reserves general education hours in their preferred terms. Output: the plan, the projected graduation term, and the courses that set that date. This rule produces a good plan but does not guarantee the best one; an exact solver can replace it after the proof of concept.
- **Section timetabling.** For the courses planned in one term, it searches section combinations (a lecture and its paired lab count as one choice when the catalog lists them as one planning unit) and returns combinations with no time overlaps, ranked by fewest campus days and fewest classes before 9:00 a.m. When no combination exists, it reports the smallest set of courses that conflict and, using slack, which of them can move to a later term without delaying graduation.
- **What-if changes.** A list of edits applied on top of the catalog and schedule data: change a prerequisite, change offered seasons, change credits, move a course between required and elective, or replace a course's meeting pattern (for example, two 2.5-hour lecture and lab meetings per week becoming one 3-hour lecture block). Every result screen shows the difference from the unchanged baseline.

### 5. Web page

One page with four views:

- **Graph.** Courses as nodes in columns by suggested term, prerequisite edges, corequisite edges drawn dashed, critical path highlighted, slack shown on each node. Uses Cytoscape.js with the dagre layout, loaded from cdnjs.
- **Plan.** The student checks off completed courses and picks a start term and options (summer allowed, credit limit). The page shows the term-by-term plan and the projected senior design start.
- **Next term.** A weekly grid of the best section combination, with alternatives and conflict explanations.
- **What-if.** The edit list with baseline comparisons.

State (completed courses, options, edits) saves to browser storage, wrapped so the page still works when storage is unavailable, and can be exported and imported as a JSON file. A build script inlines the scripts and data into one HTML file for publishing.

## Repository layout

```
README.md
docs/SPEC.md
docs/DATA_FORMAT.md
data/catalogs/2026-27.json
data/schedule/raw/<term_code>/<subject>.html
data/schedule/<term_code>.json
data/offerings.json
importer/            Python: adapter, parser, offering derivation
web/                 HTML, CSS, JavaScript modules
web/engine/          planning engine
tests/               Node tests for the engine, pytest tests for the parser
tools/build.py       produces dist/planner.html
.github/workflows/import-schedule.yml
```

## Acceptance checks

The proof of concept is done when all of these pass:

1. The 2026-27 catalog file validates, and every prerequisite matches its source, with each disagreement between course description and academic map listed in `notes`.
2. The 2026-27 academic map's suggested schedule passes the engine's prerequisite check with no violations.
3. The parser reproduces the expected sections from saved HTML samples of at least one fall and one spring term.
4. The offering-pattern file covers every ENGR course in the 2026-27 catalog.
5. A student starting with MATH 1730 in Fall 2026 and a student starting with MATH 1910 in Fall 2026 both receive plans, and the page shows the senior design start term for each, along with the courses responsible for any difference.
6. A test schedule with two known overlapping sections produces a conflict report naming both courses.
7. A what-if edit that makes ENGR 3530 fall-only changes the critical path, and the page shows the difference from the baseline.

## Team and workflow

- Coordinator (Opus, the main conversation): owns this specification and the data format, assigns tasks, reviews every result, and relays results between agents.
- Builder (Sonnet): importer, planning engine, web page, build script, tests.
- Data and checker (Haiku): encodes both catalog files from primary sources, then checks the engine's outputs against the academic maps and acceptance checks.

Agents coordinate through this file, `DATA_FORMAT.md`, and the task list. The coordinator commits reviewed work to the GitHub repository.
