# Planning Engine Interface

The planning engine is plain JavaScript in `web/engine/` with no dependencies. Every function is pure: it reads its arguments, returns new values, and never changes its inputs. Results are plain data that survive `JSON.stringify`, so the site can save them, compare them, or pass them to a web worker.

Import everything from one file:

```js
import * as engine from '../web/engine/index.js';
// or pick functions
import { checkPlan, findBrokenPlans, optimizeElectives, buildCourseModel } from '../web/engine/index.js';
```

The site's `app/src/lib/engine.js` re-exports the same modules for the React code.

## Words used here

| Word | Meaning |
| --- | --- |
| Term | One semester, written as a year and a season code: `2027FA` (Fall 2027), `2028SP` (Spring 2028), `2028SU` (Summer 2028). |
| Prerequisite | A course that must be finished in an earlier term. |
| Corequisite | A course that may be taken in the same term or earlier. The catalog file marks it `concurrent_ok`. |
| Planning unit | A course plus any lab that must be taken with it, such as PHYS 2110 with PHYS 2111. The unit's id is the lecture's id. |
| Academic map | The department's suggested semester for each course (`suggested_term` in the catalog). |
| Milestone | A set of courses the planner tracks by start term. The catalog defines one: senior design (ENGR 4580 in fall, then ENGR 4590 in spring). |
| Plan | A list of terms, each with the courses a student intends to take. The format is below. |
| Edit | One curriculum change for a what-if run, such as a new prerequisite. The edit types are below. |
| Career track | A career direction with a weight for each elective. The file is `data/career-tracks.json`. |

## Data the engine reads

| Input | File | Format |
| --- | --- | --- |
| `catalog` | `data/catalogs/2026-27.json` | `docs/DATA_FORMAT.md`, catalog file |
| `offerings` | `data/offerings.json` | `docs/DATA_FORMAT.md`, offering patterns. Optional: without it the engine uses each course's academic map season. |
| `schedules` | `data/schedule/<term>.json` | An object that maps a term id to its schedule file, for example `{ "2027SP": schedule }`. Optional. |
| `tracks` | `data/career-tracks.json` | `docs/DATA_FORMAT.md`, career tracks |

The site's build copies all four into `app/public/data/`.

## Course data and the prerequisite graph (`graph.js`)

### `buildCourseModel(catalog, offerings?)`

Returns `{ catalog_year, program, total_hours, standing_hours, milestones, requirements, courses }`. `courses` maps each course id to a record the interface can show directly:

