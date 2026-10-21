# Mechatronics Degree Planner: Interface Specification

## Audience and goal

The audience is a Mechatronics Engineering student who knows which classes they have taken but not how the prerequisite chain works. The site answers one question for them: "What do I take each semester to graduate, and when do I start senior design?" It asks one question at a time, explains every result in plain words, and never assumes the student knows the curriculum.

## Pages

The site has three pages, reached from a top bar that is present on every page. The top bar shows the Engineering & Technology gear logo, "Department of Engineering & Technology," and "Mechatronics Engineering." Every page ends with a footer that reads: "Student-built planning tool. Confirm your plan with your academic advisor." Pages use hash routes (`#/explore`, `#/plan`, `#/advanced`) so they work on GitHub Pages.

### 1. Explore (home, `#/explore`)

A course map in the style of UofT ECE Iris.

- Courses appear as rounded tiles grouped into areas. The core areas sit in the center, and the elective career groups sit around them.
- Selecting a course highlights its prerequisites (solid lines) and the courses it unlocks (dashed lines), and dims everything else.
- A side panel (a bottom sheet on phones) shows the title, credit hours, the semesters it runs, prerequisites in plain words ("Take ENGR 3520 first. ENGR 3530 can be taken the same semester."), and what it unlocks.
- A legend explains the line styles and group colors. A "Plan my degree" button leads to page 2.
- The map supports pan and zoom on desktop and phone.

Course groups:

| Group | Courses |
|---|---|
| Math & Science | MATH 1910, 1920, 2010, 3110, 3120; PHYS 2110/2111, 2120/2121; CHEM 1110/1111; CSCI 1170 |
| Engineering Foundations | ENGR 1100, 2100, 2210, 4500 |
| Mechanics | ENGR 2110, 2120, 3550, 3560, 3590 |
| Circuits, Electronics & Automation | ENGR 2130, 3510, 3520, 3530, 4510, 4520 |
| Controls | ENGR 3540, 4530 |
| Senior Design | ENGR 4580, 4590 |
| Elective: Systems Engineering & Management | ENGR 3915, 3970 |
| Elective: Robotics & Embedded Systems | ENGR 4550, 4560 |
| Elective: Advanced Study | ENGR 4540, 4570 |
| Elective: Internship & Research | ENGR 4600, 4610 |

### 2. Plan my degree (`#/plan`)

A guided walkthrough in a light theme. One question per screen, a progress bar with step names, Back and Continue buttons on every step, and answers kept when the student goes back.

1. **Where are you in the program?** Year (1st, 2nd, 3rd, 4th, 5th or later) and semester (fall or spring). The answer is the student's current semester, the one in progress today, and the plan starts with the semester after it. A separate option reads "I'm starting my first semester" and asks which semester they start, with Fall 2027 selected and Spring 2027 as the other choice; that plan starts with the chosen semester.
2. **Which courses have you finished?** A checklist of the Mechatronics and required math and science courses, grouped by the academic map's semesters. Every course the map places before the student's current semester starts checked. The student unchecks what they have not taken. A short line explains why: "We checked the courses most students have finished by now. Uncheck any you haven't taken."
3. **What are you taking this semester?** The map's courses for the current semester start checked. The student adjusts. These count as finished for planning next semester.
4. **Pick your electives.** Choose 3. Cards are grouped by career area. Each card shows the title, a one-sentence description, the semesters it runs, and what it requires. A card the student cannot take yet says when they can. A counter reads "2 of 3 chosen."
5. **How many credit hours per semester?** Light (12 to 14), Standard (15 to 17), or Heavy (18), with a sentence on what each means for graduation.
6. **Your plan.** Described below.

Non-STEM general education courses are not asked about and not scheduled, because no Mechatronics course depends on them. The plan places Mechatronics, math, science, and CSCI courses only, up to the chosen credit load minus a share reserved for general education. Each semester shows its open hours ("6 open hours for general education"). If the open hours left before graduation are fewer than the student's remaining general education hours, the plan says so and suggests a summer course or a heavier semester.

### Plan results

The planner keeps each course in its academic map semester whenever the student's situation allows, and moves a course only when a prerequisite, an offering season, or the credit load requires it. A statement that the plan matches the academic map appears only when every remaining course sits in its map semester.

- **Summary at the top:** projected graduation semester, senior design start (ENGR 4580, fall) and finish (ENGR 4590, spring), and the chosen electives.
- **Semester cards** in order through graduation. Each card lists its courses with credit hours, total hours, and open general education hours. Senior design courses are visually marked.
- **Plain-language alerts**, only where they apply, for example: "ENGR 3540 must be taken by Fall 2028, or senior design moves to Fall 2029." "ENGR 4570 is first offered in Fall 2027."
- **Next semester's class times:** a weekly calendar for the first semester of the plan, with one set of sections that fit together without time overlaps, plus alternatives. Sections with set meeting times come before online or "time to be announced" sections. When the next semester's schedule is not published yet, the calendar uses the same semester from the previous year and says so.
- **Export PDF** downloads a file named like `mechatronics-plan-fall-2026.pdf`.
- **Start over** and **Edit answers** buttons.

### PDF contents

One or two letter-size pages: the logo and department lines, "Mechatronics Engineering Degree Plan," the date created and catalog year (2026-27), the student's answers (current semester, finished courses, electives, credit load), the semester-by-semester table through graduation with senior design marked, the alerts, the next semester's class times, and the advisor footer. An optional name field on the results screen fills a "Prepared for" line; it is never stored or sent anywhere.

### 3. Advanced (`#/advanced`)

The current proof of concept's tools, kept for the program owner: what-if edits with baseline comparison, the critical path and slack table, and full section timetables. Linked from the footer, not the top bar.

## Visual direction

Light theme throughout, white surfaces, MTSU blue from the logo as the single accent, near-black text, and one neutral gray family tinted toward that blue. Large, readable type, generous spacing, and one primary button per screen. Status colors (on track, needs attention, delayed) are separate from the accent. The logo file is `app/public/et-logo.png` (the Engineering & Technology gear logo, 508 by 393 pixels, white background; its blue is #0266BB). Layout works at phone width with no sideways scrolling.

## Technology

- React with Vite, JavaScript (no TypeScript), plain CSS with design tokens.
- The planning engine in `web/engine/` is reused unchanged and imported by the React app.
- Course map: React Flow with fixed group layout.
- PDF: generated in the browser with @react-pdf/renderer, so the button downloads a real file.
- Data: `data/` is copied into the build at build time. No server.
- Hosting: GitHub Pages, deployed by a GitHub Actions workflow on every push to `main`.
- Student answers save in browser storage on that device only, with a clear "Start over."

## Out of scope

Accounts, sharing plans with advisors, summer terms, precalculus starts, catalog years other than 2026-27, and the buddy system.

## Acceptance checks

1. A first-semester student starting in Fall 2027 finishes the walkthrough in under two minutes and sees graduation in Spring 2031 and senior design in Fall 2030.
2. A student in 2nd year fall with PHYS 2110 unchecked sees the effect on senior design and graduation, with an alert naming PHYS 2110.
3. The elective step prevents choosing more than 3 and explains any elective the student cannot take yet.
4. Export PDF downloads a readable plan that matches the screen.
5. The Explore map highlights prerequisites and unlocked courses for every course and works at phone width.
6. The site loads from GitHub Pages with no console errors.
