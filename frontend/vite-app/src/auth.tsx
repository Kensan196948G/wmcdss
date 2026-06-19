/**
 * WMCDSS 認証モジュール
 *
 * LoginPage : ログイン UI（一般ログイン / Microsoft 365 非対話式ログイン）
 * AuthStore  : JWT トークン管理（localStorage）
 *
 * 既存 WebUI (AppShell 以下) には一切変更を加えない。
 * main.tsx がこのモジュールを呼び出して認証ゲートとして機能させる。
 */
import { type FC, useState } from 'react';
import { WMCDSS_API_BASE } from './api';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'wmcdss_access_token';
const USER_KEY = 'wmcdss_user';

// WMCDSS_API_BASE = "/api/v1" in production, or "http://{hostname}:8003/api/v1" in Vite dev
// auth エンドポイントは /auth/login, /auth/login/m365, /auth/me
// → WMCDSS_API_BASE + "/auth/login"
function getApiBase(): string {
  return WMCDSS_API_BASE;
}

// ---------------------------------------------------------------------------
// AuthStore — JWT トークン管理
// ---------------------------------------------------------------------------

export interface AuthUser {
  username: string;
  displayName: string;
  authType: 'local' | 'm365';
}

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage;
    }
  } catch {
    // localStorage unavailable (test env, SSR, etc.)
  }
  return null;
}

export const AuthStore = {
  getToken(): string | null {
    return safeStorage()?.getItem(TOKEN_KEY) ?? null;
  },
  getUser(): AuthUser | null {
    try {
      const raw = safeStorage()?.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  },
  save(token: string, user: AuthUser): void {
    const s = safeStorage();
    s?.setItem(TOKEN_KEY, token);
    s?.setItem(USER_KEY, JSON.stringify(user));
  },
  clear(): void {
    const s = safeStorage();
    s?.removeItem(TOKEN_KEY);
    s?.removeItem(USER_KEY);
  },
  isAuthenticated(): boolean {
    const token = AuthStore.getToken();
    if (!token) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(atob(parts[1]));
      const exp = payload.exp as number | undefined;
      if (exp && Date.now() / 1000 > exp) {
        AuthStore.clear();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// LoginPage コンポーネント
// ---------------------------------------------------------------------------

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

export const LoginPage: FC<LoginPageProps> = ({ onLogin }) => {
  const [tab, setTab] = useState<'local' | 'm365'>('local');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [m365Password, setM365Password] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('ユーザー名とパスワードを入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${getApiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { detail?: string }).detail ?? 'ログインに失敗しました');
        return;
      }
      const data = await res.json() as {
        access_token: string;
        username: string;
        display_name: string;
        auth_type: string;
      };
      const user: AuthUser = {
        username: data.username,
        displayName: data.display_name,
        authType: 'local',
      };
      AuthStore.save(data.access_token, user);
      onLogin(user);
    } catch {
      setError('サーバーに接続できません。しばらくしてから再試行してください。');
    } finally {
      setLoading(false);
    }
  };

  const handleM365Login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !m365Password) {
      setError('メールアドレスとパスワードを入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${getApiBase()}/auth/login/m365`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password: m365Password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { detail?: string }).detail ?? 'Microsoft 365 ログインに失敗しました');
        return;
      }
      const data = await res.json() as {
        access_token: string;
        username: string;
        display_name: string;
        auth_type: string;
      };
      const user: AuthUser = {
        username: data.username,
        displayName: data.display_name,
        authType: 'm365',
      };
      AuthStore.save(data.access_token, user);
      onLogin(user);
    } catch {
      setError('サーバーに接続できません。しばらくしてから再試行してください。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #f0f4f8)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--card-bg, #fff)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
        padding: '36px 32px 28px',
        border: '1px solid var(--border, #e2e8f0)',
      }}>
        {/* ロゴ / タイトル */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌊</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text, #1a202c)' }}>
            WMCDSS
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, #718096)', marginTop: 4 }}>
            気象海象 施工判断支援システム
          </div>
        </div>

        {/* タブ切替 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg, #f0f4f8)', borderRadius: 8, padding: 3 }}>
          <button
            type="button"
            onClick={() => { setTab('local'); setError(''); }}
            style={{
              flex: 1,
              padding: '7px 12px',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: tab === 'local' ? 'var(--card-bg, #fff)' : 'transparent',
              color: tab === 'local' ? 'var(--blue-600, #2563eb)' : 'var(--text-muted, #718096)',
              boxShadow: tab === 'local' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            🔑 一般ログイン
          </button>
          <button
            type="button"
            onClick={() => { setTab('m365'); setError(''); }}
            style={{
              flex: 1,
              padding: '7px 12px',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              background: tab === 'm365' ? 'var(--card-bg, #fff)' : 'transparent',
              color: tab === 'm365' ? 'var(--blue-600, #2563eb)' : 'var(--text-muted, #718096)',
              boxShadow: tab === 'm365' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            🏢 Microsoft 365
          </button>
        </div>

        {/* エラー表示 */}
        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            marginBottom: 16,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* 一般ログインフォーム */}
        {tab === 'local' && (
          <form onSubmit={handleLocalLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4a5568)', marginBottom: 5 }}>
                ユーザー名
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                autoComplete="username"
                disabled={loading}
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4a5568)', marginBottom: 5 }}>
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
                style={inputStyle}
              />
            </div>
            <button type="submit" disabled={loading} style={submitBtnStyle}>
              {loading ? '認証中...' : 'ログイン'}
            </button>
          </form>
        )}

        {/* Microsoft 365 ログインフォーム */}
        {tab === 'm365' && (
          <form onSubmit={handleM365Login}>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#1d4ed8', marginBottom: 14 }}>
              @mirai-const.co.jp の M365 アカウントでログインします
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4a5568)', marginBottom: 5 }}>
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@mirai-const.co.jp"
                autoComplete="email"
                disabled={loading}
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #4a5568)', marginBottom: 5 }}>
                パスワード
              </label>
              <input
                type="password"
                value={m365Password}
                onChange={e => setM365Password(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={loading}
                style={inputStyle}
              />
            </div>
            <button type="submit" disabled={loading} style={{ ...submitBtnStyle, background: '#2563eb' }}>
              {loading ? '認証中...' : 'Microsoft 365 でログイン'}
            </button>
          </form>
        )}

        {/* フッター */}
        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted, #9ca3af)' }}>
          © 2026 WMCDSS
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// スタイル定数
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border, #d1d5db)',
  borderRadius: 6,
  fontSize: 14,
  background: 'var(--bg, #f9fafb)',
  color: 'var(--text, #111827)',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
};

const submitBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  background: '#1a8a4a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.15s',
};
