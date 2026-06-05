// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  NAV_ITEMS,
  PAGE_TITLES,
  SvgIcon,
  AppShell,
  type PageId,
} from "../app-shell";

// AppShell renders DashboardPage on first paint → Leaflet is required.
// Same mock pattern as dashboard.test.tsx.

const mockMarker = {
  addTo: vi.fn().mockReturnThis(),
  bindPopup: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
};
const mockMap = {
  setView: vi.fn().mockReturnThis(),
  invalidateSize: vi.fn(),
  removeLayer: vi.fn(),
};
const mockL = {
  map: vi.fn().mockReturnValue(mockMap),
  control: { zoom: vi.fn().mockReturnValue({ addTo: vi.fn() }) },
  tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
  divIcon: vi.fn().mockReturnValue({}),
  marker: vi.fn().mockReturnValue(mockMarker),
};

// vitest v3.2.4 + jsdom + react render path produces a half-broken
// `window.localStorage` whose .setItem becomes undefined after AppShell's
// usePersistedState writes through it. Replace the global with a minimal
// in-memory Storage shim that has stable methods for the lifetime of each test.

class InMemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length(): number {
    return Object.keys(this.store).length;
  }
  clear(): void {
    this.store = {};
  }
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
}

function installFreshStorage(): void {
  Object.defineProperty(window, "localStorage", {
    value: new InMemoryStorage(),
    writable: true,
    configurable: true,
  });
}

// NOTE: previously used vi.stubGlobal('L', mockL), but that wraps the global
// in a Proxy that breaks `localStorage.setItem` on the jsdom window in vitest
// v3.2.4. Assigning the Leaflet stub directly to window.L is enough — the
// AppShell only needs L to be a callable mock object.

interface WindowWithLeafletStub extends Window {
  L?: typeof mockL;
}

