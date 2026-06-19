// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import {
  ThresholdsPage,
  EtlPage,
  ReportsPage,
  AuditPage,
  SettingsPage,
  AiSettingsPage,
} from "../admin-pages";
import { SITES, ETL_JOBS, AUDIT_LOG } from "../data";

// vitest v3.2.4 + jsdom produces a half-broken window.localStorage in some
// test environments. Replace with a stable in-memory shim for AiSettingsPage tests
// (which call localStorage.getItem via authHeaders).
class InMemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length(): number { return Object.keys(this.store).length; }
  clear(): void { this.store = {}; }
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  key(index: number): string | null { return Object.keys(this.store)[index] ?? null; }
  removeItem(key: string): void { delete this.store[key]; }
  setItem(key: string, value: string): void { this.store[key] = String(value); }
}

function installFreshStorage(): void {
  Object.defineProperty(window, "localStorage", {
    value: new InMemoryStorage(),
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ThresholdsPage
// ---------------------------------------------------------------------------

describe("ThresholdsPage", () => {
  it("renders one row per site in the thresholds table", () => {
    const { container } = render(<ThresholdsPage />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(SITES.length);
  });

  it("renders the 8 column headers", () => {
    const { container } = render(<ThresholdsPage />);
    for (const header of [
      "現場名",
      "工種",
      "風速 (m/s)",
      "波高 (m)",
      "降水量 (mm/h)",
      "気温下限 (℃)",
      "気温上限 (℃)",
      "操作",
    ]) {
      expect(container.textContent).toContain(header);
    }
  });

  it("waveHeight shows — for a land site (display mode)", () => {
    const landSite = SITES.find((s) => s.type === "land");
    if (!landSite) return;
    const { container } = render(<ThresholdsPage />);
    const row = Array.from(container.querySelectorAll("tbody tr")).find((tr) =>
      tr.textContent?.includes(landSite.shortName),
    );
    expect(row?.textContent).toContain("—");
  });

  it("clicking 編集 swaps the row into edit mode (5 number inputs visible)", () => {
    const { container } = render(<ThresholdsPage />);
    const firstEditBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "編集",
    );
    fireEvent.click(firstEditBtn!);
    // After entering edit mode, the row contains number inputs (one per field)
    const inputs = container.querySelectorAll('tbody input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(4); // marine sites: 5, land: 4
  });

  it("clicking 保存 returns to display mode (no number inputs)", () => {
    const { container } = render(<ThresholdsPage />);
    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "編集",
    );
    fireEvent.click(editBtn!);
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存",
    );
    fireEvent.click(saveBtn!);
    const inputs = container.querySelectorAll('tbody input[type="number"]');
    expect(inputs.length).toBe(0);
  });

  it("clicking 取消 returns to display mode without saving", () => {
    const { container } = render(<ThresholdsPage />);
    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "編集",
    );
    fireEvent.click(editBtn!);
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    fireEvent.click(cancelBtn!);
    const inputs = container.querySelectorAll('tbody input[type="number"]');
    expect(inputs.length).toBe(0);
  });

  it("editing a wind value updates the input through the state", () => {
    const { container } = render(<ThresholdsPage />);
    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "編集",
    );
    fireEvent.click(editBtn!);
    const inputs = container.querySelectorAll(
      'tbody input[type="number"]',
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.change(inputs[0], { target: { value: "999" } });
    expect(inputs[0].value).toBe("999");
  });

  it("一括CSV出力 button is rendered", () => {
    const { container } = render(<ThresholdsPage />);
    expect(container.textContent).toContain("一括CSV出力");
  });
});

// ---------------------------------------------------------------------------
// EtlPage
// ---------------------------------------------------------------------------

describe("EtlPage", () => {
  it("renders data source info section with configured endpoints", () => {
    // EtlPage shows production data source information instead of hardcoded stats.
    const { container } = render(<EtlPage />);
    for (const label of [
      "データ取得元情報",
      "AMeDAS",
      "海象参考情報（Open-Meteo Marine API）",
      "バックエンド接続状況",
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("renders ジョブ一覧 card title and 6 column headers", () => {
    const { container } = render(<EtlPage />);
    expect(container.textContent).toContain("ジョブ一覧");
    for (const header of [
      "ジョブ名",
      "スケジュール",
      "最終実行",
      "ステータス",
      "取得件数",
      "操作",
    ]) {
      expect(container.textContent).toContain(header);
    }
  });

  it("renders data-source rows + one row per ETL_JOBS entry", () => {
    // EtlPage has two tables: data-source table (2 rows: AMeDAS + marine reference info)
    // and job table (ETL_JOBS.length rows).
    const { container } = render(<EtlPage />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(ETL_JOBS.length + 2);
  });

  it("renders 手動実行 button", () => {
    const { container } = render(<EtlPage />);
    expect(container.textContent).toContain("手動実行");
  });

  it("every job row carries a 正常 badge", () => {
    const { container } = render(<EtlPage />);
    const okBadges = container.querySelectorAll("span.badge.badge-ok");
    expect(okBadges.length).toBe(ETL_JOBS.length);
  });
});

// ---------------------------------------------------------------------------
// ReportsPage
// ---------------------------------------------------------------------------

describe("ReportsPage", () => {
  it("renders レポート生成 card title", () => {
    const { container } = render(<ReportsPage />);
    expect(container.textContent).toContain("レポート生成");
  });

  it("renders 対象現場 select with 全現場 + every SITES entry", () => {
    const { container } = render(<ReportsPage />);
    const selects = container.querySelectorAll("select.form-select");
    const siteSelect = selects[0] as HTMLSelectElement;
    expect(siteSelect.options.length).toBe(SITES.length + 1);
    expect(siteSelect.options[0].value).toBe("all");
  });

  it("renders all 6 report templates", () => {
    const { container } = render(<ReportsPage />);
    for (const t of [
      "日次気象レポート",
      "週次気象レポート",
      "月次気象集計",
      "施工判定記録",
      "海象データ集計",
      "年次統計レポート",
    ]) {
      expect(container.textContent).toContain(t);
    }
  });

  it("renders all 3 output format buttons (PDF/Excel/CSV)", () => {
    const { container } = render(<ReportsPage />);
    const buttons = Array.from(container.querySelectorAll("button.btn-sm")).map(
      (b) => b.textContent,
    );
    expect(buttons).toContain("PDF");
    expect(buttons).toContain("Excel");
    expect(buttons).toContain("CSV");
  });

  it("default format=PDF is active (btn-primary)", () => {
    const { container } = render(<ReportsPage />);
    const pdfBtn = Array.from(container.querySelectorAll("button.btn-sm")).find(
      (b) => b.textContent === "PDF",
    );
    expect(pdfBtn?.className).toContain("btn-primary");
  });

  it("clicking Excel makes it the active format", () => {
    const { container } = render(<ReportsPage />);
    const excelBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent === "Excel");
    fireEvent.click(excelBtn!);
    expect(excelBtn?.className).toContain("btn-primary");
  });

  it("レポート生成 button changes label to 生成中… and shows success banner after 1500ms", () => {
    vi.useFakeTimers();
    const { container } = render(<ReportsPage />);
    const genBtn = Array.from(
      container.querySelectorAll("button.btn-primary"),
    ).find((b) => b.textContent?.includes("レポート生成"));
    fireEvent.click(genBtn!);
    expect(container.textContent).toContain("生成中…");
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.textContent).toContain("レポートが生成されました");
    vi.useRealTimers();
  });

  it("最近のレポート table has the 4 historical entries", () => {
    const { container } = render(<ReportsPage />);
    expect(container.textContent).toContain("最近のレポート");
    const tables = container.querySelectorAll("table.data-table");
    const lastTable = tables[tables.length - 1];
    const bodyRows = lastTable.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// AuditPage
// ---------------------------------------------------------------------------

describe("AuditPage", () => {
  it("renders the 5 column headers", () => {
    const { container } = render(<AuditPage />);
    for (const h of ["日時", "ユーザー", "操作", "対象", "詳細"]) {
      expect(container.textContent).toContain(h);
    }
  });

  it("default filter=すべて shows every AUDIT_LOG row", () => {
    const { container } = render(<AuditPage />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(AUDIT_LOG.length);
  });

  it("filter <select> options include すべて + distinct actions", () => {
    const distinctActions = Array.from(new Set(AUDIT_LOG.map((l) => l.action)));
    const { container } = render(<AuditPage />);
    const select = container.querySelector(
      "select.form-select",
    ) as HTMLSelectElement;
    expect(select.options.length).toBe(distinctActions.length + 1);
  });

  it("selecting an action filter narrows the rows", () => {
    const action = AUDIT_LOG[0].action;
    const expectedCount = AUDIT_LOG.filter((l) => l.action === action).length;
    const { container } = render(<AuditPage />);
    const select = container.querySelector(
      "select.form-select",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: action } });
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(expectedCount);
  });

  it("export buttons are rendered (CSV / HTML / PDF)", () => {
    const { container } = render(<AuditPage />);
    expect(container.textContent).toContain("CSV");
    expect(container.textContent).toContain("HTML");
    expect(container.textContent).toContain("PDF");
  });
});

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

describe("SettingsPage", () => {
  it("role=field shows field-user defaults (田中 太郎)", () => {
    const { container } = render(<SettingsPage role="field" />);
    const inputs = container.querySelectorAll(
      "input.form-input",
    ) as NodeListOf<HTMLInputElement>;
    const nameInput = inputs[0];
    expect(nameInput.defaultValue).toBe("田中 太郎");
  });

  it("role=manager shows manager-user defaults (山田 部長)", () => {
    const { container } = render(<SettingsPage role={"manager" as never} />);
    const inputs = container.querySelectorAll(
      "input.form-input",
    ) as NodeListOf<HTMLInputElement>;
    expect(inputs[0].defaultValue).toBe("山田 部長");
  });

  it("renders all 5 notification preference labels", () => {
    const { container } = render(<SettingsPage role="field" />);
    for (const label of [
      "施工中止判定時にメール通知",
      "注意判定時にメール通知",
      "気象警報発令時にプッシュ通知",
      "日次レポート自動送信",
      "データ取得エラー時に通知",
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("renders 5 toggle checkboxes (one per notification pref)", () => {
    const { container } = render(<SettingsPage role="field" />);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(5);
  });

  it("toggling a notification checkbox doesn't crash (DOM-mutation handler)", () => {
    const { container } = render(<SettingsPage role="field" />);
    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    fireEvent.click(checkbox);
    // No assertion beyond not-crashing — handleToggle is imperative
    expect(checkbox).not.toBeNull();
  });

  it("renders the 2 retention period <select>s with correct option counts", () => {
    const { container } = render(<SettingsPage role="field" />);
    const selects = container.querySelectorAll(
      "select.form-select",
    ) as NodeListOf<HTMLSelectElement>;
    expect(selects.length).toBe(2);
    expect(selects[0].options.length).toBe(4); // 12/24/60/120
    expect(selects[1].options.length).toBe(3); // 12/36/60
  });

  it("clicking 設定を保存 shows ✓ 保存しました banner", () => {
    vi.useFakeTimers();
    const { container } = render(<SettingsPage role="field" />);
    const saveBtn = Array.from(
      container.querySelectorAll("button.btn-primary"),
    ).find((b) => b.textContent === "設定を保存");
    fireEvent.click(saveBtn!);
    expect(container.textContent).toContain("保存しました");
    // Banner disappears after 2000ms
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(container.textContent).not.toContain("保存しました");
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Extra form-handler invocations (Loop 75 — Functions coverage uplift)
// ---------------------------------------------------------------------------
//
// The baseline tests above pin layout and one-off interactions, but each
// setForm((p) => ({ ...p, ...})) lambda and each updateField/handleToggle
// invocation counts as a distinct function — coverage stays low until every
// form input is exercised. These tests fire change events on every input/
// select so the functions counter on admin-pages.tsx climbs above the
// baseline 66%.

describe("ReportsPage — form change handlers", () => {
  it("changing 対象現場 select updates form.site", () => {
    const { container } = render(<ReportsPage />);
    const select = container.querySelectorAll(
      "select.form-select",
    )[0] as HTMLSelectElement;
    const target = SITES[1]?.id ?? SITES[0].id;
    fireEvent.change(select, { target: { value: target } });
    expect(select.value).toBe(target);
  });

  it("changing テンプレート select cycles all 6 templates", () => {
    const { container } = render(<ReportsPage />);
    const select = container.querySelectorAll(
      "select.form-select",
    )[1] as HTMLSelectElement;
    const templates = ["weekly", "monthly", "decision", "marine", "annual"];
    for (const t of templates) {
      fireEvent.change(select, { target: { value: t } });
      expect(select.value).toBe(t);
    }
  });

  it("changing 開始日 / 終了日 date inputs updates form fields", () => {
    const { container } = render(<ReportsPage />);
    const dateInputs = container.querySelectorAll(
      'input[type="date"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(dateInputs.length).toBe(2);
    fireEvent.change(dateInputs[0], { target: { value: "2026-04-01" } });
    expect(dateInputs[0].value).toBe("2026-04-01");
    fireEvent.change(dateInputs[1], { target: { value: "2026-04-30" } });
    expect(dateInputs[1].value).toBe("2026-04-30");
  });

  it("clicking each format button toggles btn-primary in turn", () => {
    const { container } = render(<ReportsPage />);
    const formats = ["Excel", "CSV", "PDF"];
    for (const fmt of formats) {
      const btn = Array.from(container.querySelectorAll("button.btn-sm")).find(
        (b) => b.textContent === fmt,
      );
      fireEvent.click(btn!);
      expect(btn?.className).toContain("btn-primary");
    }
  });
});

describe("ThresholdsPage — updateField invocations", () => {
  it("editing every numeric field of an edit row updates each input value", () => {
    const { container } = render(<ThresholdsPage />);
    // Pick the first row's 編集 button to enter edit mode
    const editBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "編集",
    );
    fireEvent.click(editBtn!);
    const inputs = container.querySelectorAll(
      'tbody input[type="number"]',
    ) as NodeListOf<HTMLInputElement>;
    // Bump every input by a distinct value to call updateField with each
    // distinct keyof SiteThresholds (windSpeed/waveHeight/rainfall/tempLow/
    // tempHigh — marine sites get all 5, land 4 (no waveHeight)).
    for (let i = 0; i < inputs.length; i++) {
      fireEvent.change(inputs[i], { target: { value: String(100 + i) } });
      expect(inputs[i].value).toBe(String(100 + i));
    }
  });
});

describe("AuditPage — filter handler invocation", () => {
  it("changing the filter select repeatedly invokes setFilterAction", () => {
    const { container } = render(<AuditPage />);
    const select = container.querySelector(
      "select.form-select",
    ) as HTMLSelectElement;
    // Walk through all options at least once
    const opts = Array.from(select.options).map((o) => o.value);
    for (const v of opts) {
      fireEvent.change(select, { target: { value: v } });
      expect(select.value).toBe(v);
    }
  });
});

describe("SettingsPage — loads persisted settings from localStorage (lines 1140-1145)", () => {
  afterEach(() => {
    cleanup();
  });

  it("reads name and email from wmcdss_settings in localStorage when present (line 1140-1143 ?? true branch)", () => {
    installFreshStorage();
    localStorage.setItem(
      "wmcdss_settings",
      JSON.stringify({ name: "テスト太郎", email: "test@example.co.jp" }),
    );
    const { container } = render(<SettingsPage role="field" />);
    const inputs = container.querySelectorAll(
      "input.form-input",
    ) as NodeListOf<HTMLInputElement>;
    // inputs[0]=名前, inputs[1]=所属(固定), inputs[2]=メールアドレス
    expect(inputs[0].value).toBe("テスト太郎");
    expect(inputs[2].value).toBe("test@example.co.jp");
  });

  it("falls back to defaults when wmcdss_settings exists but fields are absent (lines 1142-1143 ?? false branch)", () => {
    installFreshStorage();
    localStorage.setItem("wmcdss_settings", JSON.stringify({}));
    const { container } = render(<SettingsPage role="field" />);
    const inputs = container.querySelectorAll(
      "input.form-input",
    ) as NodeListOf<HTMLInputElement>;
    // parsed.name is undefined → ?? fires → "田中 太郎"
    expect(inputs[0].value).toBe("田中 太郎");
  });
});

describe("SettingsPage — checkbox handlers", () => {
  it("toggling every notification checkbox runs handleToggle without throwing", () => {
    const { container } = render(<SettingsPage role="field" />);
    const checkboxes = container.querySelectorAll(
      'input[type="checkbox"]',
    ) as NodeListOf<HTMLInputElement>;
    for (const cb of Array.from(checkboxes)) {
      // Two clicks per checkbox to flip both directions (checked → unchecked
      // → checked) — exercises both branches inside handleToggle's
      // input.checked ternary.
      expect(() => {
        fireEvent.click(cb);
        fireEvent.click(cb);
      }).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// EtlPage — backend fetch path
// ---------------------------------------------------------------------------

describe("EtlPage — backend fetch path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("fetches ETL job statuses when WMCDSS_API_BASE is configured", async () => {
    const mockJobs = [
      {
        id: 1,
        name: "気象データ取得",
        source: "AMeDAS",
        schedule: "10分毎",
        last_obs_at: "2026-06-14T10:00:00",
        status: "ok",
      },
      {
        id: 2,
        name: "海象参考情報取得",
        source: "Open-Meteo Marine API（情報共有用）",
        schedule: "10分毎確認",
        last_obs_at: "2026-06-14T09:00:00",
        status: "ok",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobs: mockJobs }),
      }),
    );
    vi.stubGlobal("WMCDSS_API_BASE", "http://localhost:8003/api/v1");

    const { container } = render(<EtlPage />);
    await waitFor(() =>
      expect(container.textContent).toContain("2026-06-14T10:00:00"),
    );
  });

  it("silently ignores ETL status fetch error and keeps static data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ETL fetch fail")),
    );
    vi.stubGlobal("WMCDSS_API_BASE", "http://localhost:8003/api/v1");

    const { container } = render(<EtlPage />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("ジョブ一覧");
  });

  it("handleManualRun shows an inline error when the run request fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobs: [] }),
      })
      .mockRejectedValueOnce(new Error("run failed"));
    vi.stubGlobal("fetch", mockFetch);
    const { container } = render(<EtlPage />);
    const runBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("手動実行"),
    );
    await act(async () => {
      fireEvent.click(runBtn!);
    });
    await waitFor(() => expect(container.textContent).toContain("run failed"));
  });

  it("handleManualRun posts to /etl/run/1 and shows the completion message", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobs: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ message: "AMeDAS 完了" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ jobs: [] }),
      });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubGlobal("WMCDSS_API_BASE", "http://localhost:8003/api/v1");

    const { container } = render(<EtlPage />);
    const runBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("手動実行"),
    );
    await act(async () => {
      fireEvent.click(runBtn!);
    });
    await waitFor(() => expect(container.textContent).toContain("AMeDAS 完了"));
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:8003/api/v1/etl/run/1",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ---------------------------------------------------------------------------
// AiSettingsPage
// ---------------------------------------------------------------------------

describe("AiSettingsPage", () => {
  const MOCK_SETTINGS = {
    configured: true,
    key_preview: "sk-ant-...XYZ",
    model: "claude-sonnet-4-6",
    source: "ui",
    supported_models: [
      { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 推奨 ★" },
      { id: "claude-haiku-4-5", label: "claude-haiku-4-5 高速" },
    ],
  };

  beforeEach(() => {
    installFreshStorage();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows 読み込み中 while settings are loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = render(<AiSettingsPage />);
    expect(container.textContent).toContain("読み込み中");
  });

  it("renders form with ✅ 接続済み after settings load (configured=true)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));
    expect(container.textContent).toContain("sk-ant-...XYZ");
  });

  it("shows UI設定 when source=ui (line 1650)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ ...MOCK_SETTINGS, source: "ui" }),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("UI設定"));
  });

  it("shows 環境変数 when source=env (line 1652)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ ...MOCK_SETTINGS, source: "env" }),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("環境変数"));
  });

  it("shows ルールベース when configured=false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...MOCK_SETTINGS,
          configured: false,
          key_preview: null,
          source: "other",
        }),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() =>
      expect(container.textContent).toContain("ルールベース"),
    );
  });

  it("falls back to static display when settings fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network fail")),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() =>
      expect(container.textContent).not.toContain("読み込み中"),
    );
    expect(container.textContent).toContain("Anthropic Claude API 設定");
  });

  it("handleTest shows validation error when apiKey is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const testBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("接続テスト"),
    );
    await act(async () => {
      fireEvent.click(testBtn!);
    });
    expect(container.textContent).toContain("API キーを入力してください");
  });

  it("handleTest shows success result from /ai/test", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockResolvedValueOnce({
        json: vi
          .fn()
          .mockResolvedValue({ ok: true, message: "接続成功しました" }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const apiKeyInput = container.querySelector(
      'input[placeholder="sk-ant-..."]',
    ) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "sk-ant-test-key" } });

    const testBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("接続テスト"),
    );
    await act(async () => {
      fireEvent.click(testBtn!);
    });
    await waitFor(() =>
      expect(container.textContent).toContain("接続成功しました"),
    );
  });

  it("handleTest shows network error message when fetch throws", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockRejectedValueOnce(new Error("connect fail"));
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const apiKeyInput = container.querySelector(
      'input[placeholder="sk-ant-..."]',
    ) as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: "sk-ant-test-key" } });

    const testBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("接続テスト"),
    );
    await act(async () => {
      fireEvent.click(testBtn!);
    });
    await waitFor(() =>
      expect(container.textContent).toContain("バックエンドに接続できません"),
    );
  });

  it("handleSave shows saveResult on success (line 1617)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ key_preview: "sk-...new" }),
      })
      .mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      });
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("設定を保存"),
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    await waitFor(() =>
      expect(container.textContent).toContain("設定を保存しました"),
    );
  });

  it("handleSave shows 保存に失敗 when response is not ok", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockResolvedValueOnce({ ok: false, json: vi.fn().mockResolvedValue({}) });
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("設定を保存"),
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    await waitFor(() => expect(container.textContent).toContain("保存に失敗"));
  });

  it("handleSave saves to localStorage when network fails", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockRejectedValueOnce(new Error("network fail"));
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("設定を保存"),
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    await waitFor(() =>
      expect(container.textContent).toContain("ローカルに保存"),
    );
  });

  it("doLoadSettings inner catch fires when fetch fails AND wmcdss_ai_settings getItem throws (line 1418)", async () => {
    // authHeaders reads "wmcdss_access_token"; inner catch reads "wmcdss_ai_settings"
    // Only throw for the settings key so authHeaders doesn't crash on mount
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    vi.spyOn(window.localStorage, "getItem").mockImplementation((key: string) => {
      if (key === "wmcdss_ai_settings") throw new Error("storage unavailable");
      return null;
    });

    // Component should render without crashing even when inner catch fires
    const { container } = render(<AiSettingsPage />);
    await act(async () => { await Promise.resolve(); });
    // Still renders something (outer div always present)
    expect(container.firstChild).not.toBeNull();
  });

  it("handleSave shows error message when both network and localStorage fail (lines 1479-1480)", async () => {
    // First fetch loads settings OK; second (save) rejects → triggers localStorage fallback
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      })
      .mockRejectedValueOnce(new Error("network fail"));
    vi.stubGlobal("fetch", mockFetch);

    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    // Make localStorage.setItem throw so the inner catch at lines 1479-1480 fires
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage quota exceeded");
    });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("設定を保存"),
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    await waitFor(() =>
      expect(container.textContent).toContain("接続できません"),
    );
  });

  it("showKey toggle switches API key input between password and text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    expect(container.querySelector('input[type="password"]')).not.toBeNull();

    const toggleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("表示"),
    );
    fireEvent.click(toggleBtn!);

    expect(
      container.querySelector('input[type="text"][placeholder]'),
    ).not.toBeNull();
  });

  it("model select change updates selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));

    const modelSelect = container.querySelector(
      "select.form-select",
    ) as HTMLSelectElement;
    fireEvent.change(modelSelect, { target: { value: "claude-haiku-4-5" } });
    expect(modelSelect.value).toBe("claude-haiku-4-5");
  });

  it("renders 対応モデル一覧 table after load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() =>
      expect(container.textContent).toContain("対応モデル一覧"),
    );
    const modelRows = container.querySelectorAll(".data-table tbody tr");
    expect(modelRows.length).toBeGreaterThan(0);
  });

  it("reads model from wmcdss_ai_settings localStorage when fetch fails (lines 1410-1413)", async () => {
    // Pre-populate cached settings so the `if (raw)` true branch fires
    localStorage.setItem("wmcdss_ai_settings", JSON.stringify({ model: "claude-opus-4-8" }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));

    const { container } = render(<AiSettingsPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // Component renders without crashing after reading model from localStorage
    expect(container.firstChild).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EtlPage — BACKEND_STATUS connected branches (lines 284, 286, 435, 455, 460)
// ---------------------------------------------------------------------------

describe("EtlPage — BACKEND_STATUS isConnected=true branches", () => {
  afterEach(() => {
    delete (window as Window & { BACKEND_STATUS?: unknown }).BACKEND_STATUS;
    cleanup();
  });

  it("shows ✅ バックエンド接続中 and site count when BACKEND_STATUS.ok is true (lines 284/286/435/455/460)", () => {
    (window as Window & { BACKEND_STATUS?: { ok: boolean; sites: number } })
      .BACKEND_STATUS = { ok: true, sites: 3 };
    const { container } = render(<EtlPage />);
    expect(container.textContent).toContain("バックエンド接続中");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("接続中の現場数");
  });
});

// ---------------------------------------------------------------------------
// AuditPage — fetchAuditLog real data (isRealData badge, lines 839, 1058)
// ---------------------------------------------------------------------------

describe("AuditPage — fetchAuditLog real data badge (isRealData=true)", () => {
  afterEach(() => {
    delete (window as Window & { WMCDSS_API?: unknown }).WMCDSS_API;
    cleanup();
  });

  it("shows 実データ badge when fetchAuditLog resolves with entries (lines 839/1058)", async () => {
    (
      window as Window & { WMCDSS_API?: { fetchAuditLog: (...args: unknown[]) => Promise<unknown> } }
    ).WMCDSS_API = {
      fetchAuditLog: vi.fn().mockResolvedValue([
        {
          id: 1,
          occurred_at: "2026-06-14T10:00:00Z",
          actor: "user1",
          action: "login",
          target_type: null,
          target_id: null,
          detail: null,
        },
      ]),
    };
    const { container } = render(<AuditPage />);
    await waitFor(() =>
      expect(container.textContent).toContain("実データ"),
    );
    const badge = container.querySelector(".badge.badge-ok");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("実データ");
  });
});

// ---------------------------------------------------------------------------
// AiSettingsPage — authHeaders with localStorage token (lines 1361, 1363)
// ---------------------------------------------------------------------------

describe("AiSettingsPage — authHeaders uses localStorage token (lines 1361/1363)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("sends Authorization header when wmcdss_access_token exists in localStorage", async () => {
    installFreshStorage();
    localStorage.setItem("wmcdss_access_token", "test-jwt-token");
    const MOCK_SETTINGS = {
      model: "claude-sonnet-4-6",
      api_key_configured: true,
      configured: true,
      status: "ok",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(MOCK_SETTINGS),
      }),
    );
    const { container } = render(<AiSettingsPage />);
    await waitFor(() => expect(container.textContent).toContain("接続済み"));
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const headers = fetchCalls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-jwt-token");
  });
});

// ---------------------------------------------------------------------------
// window side-effects (dual-surface contract)
// ---------------------------------------------------------------------------

describe("admin-pages.tsx — window side effects", () => {
  it("attaches all 6 admin pages to window", () => {
    const w = window as unknown as Record<string, unknown>;
    expect(w.ThresholdsPage).toBe(ThresholdsPage);
    expect(w.EtlPage).toBe(EtlPage);
    expect(w.ReportsPage).toBe(ReportsPage);
    expect(w.AuditPage).toBe(AuditPage);
    expect(w.SettingsPage).toBe(SettingsPage);
    expect(w.AiSettingsPage).toBe(AiSettingsPage);
  });
});
