import React from 'react';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-cell">
          <p>Student-built planning tool. Confirm your plan with your academic advisor.</p>
        </div>
        <div className="footer-cell">
          <span className="cell-label">Catalog year</span>
          <p>2026-27</p>
        </div>
        <div className="footer-cell">
          <span className="cell-label">For the program owner</span>
          <p><a href="#/advanced">Advanced tools</a></p>
        </div>
      </div>
    </footer>
  );
}
