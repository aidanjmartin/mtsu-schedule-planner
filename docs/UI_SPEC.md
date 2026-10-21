# Mechatronics Degree Planner: Interface Specification

## Audience and goal

The audience is a Mechatronics Engineering student who knows which classes they have taken but not how the prerequisite chain works. The site answers one question for them: "What do I take each semester to graduate, and when do I start senior design?" It asks one question at a time, explains every result in plain words, and never assumes the student knows the curriculum.

## Pages

The site has three pages, reached from a top bar that is present on every page. The top bar shows the Engineering & Technology gear logo, "Department of Engineering & Technology," and "Mechatronics Engineering." Every page ends with a footer that reads: "Student-built planning tool. Confirm your plan with your academic advisor." Pages use hash routes (`#/explore`, `#/plan`, `#/advanced`) so they work on GitHub Pages.

### 1. Explore (home, `#/explore`)

**Two views.** A switch at the top of the map offers **Circle view** (described below, the default) and **Flow view**. The page remembers the student's last choice on that device. Both views use the same course data, subject colors, details panel, and search.

**Flow view** is the earlier flow chart: every course as a tile in its subject group, with prerequisite lines drawn when a course is selected. Group boxes follow the subject table below, with each elective career area as its own box. Tiles show the full course title (wrapping to two lines when needed, with the full title on hover). At phone width the chart opens fitted to the screen width, with a "Drag to move, pinch to zoom" hint.

**Circle view** is an interactive course map that works the way UofT ECE Iris works: the program starts as a few labeled circles, a student opens the ones they care about, and each opened circle becomes a ring of courses they can click.

**Starting view.** Six area circles on a light canvas, each labeled above it:

| Area circle | Courses inside | Ring order |
|---|---|---|
| Core: Years 1 and 2 (center) | MATH 1910, 1920, 3110, 3120; PHYS 2110/2111, 2120/2121; CHEM 1110/1111; CSCI 1170; ENGR 1010, 1100, 2100, 2110, 2120, 2130, 2210 | By academic map semester, Year 1 Fall to Year 2 Spring, clockwise from the top |
| Required: Years 3 and 4 | ENGR 3510, 3520, 3530, 3540, 3550, 3560, 3590, 4510, 4520, 4530, 4580, 4590; MATH 2010 | By academic map semester, Year 3 Fall to Year 4 Spring, clockwise from the top |
| Elective: Systems Engineering & Management | ENGR 3915, 3970, 4500 | By course number |
| Elective: Robotics & Embedded Systems | ENGR 4550, 4560 | By course number |
| Elective: Advanced Study | ENGR 4540, 4570 | By course number |
| Elective: Internship & Research | ENGR 3600 (internship), 4600 (research) | By course number |

The core circle sits in the center. The required circle and the four elective circles sit around it. A short line under the page title reads: "Open an area to see its courses. Select a course to see what it needs and what it opens up."

**Opening an area.** Clicking an area circle grows it, with a short animation, into a ring of course circles. Inside the ring:

- Each course is a small circle showing its course number and credit hours, filled with its subject color (table below).
- Thin arcs outside the course circles mark and label each semester ("Year 1 Fall", "Year 1 Spring", and so on). Elective rings have no semester arcs.
- The empty center of the ring reads "Select a course."
- A close button (×) sits below the ring. Other area circles move aside to make room and stay clickable, so several areas can be open at once. An "Open all" control opens every area.

**Selecting a course.**

- The course moves to the center of its ring, enlarged, with its full title.
- Dashed arrows connect it to its prerequisites and to the courses it opens up, across every open ring. A "taken in the same semester is fine" prerequisite uses a dash-dot arrow. Unconnected courses fade.
- A closed area circle that holds a connected course shows a small count badge ("2 linked"). Clicking it opens that area with the links already drawn.
- A details panel (a bottom sheet on phones) shows the course number and title, credit hours, the semesters it runs, its academic map semester, the official catalog description, prerequisites in plain words, and linked course chips. Clicking a chip selects that course.
- Hovering a course circle shows a label such as "ENGR 3540, Introduction to Feedback Control, Year 4 Fall."

