import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './app-shell';
import { WMCDSS_API } from './api';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

const root = createRoot(rootEl);

WMCDSS_API.initFromBackend()
  .catch((e: unknown) => {
    console.warn('[wmcdss] initFromBackend failed:', e);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <AppShell />
      </StrictMode>,
    );
  });