| Field | Meaning |
| --- | --- |
| `id`, `subject`, `number`, `level` | `"ENGR 4580"`, `"ENGR"`, `"4580"`, `4000` |
| `title`, `description` | From the catalog. `description` is `null` for a proposed course with no text yet. |
| `credits` | `{ min, max }`. Equal for a fixed-hour course. |
| `repeatable` | `true` when a student may take the course in more than one term. |
| `components` | Course numbers that need a section, such as `["PHYS 2110", "PHYS 2111"]`. |
| `prereqs`, `prereq_text` | The normalized prerequisite expression, and the same in words. |
| `standing`, `standing_hours` | `"junior"` and `60`, for example, or `null`. |
| `seasons`, `season_source` | Seasons the planner uses, and where they came from: `"data"` (class schedules), `"edit"` (the catalog's planned seasons or a what-if edit), or `"assumed"` (the academic map season). |
| `regular_seasons`, `occasional_seasons` | The offering pattern behind `seasons`. |
| `available_from` | The first term a new course runs, or `null`. |
| `suggested_term`, `suggested_label`, `suggested_position` | The academic map semester: `"senior-fall"`, `"Senior fall"`, `9`. |
| `requirement`, `role` | The requirement id, and `"required"`, `"elective"`, or `"other"`. |
| `first_semester` | `true` for ENGR 1010. |
| `proposed` | `true` for a course that is not in the published catalog. |
| `needs_check`, `notes` | `needs_check` is `true` when the notes start with `CHECK:`. |

### `buildPrereqGraph(catalog)`

Returns `{ nodes, edges, unknown }`. Each edge runs from the course that comes first to the course that needs it:

```js
{ from: 'ENGR 3540', to: 'ENGR 4580', kind: 'corequisite', optional: false, group: null, min_grade: null }
```

- `kind` is `"prerequisite"` or `"corequisite"`.
- `optional` is `true` inside an any-of group, where another course can satisfy the link. Edges of one group share a `group` id.
- `unknown` lists edges that name a course outside the catalog.

### Graph helpers

| Function | Returns |
| --- | --- |
| `prerequisitesOf(graph, id)` | Edges into `id`. |
| `dependentsOf(graph, id)` | Edges out of `id`. |
| `ancestors(graph, id, { includeOptional })` | Every course needed before `id`, sorted. |
| `descendants(graph, id, { includeOptional })` | Every course that needs `id`, sorted. |
| `levels(catalog)` | The fewest terms needed to reach each course: a prerequisite adds 1, a corequisite adds 0. `null` inside a cycle. |
| `longestChain(catalog, id)` | The longest prerequisite chain that ends at `id`, first course first. For ENGR 4590 it runs MATH 1910, PHYS 2110, ENGR 2110, ENGR 2120, ENGR 3590, ENGR 4580, ENGR 4590. |

## Plan checker (`checker.js`)

### Plan format

```js
{
  completed: ['MATH 1910', 'ENGR 1010'],   // finished courses (and finished general education ids)
  in_progress: ['MATH 1920'],              // courses this term; they count as finished before the first planned term
  completed_hours: 34,                     // optional: overrides the finished-hours total used for class standing
  terms: [
    { term: '2027FA', courses: ['ENGR 2110', { course: 'ENGR 3600', hours: 2 }], other_hours: 6 },
    { term: '2028SP', courses: ['ENGR 2120'] },
  ],
  options: {
    max_credits: 17,          // most hours in a fall or spring term (default 18)
    summer_max_credits: 8,    // most hours in a summer term (default 8)
    min_credits: 12,          // optional: flag lighter fall and spring terms
    summer_allowed: false,    // allow fixes to use summer terms
    include_occasional: false // count occasional offerings as offered
  },
}
```

A course entry is an id, or `{ course, hours }` for a course with a range of hours. `other_hours` counts hours that are not catalog courses, such as general education, toward the credit limit and class standing. A plan from the planner converts with `planFromPlanner(planTerms(...), student)`.

### `checkPlan({ catalog, offerings?, schedules?, plan, fixes = true, replan = true })`

Returns:

```js
{
  ok: false,                 // true when there are no errors
  summary: 'The plan has 1 problem to fix. Senior design is planned for Fall 2030, but ENGR 4580 still needs ENGR 3590 by then. ...',
  counts: { error: 1, warning: 0, info: 0 },
  issues: [{
    id: 'missing_prerequisite|ENGR 4580|2030FA',
    kind: 'missing_prerequisite',
    severity: 'error',
    course: 'ENGR 4580', term: '2030FA', term_label: 'Fall 2030',
    courses: ['ENGR 3590'],   // the other courses involved
    message: 'ENGR 4580 is planned for Fall 2030, but it needs ENGR 3590 (in an earlier term; it is planned for Fall 2030).',
    detail: 'The catalog requires: ENGR 3590 and ENGR 3540 (may be taken at the same time) and ...',
    fixes: [{ type: 'move', course: 'ENGR 3590', from: '2030FA', to: '2029FA', text: 'Move ENGR 3590 from Fall 2030 to Fall 2029.', delays_graduation: false, partial: false }],
  }],
  terms: [{ term, label, hours, other_hours, capacity, status: 'ok' | 'warning' | 'error', courses: [{ course, hours, issues: [issue ids] }] }],
  readiness: [/* see below */],
  last_term: '2031SP', last_term_label: 'Spring 2031',
  replan: null,              // a rebuilt plan when some error has no single-step fix (see suggestReplan)
}
```

Issue kinds:

| Kind | Severity | Raised when |
| --- | --- | --- |
| `missing_prerequisite` | error | A prerequisite is not finished in an earlier term, or a corequisite is not in the same term or earlier. |
| `class_standing` | error | The plan has fewer finished hours before the term than the course's standing needs. |
| `overloaded_term` | error | A term's hours, including `other_hours`, pass the credit limit. |
| `light_term` | warning | A fall or spring term has fewer hours than `options.min_credits`. |
| `not_offered` | error | The course does not run in that season. |
| `rarely_offered` | warning | The course has run in that season only now and then. |
| `not_yet_offered` | error | The term comes before the course's `available_from`. |
| `duplicate_course` | error | A course that is not repeatable appears in two terms. |
| `already_completed` | warning | A finished course appears in the plan again. |
| `missing_requirement` | error | A required course is not finished, in progress, or planned. |
| `elective_hours` | error or warning | Elective hours do not add up to the requirement, or a limit is passed. Too many hours is a warning. |
| `milestone_not_planned` | error | No senior design course is in the plan. |
| `time_conflict` | error | For a term with a schedule: no set of sections fits together. |
| `no_sections` | warning | For a term with a schedule: a planned course has no sections listed. |
| `unknown_course` | warning | A course id is not in the catalog. |

Fixes have `type` `"move"`, `"add"`, or `"remove"`, with `course`, `from`, `to`, and `hours` as they apply. The checker applies every candidate fix to a copy of the plan and keeps it only when the problem clears and no new error appears. For an overload or an hour count, a fix that shrinks the problem without clearing it is kept with `partial: true`, after the full fixes. `delays_graduation` is `true` when the fix adds a term at the end. At most `options.max_fixes` (default 3) fixes are kept per issue, nearest term first.

### Senior design readiness

Each entry of `readiness` describes one milestone:

```js
{
  id: 'senior-design', label: 'Senior design', courses: ['ENGR 4580', 'ENGR 4590'],
  status: 'ready',            // 'done', 'ready', 'not_ready', or 'not_planned'
  planned_term: '2030FA',
  ready_term: '2030FA',       // the first term the plan's courses let ENGR 4580 start
  missing: [],                // prerequisites not met at planned_term
  at_risk: [{                 // courses that cannot slip one offering without moving the start
    course: 'ENGR 3540', term: '2030FA', delay_terms: 2, new_start_term: '2031FA',
    message: 'If ENGR 3540 slips from Fall 2030 to its next offering, senior design starts in Fall 2031, 2 terms later.',
  }],
  message: 'Ready for senior design in Fall 2030. ENGR 3540 has no room to slip.',
}
```

The at-risk check pushes each planned course before senior design to its next offering and carries the change forward through every course that depends on it. It ignores credit limits.

### Other checker functions

| Function | Returns |
| --- | --- |
| `applyPlanFix(catalog, plan, fix)` | A new plan with one fix applied. |
| `suggestReplan({ catalog, offerings?, plan })` | `{ plan, last_term, last_term_label, readiness, moved: [{ course, from, to }], message }`: the planner's plan from the same first term, finished courses, credit limit, and elective picks. |
| `planFromPlanner(plannerPlan, student)` | Checker input from a `planTerms` result. |
| `normalizePlan(catalog, plan)`, `denormalizePlan(norm)` | The plan in the checker's internal shape and back. |
| `electivePicksInPlan(catalog, norm, requirement)` | The plan's elective picks in the planner's `choices` format. |

## What-if changes (`whatif.js`)

### Edit types

Edits apply in order on top of copies of the catalog and schedules.

| Type | Fields | Effect |
| --- | --- | --- |
| `set_prereqs` | `course`, `prereqs` | Replace the prerequisite expression. |
| `set_seasons` | `course`, `regular_seasons` | Offer the course only in these seasons. |
| `set_credits` | `course`, `credits` | Change the hours. |
| `set_standing` | `course`, `standing` | Require `"junior"` or `"senior"` standing, or `null` for none. |
| `move_requirement` | `course`, `to` | Move a course to another requirement, such as from required to elective. |
| `add_course` | `course`, `requirement`, `definition` | Add a course. `definition` holds catalog fields; `title` and `credits` are required. |
| `remove_course` | `course` | Remove a course from the catalog, its requirement, any milestone, and every prerequisite expression. An any-of group keeps its other alternatives. |
| `set_meeting_pattern` | `course`, `term`, `meetings`, optional `section` | Replace section meeting times in one term. |

### `findBrokenPlans({ catalog, offerings?, schedules?, edits, plans })`

`plans` is a list of `{ id, label, plan }` in the plan format above. Each plan is checked against the unchanged catalog and against the changed one. Returns:

```js
{
  summary: 'Offer ENGR 4580 in spring only. 2 of 2 plans break.',
  counts: { breaks: 2, still_ok: 0, already_broken: 0, fixed: 0 },
  edits: [/* edits that applied */],
  edit_errors: [{ position, edit, message }],     // edits that could not apply
  new_problems: [/* catalog errors the change creates, such as a prerequisite cycle */],
  plans: [{
    id, label,
    status: 'breaks',          // 'breaks', 'still_ok', 'already_broken', or 'fixed'
    new_issues: [/* checker issues, with fixes under the changed catalog */],
    resolved_issues: [/* errors the change clears */],
    readiness: { before: { status, planned_term, ready_term }, after: { status, planned_term, ready_term, message } },
    message: 'Freshman starting Fall 2027 breaks: ENGR 4580 is planned for Fall 2030, but it runs in spring only.',
  }],
}
```

A plan breaks when the change adds an error it did not have before.

### `plannerPlans({ catalog, offerings?, students })`

Builds example plans with the planner, in the format `findBrokenPlans` reads, for when no saved plans exist. Each student is a planner student state with optional `id` and `label`.

### Earlier what-if functions

`applyEdits`, `describeEdit`, `compareScenario`, `diffPlans`, `diffAnalyses`, `summarizeDiff`, `termTimetable`, and `diffTimetables` compare one student's planner results before and after a change. The README describes them.

## Elective optimization (`electives.js`)

### `optimizeElectives({ catalog, offerings?, tracks, track, student, keep = [], avoid = [], limit = 5, evaluate = 25 })`

- `track` is a track id from `tracks`, or a track object.
- `student` is a planner student state: `start_term`, `completed`, `in_progress`, `options`, and `start_position`.
- Finished electives and `keep` courses are in every set. `avoid` courses are in none.

The optimizer lists every set of electives that meets the hour requirement exactly inside its limits, scores each set by track fit, plans the `evaluate` best-scoring sets, and ranks them by:

1. earliest graduation term
2. earliest senior design start
3. highest track fit: the sum of weight times hours, divided by 3 times the required hours
4. fewest extra prerequisite courses
5. fewest hours of internship or research credit, which depend on an employer or a faculty project
6. fewest courses

Returns:

```js
{
  track: { id, label, description },
  requirement: { id: 'engr-elective', label, hours: 10 },
  kept: [], avoided: [],
  baseline: { picks, graduation_term, senior_design_start },   // the default electives
  considered: 237,           // sets that meet the requirement
  planned: 25,               // sets the planner ran
  recommendations: [{
    rank: 1,
    picks: [{ course: 'ENGR 4550', title, hours: [3], total_hours: 3, weight: 3, weight_text: 'is central', why: '...' }],
    choices: { 'engr-elective': [{ course: 'ENGR 4550' }, ...] },  // drop into a planner student state
    total_hours: 10, fit: 0.83, fit_percent: 83,
    graduation_term: '2031FA', graduation_label: 'Fall 2031', senior_design_start: '2030FA',
    delay_terms: 0,            // terms later than the default electives
    added_prereqs: [], unplaced: [],
    explanation: 'Fits robotics and automation at 83%. ENGR 4550 and ENGR 4570 are central to the track. ENGR 4500 and ENGR 4560 help. Graduation stays in Fall 2031.',
  }],
}
```

### Other elective functions

| Function | Returns |
| --- | --- |
| `validateTracks(catalog, tracks)` | `{ errors, warnings }`, as lists of messages. |
| `trackRequirement(catalog, tracks?)` | The requirement the tracks apply to. |
| `electiveSets(catalog, requirement, { keep, avoid })` | Every valid set, as lists of `{ course, hours }`. |
| `trackFit(track, picks, requiredHours)` | `{ points, max, fit }`. |

## Planner, critical path, timetables, and validation

These modules predate this document and the README describes them:

- `planTerms({ catalog, offerings, student })` builds a term-by-term plan.
- `analyzeCriticalPath({ catalog, offerings, student })` returns earliest and latest terms, slack, and the critical path.
- `planTimetables({ courses, catalog, schedule })` finds section combinations without time overlaps.
- `validateCatalog(catalog)` checks a catalog file.
