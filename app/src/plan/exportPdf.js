import React from 'react';
import { Buffer } from 'buffer';
import { pdf } from '@react-pdf/renderer';
import PlanPdf from './PlanPdf.jsx';
import { terms as T } from '../lib/engine.js';

// The PDF library checks for Node's Buffer when it loads the logo. Browsers do not have one, so we supply it.
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;

const LOGO = `${window.location.origin}${import.meta.env.BASE_URL}et-logo.png`;

export function pdfFileName(currentTerm) {
  const season = T.seasonOf(currentTerm);
  const year = currentTerm.slice(0, 4);
  return `mechatronics-plan-${season}-${year}.pdf`;
}

function longDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Draw the PDF, then check which table rows start a new page and draw it again with the column headings repeated there.
 * A repeated heading takes room, so the check runs again until the page breaks stop moving.
 */
async function renderWithRepeatedHeadings(props) {
  let headingBefore = [];
  let blob = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const pages = [];
    const trackRow = (row, page) => { pages[row] = page; };
    blob = await pdf(React.createElement(PlanPdf, { ...props, headingBefore, trackRow })).toBlob();
    const next = [];
    pages.forEach((page, row) => { if (row > 0 && page > pages[row - 1]) next.push(row); });
    if (next.join() === headingBefore.join()) break;
    headingBefore = next;
  }
  return blob;
}

/** Build the PDF in the browser and save it to the student's computer. */
export async function downloadPlanPdf({ catalog, answers, result, name, classTimes }) {
  const props = { catalog, answers, result, name, classTimes, logo: LOGO, created: longDate(new Date()) };
  const blob = await renderWithRepeatedHeadings(props);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfFileName(result.currentTerm);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return blob;
}
