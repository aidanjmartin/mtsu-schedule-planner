import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadCore } from './data.js';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', core: null, error: null });
  useEffect(() => {
    let live = true;
    loadCore().then(
      (core) => live && setState({ status: 'ready', core, error: null }),
      (error) => live && setState({ status: 'error', core: null, error: error.message }),
    );
    return () => { live = false; };
  }, []);
  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
