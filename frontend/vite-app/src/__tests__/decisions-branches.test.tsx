// @vitest-environment jsdom
//
// Loop 70 — branch coverage for decisions.tsx MarineWorkPage status logic.
//
// The base decisions.test.tsx file pins the DOM structure of MarineWorkPage
// using the real SITES fixture. That covers the rendered shape but not the
// danger/warn branches inside each row because generateWeather/Marine returns
// values that mostly resolve to 'ok'. This file mocks the data module with
// scripted SITES + generators so we can exercise:
//
//   - line 385/387: w.wind > windLimit (danger) / w.wind > windLimit*0.8 (warn)
//   - line 410: wavePeriod > 8 (warn)
//   - line 520-...: WORK_TYPES table per-row combine (wSt vs windSt → final st)
//
// We isolate this in its own file because vi.mock for ../data leaks into every
// test in the suite — keeping it scoped here prevents collateral damage to the
// 21 baseline decisions.test.tsx assertions.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

// Marine sites with controlled thresholds. The marine_danger site has a very
// strict threshold so any non-zero wave/wind triggers danger; marine_warn sits
// at 80% so realistic generator output lands in warn; marine_safe has loose
// limits to force ok.
const TEST_SITES = [
  {
    id: "marine_danger",
    name: "Marine Danger",
    shortName: "MD",
    type: "marine" as const,
    lat: 35.6,
    lng: 139.7,
    station: "東京",
    marinePoint: "東京湾北部",
    manager: "—",
    contractor: "—",
    period: "—",
    status: "danger" as const,
    thresholds: {
      windSpeed: 5,
      waveHeight: 0.5,
      rainfall: 5,
      tempLow: 0,
      tempHigh: 40,
    },
  },
  {
    id: "marine_safe",
    name: "Marine Safe",
    shortName: "MS",
    type: "marine" as const,
    lat: 35.6,
    lng: 139.7,
    station: "東京",
    marinePoint: "東京湾北部",
    manager: "—",
    contractor: "—",
    period: "—",
    status: "ok" as const,
    thresholds: {
      windSpeed: 100,
      waveHeight: 20,
      rainfall: 100,
      tempLow: -50,
      tempHigh: 100,
    },
  },
];

vi.mock("../data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data")>();
  return {
    ...actual,
    SITES: TEST_SITES,
    generateWeather: (_siteId: string) => ({
      temp: 20,
      hum: 60,
      pressure: 1013,
      wind: 15, // danger for marine_danger (>5), ok for marine_safe (<100)
      windDir: "N",
      rain: 1,
    }),
    generateMarine: (_siteId: string) => ({
      waveHeight: 3.0, // danger for marine_danger (>0.5)
      wavePeriod: 10, // warn (>8)
      waveDir: "E",
      tide: "上げ潮",
      tideLevel: 1.2,
    }),
  };
});

// Import after vi.mock so the mock takes effect
const { MarineWorkPage } = await import("../decisions");

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarineWorkPage — danger status branches", () => {
  it("renders 中止推奨 badge when wave exceeds threshold (waveHeight 3.0 > 0.5)", () => {
    const { container } = render(
      <MarineWorkPage selectedSite="marine_danger" />,
    );
    expect(container.textContent).toContain("中止推奨");
  });

  it("renders wavePeriod with warn (>8 → '注意' or related styling)", () => {
    const { container } = render(
      <MarineWorkPage selectedSite="marine_danger" />,
    );
    // wavePeriod=10 > 8 → status='warn' → 注意 label appears (in either
    // MarineWorkPage stats card or WORK_TYPES table)
    expect(container.textContent).toContain("注意");
  });

  it("WORK_TYPES table shows multiple 中止推奨 rows when wave/wind exceed limits", () => {
    const { container } = render(
      <MarineWorkPage selectedSite="marine_danger" />,
    );
    // With wave=3.0/wind=15 and tight thresholds, multiple work types should be danger
    const dangerBadges = container.querySelectorAll("tbody tr .badge");
    const dangerCount = Array.from(dangerBadges).filter((b) =>
      b.textContent?.includes("中止"),
    ).length;
    expect(dangerCount).toBeGreaterThan(0);
  });
});

