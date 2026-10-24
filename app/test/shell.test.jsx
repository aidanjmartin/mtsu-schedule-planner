import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopBar from '../src/components/TopBar.jsx';
import Footer from '../src/components/Footer.jsx';
import App from '../src/App.jsx';

describe('top bar', () => {
  it('shows the gear logo, the department, and the program', () => {
    const { container } = render(<TopBar route="#/explore" />);
    const logo = container.querySelector('.brand img');
    expect(logo.getAttribute('src')).toMatch(/et-logo\.png$/);
    expect(screen.getByText('Department of Engineering & Technology')).toBeTruthy();
    expect(screen.getByText('Mechatronics Engineering')).toBeTruthy();
  });

  it('marks the current page in the navigation', () => {
    render(<TopBar route="#/plan" />);
    expect(screen.getByRole('link', { name: 'Plan my degree' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Course map' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('footer', () => {
  it('tells students to confirm the plan with an advisor', () => {
    render(<Footer />);
    expect(screen.getByText('Student-built planning tool. Confirm your plan with your academic advisor.')).toBeTruthy();
  });
});

describe('app', () => {
  it('opens the course map at the home page and the walkthrough at #/plan', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Course map', level: 1 })).toBeTruthy();
    window.location.hash = '#/plan';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('heading', { name: 'Where are you in the program?' })).toBeTruthy();
  });

  it('says so when the catalog does not load', async () => {
    globalThis.fetch = async () => ({ ok: false, json: async () => null });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch('The course catalog did not load.');
  });
});
