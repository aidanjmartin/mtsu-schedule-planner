// Browser features jsdom does not provide, and a fetch that serves the repository's data/ folder the way the
// built site serves its copy. The date is fixed so plans do not change from week to week.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

export const TODAY = new Date('2026-10-21T12:00:00');

export function readData(file) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
}

class ResizeObserverStub {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
}

// React Flow reads the zoom from the transform of each node with DOMMatrixReadOnly.
class DOMMatrixStub {
  constructor() { this.m22 = 1; }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
  // The PDF test runs in plain Node, with no window.
  if (typeof window === 'undefined') return;
  window.DOMMatrixReadOnly = DOMMatrixStub;
  globalThis.ResizeObserver = ResizeObserverStub;
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  globalThis.fetch = vi.fn(async (url) => {
    const rel = String(url).replace(/^.*?\/data\//, '');
    const file = path.join(dataDir, rel);
    if (!file.startsWith(dataDir) || !fs.existsSync(file)) return { ok: false, json: async () => null };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
  });
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  if (typeof window !== 'undefined') cleanup();
  vi.useRealTimers();
});
