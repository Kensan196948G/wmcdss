// @vitest-environment jsdom
/**
 * task-10 回帰テスト — ダッシュボードが実判定を表示する
 *
 *   (A) 接続確立後（マウント後に true になるケース）に /api/v1/dashboard を
 *       必ず 1 回取得する。多重取得はしない。
 *   (B) ヘッダーの件数とダッシュボードのカードが同一の情報源（実判定）から
 *       算出される。接続中に実判定が未取得ならモック件数を出さない。
 *   (C) 接続時の現場名は API の name 由来（モック SITES の shortName を流用しない）。
 *   (D) 未接続（デモ）は従来どおりモック表示のまま。
 *
 * 実アプリの起動順序（AppShell マウント → initFromBackend 完了）をそのまま
 * 再現するため、fetch をスタブして本物の initFromBackend() を呼ぶ。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, act, cleanup, fireEvent } from "@testing-library/react";

import { AppShell } from "../app-shell";
import { DashboardPage } from "../dashboard";
import { resetDashboardSummary } from "../dashboard-summary";
import { initFromBackend, type BackendSite, type DashboardSummaryResponse } from "../api";
import { SITES as MOCK_SITES } from "../data";

// ── 実 API の応答形（公開MVPの実測値に合わせた 3 現場）──────────────────────

const API_SITES: BackendSite[] = [
  {
    id: "00b05d5b-612a-4548-bd89-eb335b0214b1",
    code: "TYO-01",
    name: "東京港臨海現場",
    kind: "marine",
    lat: 35.645,
    lon: 139.77,
    jma_station_id: "44132",
    address: "東京都港区",
  },
  {
    id: "7cc60be6-eeb2-4c82-8503-e5620e8294ed",
    code: "TYO-02",
    name: "羽田D滑走路工事",
    kind: "marine",
    lat: 35.55,
    lon: 139.78,
    jma_station_id: "44132",
    address: "東京都大田区",
  },
  {
    id: "1f7b1c2d-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
    code: "TYO-03",
    name: "横浜本牧埠頭改修",
    kind: "marine",
    lat: 35.44,
    lon: 139.66,
    jma_station_id: "47670",
    address: "神奈川県横浜市",
  },
];

function summaryFor(
  site: BackendSite,
  status: "go" | "caution" | "stop",
  reason: string,
) {
  return {
    site_id: String(site.id),
    code: site.code,
    name: site.name,
    kind: site.kind,
    status,
    reason,
    work_types: [],
    weather_observed_at: "2026-09-29T14:23:47+00:00",
    marine_observed_at: "2026-09-29T14:03:47+00:00",
    weather_fresh: true,
    marine_fresh: true,
    data_complete: true,
    latest_weather: {
      temperature_c: 22,
      humidity_pct: 60,
      precip_mm: 0,
      wind_speed_ms: 4,
      wind_gust_ms: 6.5,
    },
    latest_marine: { sig_wave_h_m: 0.4, wave_period_s: 5.2 },
  };
}

/** 住所が空（地域を判別できない）現場。地域フィルタで消えてはいけない。 */
const UNKNOWN_ADDRESS_SITE: BackendSite = {
  id: "22222222-3333-4444-8555-666677778888",
  code: "TYO-04",
  name: "住所未登録現場",
  kind: "land",
  lat: 35.0,
  lon: 139.0,
  jma_station_id: null,
  address: null,
};

/** 地域が判別できる現場（九州）。地域フィルタが実際に絞り込むことの確認に使う。 */
const KYUSHU_SITE: BackendSite = {
  id: "33333333-4444-4555-8666-777788889999",
  code: "FUK-01",
  name: "博多港岸壁改良",
  kind: "marine",
  lat: 33.6,
  lon: 130.4,
  jma_station_id: "47807",
  address: "福岡県福岡市博多区",
};

/** 地域フィルタ検証用: 関東 3 件 + 住所不明 1 件 + 九州 1 件。 */
const AREA_TEST_SITES: BackendSite[] = [...API_SITES, UNKNOWN_ADDRESS_SITE, KYUSHU_SITE];