**Subject colors** come from the earlier groups, shown in a legend on the left with the arrow styles:

| Subject color | Courses |
|---|---|
| Math & Science | MATH 1910, 1920, 2010, 3110, 3120; PHYS 2110/2111, 2120/2121; CHEM 1110/1111; CSCI 1170 |
| Engineering Foundations | ENGR 1010, 1100, 2100, 2210 |
| Mechanics | ENGR 2110, 2120, 3550, 3560, 3590 |
| Circuits, Electronics & Automation | ENGR 2130, 3510, 3520, 3530, 4510, 4520 |
| Controls | ENGR 3540, 4530 |
| Senior Design | ENGR 4580, 4590 |
| Electives | ENGR 3600, 3915, 3970, 4500, 4540, 4550, 4560, 4570, 4600 |

**Controls**, stacked at the bottom right: zoom in, zoom out, fit to screen, search (type a course number or title, then the map opens its area and selects it), and help (a short walkthrough of the steps above). A "Plan my degree" button sits at the top right.

**Phone width.** Area circles stack in one column in the same order. An opened ring fills the screen width, and the details panel opens as a bottom sheet. Pinch to zoom works.

**Drawing.** The map is drawn in SVG by React, with animation by the Motion library. Animation respects the reduced-motion setting. The canvas uses the site's light theme and the logo blue as the accent, with the subject colors kept soft so the selected course and its arrows stand out.

**Descriptions.** Catalog descriptions are stored in the catalog file as a `description` field for each course. ENGR 1010, 3600, 4570, and 4600 are proposed courses with no catalog description. ENGR 1010, 3600, and 4570 show the program owner's placeholder text under the label "Unofficial description." ENGR 4600 reads "Proposed course. Description coming soon."

### 2. Plan my degree (`#/plan`)

A guided walkthrough in a light theme. One question per screen, a progress bar with step names, Back and Continue buttons on every step, and answers kept when the student goes back.

1. **Where are you in the program?** Year (1st, 2nd, 3rd, 4th, 5th or later). The site does not ask which semester: it works out the current semester from today's date and states it ("We count Fall 2026 as your current semester and plan the semesters after it."). The plan starts with the semester after the current one. A separate option reads "I'm starting my first semester" and asks which semester they start, with Fall 2027 selected and Spring 2027 as the other choice; that plan starts with the chosen semester.
2. **Which courses have you finished?** A checklist of the Mechatronics and required math and science courses, grouped by the academic map's semesters. Every course the map places before the student's current semester starts checked. The student unchecks what they have not taken. A short line explains why: "We checked the courses most students have finished by now. Uncheck any you haven't taken."
3. **What are you taking this semester?** The map's courses for the current semester start checked. The student adjusts. These count as finished for planning next semester.
4. **Pick your electives.** Choose 10 elective credit hours, in any mix: for example three 3-hour courses and ENGR 4500 (1 hour). Cards are grouped by career area. Each card shows the title, credit hours, a one-sentence description, the semesters it runs, and what it requires. A card the student cannot take yet says when they can. ENGR 3600 (internship) and ENGR 4600 (research) let the student pick 1, 2, or 3 hours per semester and repeat across semesters; together they count for at most 6 hours. A counter reads "7 of 10 hours chosen." Continue is enabled at exactly 10 hours; the step explains how to reach 10 when the student is over or under.
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
3. The elective step accepts exactly 10 elective hours, enforces the 6-hour combined limit on ENGR 3600 and ENGR 4600, and explains any elective the student cannot take yet.
4. Export PDF downloads a readable plan that matches the screen.
5. On the Explore map, every area opens and closes, every course can be selected, its prerequisites and the courses it opens up are linked across open areas, and the map works at phone width.
6. The site loads from GitHub Pages with no console errors.
7. Both Explore views work at desktop and phone width, the switch remembers the last view, and Circle view opens by default.
8. A first-semester student's plan places ENGR 1010 in the first semester, in the same semester as ENGR 1100 or earlier.
