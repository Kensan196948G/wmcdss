// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { waitFor } from "@testing-library/react";

// Dynamic imports under --coverage (V8 instrumentation) are significantly
// slower than normal runs. 30s timeout prevents false positives locally.
const DYNAMIC_IMPORT_TIMEOUT = 30_000;

// main.tsx mounts <AppShell /> into #root the moment it is imported, so each
// test that exercises a different branch must (1) reset the module graph,
// (2) re-mock dependencies, and (3) only THEN dynamic-import the module.

interface BackendStatus {
  ok: boolean;
  sites?: number;
  base?: string;
  reason?: string;
}

interface WindowWithBackendStatus extends Window {
  BACKEND_STATUS?: BackendStatus;
}

function setBackendStatus(status: BackendStatus | undefined): void {
  if (status === undefined) {
    delete (window as WindowWithBackendStatus).BACKEND_STATUS;
  } else {
    (window as WindowWithBackendStatus).BACKEND_STATUS = status;
  }
}

async function importMainAndFlush(): Promise<void> {
  await import("../main");
  // Wait one extra microtask + one macrotask so the
  // initFromBackend().finally(() => root.render(...)) chain commits.
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function freshRootDiv(): void {
  // Avoid innerHTML — security-lint flags string-based DOM construction even
  // for hard-coded test fixtures. createElement is equivalent and safe.
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
}

beforeEach(() => {
  freshRootDiv();
  vi.resetModules();
  setBackendStatus(undefined);
  vi.doMock("../api", () => ({
    WMCDSS_API: {
      initFromBackend: vi.fn().mockResolvedValue(true),
    },
  }));
  vi.doMock("../app-shell", () => ({
    AppShell: () => <div data-testid="appshell">app-shell-stub</div>,
  }));
  vi.doMock("../tweaks-panel", () => ({}));
  // 認証済みとしてスタブ化（main.test は認証ゲートの後 AppShell のレンダーをテストする）
  //
  // ../auth はモジュール全体を差し替える方式なので、main.tsx が import する
  // シンボルは *すべて* ここに用意する必要がある。tryDemoLogin を欠かすと
  // 未認証分岐のテストで「No "tryDemoLogin" export is defined」になる。
  vi.doMock("../auth", () => ({
    AuthStore: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getUser: vi
        .fn()
        .mockReturnValue({
          username: "test",
          displayName: "Test User",
          authType: "local",
        }),
      clear: vi.fn(),
      save: vi.fn(),
      getToken: vi.fn().mockReturnValue("mock-token"),
    },
    LoginPage: () => <div data-testid="login-page">login-page-stub</div>,
    // 認証済みなので demo-login は呼ばれないが、import 時点で解決できる必要がある。
    tryDemoLogin: vi.fn().mockResolvedValue(null),
  }));
});

