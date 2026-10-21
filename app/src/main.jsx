import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/explore.css';
import './styles/plan.css';
import './styles/results.css';
import './styles/advanced.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
