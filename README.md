# MTSU Degree Planner

A degree planner for MTSU Mechatronics Engineering B.S. students. It answers one question for a student: "What do I take each semester to graduate, and when do I start senior design?"

The site has three pages:

- **Course map** (`#/explore`, the home page). A map of every course in the degree, grouped by subject. Selecting a course highlights what the student needs first (solid lines) and what it opens up (dashed lines), and a side panel (a bottom sheet on phones) explains the course in plain words.
- **Plan my degree** (`#/plan`). A six-step walkthrough: where the student is in the program, finished courses, courses taken this semester, three electives, credit hours per semester, and the plan. The plan lists every semester through graduation, explains anything that needs attention, shows next semester's class times, and exports a PDF.
- **Advanced** (`#/advanced`, linked from the footer). Tools for the program owner: what-if edits with a baseline comparison, the critical path and slack table, and full section timetables.

The site runs entirely in the browser. There is no server and no account. Answers save in the browser on that device only, and **Start over** clears them. The name a student types for the PDF is never stored. The interface specification is `docs/UI_SPEC.md`. The data formats are in `docs/DATA_FORMAT.md`.

## What is in the repository

| Folder or file | What it holds |
| --- | --- |
| `app/` | The React site (Vite and JavaScript). `app/src/pages/` holds the three pages, `app/src/plan/` the walkthrough steps, results, and PDF, and `app/src/lib/` the plan model, the map layout, and data loading. |
| `web/engine/` | The planning engine. It is plain JavaScript with no dependencies, and the site imports it unchanged. |
| `data/catalogs/` | One hand-encoded catalog file per catalog year (2026-27). |
| `data/schedule/` | Parsed class schedules, one file per term, plus `index.json` that lists them. `raw/` keeps the saved web pages and is not published. |
| `data/offerings.json` | Which seasons each course regularly runs, derived from the schedules. |
| `importer/` | Python code that reads MTSU's public class schedule and derives offering patterns. |
| `tests/` | Node tests for the engine and the plan model, and pytest tests for the importer. |
| `docs/` | The specifications. |
| `.github/workflows/import-schedule.yml` | Runs the importer on GitHub and commits the results. |
| `.github/workflows/deploy-pages.yml` | Builds the site and publishes it to GitHub Pages. |

## Run the site on your computer

You need Node 20 or newer.

```
cd app
npm install
npm run dev
```

Open the address that Vite prints. `npm run build` writes the finished site to `app/dist/`, and `npm run preview` serves it.

Before every `dev` and `build`, `app/scripts/copy-data.mjs` copies `data/catalogs/`, `data/offerings.json`, and `data/schedule/*.json` (not `raw/`) into `app/public/data/`. That folder is generated and is not committed. The engine is not copied. Vite reads it from `web/engine/`, so there is one engine and no fork.

The site is served from `/mtsu-schedule-planner/` on GitHub Pages, which is the `base` setting in `app/vite.config.js`. Change it if the repository name changes.

## Run the tests

You need Node 18 or newer and Python 3.9 or newer.

```
pip install -r importer/requirements.txt pytest
node --test tests/
python3 -m pytest tests/
```

On Node 21 and newer, `node --test tests/` works through a small helper, `tests/index.js`. You can also run `npm test` from the repository root.

The engine tests use a small synthetic catalog in `tests/fixtures/catalog-small.json`. The plan model tests use the real 2026-27 catalog with a fixed date, and check the two walkthroughs in the interface specification: a first-semester student who starts in Fall 2027 graduates in Spring 2031 and starts senior design in Fall 2030, and a 2nd year fall student who has not finished PHYS 2110 gets an alert naming it. The importer tests use synthetic HTML in `tests/fixtures/` that copies the layout of MTSU's Banner 8 class listing.

## Publish the site

`.github/workflows/deploy-pages.yml` builds `app/` and deploys it with GitHub Pages. In the repository settings, set Pages to the **GitHub Actions** source once. After that the workflow runs:

- on every push to `main`, and
- when the "Import class schedule" workflow finishes successfully. A commit made with the built-in `GITHUB_TOKEN` does not start other workflows, so this second trigger makes new schedule data reach the site.

You can also start it by hand from the Actions tab.

## How the plan page works

`app/src/lib/planModel.js` turns the student's answers into the engine's input and turns the engine's output into the plan on screen. It holds no page code, so the Node tests run it directly.

- **Position and pre-checked courses.** Each semester has a place on the academic map. Courses the map puts before the student's current semester start checked as finished, and the courses in the current semester start checked as "taking now." Unchecking a course also unchecks the finished courses that need it.
- **The first planned semester.** A student in the middle of the program gets a plan that starts with the semester after the current one. The current semester shows as a separate "in progress" card. A student starting a first semester chooses one of the next two semesters (Fall 2027 is selected by default today) and gets a plan that starts with it. The current semester comes from today's date: August through December is fall, January through May is spring, and June and July lead to the coming fall. The earliest start is Fall 2026.
- **Course order.** The planner puts each remaining course in its academic map semester. A course moves later only when a prerequisite, an offering season, a first-offered term, or the credit load requires it. A course the map placed before the student's first planned semester goes in as early as possible. "Your plan matches the academic map" appears only when every remaining course sits in its map semester.
- **Class times.** Sections with set meeting times rank before online or time-to-be-announced sections, so a section without set times appears only when no timed section of that course fits.
- **General education.** The planner schedules only the catalog's courses (Mechatronics, math, science, and CSCI). It leaves room in each semester for general education, shows the open hours, and warns when the open hours before graduation are fewer than the general education hours the student still needs.
- **Credit load.** Light, Standard, and Heavy set the most hours the planner puts in one semester (14, 17, and 18).
- **Alerts.** "X must be taken by Fall 2028, or senior design moves to Fall 2029" comes from planning again with that course held back one semester. "X is holding up your plan" appears when a course the academic map expects the student to have finished is not finished and the dates move later than the map's.
- **Class times.** Next semester's class times come from `web/engine/timetable.js`. When the semester has no schedule file yet, the page uses the same semester from an earlier year and says so.
- **PDF.** `@react-pdf/renderer` builds the PDF in the browser when the student chooses Export PDF. The library loads only then.

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

## Known limits

- The planner follows prerequisites, offered seasons, class standing hours, and credit limits. It does not model grade rules, transfer credit, or minors.
- The student plan does not schedule general education courses. It reports open hours instead. The Advanced page still reserves the catalog's general education blocks.
- Summer terms, precalculus starts, and catalog years other than 2026-27 are out of scope.
- Slack and critical path ignore the credit limit. The planner applies the credit limit afterward, so a plan can finish later than the critical path alone suggests.
- Offering patterns come from past terms. They do not promise that a course runs in a future term.
