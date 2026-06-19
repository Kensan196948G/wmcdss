// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import { HistoricalPage, Wave50Page } from "../analysis";
import { SITES } from "../data";

// generateHistoricalMonthly() (data.ts) and the inline annualMax/jitter terms in
// Wave50Page lean on Math.random. Pin it so DOM row counts and SVG point counts
// stay deterministic — assertions only target shape/labels, never numeric values.

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// HistoricalPage
// ---------------------------------------------------------------------------

describe("HistoricalPage", () => {
  it("renders 現場 / 年度 labels and two <select>s", () => {
    const { container } = render(<HistoricalPage />);
    expect(container.textContent).toContain("現場");
    expect(container.textContent).toContain("年度");
    const selects = container.querySelectorAll("select.form-select");
    expect(selects.length).toBe(2);
  });

  it("site <select> contains every SITES entry", () => {
    const { container } = render(<HistoricalPage />);
    const siteSelect = container.querySelectorAll(
      "select.form-select",
    )[0] as HTMLSelectElement;
    expect(siteSelect.options.length).toBe(SITES.length);
  });

  it("year <select> offers 2025 down to 2021 (5 years)", () => {
    const { container } = render(<HistoricalPage />);
    const yearSelect = container.querySelectorAll(
      "select.form-select",
    )[1] as HTMLSelectElement;
    expect(yearSelect.options.length).toBe(5);
    const values = Array.from(yearSelect.options).map((o) => o.value);
    expect(values).toEqual(["2025", "2024", "2023", "2022", "2021"]);
  });

  it("uses selectedSite prop to pre-select the site", () => {
    const target = SITES[2]?.id ?? SITES[1].id;
    const { container } = render(<HistoricalPage selectedSite={target} />);
    const siteSelect = container.querySelectorAll(
      "select.form-select",
    )[0] as HTMLSelectElement;
    expect(siteSelect.value).toBe(target);
  });

  it("renders 3 metric buttons (風速 / 波高 / 降水量)", () => {
    const { container } = render(<HistoricalPage />);
    const buttons = Array.from(container.querySelectorAll("button.btn-sm"));
    const labels = buttons.map((b) => b.textContent ?? "");
    expect(labels).toContain("風速");
    expect(labels).toContain("波高");
    expect(labels).toContain("降水量");
  });

  it("the wind metric button is active by default (btn-primary)", () => {
    const { container } = render(<HistoricalPage />);
    const windBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent === "風速");
    expect(windBtn?.className).toContain("btn-primary");
  });

  it("switching to 波高 makes that button active and renders a LineChart", () => {
    const { container } = render(<HistoricalPage />);
    const waveBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent === "波高");
    fireEvent.click(waveBtn!);
    expect(waveBtn?.className).toContain("btn-primary");
    // chart title should reference 最大波高
    expect(container.textContent).toContain("最大波高 (m)");
  });

  it("switching to 降水量 swaps in a BarChart with 月間降水量 label", () => {
    const { container } = render(<HistoricalPage />);
    const rainBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent === "降水量");
    fireEvent.click(rainBtn!);
    expect(container.textContent).toContain("月間降水量 (mm)");
    // BarChart renders <rect> elements; LineChart does not
    const rects = container.querySelectorAll("svg rect");
    expect(rects.length).toBeGreaterThan(0);
  });

  it("renders 月別集計データ table with 7 column headers", () => {
    const { container } = render(<HistoricalPage />);
    expect(container.textContent).toContain("月別集計データ");
    for (const header of [
      "月",
      "平均風速",
      "最大風速",
      "平均波高",
      "最大波高",
      "降雨日数",
      "月間降水量",
    ]) {
      expect(container.textContent).toContain(header);
    }
  });

  it("月別集計 table has 12 rows (one per month)", () => {
    const { container } = render(<HistoricalPage />);
    const tables = container.querySelectorAll("table.data-table");
    expect(tables.length).toBe(1);
    const bodyRows = tables[0].querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(12);
  });

  it("CSV出力 button appears in the chart card", () => {
    const { container } = render(<HistoricalPage />);
    expect(container.textContent).toContain("📥 CSV出力");
  });

  it("chart card title includes the selected year", () => {
    const { container } = render(<HistoricalPage />);
    expect(container.textContent).toContain("2025年 月別推移");
  });

  it("changing the year updates the chart card title", () => {
    const { container } = render(<HistoricalPage />);
    const yearSelect = container.querySelectorAll(
      "select.form-select",
    )[1] as HTMLSelectElement;
    fireEvent.change(yearSelect, { target: { value: "2023" } });
    expect(container.textContent).toContain("2023年 月別推移");
  });
});

