// @vitest-environment node
// The PDF library runs the same way in Node as in the browser, so this test draws the real file.

import React from 'react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToBuffer } from '@react-pdf/renderer';
import PlanPdf from '../src/plan/PlanPdf.jsx';
import * as M from '../src/lib/planModel.js';
import { readData, TODAY } from './setup.js';

const catalog = readData('catalogs/2026-27.json');
const offerings = readData('offerings.json');
const logo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/et-logo.png');

describe('plan PDF', () => {
  it('draws a letter-size PDF of the plan to graduation', async () => {
    const answers = M.seedAnswers(catalog, { ...M.emptyAnswers(), firstSemester: true, electives: ['ENGR 3915', 'ENGR 4550', 'ENGR 4560', 'ENGR 4500'] });
    const result = M.computeResult(catalog, offerings, answers, { today: TODAY });
    const pages = [];
    const buffer = await renderToBuffer(
      <PlanPdf catalog={catalog} answers={answers} result={result} name="Test Student" logo={logo} created="October 21, 2026" classTimes={null} trackRow={(row, page) => { pages[row] = page; }} />,
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const text = buffer.toString('latin1');
    expect(text).toMatch('/MediaBox [0 0 612 792]');
    expect(text).toMatch('Mechatronics Engineering Degree Plan');
    // Every semester through graduation is a row of the table.
    expect(pages.filter((p) => p !== undefined)).toHaveLength(result.terms.length);
    expect(Math.max(...pages)).toBeLessThanOrEqual(2);
  });
});
