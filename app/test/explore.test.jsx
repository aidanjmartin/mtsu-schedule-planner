import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider, useData } from '../src/lib/DataContext.jsx';
import Explore from '../src/pages/Explore.jsx';
import ViewSwitch from '../src/components/ViewSwitch.jsx';

function renderExplore() {
  return render(<DataProvider><Gate /></DataProvider>);
}

// Explore reads the catalog from the data context, so it renders once the data has loaded.
function Gate() {
  const data = useData();
  return data.status === 'ready' ? <Explore /> : <p>Loading</p>;
}

const map = () => screen.getByRole('region', { name: 'Course map by semester' });
const tile = (id) => within(map()).getByRole('button', { name: new RegExp(`^${id}(/\\d+)*, `) });
const stateOf = (id) => tile(id).closest('.tile-wrap').className.match(/tile-(\w+)$/)[1];

describe('view switch', () => {
  it('offers the term, circle, and flow views and moves with the arrow keys', async () => {
    const user = userEvent.setup();
    let view = 'term';
    const { rerender } = render(<ViewSwitch view={view} onChange={(v) => { view = v; }} />);
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Term view', 'Circle view', 'Flow view']);
    screen.getByRole('radio', { name: 'Term view' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(view).toBe('circle');
    rerender(<ViewSwitch view={view} onChange={(v) => { view = v; }} />);
    expect(screen.getByRole('radio', { name: 'Circle view' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('course map, term view', () => {
  it('opens in Term view with one column per academic map semester', async () => {
    const { container } = renderExplore();
    await screen.findByRole('heading', { name: 'Course map' });
    expect(screen.getByRole('radio', { name: 'Term view' }).getAttribute('aria-checked')).toBe('true');
    const columns = [...container.querySelectorAll('.map-group-term .map-group-name')].map((n) => n.textContent);
    expect(columns).toEqual([
      'Year 1 Fall', 'Year 1 Spring', 'Year 2 Fall', 'Year 2 Spring',
      'Year 3 Fall', 'Year 3 Spring', 'Year 4 Fall', 'Year 4 Spring',
    ]);
    expect(container.querySelectorAll('.tile').length).toBe(37);
  });

  it('highlights what a course needs and what it opens up, and shows its details', async () => {
    renderExplore();
    await screen.findByRole('heading', { name: 'Course map' });
    // A plain click: the map's pan handler reads mouse-down details that jsdom does not provide.
    fireEvent.click(tile('ENGR 3590'));

    expect(stateOf('ENGR 3590')).toBe('selected');
    expect(tile('ENGR 3590').getAttribute('aria-pressed')).toBe('true');
    // Prerequisites, all the way back.
    for (const id of ['ENGR 2120', 'CSCI 1170', 'ENGR 2110', 'MATH 1910']) expect(stateOf(id)).toBe('before');
    // Courses it opens up, all the way forward.
    for (const id of ['ENGR 4580', 'ENGR 4590', 'ENGR 4550']) expect(stateOf(id)).toBe('after');
    // Unrelated courses fade.
    expect(stateOf('CHEM 1110')).toBe('dim');

    const panel = screen.getByRole('complementary', { name: 'Course details' });
    expect(within(panel).getByText('Kinematics and Dynamics of Machinery')).toBeTruthy();
    expect(within(panel).getByText('Year 3 Fall')).toBeTruthy();
  });

  it('remembers the last view on this device', async () => {
    const user = userEvent.setup();
    renderExplore();
    await screen.findByRole('heading', { name: 'Course map' });
    await user.click(screen.getByRole('radio', { name: 'Flow view' }));
    expect(window.localStorage.getItem('mtsu-mechatronics-map-view-v1')).toBe('flow');
    expect(screen.getByText(/Every course sits in its subject group/)).toBeTruthy();
  });
});
