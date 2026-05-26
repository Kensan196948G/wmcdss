import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './app-shell';
import { WMCDSS_API } from './api';
import './tweaks-panel';
import '../../styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

const root = createRoot(rootEl);

function MockBanner() {
  const status = window.BACKEND_STATUS;
  if (status?.ok) return null;
  const reason = status?.reason ?? 'pending';
  return (
    <div
      role="alert"
      style={{
        background: '#b91c1c',
        color: '#fff',
        padding: '10px 16px',
        fontSize: 14,
        fontWeight: 600,
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
      }}
    >
      ⚠️ バックエンド未接続: 表示中のデータはサンプルです（{reason}）。施工判断には使用しないでください。
    </div>
  );
}

WMCDSS_API.initFromBackend()
  .catch((e: unknown) => {
    console.warn('[wmcdss] initFromBackend failed:', e);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <MockBanner />
        <AppShell />
      </StrictMode>,
    );
  });
