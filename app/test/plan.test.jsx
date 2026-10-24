import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider, useData } from '../src/lib/DataContext.jsx';
import Plan from '../src/pages/Plan.jsx';
import CheckPlan from '../src/plan/CheckPlan.jsx';
import * as M from '../src/lib/planModel.js';
import { readData, TODAY } from './setup.js';

function Gate() {
  const data = useData();
  return data.status === 'ready' ? <Plan /> : <p>Loading</p>;
}

const catalog = readData('catalogs/2026-27.json');
const offerings = readData('offerings.json');
const ELECTIVES = ['ENGR 3915', 'ENGR 4550', 'ENGR 4560', 'ENGR 4500'];

async function walkToResults(user) {
  render(<DataProvider><Gate /></DataProvider>);
  await screen.findByRole('heading', { name: 'Where are you in the program?' });
  await user.click(screen.getByRole('radio', { name: /I'm starting my first semester/ }));
  expect(screen.getByRole('radio', { name: 'Fall 2027' }).checked).toBe(true);
  const next = () => user.click(screen.getByRole('button', { name: 'Continue' }));
  await next();
  expect(screen.getByRole('heading', { name: 'Which courses have you finished?' })).toBeTruthy();
  await next();
  expect(screen.getByRole('heading', { name: 'What are you taking this semester?' })).toBeTruthy();
  await next();
  expect(screen.getByRole('heading', { name: 'Pick your electives' })).toBeTruthy();
  for (const id of ELECTIVES) await user.click(screen.getByRole('checkbox', { name: new RegExp(`^${id}`) }));
  expect(screen.getByText(/10 of 10 hours chosen/)).toBeTruthy();
  await next();
  expect(screen.getByRole('heading', { name: 'How many credit hours per semester?' })).toBeTruthy();
  await next();
  expect(screen.getByRole('heading', { name: 'Your plan' })).toBeTruthy();
}

describe('plan walkthrough', () => {
  it('keeps Continue off until the student says where they are', async () => {
    const user = userEvent.setup();
    render(<DataProvider><Gate /></DataProvider>);
    await screen.findByRole('heading', { name: 'Where are you in the program?' });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Where are you in the program?' })).toBeTruthy();
    expect(screen.getByText('Choose where you are to continue.')).toBeTruthy();
  });

  it('takes a first-semester student to a plan through graduation', async () => {
    const user = userEvent.setup();
    await walkToResults(user);
    const glance = screen.getByRole('region', { name: 'Your plan at a glance' });
    expect(within(glance).getByText('Spring 2031')).toBeTruthy();
    expect(within(glance).getByText('Fall 2030')).toBeTruthy();
    const semesters = screen.getByRole('region', { name: 'Semester by semester' });
    expect(within(semesters).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Fall 2027', 'Spring 2028', 'Fall 2028', 'Spring 2029', 'Fall 2029', 'Spring 2030', 'Fall 2030', 'Spring 2031',
    ]);
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
  });

  it('shows each conflict of a change with its fix, and applying the fix clears it', async () => {
    const user = userEvent.setup();
    await walkToResults(user);
    const check = screen.getByRole('region', { name: 'Check a change' });
    expect(within(check).getByText('Your plan has no conflicts.')).toBeTruthy();

    await user.selectOptions(within(check).getByLabelText('Course'), 'ENGR 2120');
    await user.selectOptions(within(check).getByLabelText('Move to'), 'Spring 2030');
    await user.click(within(check).getByRole('button', { name: 'Move course' }));

    expect(within(check).getByText('ENGR 2120: Spring 2029 to Spring 2030')).toBeTruthy();
    expect(within(check).getByText('3 conflicts')).toBeTruthy();
    expect(within(check).getAllByText('Prerequisite not finished')).toHaveLength(2);
    expect(within(check).getByText('Too many credit hours')).toBeTruthy();
    expect(within(check).getAllByText('Move ENGR 2120 from Spring 2030 to Spring 2029.').length).toBeGreaterThan(0);

    await user.click(within(check).getAllByRole('button', { name: 'Apply fix' })[0]);
    expect(within(check).getByText('Your plan has no conflicts.')).toBeTruthy();
    expect(within(check).queryByText('Your changes')).toBeNull();
  });
});

describe('check a change', () => {
  const answers = M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, electives: ELECTIVES });
  const result = M.computeResult(catalog, offerings, answers, { today: TODAY });

  it('offers a fix that adds a semester only as a second choice', async () => {
    const user = userEvent.setup();
    render(<CheckPlan catalog={catalog} offerings={offerings} result={result} />);
    await user.selectOptions(screen.getByLabelText('Course'), 'ENGR 4580');
    await user.selectOptions(screen.getByLabelText('Move to'), 'Spring 2031');
    await user.click(screen.getByRole('button', { name: 'Move course' }));
    const card = screen.getByText('Not offered that semester').closest('li');
    expect(within(card).getByText(/runs in fall only/)).toBeTruthy();
    const fixes = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(fixes[0]).toMatch('Move ENGR 4580 from Spring 2031 to Fall 2030.');
    expect(fixes[1]).toMatch('This adds a term');
  });

  it('undoes every change at once', async () => {
    const user = userEvent.setup();
    render(<CheckPlan catalog={catalog} offerings={offerings} result={result} />);
    await user.selectOptions(screen.getByLabelText('Course'), 'MATH 3110');
    await user.selectOptions(screen.getByLabelText('Move to'), 'Fall 2031');
    await user.click(screen.getByRole('button', { name: 'Move course' }));
    expect(screen.getByRole('list', { name: 'Your changed plan' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo all changes' }));
    expect(screen.getByText('Your plan has no conflicts.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Your changed plan' })).toBeNull();
  });
});
