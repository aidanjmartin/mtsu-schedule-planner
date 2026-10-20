# MTSU Degree Planner

A proof of concept that helps Mechatronics Engineering B.S. students at MTSU plan the prerequisite chain into senior design. It answers four questions:

1. Which courses are on the critical path to senior design and graduation, and how many terms can each one slip?
2. Given the courses a student has finished, what term-by-term plan reaches graduation soonest?
3. For the next term, which section combinations fit without time overlaps, and which course pairs can never fit together?
4. If the department changes a course, how do the answers to 1 through 3 change?

The page runs entirely in the browser. There is no server and no account, and nothing a student enters leaves the device. The full specification is in `docs/SPEC.md` and the file formats are in `docs/DATA_FORMAT.md`.

## What is in the repository

| Folder or file | What it holds |
| --- | --- |
| `data/catalogs/` | One hand-encoded catalog file per catalog year. |
| `data/schedule/` | Parsed class schedules, one file per term, plus `index.json` that lists them. `raw/` keeps the saved web pages. |
| `data/offerings.json` | Which seasons each course regularly runs, derived from the schedules. |
| `importer/` | Python code that reads MTSU's public class schedule and derives offering patterns. |
| `web/` | The page (`index.html`, `app.js`, `styles.css`) and the planning engine in `web/engine/`. |
| `tests/` | Node tests for the engine and pytest tests for the importer and build script. |
| `tools/build.py` | Builds one self-contained page, `dist/planner.html`. |
| `.github/workflows/import-schedule.yml` | Runs the importer on GitHub and commits the results. |

## Run the tests

You need Node 18 or newer and Python 3.9 or newer.

```
pip install -r importer/requirements.txt pytest
node --test tests/
python3 -m pytest tests/
```

On Node 21 and newer, `node --test tests/` works through a small helper, `tests/index.js`. You can also run `npm test` or `node --test tests/*.test.mjs`.

The engine tests use a small synthetic catalog in `tests/fixtures/catalog-small.json`. The importer tests use synthetic HTML in `tests/fixtures/` that copies the layout of MTSU's Banner 8 class listing. Each of those files says it is synthetic. Replace them with saved real pages once the importer has run.

## Open the page while you work on it

Serve the repository root with any static web server, then open `web/index.html`:

```
python3 -m http.server 8000
```

Open `http://localhost:8000/web/index.html`. The page loads `data/catalogs/*.json`, `data/schedule/*.json`, and `data/offerings.json` when they exist.

- Without offering data, the page treats every course as regularly offered in its suggested season and says so at the top.
- Without schedule data, the Next term view explains that section times are missing. The other views still work.
- The graph libraries (Cytoscape.js, dagre, and cytoscape-dagre) load from `cdnjs.cloudflare.com`. If they cannot load, the Graph view shows a list instead.

## The four views

- **Graph.** Courses appear in columns by suggested term. Arrows point from a prerequisite to the course that needs it, and a dashed arrow means the prerequisite may be taken at the same time. Each course shows its slack. Courses with zero slack form the critical path and have a red outline.
- **Plan.** Check off finished courses, choose a start term, and set the credit limits. The page shows the term-by-term plan, the projected graduation term, the senior design start term, and the courses that set those dates. A comparison panel plans two starting points side by side, for example a student who starts with MATH 1730 and one who starts with MATH 1910, and names the courses responsible for any difference.
- **Next term.** A weekly grid shows the best section combination. Other combinations, course pairs that cannot fit, and conflict explanations appear below it.
- **What-if.** Add edits (change prerequisites, offered seasons, or credit hours, move a course between required and elective, or replace a meeting pattern). Every view then shows the difference from the unchanged baseline.

Your choices save in the browser's storage. If storage is blocked, the page still works but forgets your choices when you close it. Use **Export** to save your state as a JSON file and **Import** to load it again.

## How the planning engine works

