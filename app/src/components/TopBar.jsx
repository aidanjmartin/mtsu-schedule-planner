import React from 'react';

const LOGO = `${import.meta.env.BASE_URL}et-logo.png`;

export default function TopBar({ route }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/explore" aria-label="Department of Engineering and Technology, Mechatronics Engineering. Go to the course map.">
          <img src={LOGO} alt="" width="59" height="46" />
          <span className="brand-text">
            <span className="brand-dept">Department of Engineering &amp; Technology</span>
            <span className="brand-prog">Mechatronics Engineering</span>
          </span>
        </a>
        <nav className="topnav" aria-label="Main">
          <a href="#/explore" aria-current={route === '#/explore' ? 'page' : undefined}>Course map</a>
          <a href="#/plan" aria-current={route === '#/plan' ? 'page' : undefined}>Plan my degree</a>
        </nav>
      </div>
    </header>
  );
}