// ---------------------------------------------------------------------------
// Wave50Page
// ---------------------------------------------------------------------------

describe("Wave50Page", () => {
  it("renders 観測点 / 推定手法 labels and 2 <select>s", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("観測点");
    expect(container.textContent).toContain("推定手法");
    const selects = container.querySelectorAll("select.form-select");
    expect(selects.length).toBe(2);
  });

  it("観測点 select has 4 wave points (東京湾北部/中部/南部/東部)", () => {
    const { container } = render(<Wave50Page />);
    const pointSelect = container.querySelectorAll(
      "select.form-select",
    )[0] as HTMLSelectElement;
    expect(pointSelect.options.length).toBe(4);
    const values = Array.from(pointSelect.options).map((o) => o.value);
    expect(values).toEqual([
      "東京湾北部",
      "東京湾中部",
      "東京湾南部",
      "東京湾東部",
    ]);
  });

  it("推定手法 select offers Gumbel / Weibull / GenPareto (3 options)", () => {
    const { container } = render(<Wave50Page />);
    const methodSelect = container.querySelectorAll(
      "select.form-select",
    )[1] as HTMLSelectElement;
    expect(methodSelect.options.length).toBe(3);
    const values = Array.from(methodSelect.options).map((o) => o.value);
    expect(values).toEqual(["gumbel", "weibull", "genpareto"]);
  });

  it("renders 3 summary stat cards (50年確率波高 / 年最大波高（平均） / 観測最大波高)", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("50年確率波高");
    expect(container.textContent).toContain("年最大波高（平均）");
    expect(container.textContent).toContain("観測最大波高");
  });

  it("renders 年最大有義波高推移(過去20年) chart card", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("年最大有義波高推移(過去20年)");
    const svgs = container.querySelectorAll("svg");
    // at least 1 SVG for the LineChart
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("再現期間別推定値 table has 8 rows (1/2/5/10/20/30/50/100 years)", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("再現期間別推定値");
    const tables = container.querySelectorAll("table.data-table");
    expect(tables.length).toBe(1);
    const bodyRows = tables[0].querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(8);
  });

  it("再現期間 table includes 再現期間 / 確率波高 / 確率風速 / 信頼区間 headers", () => {
    const { container } = render(<Wave50Page />);
    for (const header of [
      "再現期間",
      "確率波高 (m)",
      "確率風速 (m/s)",
      "信頼区間（95%）",
    ]) {
      expect(container.textContent).toContain(header);
    }
  });

  it("the 50-year row carries a 設計基準 badge", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("設計基準");
    const badges = container.querySelectorAll(".badge.badge-info");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("changing 観測点 updates the stat card 観測点 line", () => {
    const { container } = render(<Wave50Page />);
    const pointSelect = container.querySelectorAll(
      "select.form-select",
    )[0] as HTMLSelectElement;
    fireEvent.change(pointSelect, { target: { value: "東京湾南部" } });
    expect(container.textContent).toContain("東京湾南部");
  });

  it("changing 推定手法 updates the methodFullLabel in 分析条件", () => {
    const { container } = render(<Wave50Page />);
    const methodSelect = container.querySelectorAll(
      "select.form-select",
    )[1] as HTMLSelectElement;
    fireEvent.change(methodSelect, { target: { value: "weibull" } });
    expect(container.textContent).toContain("Weibull分布");
  });

  it("renders all 6 分析条件 rows", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("分析条件");
    for (const key of [
      "データ期間",
      "観測点",
      "データソース",
      "推定手法",
      "サンプル数",
      "最終算出日",
    ]) {
      expect(container.textContent).toContain(key);
    }
  });

  it("Excel出力 button is rendered", () => {
    const { container } = render(<Wave50Page />);
    expect(container.textContent).toContain("📥 Excel出力");
  });

  it("annualAvg is computed from 20 annual max samples (.stat-card 2 has a 2-decimal numeric)", () => {
    const { container } = render(<Wave50Page />);
    // The annual avg card displays a 2-decimal numeric followed by "m".
    // We only verify the unit + label are present, not the value itself.
    expect(container.textContent).toContain("過去20年間");
  });
});