The engine is plain JavaScript in `web/engine/`. Its functions are pure, so they run in the browser and in Node.

- `terms.js` converts term ids such as `2026FA` and builds the list of usable terms.
- `prereqs.js` reads prerequisite expressions, finds offered seasons, and resolves degree requirements.
- `validate.js` finds prerequisite cycles, unknown courses, and requirements no course can satisfy. It also checks any course-to-term placement, including the academic map's suggested schedule.
- `critical-path.js` runs a forward pass (earliest term) and a backward pass (latest term), and reports slack.
- `planner.js` fills each term with the courses that are offered and ready, ordered by least slack and then by the longest chain of dependent courses. It reserves general education hours first. This rule gives a good plan, not a guaranteed best plan.
- `timetable.js` searches section combinations, ranks them by fewest campus days and then fewest classes before 9:00 a.m., and explains conflicts.
- `whatif.js` applies edits to copies of the data and compares results with the baseline.

## Run the schedule importer on your computer

The importer reads MTSU's public Banner 8 class schedule at `https://ssb.mtsu.edu/pls/PROD/bwckschd.p_disp_dyn_sched`. It waits at least three seconds between requests and refuses to run faster.

```
pip install -r importer/requirements.txt
python3 importer/run_import.py                          # Fall 2018 through the newest listed term
python3 importer/run_import.py --first 2026FA --last 2027SP
python3 importer/run_import.py --subjects ENGR MATH
python3 importer/run_import.py --reparse                # parse saved pages again, no web requests
```

For each term and subject the importer saves the raw page in `data/schedule/raw/<term>/<subject>.html`, parses it into `data/schedule/<term>.json`, updates `data/schedule/index.json`, and then derives `data/offerings.json`. A term's file changes only when all of its subjects were fetched and parsed, so a failed run never leaves half a term. A rerun that finds no changes rewrites nothing.

All knowledge of MTSU's site sits in `importer/banner8.py`. MTSU plans to move to Banner 9 during 2026-27. A Banner 9 adapter can replace that one module. It must offer `get_terms`, `fetch_subject`, and `save_raw`, and `parse.py` can stay as it is only if the new adapter returns pages in the same layout. Otherwise the new adapter needs its own parser that returns the same schedule format.

### Offering patterns

`derive_offerings.py` records, for each course, the years it ran in fall, spring, and summer. A course is regularly offered in a season if it ran in at least 3 of the last 4 years, and occasionally offered if it ran in 1 or 2. "The last 4 years" means the last four years that have a schedule file for that season, so a missing import does not count against a course.

## How the GitHub workflow works

`.github/workflows/import-schedule.yml` runs the importer on GitHub's servers.

- **When it runs.** Start it by hand from the Actions tab (it asks for a first and a last term), or let it run on its own at 06:17 UTC on the first day of every month.
- **What it does.** It installs the importer's packages, runs `importer/run_import.py` for ENGR, MATH, PHYS, CHEM, and CSCI, and commits any changed files under `data/` to the repository.
- **If GitHub cannot reach MTSU.** Run the importer on your own computer with the commands above, then commit the changed files under `data/`.

## Build one self-contained page

```
python3 tools/build.py
```

This writes `dist/planner.html`. The file carries its own scripts, styles, and data, so you can publish it as a single file. The three graph library tags stay as links to `cdnjs.cloudflare.com`. Use `--schedule-terms 8` to include only the newest eight schedule files, which keeps the file small.

## Known limits

- The planner follows prerequisites, offered seasons, class standing hours, and credit limits. It does not model grade rules, transfer credit, minors, or career-track electives.
- General education requirements are placeholders. They reserve hours in their preferred terms and are not scheduled by section.
- Slack and critical path ignore the credit limit. The planner applies the credit limit afterward, so a plan can finish later than the critical path alone suggests.
- Offering patterns come from past terms. They do not promise that a course runs in a future term.