const DASHBOARD_SUMMARY: DashboardSummaryResponse = {
  generated_at: "2026-09-29T14:40:03+00:00",
  count: 3,
  sites: [
    summaryFor(API_SITES[0], "go", "全しきい値を満たしています。施工可。"),
    summaryFor(API_SITES[1], "stop", "sig_wave_h_m=1.2 が基準 (>=0.5) に該当 [stop]"),
    summaryFor(API_SITES[2], "caution", "風速が基準の 80% に接近 [caution]"),
  ],
};

// ── Leaflet / localStorage stubs（app-shell.test.tsx と同じ作法）─────────────

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

class InMemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length(): number {
    return Object.keys(this.store).length;
  }
  clear(): void {
    this.store = {};
  }
  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
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

// ── helpers ─────────────────────────────────────────────────────────────────

function okJson(json: unknown) {
  return Promise.resolve({ ok: true as const, json: async () => json });
}

interface WindowWithGlobals extends Window {
  BACKEND_STATUS?: { ok: boolean; sites?: number; base?: string; reason?: string };
  SITES?: unknown;
}

let fetchMock: ReturnType<typeof vi.fn>;

/** /sites と /dashboard だけを返す fetch スタブ。 */
function installFetch(options?: {
  dashboard?: "ok" | "pending";
  sites?: BackendSite[];
  summary?: DashboardSummaryResponse;
}): void {
  const mode = options?.dashboard ?? "ok";
  const sites = options?.sites ?? API_SITES;
  const summary = options?.summary ?? DASHBOARD_SUMMARY;
  fetchMock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes("/sites")) return okJson(sites);
    if (url.includes("/dashboard")) {
      if (mode === "pending") return new Promise(() => {});
      return okJson(summary);
    }
    return Promise.resolve({ ok: false, status: 404, text: async () => "not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function dashboardCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/dashboard")).length;
}

function headerBadge(label: string): string {
  const badges = Array.from(document.querySelectorAll(".header-right .header-badge"));
  const badge = badges.find((b) => (b.textContent ?? "").includes(label));
  return (badge?.textContent ?? "").replace(label, "").trim();
}

function statValue(label: string): string {
  const cards = Array.from(document.querySelectorAll(".stat-card"));
  const card = cards.find((c) => (c.querySelector(".stat-label")?.textContent ?? "") === label);
  return card?.querySelector(".stat-value")?.textContent?.trim() ?? "";
}

/** 実アプリと同じく「マウント後に接続が確立する」状況を作る。 */
async function connectBackend(): Promise<void> {
  await act(async () => {
    await initFromBackend();
  });
}

const navigate = () => {};

/** 地域フィルタのチップを押す。 */
function clickArea(area: string): void {
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === area,
  );
  expect(button, `${area} のチップが見つからない`).toBeTruthy();
  fireEvent.click(button as HTMLButtonElement);
}

/** 画面に出ている現場カードの数（SiteStatusCard は 1 枚 1 つの .reason-text を持つ）。 */
function visibleCardCount(): number {
  return document.querySelectorAll(".reason-text").length;
}

/**
 * 現場カード本文のテキスト一覧。
 * 警告帯（AlertBanner）は地域フィルタの対象外（全現場の警告サマリー）なので、
 * フィルタ結果の検証はカード本文だけを対象にする。
 */
function cardTexts(): string[] {
  return Array.from(document.querySelectorAll(".card-body")).map((el) => el.textContent ?? "");
}

// ── setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  cleanup();
  installFreshStorage();
  resetDashboardSummary();
  // data.ts はモジュール読み込み時に window.SITES へモックを流し込む（実アプリと同じ）。
  (window as WindowWithGlobals).SITES = MOCK_SITES;
  delete (window as WindowWithGlobals).BACKEND_STATUS;
  (window as unknown as { L?: typeof mockL }).L = mockL;
  vi.clearAllMocks();
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
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── (A) 初回ロードで必ず取得する ────────────────────────────────────────────