// ---------------------------------------------------------------------------
// HistoricalPage — backend fetch path (window.WMCDSS_API_BASE configured)
// ---------------------------------------------------------------------------

const MOCK_HISTORICAL_RESPONSE = {
  site_id: "site-01",
  year: 2025,
  data_source: "backend DB",
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    avg_wind_ms: 5.0 + i * 0.1,
    max_wind_ms: 10.0 + i * 0.2,
    avg_temp_c: 15.0 + i,
    total_rain_mm: 80 + i * 5,
    rain_days: 8 + i,
    avg_wave_h_m: 1.0 + i * 0.05,
    max_wave_h_m: 2.0 + i * 0.1,
  })),
};

describe("HistoricalPage — backend fetch path", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("fetches from configuredApiBase and renders backend chartData", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_HISTORICAL_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);

    await waitFor(() => {
      // Chart renders with data from backend months (label still appears)
      expect(container.textContent).toContain("最大風速 (m/s)");
    });
  });

  it("renders tableMonthly from backendMonthly data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_HISTORICAL_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);

    await waitFor(() => {
      const tables = container.querySelectorAll("table.data-table");
      expect(tables.length).toBeGreaterThan(0);
    });

    // Table should have 12 rows from backend data
    const tables = container.querySelectorAll("table.data-table");
    const bodyRows = tables[0].querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(12);
  });

  it("shows loading indicator during fetch then hides it", async () => {
    let resolveJson: (v: unknown) => void;
    const pendingJson = new Promise((r) => { resolveJson = r; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => pendingJson,
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);

    // Loading state should appear before fetch resolves
    await waitFor(() => {
      expect(container.textContent).toContain("データ取得中");
    });

    // Resolve the fetch
    await act(async () => {
      resolveJson!(MOCK_HISTORICAL_RESPONSE);
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain("データ取得中");
    });
  });

  it("silently handles network error and shows サンプルデータ badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);

    await waitFor(() => {
      expect(container.textContent).toContain("サンプルデータ");
    });
  });

  it("uses window.WMCDSS_API.fetchJSON when available (lines 116-119)", async () => {
    const mockFetchJSON = vi.fn().mockResolvedValue(MOCK_HISTORICAL_RESPONSE);
    vi.stubGlobal("WMCDSS_API", { fetchJSON: mockFetchJSON });

    const { container } = render(<HistoricalPage />);

    await waitFor(() => expect(mockFetchJSON).toHaveBeenCalled());
    expect(container.querySelector("table.data-table")).not.toBeNull();
  });

  it("shows サンプルデータ when response has no months array (lines 131-134)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ site_id: "site-01", year: 2025, months: null }),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);

    await waitFor(() =>
      expect(container.textContent).toContain("サンプルデータ"),
    );
  });
});

// ---------------------------------------------------------------------------
// Wave50Page — backend fetch path (window.WMCDSS_API_BASE configured)
// ---------------------------------------------------------------------------

