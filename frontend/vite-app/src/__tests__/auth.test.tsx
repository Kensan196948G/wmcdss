// @vitest-environment jsdom
/**
 * Tests for auth.tsx:
 *   AuthStore  — JWT token management (localStorage)
 *   LoginPage  — login UI with local / M365 tabs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

// ── localStorage shim (same pattern as app-shell tests) ─────────────────────
const _store: Record<string, string> = {};
const _fakeStorage = {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
};
Object.defineProperty(globalThis, "localStorage", {
  value: _fakeStorage,
  writable: true,
});

// ── import after shim is in place ───────────────────────────────────────────
import { AuthStore, LoginPage, tryDemoLogin, type AuthUser } from "../auth";

// ── helpers ─────────────────────────────────────────────────────────────────

/** Build a JWT with the given payload (no real signature). */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesig`;
}

const MOCK_USER: AuthUser = {
  username: "admin",
  displayName: "Admin User",
  authType: "local",
};

// ── AuthStore ────────────────────────────────────────────────────────────────

describe("AuthStore", () => {
  beforeEach(() => _fakeStorage.clear());
  afterEach(() => _fakeStorage.clear());

  it("getToken returns null when nothing stored", () => {
    expect(AuthStore.getToken()).toBeNull();
  });

  it("save + getToken round-trip", () => {
    AuthStore.save("tok123", MOCK_USER);
    expect(AuthStore.getToken()).toBe("tok123");
  });

  it("save + getUser round-trip", () => {
    AuthStore.save("tok123", MOCK_USER);
    expect(AuthStore.getUser()).toEqual(MOCK_USER);
  });

  it("getUser returns null when nothing stored", () => {
    expect(AuthStore.getUser()).toBeNull();
  });

  it("getUser returns null for corrupt JSON", () => {
    _store["wmcdss_user"] = "{not-json";
    expect(AuthStore.getUser()).toBeNull();
  });

  it("clear removes token and user", () => {
    AuthStore.save("tok", MOCK_USER);
    AuthStore.clear();
    expect(AuthStore.getToken()).toBeNull();
    expect(AuthStore.getUser()).toBeNull();
  });

  describe("isAuthenticated", () => {
    it("false when no token", () => {
      expect(AuthStore.isAuthenticated()).toBe(false);
    });

    it("false for non-JWT string", () => {
      _store["wmcdss_access_token"] = "not.a.jwt.at.all";
      expect(AuthStore.isAuthenticated()).toBe(false);
    });

    it("false when exp is in the past (clears token)", () => {
      const expiredJwt = makeJwt({ sub: "admin", exp: Math.floor(Date.now() / 1000) - 3600 });
      AuthStore.save(expiredJwt, MOCK_USER);
      expect(AuthStore.isAuthenticated()).toBe(false);
      expect(AuthStore.getToken()).toBeNull();
    });

    it("true when exp is in the future", () => {
      const validJwt = makeJwt({ sub: "admin", exp: Math.floor(Date.now() / 1000) + 3600 });
      AuthStore.save(validJwt, MOCK_USER);
      expect(AuthStore.isAuthenticated()).toBe(true);
    });

    it("true when JWT has no exp field", () => {
      const noExpJwt = makeJwt({ sub: "admin" });
      AuthStore.save(noExpJwt, MOCK_USER);
      expect(AuthStore.isAuthenticated()).toBe(true);
    });

    it("false when payload base64 is invalid", () => {
      _store["wmcdss_access_token"] = "aaa.!!!.ccc";
      expect(AuthStore.isAuthenticated()).toBe(false);
    });
  });
});

// ── tryDemoLogin — MVP 公開デモ用の自動ログイン（bd9628d） ───────────────────
//
// サーバーが WMCDSS_AUTH_BYPASS=true のときだけ 200 を返す。本番は 404 なので
// 呼び出し側（main.tsx）はログイン画面へフォールバックする。ここでは「200 の
// ときだけ保存して user を返す」「それ以外は必ず null」を固定する。

describe("tryDemoLogin", () => {
  beforeEach(() => _fakeStorage.clear());
  afterEach(() => {
    _fakeStorage.clear();
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/demo-login once", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    await tryDemoLogin();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toContain("/auth/demo-login");
    expect(mockFetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  it("returns null and stores nothing on 404 (bypass disabled)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(tryDemoLogin()).resolves.toBeNull();
    expect(AuthStore.getToken()).toBeNull();
    expect(AuthStore.getUser()).toBeNull();
  });

  it("saves the JWT and returns the user on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        access_token: "demo-jwt",
        username: "demo",
        display_name: "Demo User",
        role: "admin",
      }),
    }));

    await expect(tryDemoLogin()).resolves.toEqual({
      username: "demo",
      displayName: "Demo User",
      authType: "local",
      role: "admin",
    });
    // 自動ログインでも AuthStore 経由で保存され、以降 isAuthenticated() が真になる
    expect(AuthStore.getToken()).toBe("demo-jwt");
    expect(AuthStore.getUser()).toEqual({
      username: "demo",
      displayName: "Demo User",
      authType: "local",
      role: "admin",
    });
  });

  it("falls back to username when display_name / role are omitted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ access_token: "demo-jwt", username: "demo" }),
    }));

    await expect(tryDemoLogin()).resolves.toEqual({
      username: "demo",
      displayName: "demo",
      authType: "local",
      role: undefined,
    });
  });

  it("returns null when the 200 body is missing access_token or username", async () => {
    const incompleteBodies = [
      {},
      { access_token: "demo-jwt" },
      { username: "demo" },
    ];
    for (const body of incompleteBodies) {
      _fakeStorage.clear();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(body),
      }));

      await expect(tryDemoLogin()).resolves.toBeNull();
      expect(AuthStore.getToken()).toBeNull();
    }
  });

  it("returns null instead of throwing when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(tryDemoLogin()).resolves.toBeNull();
    expect(AuthStore.getToken()).toBeNull();
  });

  // ── 無応答（ハング）対策のタイムアウト配線 ─────────────────────────────────
  // 実時間で 5 秒待つテストは書かない（遅いテストはフレーク源）。ここでは
  // 「signal が実際に fetch へ渡っている」ことと「abort/timeout の reject が
  // null になる」ことを固定する。

  it("passes an AbortSignal to fetch (demo-login timeout is wired)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    await tryDemoLogin();

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // 呼び出し直後に既に aborted だと判定が即失敗してしまう（配線ミス）
    expect((init.signal as AbortSignal).aborted).toBe(false);
  });

  it("returns null when the request aborts (AbortError)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    ));

    await expect(tryDemoLogin()).resolves.toBeNull();
    expect(AuthStore.getToken()).toBeNull();
  });

  it("returns null when the request times out (TimeoutError)", async () => {
    // AbortSignal.timeout() が発火したとき fetch が投げる DOMException
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    ));

    await expect(tryDemoLogin()).resolves.toBeNull();
    expect(AuthStore.getToken()).toBeNull();
  });
});

// ── LoginPage ────────────────────────────────────────────────────────────────

describe("LoginPage", () => {
  const onLogin = vi.fn();

  beforeEach(() => {
    _fakeStorage.clear();
    onLogin.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders with local tab active by default", () => {
    const { getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    expect(getByPlaceholderText("admin")).toBeTruthy();
    expect(getByPlaceholderText("••••••••")).toBeTruthy();
  });

  it("renders logo title WMCDSS", () => {
    const { getByText } = render(<LoginPage onLogin={onLogin} />);
    expect(getByText("WMCDSS")).toBeTruthy();
  });

  it("renders both tab buttons", () => {
    const { getByText } = render(<LoginPage onLogin={onLogin} />);
    expect(getByText(/一般ログイン/)).toBeTruthy();
    expect(getByText(/Microsoft 365/)).toBeTruthy();
  });

  it("clicking M365 tab shows email field", () => {
    const { getByText, getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    expect(getByPlaceholderText(/mirai-const\.co\.jp/)).toBeTruthy();
  });

  it("clicking back to local tab shows username field", () => {
    const { getByText, getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    fireEvent.click(getByText(/一般ログイン/));
    expect(getByPlaceholderText("admin")).toBeTruthy();
  });

  // ── local login validation ───────────────────────────────────────────────

  it("shows error when submitting empty username", async () => {
    const { getByText } = render(<LoginPage onLogin={onLogin} />);
    await act(async () => { fireEvent.click(getByText("ログイン")); });
    expect(getByText(/ユーザー名とパスワードを入力してください/)).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("shows error when submitting whitespace-only username", async () => {
    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "   " } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "pass" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });
    expect(getByText(/ユーザー名とパスワードを入力してください/)).toBeTruthy();
  });

  // ── local login success ──────────────────────────────────────────────────

  it("calls onLogin with user on successful local login", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: "jwt-abc",
        username: "admin",
        display_name: "Admin User",
        auth_type: "local",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "admin" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "pass123" } });

    await act(async () => { fireEvent.click(getByText("ログイン")); });

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(onLogin).toHaveBeenCalledWith({
      username: "admin",
      displayName: "Admin User",
      authType: "local",
      role: "field",
    });
    expect(AuthStore.getToken()).toBe("jwt-abc");
  });

  // ── local login 401 ──────────────────────────────────────────────────────

  it("shows error message on 401 local login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: "Invalid credentials" }),
    }));

    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "admin" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "wrongpass" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });

    await waitFor(() => expect(getByText(/Invalid credentials/)).toBeTruthy());
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("shows fallback error when 401 response has no detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    }));

    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "admin" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "bad" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });

    await waitFor(() => expect(getByText(/ログインに失敗しました/)).toBeTruthy());
  });

  it("shows fallback error when response.json() throws on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockRejectedValue(new Error("not json")),
    }));

    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "admin" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "bad" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });

    await waitFor(() => expect(getByText(/ログインに失敗しました/)).toBeTruthy());
  });

  // ── local login network error ────────────────────────────────────────────

  it("shows connection error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    const { getByPlaceholderText, getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "admin" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "pass" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });

    await waitFor(() => expect(getByText(/サーバーに接続できません/)).toBeTruthy());
  });

  // ── M365 login validation ────────────────────────────────────────────────

  it("shows error when submitting empty M365 email", async () => {
    const { getByText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    await act(async () => { fireEvent.click(getByText(/Microsoft 365 でログイン/)); });
    expect(getByText(/メールアドレスとパスワードを入力してください/)).toBeTruthy();
  });

  // ── M365 login success ───────────────────────────────────────────────────

  it("calls onLogin on successful M365 login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        access_token: "m365-jwt",
        username: "user@mirai-const.co.jp",
        display_name: "Test User",
        auth_type: "m365",
      }),
    }));

    const { getByText, getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    fireEvent.change(getByPlaceholderText(/mirai-const\.co\.jp/), {
      target: { value: "user@mirai-const.co.jp" },
    });
    // get second password field (m365 tab)
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "m365pass" } });

    await act(async () => { fireEvent.click(getByText(/Microsoft 365 でログイン/)); });

    await waitFor(() => expect(onLogin).toHaveBeenCalledOnce());
    expect(onLogin).toHaveBeenCalledWith(
      expect.objectContaining({ authType: "m365" })
    );
  });

  // ── M365 login error ─────────────────────────────────────────────────────

  it("shows error on M365 login failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: "M365 auth failed" }),
    }));

    const { getByText, getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    fireEvent.change(getByPlaceholderText(/mirai-const\.co\.jp/), {
      target: { value: "user@mirai-const.co.jp" },
    });
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "badpw" } });

    await act(async () => { fireEvent.click(getByText(/Microsoft 365 でログイン/)); });

    await waitFor(() => expect(getByText(/M365 auth failed/)).toBeTruthy());
  });

  it("shows fallback error on M365 network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { getByText, getByPlaceholderText } = render(<LoginPage onLogin={onLogin} />);
    fireEvent.click(getByText(/Microsoft 365/));
    fireEvent.change(getByPlaceholderText(/mirai-const\.co\.jp/), {
      target: { value: "user@mirai-const.co.jp" },
    });
    const pwds = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwds[0], { target: { value: "pw" } });

    await act(async () => { fireEvent.click(getByText(/Microsoft 365 でログイン/)); });

    await waitFor(() => expect(getByText(/サーバーに接続できません/)).toBeTruthy());
  });

  // ── tab switch clears error ──────────────────────────────────────────────

  it("switching tab clears error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
    const { getByPlaceholderText, getByText, queryByText } = render(<LoginPage onLogin={onLogin} />);

    fireEvent.change(getByPlaceholderText("admin"), { target: { value: "a" } });
    fireEvent.change(getByPlaceholderText("••••••••"), { target: { value: "b" } });
    await act(async () => { fireEvent.click(getByText("ログイン")); });
    await waitFor(() => expect(getByText(/サーバーに接続できません/)).toBeTruthy());

    fireEvent.click(getByText(/Microsoft 365/));
    expect(queryByText(/サーバーに接続できません/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// safeStorage — localStorage access throws (lines 44-46 catch branch)
//
// safeStorage() does `typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'`
// inside a try/catch. A Proxy whose get trap always throws triggers the catch,
// returning null — which means all AuthStore methods that depend on safeStorage
// return null / do nothing, exercising the catch block.
// ---------------------------------------------------------------------------

describe("safeStorage — localStorage access throws (lines 44-46 catch branch)", () => {
  it("returns null when accessing localStorage throws a SecurityError", () => {
    const saved = (globalThis as unknown as Record<string, unknown>).localStorage;
    const throwingProxy = new Proxy({} as Storage, {
      get(_target, prop) {
        if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) return undefined;
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    (globalThis as unknown as Record<string, unknown>).localStorage = throwingProxy;
    try {
      // safeStorage() catches the throw and returns null → getToken() returns null
      expect(AuthStore.getToken()).toBeNull();
    } finally {
      (globalThis as unknown as Record<string, unknown>).localStorage = saved;
    }
  });
});
