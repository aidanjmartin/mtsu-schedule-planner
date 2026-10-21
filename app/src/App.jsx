import React, { Suspense, lazy, useEffect, useState } from 'react';
import { DataProvider, useData } from './lib/DataContext.jsx';
import TopBar from './components/TopBar.jsx';
import Footer from './components/Footer.jsx';
import Explore from './pages/Explore.jsx';
import Plan from './pages/Plan.jsx';

const Advanced = lazy(() => import('./pages/Advanced.jsx'));

const ROUTES = {
  '#/explore': { title: 'Course map' },
  '#/plan': { title: 'Plan my degree' },
  '#/advanced': { title: 'Advanced tools' },
};

function currentRoute() {
  const hash = window.location.hash;
  return ROUTES[hash] ? hash : '#/explore';
}

function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Page({ route }) {
  const data = useData();
  if (data.status === 'loading') return <div className="loading" role="status">Loading the course catalog...</div>;
  if (data.status === 'error') {
    return (
      <div className="page">
        <div className="notice notice-bad" role="alert">
          <p><strong>The course catalog did not load.</strong></p>
          <p>Check your internet connection and reload the page.</p>
        </div>
      </div>
    );
  }
  if (route === '#/plan') return <Plan />;
  if (route === '#/advanced') {
    return <Suspense fallback={<div className="loading" role="status">Loading...</div>}><Advanced /></Suspense>;
  }
  return <Explore />;
}

export default function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = `${ROUTES[route].title} | Mechatronics Degree Planner`;
    window.scrollTo(0, 0);
  }, [route]);
  return (
    <DataProvider>
      <a className="skip-link" href="#main">Skip to the page</a>
      <TopBar route={route} />
      <main id="main" tabIndex={-1} className={route === '#/explore' ? 'main-explore' : 'main'}>
        <Page route={route} />
      </main>
      <Footer />
    </DataProvider>
  );
}