beforeEach(() => {
  installFreshStorage();
  vi.clearAllMocks();
  // Re-seed Leaflet mock return values that clearAllMocks just wiped — same
  // pattern used in dashboard.test.tsx. Without this the next render gets
  // `L.map()` returning undefined and crashes on `.setView`.
  mockMap.setView.mockReturnThis();
  mockMap.invalidateSize.mockReturnValue(undefined);
  mockMap.removeLayer.mockReturnValue(undefined);
  mockL.map.mockReturnValue(mockMap);
  mockL.control.zoom.mockReturnValue({ addTo: vi.fn() });
  mockL.tileLayer.mockReturnValue({ addTo: vi.fn() });
  mockL.marker.mockReturnValue(mockMarker);
  mockMarker.addTo.mockReturnThis();
  mockMarker.bindPopup.mockReturnThis();
  mockMarker.on.mockReturnThis();
  vi.stubGlobal("L", mockL);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure exports — schema / shape checks
// ---------------------------------------------------------------------------

describe("NAV_ITEMS", () => {
  it("has at least one group", () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0);
  });

  it("every group has a group label and at least one item", () => {
    for (const g of NAV_ITEMS) {
      expect(typeof g.group).toBe("string");
      expect(g.group.length).toBeGreaterThan(0);
      expect(Array.isArray(g.items)).toBe(true);
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("every item has id / label / icon (non-empty strings)", () => {
    for (const g of NAV_ITEMS) {
      for (const item of g.items) {
        expect(typeof item.id).toBe("string");
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it("all NAV_ITEMS ids exist in PAGE_TITLES", () => {
    for (const g of NAV_ITEMS) {
      for (const item of g.items) {
        expect(PAGE_TITLES[item.id]).toBeDefined();
      }
    }
  });

  it("contains the dashboard item under メイン group", () => {
    const main = NAV_ITEMS.find((g) => g.group === "メイン");
    expect(main).toBeDefined();
    const dashboard = main?.items.find((i) => i.id === "dashboard");
    expect(dashboard).toBeDefined();
    expect(dashboard?.label).toBe("ダッシュボード");
  });
});

describe("PAGE_TITLES", () => {
  it("covers every PageId (no missing entry)", () => {
    const ids: PageId[] = [
      "dashboard",
      "sites",
      "site-register",
      "site-detail",
      "weather",
      "marine",
      "concrete",
      "marine-work",
      "historical",
      "wave50",
      "thresholds",
      "etl",
      "reports",
      "audit",
      "settings",
      "ai-settings",
    ];
    for (const id of ids) {
      expect(typeof PAGE_TITLES[id]).toBe("string");
      expect(PAGE_TITLES[id].length).toBeGreaterThan(0);
    }
  });

  it("dashboard title is ダッシュボード", () => {
    expect(PAGE_TITLES.dashboard).toBe("ダッシュボード");
  });

  it("wave50 title is 50年確率波分析", () => {
    expect(PAGE_TITLES.wave50).toBe("50年確率波分析");
  });
});

// ---------------------------------------------------------------------------
// SvgIcon
// ---------------------------------------------------------------------------

describe("SvgIcon", () => {
  it("renders an svg element", () => {
    const { container } = render(<SvgIcon d="M0 0h24v24H0z" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("uses the provided path d attribute", () => {
    const d = "M3 13h8V3H3v10z";
    const { container } = render(<SvgIcon d={d} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toBe(d);
  });

  it("default size is 18×18", () => {
    const { container } = render(<SvgIcon d="M0 0h24v24" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("18");
    expect(svg?.getAttribute("height")).toBe("18");
  });

  it("respects a custom size prop", () => {
    const { container } = render(<SvgIcon d="M0 0h24v24" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("32");
    expect(svg?.getAttribute("height")).toBe("32");
  });

  it("uses viewBox 0 0 24 24", () => {
    const { container } = render(<SvgIcon d="M0 0h24v24" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});

// ---------------------------------------------------------------------------
// AppShell — basic integration
// ---------------------------------------------------------------------------

describe("AppShell — first paint", () => {
  it("renders sidebar logo with 気象海象判断支援", () => {
    const { container } = render(<AppShell />);
    expect(container.textContent).toContain("気象海象判断支援");
    expect(container.textContent).toContain("Decision Support System");
  });

  it("renders every NAV_ITEMS group label", () => {
    const { container } = render(<AppShell />);
    for (const g of NAV_ITEMS) {
      expect(container.textContent).toContain(g.group);
    }
  });

  it("renders every NAV_ITEMS item label", () => {
    const { container } = render(<AppShell />);
    for (const g of NAV_ITEMS) {
      for (const item of g.items) {
        expect(container.textContent).toContain(item.label);
      }
    }
  });

  it("dashboard item is active by default (sidebar-item.active)", () => {
    const { container } = render(<AppShell />);
    const active = container.querySelectorAll(".sidebar-item.active");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain("ダッシュボード");
  });

  it("header shows the dashboard title initially", () => {
    const { container } = render(<AppShell />);
    const headerTitle = container.querySelector(".header-title");
    expect(headerTitle?.textContent).toBe("ダッシュボード");
  });

  it("header renders 3 status badges (施工可 / 注意 / 中止)", () => {
    const { container } = render(<AppShell />);
    expect(container.textContent).toContain("施工可");
    expect(container.textContent).toContain("注意");
    expect(container.textContent).toContain("中止");
  });

  it("renders role switch (現場 / 本社) buttons", () => {
    const { container } = render(<AppShell />);
    const roleButtons = container.querySelectorAll(".role-btn");
    expect(roleButtons.length).toBe(2);
    const labels = Array.from(roleButtons).map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("現場"))).toBe(true);
    expect(labels.some((l) => l.includes("本社"))).toBe(true);
  });

  it("renders the ⚙ tweaks button with aria-label 表示設定を開く", () => {
    const { container } = render(<AppShell />);
    const btn = container.querySelector(
      ".header-tweaks-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("表示設定を開く");
  });

  it("renders the dashboard page content (現場マップ card title from DashboardPage)", () => {
    const { container } = render(<AppShell />);
    // DashboardPage renders 現場マップ as a card title
    expect(container.textContent).toContain("現場マップ");
  });
});

// ---------------------------------------------------------------------------
// AppShell — interaction
// ---------------------------------------------------------------------------

describe("AppShell — sidebar navigation", () => {
  it("clicking a sidebar item navigates: 現場一覧 → header title 現場一覧 (or remains usable)", () => {
    const { container } = render(<AppShell />);
    const sitesItem = Array.from(
      container.querySelectorAll(".sidebar-item"),
    ).find((el) => el.textContent?.includes("現場一覧"));
    expect(sitesItem).not.toBeUndefined();
    fireEvent.click(sitesItem!);
    const headerTitle = container.querySelector(".header-title");
    expect(headerTitle?.textContent).toBe("現場一覧");
  });

  it("clicking 気象データ updates the active sidebar item", () => {
    const { container } = render(<AppShell />);
    const weatherItem = Array.from(
      container.querySelectorAll(".sidebar-item"),
    ).find((el) => el.textContent?.includes("気象データ"));
    fireEvent.click(weatherItem!);
    const activeItems = container.querySelectorAll(".sidebar-item.active");
    expect(activeItems.length).toBe(1);
    expect(activeItems[0].textContent).toContain("気象データ");
  });

  it("breadcrumb is hidden by default (no selectedSite yet)", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector(".header-breadcrumb")).toBeNull();
  });

  it("clicking a site row from 現場一覧 navigates to site-detail and shows breadcrumb", () => {
    const { container } = render(<AppShell />);
    // 1. Navigate to 現場一覧 via sidebar
    const sitesItem = Array.from(
      container.querySelectorAll(".sidebar-item"),
    ).find((el) => el.textContent?.includes("現場一覧"));
    fireEvent.click(sitesItem!);
    // 2. Click the first site row → navigate('site-detail', site.id)
    const firstRow = container.querySelector(
      "tbody tr.clickable",
    ) as HTMLElement;
    expect(firstRow).not.toBeNull();
    fireEvent.click(firstRow);
    // 3. Header title becomes 現場詳細, breadcrumb appears with site shortName
    const headerTitle = container.querySelector(".header-title");
    expect(headerTitle?.textContent).toBe("現場詳細");
    const breadcrumb = container.querySelector(".header-breadcrumb");
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent).toContain("▸");
  });
});

// ---------------------------------------------------------------------------
// AppShell — exhaustive navigation (renderPage switch case coverage)
// ---------------------------------------------------------------------------
//
// Each NAV_ITEMS label clicks into a different page; verifying the header
// title flips to PAGE_TITLES[page] simultaneously exercises the
// `PAGE_TITLES[page] || 'ダッシュボード'` fallback OR branch, the
// renderPage switch case for that page, and the navigate(page) state
// transition. Skips dashboard (default) and 現場詳細 (covered by the
// breadcrumb integration test above — only reachable via SiteListPage row).

// [sidebar nav label (short), header title (full from PAGE_TITLES)]
// Some labels differ — UX shortens long names in the sidebar to fit the
// narrow column, but the header always shows the canonical title.
// exact: true → textContent must equal the label exactly (used when one label
// is a substring of another, e.g. "設定" ⊂ "AI設定・管理").
type NavTitleEntry = readonly [navLabel: string, expectedTitle: string, exact?: boolean];

const NAV_TITLES: ReadonlyArray<NavTitleEntry> = [
  ["現場登録", "現場登録"],
  ["気象データ", "気象データ"],
  ["海象データ", "海象データ"],
  ["コンクリート打設", "コンクリート打設判定"], // sidebar 短縮形
  ["海上作業", "海上作業判定"], // sidebar 短縮形
  ["過去データ分析", "過去データ分析"],
  ["50年確率波", "50年確率波分析"], // sidebar 短縮形
  ["閾値管理", "閾値管理"],
  ["データ取得状況", "データ取得状況"],
  ["レポート出力", "レポート出力"],
  ["監査ログ", "監査ログ"],
  ["AI設定・管理", "AI設定・管理"],
  // "設定" is a substring of "AI設定・管理" — use exact match to avoid false hit
  ["設定", "設定", true],
];

describe("AppShell — exhaustive sidebar navigation", () => {
  for (const [navLabel, expectedTitle, exact] of NAV_TITLES) {
    it(`clicking ${navLabel} updates the header title to ${expectedTitle}`, () => {
      const { container } = render(<AppShell />);
      const item = Array.from(container.querySelectorAll(".sidebar-item")).find(
        (el) => exact
          ? el.textContent?.trim() === navLabel
          : el.textContent?.includes(navLabel),
      );
      expect(item).not.toBeUndefined();
      fireEvent.click(item!);
      const headerTitle = container.querySelector(".header-title");
      expect(headerTitle?.textContent).toBe(expectedTitle);
    });
  }
});

describe("AppShell — role/theme persistence (localStorage)", () => {
  it("default role is 現場 (active class on field button)", () => {
    const { container } = render(<AppShell />);
    const fieldBtn = Array.from(container.querySelectorAll(".role-btn")).find(
      (b) => b.textContent?.includes("現場"),
    );
    expect(fieldBtn?.className).toContain("active");
  });

  it("clicking 本社 button switches role and persists to localStorage", () => {
    const { container } = render(<AppShell />);
    const hqBtn = Array.from(container.querySelectorAll(".role-btn")).find(
      (b) => b.textContent?.includes("本社"),
    );
    fireEvent.click(hqBtn!);
    expect(hqBtn?.className).toContain("active");
    expect(localStorage.getItem("wmcdss.tweaks.v1.role")).toBe('"hq"');
  });

  it("reloads role=hq from localStorage on a fresh render", () => {
    localStorage.setItem("wmcdss.tweaks.v1.role", '"hq"');
    const { container } = render(<AppShell />);
    const hqBtn = Array.from(container.querySelectorAll(".role-btn")).find(
      (b) => b.textContent?.includes("本社"),
    );
    expect(hqBtn?.className).toContain("active");
  });

  it("invalid persisted role value falls back to default (現場)", () => {
    localStorage.setItem("wmcdss.tweaks.v1.role", '"not-a-role"');
    const { container } = render(<AppShell />);
    const fieldBtn = Array.from(container.querySelectorAll(".role-btn")).find(
      (b) => b.textContent?.includes("現場"),
    );
    expect(fieldBtn?.className).toContain("active");
  });

  it("malformed JSON in localStorage does not crash AppShell (warn-and-recover path)", () => {
    localStorage.setItem("wmcdss.tweaks.v1.role", "<<not-json>>");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<AppShell />);
    expect(container.textContent).toContain("気象海象判断支援");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("density=compact toggles the density-compact class on the root", () => {
    localStorage.setItem("wmcdss.tweaks.v1.density", '"compact"');
    const { container } = render(<AppShell />);
    const root = container.querySelector(".app-layout");
    expect(root?.className).toContain("density-compact");
  });

  it("theme=dark toggles the theme-dark class and data-theme on the root", () => {
    localStorage.setItem("wmcdss.tweaks.v1.theme", '"dark"');
    const { container } = render(<AppShell />);
    const root = container.querySelector(".app-layout");
    expect(root?.className).toContain("theme-dark");
    expect(root?.getAttribute("data-theme")).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// window side-effects
// ---------------------------------------------------------------------------

describe("app-shell.tsx — window side effects", () => {
  it("attaches App / SvgIcon / NAV_ITEMS / PAGE_TITLES to window", () => {
    const w = window as unknown as Record<string, unknown>;
    expect(w.App).toBe(AppShell);
    expect(w.SvgIcon).toBe(SvgIcon);
    expect(w.NAV_ITEMS).toBe(NAV_ITEMS);
    expect(w.PAGE_TITLES).toBe(PAGE_TITLES);
  });
});
