import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppShell } from './app-shell';
import { WMCDSS_API } from './api';
import { AuthStore, LoginPage, tryDemoLogin, type AuthUser } from './auth';
import { UNAUTHORIZED_EVENT } from './auth-token';
import './tweaks-panel';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing');

const root = createRoot(rootEl);

type BackendStatus = {
  ok: boolean;
  reason?: string;
  sites?: number;
  base?: string;
  error?: string;
};

function BackendStatusStrip({ status }: { status: BackendStatus | null }) {
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

/**
 * デモログイン判定の状態。
 *
 *   'pending' … サーバーへ問い合わせ中（まだ白黒ついていない）
 *   'done'    … 判定完了（成功で user が入る / 失敗・404 なら null のまま）
 *
 * 「試したか」ではなく「終わったか」を表すのが要点。判定が終わるまでは何も
 * 描画しないため、バイパス有効環境でログイン画面が一瞬見えるちらつきが出ない。
 */
type DemoState = 'pending' | 'done';

function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    // 起動時にトークンが有効かチェック
    if (AuthStore.isAuthenticated()) {
      return AuthStore.getUser();
    }
    return null;
  });
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(
    () => window.BACKEND_STATUS ?? null,
  );
  // 判定が終わるまで 'pending'。多重 POST の抑止は下の effect の実行条件で行う
  // （user が居る / 既に 'done' なら何もしない）。
  // 注意: React StrictMode の開発時のみ effect が 2 回実行されるため
  // POST も 2 回になる（production build では 1 回）。
  const [demoState, setDemoState] = useState<DemoState>('pending');

  // ログイン後にだけバックエンドを初期化する。GET /sites 等は本番では JWT を
  // 要求するため、未認証のまま preflight すると「未接続」と誤判定される。
  // ログアウト時（user が null）は初期化しない。
  useEffect(() => {
    if (!user) return;
    const pending = WMCDSS_API?.initFromBackend?.();
    if (pending && typeof pending.catch === 'function') {
      pending
        .then(() => {
          // initFromBackend は window.BACKEND_STATUS を更新するが、それ自体では
          // React の再レンダリングを誘発しない。状態をコピーして表示へ反映する。
          setBackendStatus(window.BACKEND_STATUS ?? null);
        })
        .catch((e: unknown) => {
          console.warn('[wmcdss] initFromBackend failed:', e);
          setBackendStatus(window.BACKEND_STATUS ?? null);
        });
    }
  }, [user]);

  // API が 401 を返したら（＝トークンが失効・改竄されている）ログイン画面へ戻す。
  //
  // 起動時のチェックだけでは足りない。トークンの有効期限は開いたままの画面でも
  // 切れるため、それを検知できるのは実際に API を叩いた瞬間しかない。これが無いと
  // 期限切れ後は「画面は表示されているのに全ての操作が黙って失敗する」状態になる。
  // 破棄自体は fetchJSON 側で済んでいるので、ここでは表示の巻き戻しだけを行う。
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // MVP 公開デモ: サーバー側でログイン認証がバイパスされている場合は、
  // ログイン画面を出さずにデモ用セッションを自動で開始する。
  // バイパスが無効な環境では /auth/demo-login が 404 になるため、
  // 従来どおりログイン画面が表示される。
  //
  // 判定の完了（成功・404・予期しない reject のいずれでも）を finally で
  // 'done' に倒す。これにより、判定が返らないまま固まっても空白になり続けず、
  // 必ず LoginPage か AppShell のどちらかへ到達する。
  // 依存配列は [user, demoState] で、どちらかが変われば再実行されるが、
  // 先頭の early return により POST は 1 判定につき 1 回で止まる。
  useEffect(() => {
    if (user || demoState === 'done') return;
    let cancelled = false;
    void tryDemoLogin()
      .then((demoUser) => {
        if (!cancelled && demoUser) setUser(demoUser);
      })
      .catch((e: unknown) => {
        // tryDemoLogin 自身は失敗時に null を返す契約だが、予期しない reject でも
        // UI を固まらせない（finally が 'done' にして LoginPage へ落とす）。
        console.warn('[wmcdss] tryDemoLogin failed:', e);
      })
      .finally(() => {
        if (!cancelled) setDemoState('done');
      });
    return () => {
      cancelled = true;
    };
  }, [user, demoState]);

  if (!user) {
    // 判定が終わるまでは何も描画しない（ログイン画面が一瞬出るちらつきを防ぐ）
    if (demoState === 'pending') return null;
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
      <BackendStatusStrip status={backendStatus} />
      <AppShell />
    </>
  );
}

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
