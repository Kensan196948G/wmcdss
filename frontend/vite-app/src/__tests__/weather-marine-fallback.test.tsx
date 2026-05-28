// @vitest-environment jsdom
//
// Loop 72 — fallback branch coverage for weather-marine.tsx MarinePage.
//
// MarinePage has two defensive fallbacks at line 343-360:
//   1. `if (!site || !m) return <...海象データのある現場がありません...>`
//   2. `if (waveLimit === null) return <...海象データのある現場がありません...>`
//
// Neither is reachable with the real SITES fixture (every marine site has a
// numeric waveHeight threshold). vi.mock the data module per-file to drive
// both branches and pin the user-facing fallback copy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Case 1: no marine sites at all → marineSites is empty → !site
// ---------------------------------------------------------------------------

describe("MarinePage fallback — no marine sites", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../data")>();
      return {
        ...actual,
        SITES: [
          {
            id: "land-only",
            name: "Land Only",
            shortName: "LO",
            type: "land" as const,
            lat: 35.6,
            lng: 139.7,
            station: "東京",
            marinePoint: null,
            manager: "—",
            contractor: "—",
            period: "—",
            status: "ok" as const,
            thresholds: {
              windSpeed: 10,
              waveHeight: null,
              rainfall: 5,
              tempLow: 0,
              tempHigh: 40,
            },
          },
        ],
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("../data");
  });

  it("renders the fallback copy when no marine sites exist", async () => {
    const { MarinePage } = await import("../weather-marine");
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain("海象データのある現場がありません");
  });
});

// ---------------------------------------------------------------------------
// Case 2: marine site exists but waveHeight=null → waveLimit === null
// ---------------------------------------------------------------------------

describe("MarinePage fallback — marine site with null waveHeight threshold", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../data", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../data")>();
      return {
        ...actual,
        SITES: [
          {
            id: "marine-no-wave",
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
              waveHeight: null, // <-- triggers the second fallback
              rainfall: 5,
              tempLow: 0,
              tempHigh: 40,
            },
          },
        ],
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("../data");
  });

  it("renders the fallback copy when waveLimit is null", async () => {
    const { MarinePage } = await import("../weather-marine");
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain("海象データのある現場がありません");
  });
});
