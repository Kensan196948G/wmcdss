// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { SiteListPage, SiteRegisterPage, SiteDetailPage } from "../site-pages";
import { SITES } from "../data";

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// SiteListPage
// ---------------------------------------------------------------------------

describe("SiteListPage", () => {
  it("renders 4 filter buttons (すべて / 施工可 / 注意 / 中止推奨)", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const labels = ["すべて", "施工可", "注意", "中止推奨"];
    for (const l of labels) {
      expect(container.textContent).toContain(l);
    }
  });

  it("default filter is すべて (btn-primary)", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const allBtn = Array.from(container.querySelectorAll("button.btn-sm")).find(
      (b) => b.textContent === "すべて",
    );
    expect(allBtn?.className).toContain("btn-primary");
  });

  it("clicking a filter button activates it", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const okBtn = Array.from(container.querySelectorAll("button.btn-sm")).find(
      (b) => b.textContent === "施工可",
    );
    fireEvent.click(okBtn!);
    expect(okBtn?.className).toContain("btn-primary");
  });

  it("renders a search input and 新規登録 button", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const input = container.querySelector(
      "input.form-input",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toContain("現場名");
    expect(container.textContent).toContain("＋ 新規登録");
  });

  it("clicking 新規登録 calls navigate('site-register')", () => {
    const navigate = vi.fn();
    const { container } = render(<SiteListPage navigate={navigate} />);
    const registerBtn = Array.from(
      container.querySelectorAll("button.btn-primary"),
    ).find((b) => b.textContent?.includes("新規登録"));
    fireEvent.click(registerBtn!);
    expect(navigate).toHaveBeenCalledWith("site-register");
  });

  it("renders the 9 table column headers", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    for (const header of [
      "ステータス",
      "現場名",
      "工種",
      "観測所",
      "担当者",
      "施工者",
      "気温",
      "風速",
      "波高",
    ]) {
      expect(container.textContent).toContain(header);
    }
  });

  it("renders one row per site by default (filter=all)", () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(SITES.length);
  });

  it("filter=施工可 only shows ok-status sites", () => {
    const okCount = SITES.filter((s) => s.status === "ok").length;
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const okBtn = Array.from(container.querySelectorAll("button.btn-sm")).find(
      (b) => b.textContent === "施工可",
    );
    fireEvent.click(okBtn!);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(okCount);
  });

  it("search by site name filters rows", () => {
    const target = SITES[0];
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    const input = container.querySelector(
      "input.form-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: target.shortName } });
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    // every visible row should mention the searched shortName (or the full name contains it)
    for (const row of Array.from(rows)) {
      const text = row.textContent ?? "";
      const matched = SITES.some(
        (s) =>
          text.includes(s.name) &&
          (s.name.includes(target.shortName) ||
            s.shortName.includes(target.shortName)),
      );
      expect(matched).toBe(true);
    }
  });

  it("clicking a site row calls navigate('site-detail', site.id)", () => {
    const navigate = vi.fn();
    const { container } = render(<SiteListPage navigate={navigate} />);
    const firstRow = container.querySelector(
      "tbody tr.clickable",
    ) as HTMLElement;
    fireEvent.click(firstRow);
    expect(navigate).toHaveBeenCalledWith("site-detail", expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// SiteRegisterPage
// ---------------------------------------------------------------------------

describe("SiteRegisterPage", () => {
  it("renders 基本情報 / 閾値設定 card titles (or at least 基本情報)", () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    expect(container.textContent).toContain("基本情報");
  });

  it("renders the 現場名 / 工種 / 緯度 / 経度 / 観測所 form labels", () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    for (const label of ["現場名", "工種", "緯度", "経度", "気象観測所"]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("type select has land / marine / both options", () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    const selects = container.querySelectorAll("select.form-select");
    const typeSelect = Array.from(selects).find((s) => {
      const opts = Array.from((s as HTMLSelectElement).options).map(
        (o) => o.value,
      );
      return (
        opts.includes("land") &&
        opts.includes("marine") &&
        opts.includes("both")
      );
    }) as HTMLSelectElement | undefined;
    expect(typeSelect).not.toBeUndefined();
    expect(typeSelect!.value).toBe("marine"); // INITIAL_FORM.type
  });

  it("default windSpeed input is 10 and tempLow is 5", () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    const numericInputs = Array.from(
      container.querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[];
    const windInput = numericInputs.find((i) => i.value === "10");
    const tempLowInput = numericInputs.find((i) => i.value === "5");
    expect(windInput).not.toBeUndefined();
    expect(tempLowInput).not.toBeUndefined();
  });

  it("typing in the 現場名 field updates the input value", () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    const input = container.querySelector(
      "input.form-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "テスト現場" } });
    expect(input.value).toBe("テスト現場");
  });

  it("clicking キャンセル calls navigate('sites')", () => {
    const navigate = vi.fn();
    const { container } = render(<SiteRegisterPage navigate={navigate} />);
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "キャンセル",
    );
    fireEvent.click(cancelBtn!);
    expect(navigate).toHaveBeenCalledWith("sites");
  });

  it("clicking 登録する shows a confirmation banner", () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const { container } = render(<SiteRegisterPage navigate={navigate} />);
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "登録する",
    );
    fireEvent.click(saveBtn!);
    expect(container.textContent).toContain("現場を登録しました");
    vi.useRealTimers();
  });

  it("after 1200ms the save flow calls navigate('sites')", () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const { container } = render(<SiteRegisterPage navigate={navigate} />);
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "登録する",
    );
    fireEvent.click(saveBtn!);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1300);
    expect(navigate).toHaveBeenCalledWith("sites");
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// SiteDetailPage
// ---------------------------------------------------------------------------

describe("SiteDetailPage", () => {
  it("renders the site name in the header card", () => {
    const target = SITES[0];
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite={target.id} />,
    );
    expect(container.textContent).toContain(target.name);
  });

  it("falls back to SITES[0] when selectedSite is undefined", () => {
    const { container } = render(<SiteDetailPage navigate={vi.fn()} />);
    expect(container.textContent).toContain(SITES[0].name);
  });

  it("falls back to SITES[0] when selectedSite is unknown", () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="no-such-site" />,
    );
    expect(container.textContent).toContain(SITES[0].name);
  });

  it("renders the manager and contractor lines", () => {
    const target = SITES[0];
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite={target.id} />,
    );
    expect(container.textContent).toContain(target.manager);
    expect(container.textContent).toContain(target.contractor);
  });

  it("renders quick action buttons: 気象データ + 打設判定 (always)", () => {
    const { container } = render(<SiteDetailPage navigate={vi.fn()} />);
    expect(container.textContent).toContain("📊 気象データ");
    expect(container.textContent).toContain("🏗 打設判定");
  });

  it("renders 海象データ + 海上作業判定 only when site.type !== land", () => {
    const marineSite = SITES.find((s) => s.type !== "land");
    if (!marineSite) return;
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite={marineSite.id} />,
    );
    expect(container.textContent).toContain("🌊 海象データ");
    expect(container.textContent).toContain("🚢 海上作業判定");
  });

  it("does NOT render 海象 buttons for land sites", () => {
    const landSite = SITES.find((s) => s.type === "land");
    if (!landSite) return;
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite={landSite.id} />,
    );
    expect(container.textContent).not.toContain("🌊 海象データ");
    expect(container.textContent).not.toContain("🚢 海上作業判定");
  });

  it("clicking 気象データ button calls navigate('weather', site.id)", () => {
    const navigate = vi.fn();
    const target = SITES[0];
    const { container } = render(
      <SiteDetailPage navigate={navigate} selectedSite={target.id} />,
    );
    const weatherBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent?.includes("気象データ"));
    fireEvent.click(weatherBtn!);
    expect(navigate).toHaveBeenCalledWith("weather", target.id);
  });

  it("clicking 打設判定 button calls navigate('concrete', site.id)", () => {
    const navigate = vi.fn();
    const target = SITES[0];
    const { container } = render(
      <SiteDetailPage navigate={navigate} selectedSite={target.id} />,
    );
    const concreteBtn = Array.from(
      container.querySelectorAll("button.btn-sm"),
    ).find((b) => b.textContent?.includes("打設判定"));
    fireEvent.click(concreteBtn!);
    expect(navigate).toHaveBeenCalledWith("concrete", target.id);
  });

  it("renders 現在の気象 card with 気温 / 湿度 / 気圧 / 風速 / 風向 / 降水量", () => {
    const { container } = render(<SiteDetailPage navigate={vi.fn()} />);
    expect(container.textContent).toContain("現在の気象");
    for (const label of ["気温", "湿度", "気圧", "風速", "風向", "降水量"]) {
      expect(container.textContent).toContain(label);
    }
  });

  it("renders 総合判定 decision panel", () => {
    const { container } = render(<SiteDetailPage navigate={vi.fn()} />);
    expect(container.textContent).toContain("総合判定");
  });

  it("renders 本日の風速推移 chart card with an svg", () => {
    const { container } = render(<SiteDetailPage navigate={vi.fn()} />);
    expect(container.textContent).toContain("本日の風速推移");
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// window side-effects (dual-surface contract: see header of site-pages.tsx)
// ---------------------------------------------------------------------------

describe("site-pages.tsx — window side effects", () => {
  it("attaches SiteListPage / SiteRegisterPage / SiteDetailPage to window", () => {
    const w = window as unknown as Record<string, unknown>;
    expect(w.SiteListPage).toBe(SiteListPage);
    expect(w.SiteRegisterPage).toBe(SiteRegisterPage);
    expect(w.SiteDetailPage).toBe(SiteDetailPage);
  });
});

// ---------------------------------------------------------------------------
// SiteRegisterPage — WMCDSS_API.fetchJSON integration (lines 249-262, 265)
//
// handleSave checks `window.WMCDSS_API?.fetchJSON` and calls it when available.
// Two branches:
//   lines 249-262: fetchJSON resolves successfully (happy path)
//   line 265:      fetchJSON rejects → catch swallows the error, setSaved(true) still fires
// ---------------------------------------------------------------------------

describe("SiteRegisterPage — WMCDSS_API.fetchJSON integration (lines 249-262, 265)", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).WMCDSS_API;
  });

  it("calls WMCDSS_API.fetchJSON when available (lines 249-262 true branch)", async () => {
    const fetchJSON = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as Record<string, unknown>).WMCDSS_API = { fetchJSON };
    const navigate = vi.fn();
    const { container } = render(<SiteRegisterPage navigate={navigate} />);
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "登録する",
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    expect(fetchJSON).toHaveBeenCalledWith("/sites", expect.objectContaining({ method: "POST" }));
  });

  it("catches fetchJSON rejection and still shows confirmation (line 265 catch branch)", async () => {
    const fetchJSON = vi.fn().mockRejectedValue(new Error("backend unavailable"));
    (window as unknown as Record<string, unknown>).WMCDSS_API = { fetchJSON };
    const navigate = vi.fn();
    const { container } = render(<SiteRegisterPage navigate={navigate} />);
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "登録する",
    );
    await act(async () => {
      fireEvent.click(saveBtn!);
    });
    expect(container.textContent).toContain("現場を登録しました");
  });
});