afterEach(() => {
  vi.doUnmock("../api");
  vi.doUnmock("../app-shell");
  vi.doUnmock("../tweaks-panel");
  vi.doUnmock("../auth");
  vi.restoreAllMocks();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("main.tsx — bootstrap", () => {
  it(
    "mounts AppShell into #root after initFromBackend resolves",
    async () => {
      await importMainAndFlush();
      const root = document.getElementById("root");
      await waitFor(() => expect(root?.innerHTML).toContain("app-shell-stub"), {
        timeout: DYNAMIC_IMPORT_TIMEOUT,
      });
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "still mounts AppShell when initFromBackend rejects (caught)",
    async () => {
      vi.resetModules();
      vi.doMock("../api", () => ({
        WMCDSS_API: {
          initFromBackend: vi.fn().mockRejectedValue(new Error("boom")),
        },
      }));
      vi.doMock("../app-shell", () => ({
        AppShell: () => <div data-testid="appshell">app-shell-stub</div>,
      }));
      vi.doMock("../tweaks-panel", () => ({}));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await importMainAndFlush();
      const root = document.getElementById("root");
      await waitFor(() => expect(root?.innerHTML).toContain("app-shell-stub"), {
        timeout: DYNAMIC_IMPORT_TIMEOUT,
      });
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// main.tsx — Auth gate: LoginPage rendered when user is not authenticated
// Lines 77 (return null), 80-88 (LoginPage block) in main.tsx
// ---------------------------------------------------------------------------

describe("main.tsx — Auth gate (unauthenticated path)", () => {
  it(
    "renders LoginPage when AuthStore.isAuthenticated returns false",
    async () => {
      // Override the beforeEach mock to return false for this test only
      vi.resetModules();
      vi.doMock("../api", () => ({
        WMCDSS_API: {
          initFromBackend: vi.fn().mockResolvedValue(true),
        },
      }));
      vi.doMock("../app-shell", () => ({
        AppShell: () => <div data-testid="appshell">app-shell-stub</div>,
      }));
      vi.doMock("../tweaks-panel", () => ({}));
      vi.doMock("../auth", () => ({
        AuthStore: {
          isAuthenticated: vi.fn().mockReturnValue(false),
          getUser: vi.fn().mockReturnValue(null),
          clear: vi.fn(),
          save: vi.fn(),
          getToken: vi.fn().mockReturnValue(null),
        },
        LoginPage: () => <div data-testid="login-page">login-page-stub</div>,
        // 未認証 → main.tsx は demo-login を試す。null = バイパス無効（404）。
        tryDemoLogin: vi.fn().mockResolvedValue(null),
      }));

      await importMainAndFlush();
      await waitFor(
        () => expect(document.body.textContent).toContain("login-page-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      expect(document.body.textContent).not.toContain("app-shell-stub");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------
// main.tsx — MVP demo auto-login (bd9628d / task-5)
//
// サーバーが WMCDSS_AUTH_BYPASS=true のときだけ POST /auth/demo-login が JWT を
// 返す。無効な環境では 404 になり tryDemoLogin は null を返すため、従来どおり
// ログイン画面が表示される。加えて、判定が終わるまでは何も描画しない
// （=ログイン画面が一瞬出るちらつきを防ぐ）ことを固定する。
// ---------------------------------------------------------------------------

describe("main.tsx — MVP demo auto-login", () => {
  type DemoUser = { username: string; displayName: string; authType: "local" };

  const DEMO_USER: DemoUser = {
    username: "demo",
    displayName: "Demo User",
    authType: "local",
  };

  /** demo-login の応答を手動で制御する deferred（判定中の状態を再現する）。 */
  function deferredDemoLogin(): {
    promise: Promise<DemoUser | null>;
    resolve: (user: DemoUser | null) => void;
  } {
    let resolve!: (user: DemoUser | null) => void;
    const promise = new Promise<DemoUser | null>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  /** 判定中に何も描画されていないことを確認する。 */
  function expectNothingRendered(): void {
    const root = document.getElementById("root");
    expect(root?.innerHTML).toBe("");
    expect(document.body.textContent).not.toContain("login-page-stub");
    expect(document.body.textContent).not.toContain("app-shell-stub");
  }

  /**
   * beforeEach と同じ 4 モジュールを、demo-login の結果だけ差し替えて再適用する。
   * 呼び出し前に vi.resetModules() が済んでいる必要がある。
   */
  function mockMainDependencies(options: {
    isAuthenticated: boolean;
    tryDemoLogin: ReturnType<typeof vi.fn>;
  }): void {
    vi.doMock("../api", () => ({
      WMCDSS_API: {
        initFromBackend: vi.fn().mockResolvedValue(true),
      },
    }));
    vi.doMock("../app-shell", () => ({
      AppShell: () => <div data-testid="appshell">app-shell-stub</div>,
    }));
    vi.doMock("../tweaks-panel", () => ({}));
    vi.doMock("../auth", () => ({
      AuthStore: {
        isAuthenticated: vi.fn().mockReturnValue(options.isAuthenticated),
        getUser: vi
          .fn()
          .mockReturnValue(
            options.isAuthenticated
              ? { username: "test", displayName: "Test User", authType: "local" }
              : null,
          ),
        clear: vi.fn(),
        save: vi.fn(),
        getToken: vi.fn().mockReturnValue(options.isAuthenticated ? "mock-token" : null),
      },
      LoginPage: () => <div data-testid="login-page">login-page-stub</div>,
      tryDemoLogin: options.tryDemoLogin,
    }));
  }

  it(
    "renders LoginPage when demo-login returns null (bypass disabled → 404)",
    async () => {
      vi.resetModules();
      const tryDemoLogin = vi.fn().mockResolvedValue(null);
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(
        () => expect(document.body.textContent).toContain("login-page-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      // バイパス無効のときも判定自体は行い、そのうえでログイン画面へフォールバックする
      expect(tryDemoLogin).toHaveBeenCalled();
      // バイパス無効のときは AppShell を出さない
      expect(document.body.textContent).not.toContain("app-shell-stub");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders AppShell without LoginPage when demo-login returns an AuthUser (bypass enabled)",
    async () => {
      vi.resetModules();
      const tryDemoLogin = vi.fn().mockResolvedValue({
        username: "demo",
        displayName: "Demo User",
        authType: "local",
      });
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(
        () => expect(document.body.textContent).toContain("app-shell-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      expect(tryDemoLogin).toHaveBeenCalled();
      // demo ユーザーで自動ログインした以上、ログイン画面は描画されない
      expect(document.body.textContent).not.toContain("login-page-stub");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "does not attempt demo-login when a valid session already exists",
    async () => {
      vi.resetModules();
      const tryDemoLogin = vi.fn().mockResolvedValue(null);
      mockMainDependencies({ isAuthenticated: true, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(
        () => expect(document.body.textContent).toContain("app-shell-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      // 既存セッションがあるなら余計な POST /auth/demo-login を投げない
      expect(tryDemoLogin).not.toHaveBeenCalled();
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  // ── ちらつき防止（task-5）────────────────────────────────────────────────
  // 判定が終わるまでは null を render する。以前は「判定の開始」でフラグが
  // 立っていたため、判定中に LoginPage が一瞬描画されていた。

  it(
    "renders nothing while demo-login is pending, then LoginPage when it resolves to null",
    async () => {
      vi.resetModules();
      const demo = deferredDemoLogin();
      const tryDemoLogin = vi.fn().mockReturnValue(demo.promise);
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(() => expect(tryDemoLogin).toHaveBeenCalled(), {
        timeout: DYNAMIC_IMPORT_TIMEOUT,
      });

      // 判定中。少し待っても LoginPage / AppShell のどちらも描画しない。
      await new Promise((resolve) => setTimeout(resolve, 50));
      expectNothingRendered();

      // 404（null）で判定完了 → 従来どおりログイン画面へ遷移する
      demo.resolve(null);
      await waitFor(
        () => expect(document.body.textContent).toContain("login-page-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      expect(document.body.textContent).not.toContain("app-shell-stub");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders nothing while demo-login is pending, then AppShell when it resolves to an AuthUser",
    async () => {
      vi.resetModules();
      const demo = deferredDemoLogin();
      const tryDemoLogin = vi.fn().mockReturnValue(demo.promise);
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(() => expect(tryDemoLogin).toHaveBeenCalled(), {
        timeout: DYNAMIC_IMPORT_TIMEOUT,
      });

      // 判定中はログイン画面を出さない（これがちらつきの正体）
      await new Promise((resolve) => setTimeout(resolve, 50));
      expectNothingRendered();

      // バイパス有効（AuthUser）で判定完了 → ログイン画面を挟まず AppShell へ
      demo.resolve(DEMO_USER);
      await waitFor(
        () => expect(document.body.textContent).toContain("app-shell-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      expect(document.body.textContent).not.toContain("login-page-stub");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "does not repeat demo-login once the judgement is done (no loop / no extra POST)",
    async () => {
      vi.resetModules();
      const tryDemoLogin = vi.fn().mockResolvedValue(null);
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });

      await importMainAndFlush();
      await waitFor(
        () => expect(document.body.textContent).toContain("login-page-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      const callsAfterDone = tryDemoLogin.mock.calls.length;
      expect(callsAfterDone).toBeGreaterThan(0);
      // production build は 1 回、開発/テストは React StrictMode の effect 二重実行で
      // 2 回。それ以上は「判定完了後も effect が再実行されている」= 多重 POST の回帰。
      expect(callsAfterDone).toBeLessThanOrEqual(2);
      // 'done' に落ちた後は再レンダリングされても POST が増えない（無限ループ防止）
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(tryDemoLogin.mock.calls.length).toBe(callsAfterDone);
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders LoginPage when demo-login rejects (does not stay blank)",
    async () => {
      vi.resetModules();
      const tryDemoLogin = vi.fn().mockRejectedValue(new Error("demo-login boom"));
      mockMainDependencies({ isAuthenticated: false, tryDemoLogin });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await importMainAndFlush();
      // reject しても判定は 'done' になり、空白のまま固まらず LoginPage へ落ちる
      await waitFor(
        () => expect(document.body.textContent).toContain("login-page-stub"),
        { timeout: DYNAMIC_IMPORT_TIMEOUT },
      );
      expect(document.body.textContent).not.toContain("app-shell-stub");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );
});

describe("main.tsx — BackendStatusStrip branches", () => {
  it(
    "renders nothing for the strip when BACKEND_STATUS is undefined",
    async () => {
      await importMainAndFlush();
      expect(document.body.textContent).not.toContain("Backend 接続中");
      expect(document.body.textContent).not.toContain("バックエンド未接続");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders the success strip when BACKEND_STATUS.ok=true",
    async () => {
      setBackendStatus({
        ok: true,
        sites: 9,
        base: "http://localhost:8003/api/v1",
      });
      await importMainAndFlush();
      expect(document.body.textContent).toContain("Backend 接続中");
      expect(document.body.textContent).toContain("9 現場");
      expect(document.body.textContent).toContain("localhost:8003");
      const role = document.querySelector('[role="status"]');
      expect(role).not.toBeNull();
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "falls back to 0 sites and omits the base hint when those fields are missing",
    async () => {
      setBackendStatus({ ok: true });
      await importMainAndFlush();
      expect(document.body.textContent).toContain("0 現場");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders the error strip with default reason 'pending' when BACKEND_STATUS.ok=false",
    async () => {
      setBackendStatus({ ok: false });
      await importMainAndFlush();
      expect(document.body.textContent).toContain("バックエンド未接続");
      expect(document.body.textContent).toContain("pending");
      const alert = document.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );

  it(
    "renders the error strip with a custom reason",
    async () => {
      setBackendStatus({ ok: false, reason: "timeout" });
      await importMainAndFlush();
      expect(document.body.textContent).toContain("timeout");
    },
    DYNAMIC_IMPORT_TIMEOUT,
  );
});
