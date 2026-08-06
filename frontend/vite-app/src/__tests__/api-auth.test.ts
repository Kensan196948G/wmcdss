// @vitest-environment jsdom
/**
 * fetchJSON の Authorization 注入と 401 時のログアウト、および
 * その土台である auth-token.ts のテスト。
 *
 * api.test.ts と分けている理由は実行環境である。api.test.ts は
 * `environment: 'node'`（vite.config.ts の既定）で走り、window が無い
 * 場合の WMCDSS_API_BASE 分岐を検証している。こちらは localStorage と
 * window イベントが必要なので jsdom で走らせる。同じ describe に
 * 混ぜると、どちらか一方の前提が壊れる。
 *
 * 対象は backend の PR-C（/ai/*, /reports, /audit へ JWT 必須化）で
 * 増えた責務。付け忘れると該当画面が丸ごと 401 になるため、
 * 「呼び出し側ごとにヘッダーを付ける」方式へ戻らないよう固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── localStorage shim（auth.test.tsx / app-shell.test.tsx と同じ方式）────────
// jsdom 29 + vitest 3.2.6 の組み合わせでは Web Storage が実装されず、
// globalThis.localStorage が空のプレーンオブジェクトとして生えてくる
// （getItem すら無い）。素の jsdom へ依存すると getToken() が常に null を
// 返し、「ヘッダーが付かない」テストが誤った理由で緑になる。
const _store: Record<string, string> = {};
const _fakeStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: _fakeStorage,
  writable: true,
});

// ── shim 設置後に import ────────────────────────────────────────────────────
import { APIError, fetchJSON } from '../api';
import {
  TOKEN_KEY,
  USER_KEY,
  UNAUTHORIZED_EVENT,
  authHeader,
  clearToken,
  getToken,
  notifyUnauthorized,
} from '../auth-token';

function okResponse(json: unknown) {
  return { ok: true as const, json: vi.fn().mockResolvedValue(json) };
}
function failResponse(status: number, body = 'error') {
  return { ok: false as const, status, text: vi.fn().mockResolvedValue(body) };
}

/** fetch へ渡された 2 番目の引数（RequestInit）の headers を取り出す。 */
function sentHeaders(mockFetch: ReturnType<typeof vi.fn>): Record<string, string> {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

// ---------------------------------------------------------------------------
// auth-token.ts — トークン保管の単一の情報源
// ---------------------------------------------------------------------------

describe('auth-token', () => {
  beforeEach(() => localStorage.clear());

  it('returns null from getToken when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('returns the stored token', () => {
    localStorage.setItem(TOKEN_KEY, 'abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
  });

  it('builds an empty header object when unauthenticated', () => {
    // `Bearer `（値が空）を送ると、サーバー側で「壊れた資格情報」と
    // 「資格情報を送っていない」の区別が付かなくなる。キーごと出さない。
    expect(authHeader()).toEqual({});
  });

  it('builds a Bearer header when authenticated', () => {
    localStorage.setItem(TOKEN_KEY, 'abc.def.ghi');
    expect(authHeader()).toEqual({ Authorization: 'Bearer abc.def.ghi' });
  });

  it('clears the user object together with the token', () => {
    // トークンだけ消すと、getUser() がログイン済みのユーザーを返し続ける。
    // 画面はログイン中の表示のまま API だけ全て失敗する状態になる。
    localStorage.setItem(TOKEN_KEY, 'abc.def.ghi');
    localStorage.setItem(USER_KEY, JSON.stringify({ username: 'admin' }));
    clearToken();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it('clears storage and dispatches the event from notifyUnauthorized', () => {
    localStorage.setItem(TOKEN_KEY, 'abc.def.ghi');
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    notifyUnauthorized();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });
});

// ---------------------------------------------------------------------------
// fetchJSON — Authorization ヘッダーの注入
// ---------------------------------------------------------------------------

describe('fetchJSON Authorization injection', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('attaches Authorization when a token is stored', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored.jwt.value');
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/ai/chat');
    expect(sentHeaders(mockFetch).Authorization).toBe('Bearer stored.jwt.value');
  });

  it('omits Authorization entirely when no token is stored', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/sites');
    expect(sentHeaders(mockFetch)).not.toHaveProperty('Authorization');
  });

  it('preserves caller-supplied headers alongside Authorization', async () => {
    // AI 系の 5 つの呼び出し (api.ts) は Content-Type を明示している。
    // 注入時のマージでこれを消すと、backend が本文を解釈できなくなる。
    localStorage.setItem(TOKEN_KEY, 'stored.jwt.value');
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const headers = sentHeaders(mockFetch);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBe('Bearer stored.jwt.value');
  });

  it('lets a caller-supplied Authorization win over the stored token', async () => {
    // authHeader() を先に展開し呼び出し側を後に置いた順序の帰結。
    // 別の資格情報で叩きたい経路（管理系の検証など）を塞がないため。
    localStorage.setItem(TOKEN_KEY, 'stored.jwt.value');
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/ai/chat', { headers: { Authorization: 'Bearer explicit' } });
    expect(sentHeaders(mockFetch).Authorization).toBe('Bearer explicit');
  });

  it('still forwards method and body while injecting headers', async () => {
    localStorage.setItem(TOKEN_KEY, 'stored.jwt.value');
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/decisions', { method: 'POST', body: '{"site_id":1}' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"site_id":1}');
  });
});

// ---------------------------------------------------------------------------
// fetchJSON — 401 の扱い
// ---------------------------------------------------------------------------

describe('fetchJSON 401 handling', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('clears the stored token and notifies on 401', async () => {
    localStorage.setItem(TOKEN_KEY, 'expired.jwt.value');
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    mockFetch.mockResolvedValue(failResponse(401, 'Not authenticated'));

    await expect(fetchJSON('/audit')).rejects.toBeInstanceOf(APIError);

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('still throws APIError with status 401 after clearing', async () => {
    // 破棄と通知は投げる前に済ませる。APIError を握り潰す呼び出し側が
    // あっても認証状態が巻き戻るようにするため。
    localStorage.setItem(TOKEN_KEY, 'expired.jwt.value');
    mockFetch.mockResolvedValue(failResponse(401, 'Not authenticated'));
    await expect(fetchJSON('/audit')).rejects.toMatchObject({ status: 401 });
  });

  it('keeps the token on non-401 failures', async () => {
    // 500 や 404 でログアウトさせると、backend の一時障害が
    // 「勝手にログアウトされる」という別の障害に化ける。
    localStorage.setItem(TOKEN_KEY, 'valid.jwt.value');
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    mockFetch.mockResolvedValue(failResponse(500, 'boom'));

    await expect(fetchJSON('/sites')).rejects.toBeInstanceOf(APIError);

    expect(localStorage.getItem(TOKEN_KEY)).toBe('valid.jwt.value');
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });

  it('keeps the token on 403 (authenticated but not permitted)', async () => {
    // 403 は「誰か分かっているが権限が無い」。再ログインさせても解決しない。
    localStorage.setItem(TOKEN_KEY, 'valid.jwt.value');
    mockFetch.mockResolvedValue(failResponse(403, 'Forbidden'));
    await expect(fetchJSON('/audit')).rejects.toBeInstanceOf(APIError);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('valid.jwt.value');
  });
});
