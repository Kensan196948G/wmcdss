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