describe("task-10 (A) 接続確立後の /dashboard 取得", () => {
  it("マウント時は未接続でも、接続確立後に 1 回取得してカードが実判定になる", async () => {
    render(<DashboardPage navigate={navigate} />);

    // マウント直後（initFromBackend 完了前）は取得できない
    expect(dashboardCalls()).toBe(0);

    await connectBackend();

    await waitFor(() => expect(dashboardCalls()).toBe(1));
    // 実判定の理由文がカードに出る（モック判定ではない）
    await waitFor(() =>
      expect(document.body.textContent).toContain("全しきい値を満たしています。施工可。"),
    );
    expect(document.body.textContent).toContain("東京港臨海現場");
  });

  it("ヘッダーとダッシュボードが同居しても取得は 1 回に集約される", async () => {
    render(<AppShell />);
    await connectBackend();
    await waitFor(() => expect(dashboardCalls()).toBe(1));

    // 再レンダリングが続いても追加取得しない
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dashboardCalls()).toBe(1);
  });
});

// ── (B) ヘッダーとカードの一致 ──────────────────────────────────────────────

describe("task-10 (B) ヘッダー件数とカード判定の一致", () => {
  it("実判定（go 1 / caution 1 / stop 1）がヘッダーと stat card の両方に出る", async () => {
    render(<AppShell />);
    await connectBackend();
    await waitFor(() => expect(headerBadge("施工可")).toBe("1"));

    expect(headerBadge("注意")).toBe("1");
    expect(headerBadge("中止")).toBe("1");
    // 同一情報源から算出されるので、ヘッダーとカードの数字は一致する
    expect(statValue("施工可")).toBe("1");
    expect(statValue("注意")).toBe("1");
    expect(statValue("中止推奨")).toBe("1");
    expect(headerBadge("施工可")).toBe(statValue("施工可"));
    expect(headerBadge("注意")).toBe(statValue("注意"));
    expect(headerBadge("中止")).toBe(statValue("中止推奨"));
    expect(statValue("管理現場数")).toBe(String(API_SITES.length));
  });

  it("接続中に実判定が未取得のあいだはモック件数を実判定として表示しない", async () => {
    // /dashboard が返らない（無応答）状態
    installFetch({ dashboard: "pending" });
    render(<AppShell />);
    await connectBackend();
    await waitFor(() => expect(document.body.textContent).toContain("東京港臨海現場"));

    // モック分布（3/2/1）を実判定として出さない
    expect(headerBadge("施工可")).toBe("—");
    expect(headerBadge("注意")).toBe("—");
    expect(headerBadge("中止")).toBe("—");
    expect(statValue("施工可")).toBe("—");
    expect(statValue("注意")).toBe("—");
    expect(statValue("中止推奨")).toBe("—");
    // カード側もモック判定を出さない
    expect(document.body.textContent).toContain("判定取得中");
    expect(document.body.textContent).not.toContain("全しきい値を満たしています。施工可。");
  });
});

// ── (C) 現場名は API の name 由来 ───────────────────────────────────────────

describe("task-10 (C) 現場名の出所", () => {
  it("接続後の window.SITES は API の name を持ち、モック shortName を流用しない", async () => {
    await connectBackend();

    const live = (window as WindowWithGlobals).SITES as Array<{
      name: string;
      shortName: string;
      status: string;
    }>;

    expect(live.map((s) => s.name)).toEqual([
      "東京港臨海現場",
      "羽田D滑走路工事",
      "横浜本牧埠頭改修",
    ]);
    // モックの shortName（例: 2 件目 = 横浜港防波堤）が混ざらない
    expect(live.map((s) => s.shortName)).not.toContain("横浜港防波堤");
    expect(live.map((s) => s.shortName)).not.toContain("東京港大橋");
    expect(live[1].shortName).toBe("羽田D滑走路工事");
    // モックの status（2 件目 = warn）を実判定として引き継がない
    expect(live[1].status).not.toBe("warn");
    // モックの status 分布をそのまま引き継いでいないこと
    expect(live.map((s) => s.status)).not.toEqual(
      MOCK_SITES.slice(0, live.length).map((s) => s.status),
    );
  });

  it("カードに表示される現場名が API の name と一致する", async () => {
    render(<DashboardPage navigate={navigate} />);
    await connectBackend();
    await waitFor(() => expect(document.body.textContent).toContain("羽田D滑走路工事"));

    expect(document.body.textContent).toContain("横浜本牧埠頭改修");
    // モック SITES の shortName は表示されない
    expect(document.body.textContent).not.toContain("横浜港防波堤");
    expect(document.body.textContent).not.toContain("東京港大橋");
  });
});

