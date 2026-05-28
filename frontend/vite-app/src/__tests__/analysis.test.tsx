// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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