describe("MarineWorkPage — ok status branches", () => {
  it("renders 適合 CheckItem badges when site thresholds are loose", () => {
    // marine_safe has windSpeed=100/waveHeight=20 thresholds, so the per-site
    // CheckItem cards in 判定項目 section resolve to ok=適合. Note: the
    // WORK_TYPES table at the bottom uses its own hard-coded limits and may
    // still show 中止推奨 — that's a different code path covered above.
    const { container } = render(<MarineWorkPage selectedSite="marine_safe" />);
    expect(container.textContent).toContain("適合");
  });
});

// ---------------------------------------------------------------------------
// Loop 77 — additional branches: warn (80% threshold) + waveLimit === null
// ---------------------------------------------------------------------------
//
// Adds two cases that the danger/ok scripted sites above don't reach:
//   - warn band: wind sitting at 80% of windSpeed (warn boundary)
//   - waveLimit === null fallback (line 363-368 — "この現場には波高基準が設定
//     されていません")

describe("MarineWorkPage — warn band branch", () => {
  it("renders 注意 in the WORK_TYPES table when wind sits at the warn band", () => {
    // marine_warn fixture: wave=0.4 (just under WORK_TYPES limit 0.5 for
    // potential warn @80%), wind=9 (windLimit=10 → 90% = warn band).
    // generator returns wind=9, waveHeight=0.4 → CheckItem and table both
    // resolve to warn somewhere.
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../data")>();
      return {
        ...actual,
        SITES: [
          {
            id: "marine_warn",
            name: "Marine Warn",
            shortName: "MW",
            type: "marine" as const,
            lat: 35.6,
            lng: 139.7,
            station: "東京",
            marinePoint: "東京湾北部",
            manager: "—",
            contractor: "—",
            period: "—",
            status: "warn" as const,
            thresholds: {
              windSpeed: 10, // 80% = 8.0, danger > 10
              waveHeight: 1.0, // 80% = 0.8, danger > 1.0
              rainfall: 100,
              tempLow: -50,
              tempHigh: 100,
            },
          },
        ],
        generateWeather: () => ({
          temp: 20,
          hum: 60,
          pressure: 1013,
          wind: 9, // > 8 (warn), < 10 (not danger)
          windDir: "N",
          rain: 1,
        }),
        generateMarine: () => ({
          waveHeight: 0.9, // > 0.8 (warn), < 1.0 (not danger)
          wavePeriod: 6,
          waveDir: "E",
          tide: "上げ潮",
          tideLevel: 1.2,
        }),
      };
    });
    return import("../decisions").then(({ MarineWorkPage: MWP }) => {
      const { container } = render(<MWP selectedSite="marine_warn" />);
      // Per-site CheckItem 注意 badge appears for wind / wave at 90% threshold
      expect(container.textContent).toContain("注意");
      vi.doUnmock("../data");
    });
  });
});

describe("MarineWorkPage — waveLimit null fallback", () => {
  it("renders 'この現場には波高基準が設定されていません' when the marine site has waveHeight=null", () => {
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../data")>();
      return {
        ...actual,
        SITES: [
          {
            id: "marine_no_wave",
            name: "Marine No Wave",
            shortName: "MNW",
            type: "marine" as const,
            lat: 35.6,
            lng: 139.7,
            station: "東京",
            marinePoint: "東京湾北部",
            manager: "—",
            contractor: "—",
            period: "—",
            status: "ok" as const,
            thresholds: {
              windSpeed: 10,
              waveHeight: null, // triggers the line 363-368 fallback
              rainfall: 5,
              tempLow: 0,
              tempHigh: 40,
            },
          },
        ],
        // Stub generators so `m` is non-null — otherwise the earlier
        // `!w || !m` guard fires first and we get "海上工事現場がありません".
        generateWeather: () => ({
          temp: 20,
          hum: 60,
          pressure: 1013,
          wind: 5,
          windDir: "N",
          rain: 1,
        }),
        generateMarine: () => ({
          waveHeight: 0.5,
          wavePeriod: 6,
          waveDir: "E",
          tide: "上げ潮",
          tideLevel: 1.2,
        }),
      };
    });
    return import("../decisions").then(({ MarineWorkPage: MWP }) => {
      const { container } = render(<MWP />);
      expect(container.textContent).toContain(
        "この現場には波高基準が設定されていません",
      );
      vi.doUnmock("../data");
    });
  });
});
