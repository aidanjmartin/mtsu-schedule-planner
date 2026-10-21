import React from 'react';
import { pdf } from '@react-pdf/renderer';
import PlanPdf from './PlanPdf.jsx';
import { terms as T } from '../lib/engine.js';

const LOGO = `${window.location.origin}${import.meta.env.BASE_URL}et-logo.png`;

export function pdfFileName(currentTerm) {
  const season = T.seasonOf(currentTerm);
  const year = currentTerm.slice(0, 4);
  return `mechatronics-plan-${season}-${year}.pdf`;
}

function longDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Build the PDF in the browser and save it to the student's computer. */
export async function downloadPlanPdf({ catalog, answers, result, name, classTimes }) {
  const doc = React.createElement(PlanPdf, {
    catalog, answers, result, name, classTimes, logo: LOGO, created: longDate(new Date()),
  });
  const blob = await pdf(doc).toBlob();
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
