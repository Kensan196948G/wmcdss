import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './app-shell';
import { WMCDSS_API } from './api';
import { AuthStore, LoginPage, type AuthUser } from './auth';
import './tweaks-panel';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

const root = createRoot(rootEl);

function BackendStatusStrip() {
  const status = window.BACKEND_STATUS;
  if (!status) {
    return null;
  }
  if (!status.ok) {
    const reason = status.reason ?? 'pending';
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
  const sites = status.sites ?? 0;
  const base = status.base ?? '';
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#065f46',
        color: '#ecfdf5',
        padding: '6px 16px',
        fontSize: 12,
        fontWeight: 500,
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.12)',
        letterSpacing: 0.2,
      }}
    >
      ✅ Backend 接続中 — {sites} 現場ロード済
      {base && (
        <>
          {' '}
          <span style={{ opacity: 0.75 }}>（{base}）</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 認証ゲート付きアプリルート
// ---------------------------------------------------------------------------

function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    // 起動時にトークンが有効かチェック
    if (AuthStore.isAuthenticated()) {
      return AuthStore.getUser();
    }
    return null;
  });

  if (!user) {
    return (
      <LoginPage
        onLogin={(loggedInUser) => {
          setUser(loggedInUser);
        }}
      />
    );
  }

  return (
    <>
      <BackendStatusStrip />
      <AppShell />
    </>
  );
}

WMCDSS_API.initFromBackend()
  .catch((e: unknown) => {
    console.warn('[wmcdss] initFromBackend failed:', e);
  })
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
