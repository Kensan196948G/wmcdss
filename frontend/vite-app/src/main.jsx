import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

// Phase 0: confirms the toolchain compiles JSX, bundles React, and serves the
// result. Phase 1 will port the existing window.WMCDSS_API + .jsx modules from
// ../*.jsx into this src/ tree as ES modules with explicit imports.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