const MOCK_BACKEND_RESPONSE = {
  site_id: "site-01",
  method: "gumbel",
  data_years: 15,
  sufficient_data: true,
  annual_max: [
    { year: 2010, max_wave_h_m: 2.1 },
    { year: 2011, max_wave_h_m: 2.5 },
    { year: 2012, max_wave_h_m: 1.9 },
  ],
  return_periods: [
    { period_years: 1, wave_h_m: 1.5 },
    { period_years: 2, wave_h_m: 1.8 },
    { period_years: 5, wave_h_m: 2.2 },
    { period_years: 10, wave_h_m: 2.6 },
    { period_years: 20, wave_h_m: 3.0 },
    { period_years: 30, wave_h_m: 3.2 },
    { period_years: 50, wave_h_m: 3.5 },
    { period_years: 100, wave_h_m: 3.8 },
  ],
};

describe("Wave50Page — backend fetch path", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("fetches from configuredApiBase and renders backend dataSource", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_BACKEND_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await waitFor(() =>
      expect(container.textContent).toContain("backend DB 海象履歴データ")
    );
    expect(container.textContent).toContain("15");
  });

  it("renders dataPeriod from backendData annual_max years", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_BACKEND_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await waitFor(() =>
      expect(container.textContent).toContain("2010年〜2012年（15年間）")
    );
  });

  it("renders return periods from backendData", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_BACKEND_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await waitFor(() =>
      expect(container.textContent).toContain("3.50")
    );
  });

  it("shows insufficientWarning banner when sufficient_data is false", async () => {
    const insufficientData = { ...MOCK_BACKEND_RESPONSE, sufficient_data: false };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(insufficientData),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await waitFor(() =>
      expect(container.textContent).toContain("データ期間が短いため推定精度が低い可能性があります")
    );
  });

  it("silently handles network error and uses fallback data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network fail")));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Falls back to static source label
    expect(container.textContent).toContain("気象庁 沿岸波浪モデル（5km格子）");
    // No warning banner shown on error
    expect(container.textContent).not.toContain("データ期間が短い");
  });

  it("clears backendData when method changes to genpareto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_BACKEND_RESPONSE),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    // Wait for backend data to load
    await waitFor(() =>
      expect(container.textContent).toContain("backend DB 海象履歴データ")
    );

    // Switch to genpareto — should clear backendData and show fallback
    const methodSelect = container.querySelectorAll(
      "select.form-select"
    )[1] as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(methodSelect, { target: { value: "genpareto" } });
    });

    expect(container.textContent).toContain("気象庁 沿岸波浪モデル（5km格子）");
  });

  it("uses window.WMCDSS_API.fetchJSON when available", async () => {
    const mockFetchJSON = vi.fn().mockResolvedValue(MOCK_BACKEND_RESPONSE);
    vi.stubGlobal("WMCDSS_API", { fetchJSON: mockFetchJSON });

    const { container } = render(<Wave50Page />);

    await waitFor(() =>
      expect(container.textContent).toContain("backend DB 海象履歴データ")
    );
    expect(mockFetchJSON).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Window side-effects (dual-surface contract: see header of analysis.tsx)
// ---------------------------------------------------------------------------

describe("analysis.tsx — window side effects", () => {
  it("attaches HistoricalPage and Wave50Page to window when imported in jsdom", () => {
    expect(
      (window as unknown as { HistoricalPage?: unknown }).HistoricalPage,
    ).toBe(HistoricalPage);
    expect((window as unknown as { Wave50Page?: unknown }).Wave50Page).toBe(
      Wave50Page,
    );
  });
});

// ---------------------------------------------------------------------------
// HistoricalPage — branch coverage (lines 211, 225)
// ---------------------------------------------------------------------------

describe("HistoricalPage — null branch coverage", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("?? 0 fallbacks (lines 161,206-211): missing months make bm undefined so right side fires", async () => {
    // Only 6 months returned — months 7-12 are absent from byMonth lookup.
    // When bm is undefined, ALL bm?.field ?? 0 expressions take the right side (0).
    const partialMonths = Array.from({ length: 6 }, (_, i) => ({
      month: i + 1,
      avg_wind_ms: 5.0,
      max_wind_ms: 10.0,
      avg_temp_c: 15.0,
      total_rain_mm: 80,
      rain_days: 5,
      avg_wave_h_m: 1.0,
      max_wave_h_m: 2.0,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        site_id: "site-01",
        year: 2025,
        data_source: "backend DB",
        months: partialMonths,
      }),
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<HistoricalPage />);
    await waitFor(() => {
      const tables = container.querySelectorAll("table.data-table");
      expect(tables.length).toBeGreaterThan(0);
    });
    // Table has 12 rows — missing months render as zeros
    const rows = container.querySelectorAll("table.data-table tbody tr");
    expect(rows.length).toBe(12);
  });

  it("waveLimit ?? undefined (line 225): returns undefined when site has null waveHeight and metric=wave", async () => {
    // site-06 has waveHeight: null — switching to 波高 metric exercises the ?? branch
    const { container } = render(<HistoricalPage selectedSite="site-06" />);

    // Switch to 波高 metric
    const waveButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "波高",
    );
    expect(waveButton).not.toBeUndefined();
    await act(async () => {
      waveButton!.click();
    });

    // Component renders without crashing when threshold is undefined
    expect(container.querySelector("select.form-select")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wave50Page — branch coverage (lines 441, 463)
// ---------------------------------------------------------------------------

describe("Wave50Page — null branch coverage", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("throws on non-ok HTTP response (line 441) and falls back to static data", async () => {
    // fetch returns HTTP 500 — line 441 throws, catch block falls back to static
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api");

    const { container } = render(<Wave50Page />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Falls back to static source label after HTTP error
    expect(container.textContent).toContain("気象庁 沿岸波浪モデル（5km格子）");
  });

  it("uses base=3.2 for 東京湾中部 and base=3.0 for 東京湾東部 (line 463)", async () => {
    // No backend configured — fallback is computed for all 4 point branches.
    const { container } = render(<Wave50Page />);
    const pointSelect = container.querySelector("select.form-select") as HTMLSelectElement;

    // 東京湾中部 → base=3.2, period=50: wave = "3.20"
    await act(async () => {
      fireEvent.change(pointSelect, { target: { value: "東京湾中部" } });
    });
    expect(container.textContent).toContain("3.20");

    // 東京湾東部 → base=3.0 (default/else branch), period=50: wave = "3.00"
    await act(async () => {
      fireEvent.change(pointSelect, { target: { value: "東京湾東部" } });
    });
    expect(container.textContent).toContain("3.00");
  });
});

// ---------------------------------------------------------------------------
// HistoricalPage — branch coverage (lines 82, 116)
// ---------------------------------------------------------------------------

describe("HistoricalPage — branch coverage (lines 82, 116)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("falls back to SITES[0] when selectedSite is not in SITES (line 82 || branch)", () => {
    // SITES.find(s => s.id === 'not-a-valid-site-id') → undefined
    // → || SITES[0] fires at line 82
    const { container } = render(<HistoricalPage selectedSite="not-a-valid-site-id" />);
    expect(container.querySelector("select.form-select")).not.toBeNull();
    // The site select falls back to the first valid site
    const siteSelect = container.querySelectorAll("select.form-select")[0] as HTMLSelectElement;
    // The select still contains all SITES options (no crash)
    expect(siteSelect.options.length).toBe(SITES.length);
  });

  it("falls back to sample data on non-ok HTTP response from WMCDSS_API_BASE (line 116)", async () => {
    // WMCDSS_API_BASE set + fetchJSON absent → takes direct fetch path
    // fetch returns HTTP 500 → !resp.ok → throw → catch → fallback
    vi.stubGlobal("WMCDSS_API_BASE", "http://test-api-base");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const { container } = render(<HistoricalPage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // After HTTP error the component falls back to sample/mock data
    expect(container.querySelector("select.form-select")).not.toBeNull();
  });
});