// ── (D) 未接続（デモ）は従来どおり ──────────────────────────────────────────

describe("task-10 (D) 未接続デモの回帰防止", () => {
  it("未接続なら /dashboard を投げず、モック表示のまま", async () => {
    render(<AppShell />);

    await waitFor(() =>
      expect(document.body.textContent).toContain(MOCK_SITES[0].shortName),
    );

    expect(dashboardCalls()).toBe(0);
    const mockOk = MOCK_SITES.filter((s) => s.status === "ok").length;
    const mockWarn = MOCK_SITES.filter((s) => s.status === "warn").length;
    const mockDanger = MOCK_SITES.filter((s) => s.status === "danger").length;
    expect(headerBadge("施工可")).toBe(String(mockOk));
    expect(headerBadge("注意")).toBe(String(mockWarn));
    expect(headerBadge("中止")).toBe(String(mockDanger));
    expect(statValue("管理現場数")).toBe(String(MOCK_SITES.length));
  });
});

// ── 地域フィルタ（task-12）──────────────────────────────────────────────────

describe("task-12 接続モードの地域フィルタ", () => {
  const AREA_TEST_SUMMARY: DashboardSummaryResponse = {
    ...DASHBOARD_SUMMARY,
    count: 5,
    sites: [
      ...DASHBOARD_SUMMARY.sites,
      summaryFor(UNKNOWN_ADDRESS_SITE, "go", "全しきい値を満たしています。施工可。"),
      summaryFor(KYUSHU_SITE, "caution", "風速が基準の 80% に接近 [caution]"),
    ],
  };

  async function renderConnected(): Promise<void> {
    installFetch({ sites: AREA_TEST_SITES, summary: AREA_TEST_SUMMARY });
    render(<DashboardPage navigate={navigate} />);
    await connectBackend();
    await waitFor(() => expect(visibleCardCount()).toBe(5));
  }

  it("address から導出した地域で絞り込める（関東 → 4 件 / 九州は除外）", async () => {
    await renderConnected();

    clickArea("関東");
    // 東京都 2 + 神奈川県 1 + 住所不明 1（常に表示）= 4、福岡県の 1 件は除外される
    expect(visibleCardCount()).toBe(4);
    expect(document.body.textContent).toContain("現場マップ — 関東");
    // カード一覧からは福岡県の現場が除外されている
    expect(cardTexts().some((t) => t.includes("博多港岸壁改良"))).toBe(false);
    expect(cardTexts().some((t) => t.includes("東京港臨海現場"))).toBe(true);
  });

  it("該当現場が存在する地域では 0 件にならない（九州 → 2 件）", async () => {
    await renderConnected();

    clickArea("九州");
    // 福岡県 1 + 住所不明 1 = 2
    expect(visibleCardCount()).toBe(2);
    expect(cardTexts().some((t) => t.includes("博多港岸壁改良"))).toBe(true);
  });

  it("住所が空の現場はどの地域を選んでも表示される（0 件を作らない）", async () => {
    await renderConnected();

    for (const region of ["北海道", "中部", "沖縄"]) {
      clickArea(region);
      // その地域の現場は無いが、住所不明の 1 件が表示されるので 0 件にはならない
      expect(visibleCardCount()).toBe(1);
      expect(cardTexts().some((t) => t.includes("住所未登録現場"))).toBe(true);
    }
  });
});
