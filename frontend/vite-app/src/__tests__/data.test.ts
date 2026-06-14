import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  TYPE_LABEL,
  SITES,
  getDecision,
  generateWeather,
  generateMarine,
  generateHourlyWind,
  generateHourlyWave,
  generateHistoricalMonthly,
  FORECAST_DAYS,
  WEATHER_ICONS,
  AUDIT_LOG,
  ETL_JOBS,
  type Site,
  type SiteThresholds,
} from "../data";

function synthSite(id: string, thresholds: SiteThresholds): Site {
  return {
    id,
    name: "Synthetic Test Site",
    shortName: "Synth",
    type: "marine",
    lat: 0,
    lng: 0,
    station: "Test",
    marinePoint: "Test",
    status: "ok",
    manager: "Test",
    contractor: "Test",
    period: "2025/01/01 〜 2027/12/31",
    thresholds,
  };
}

describe("STATUS_LABEL", () => {
  it("ok → 施工可", () => {
    expect(STATUS_LABEL.ok).toBe("施工可");
  });
  it("warn → 注意", () => {
    expect(STATUS_LABEL.warn).toBe("注意");
  });
  it("danger → 中止推奨", () => {
    expect(STATUS_LABEL.danger).toBe("中止推奨");
  });
});

describe("STATUS_CLASS", () => {
  it("maps each Status to the expected CSS class", () => {
    expect(STATUS_CLASS.ok).toBe("badge-ok");
    expect(STATUS_CLASS.warn).toBe("badge-warn");
    expect(STATUS_CLASS.danger).toBe("badge-danger");
  });
});

describe("TYPE_LABEL", () => {
  it("maps each SiteKind to the expected Japanese label", () => {
    expect(TYPE_LABEL.land).toBe("陸上");
    expect(TYPE_LABEL.marine).toBe("海上");
    expect(TYPE_LABEL.both).toBe("陸上＋海上");
  });
});

describe("getDecision", () => {
  // site-01: wind=4.2 (<10), rain=0 (<5), temp=22.4 (>5), wave=0.8 (<1.5) → all clear
  it("returns ok when all metrics are within thresholds (site-01)", () => {
    const site = SITES.find((s) => s.id === "site-01")!;
    const result = getDecision(site);
    expect(result.status).toBe("ok");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("全項目が基準値内");
  });

  // site-02: wave=1.3 > limit 1.2 → danger due to wave exceedance
  it("returns danger when wave height exceeds threshold (site-02)", () => {
    const site = SITES.find((s) => s.id === "site-02")!;
    const result = getDecision(site);
    expect(result.status).toBe("danger");
    expect(result.reasons.some((r) => r.includes("有義波高"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("超過"))).toBe(true);
  });

  // site-04: wind=12.4 > 8, rain=8.5 > 3, wave=2.1 > 1.0 → danger with 3 reasons
  it("returns danger with multiple reasons when several thresholds are exceeded (site-04)", () => {
    const site = SITES.find((s) => s.id === "site-04")!;
    const result = getDecision(site);
    expect(result.status).toBe("danger");
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some((r) => r.includes("風速"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("降水量"))).toBe(true);
    expect(result.reasons.some((r) => r.includes("有義波高"))).toBe(true);
  });

  // site-06: land site (waveHeight: null), wind=2.8 (<15), rain=0, temp=23 → all clear, no wave check
  it("returns ok for a land site and skips wave check (site-06)", () => {
    const site = SITES.find((s) => s.id === "site-06")!;
    expect(site.thresholds.waveHeight).toBeNull();
    const result = getDecision(site);
    expect(result.status).toBe("ok");
    expect(result.reasons.every((r) => !r.includes("有義波高"))).toBe(true);
  });

  // Ensure DecisionResult always has at least one reason string
  it("always returns at least one reason", () => {
    for (const site of SITES) {
      const result = getDecision(site);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  // site-05: wind=9.6 > 8 (danger) and wave=1.5 > 1.0 (danger) — verify wind message
  it("includes wind speed in reasons when wind exceeds threshold (site-05)", () => {
    const site = SITES.find((s) => s.id === "site-05")!;
    const result = getDecision(site);
    expect(result.status).toBe("danger");
    expect(
      result.reasons.some((r) => r.includes("風速") && r.includes("超過")),
    ).toBe(true);
  });

  // Wind warn branch: site-02 weather (wind=7.8), windSpeed=9 → 7.8 > 7.2 (80%) but < 9
  it("returns warn when wind is in 80%–100% of threshold", () => {
    const site = synthSite("site-02", {
      windSpeed: 9,
      waveHeight: 2.0,
      rainfall: 5,
      tempLow: 5,
      tempHigh: 35,
    });
    const result = getDecision(site);
    expect(result.status).toBe("warn");
    expect(
      result.reasons.some((r) => r.includes("風速") && r.includes("接近")),
    ).toBe(true);
  });

  // Temp warn branch: site-01 weather (temp=22.4), tempLow=25 → 22.4 < 25 → warn
  it("returns warn when temperature is below tempLow threshold", () => {
    const site = synthSite("site-01", {
      windSpeed: 10,
      waveHeight: null,
      rainfall: 5,
      tempLow: 25,
      tempHigh: 35,
    });
    const result = getDecision(site);
    expect(result.status).toBe("warn");
    expect(
      result.reasons.some((r) => r.includes("気温") && r.includes("下回")),
    ).toBe(true);
  });

  // Wave warn branch: site-01 marine (wave=0.8), waveHeight=0.9 → 0.8 > 0.72 (80%) but < 0.9
  it("returns warn when wave height is in 80%–100% of threshold", () => {
    const site = synthSite("site-01", {
      windSpeed: 10,
      waveHeight: 0.9,
      rainfall: 5,
      tempLow: 5,
      tempHigh: 35,
    });
    const result = getDecision(site);
    expect(result.status).toBe("warn");
    expect(
      result.reasons.some((r) => r.includes("有義波高") && r.includes("接近")),
    ).toBe(true);
  });
});

describe("generateWeather", () => {
  it("returns a WeatherSample for a known site id", () => {
    const w = generateWeather("site-01");
    expect(typeof w.temp).toBe("number");
    expect(typeof w.wind).toBe("number");
    expect(typeof w.rain).toBe("number");
    expect(typeof w.hum).toBe("number");
  });

  it("falls back to site-01 data for an unknown site id", () => {
    const fallback = generateWeather("site-01");
    const unknown = generateWeather("site-unknown-xyz");
    expect(unknown).toEqual(fallback);
  });
});

describe("generateMarine", () => {
  it("returns a MarineSample for a known marine site id", () => {
    const m = generateMarine("site-01");
    expect(m).not.toBeNull();
    expect(typeof m!.waveHeight).toBe("number");
    expect(typeof m!.wavePeriod).toBe("number");
  });

  it("returns null for an unknown site id", () => {
    expect(generateMarine("site-unknown-xyz")).toBeNull();
  });
});

describe("generateHourlyWind", () => {
  it("returns exactly 24 data points", () => {
    expect(generateHourlyWind()).toHaveLength(24);
  });

  it("assigns sequential hour indices 0–23", () => {
    const pts = generateHourlyWind();
    pts.forEach((p, i) => expect(p.hour).toBe(i));
  });

  it("speed values are finite numbers", () => {
    generateHourlyWind().forEach((p) => {
      expect(typeof p.speed).toBe("number");
      expect(isFinite(p.speed)).toBe(true);
    });
  });
});

describe("generateHourlyWave", () => {
  it("returns exactly 24 data points", () => {
    expect(generateHourlyWave()).toHaveLength(24);
  });

  it("assigns sequential hour indices 0–23", () => {
    const pts = generateHourlyWave();
    pts.forEach((p, i) => expect(p.hour).toBe(i));
  });

  it("height values are finite numbers", () => {
    generateHourlyWave().forEach((p) => {
      expect(typeof p.height).toBe("number");
      expect(isFinite(p.height)).toBe(true);
    });
  });
});

describe("generateHistoricalMonthly", () => {
  it("returns exactly 12 months", () => {
    expect(generateHistoricalMonthly()).toHaveLength(12);
  });

  it("month labels run from 1月 to 12月", () => {
    const months = generateHistoricalMonthly();
    expect(months[0].month).toBe("1月");
    expect(months[11].month).toBe("12月");
  });

  it("numeric fields are finite numbers", () => {
    generateHistoricalMonthly().forEach((m) => {
      expect(isFinite(m.avgWind)).toBe(true);
      expect(isFinite(m.maxWind)).toBe(true);
      expect(isFinite(m.avgWave)).toBe(true);
      expect(isFinite(m.maxWave)).toBe(true);
      expect(isFinite(m.rainDays)).toBe(true);
      expect(isFinite(m.totalRain)).toBe(true);
    });
  });
});

describe("FORECAST_DAYS", () => {
  it("contains 7 forecast days", () => {
    expect(FORECAST_DAYS).toHaveLength(7);
  });

  it("each entry has required fields", () => {
    FORECAST_DAYS.forEach((d) => {
      expect(typeof d.date).toBe("string");
      expect(typeof d.tempH).toBe("number");
      expect(typeof d.tempL).toBe("number");
      expect(typeof d.rain).toBe("number");
      expect(typeof d.wind).toBe("number");
    });
  });
});

describe("WEATHER_ICONS", () => {
  it("maps all four WeatherKind values to emoji strings", () => {
    expect(WEATHER_ICONS["晴れ"]).toBeTruthy();
    expect(WEATHER_ICONS["曇り"]).toBeTruthy();
    expect(WEATHER_ICONS["雨"]).toBeTruthy();
    expect(WEATHER_ICONS["雪"]).toBeTruthy();
  });
});

describe("AUDIT_LOG", () => {
  it("contains 57 entries", () => {
    expect(AUDIT_LOG).toHaveLength(57);
  });

  it("each entry has id, time, user, action, target, detail", () => {
    AUDIT_LOG.forEach((e) => {
      expect(typeof e.id).toBe("number");
      expect(typeof e.time).toBe("string");
      expect(typeof e.user).toBe("string");
      expect(typeof e.action).toBe("string");
      expect(typeof e.target).toBe("string");
      expect(typeof e.detail).toBe("string");
    });
  });
});

describe("ETL_JOBS", () => {
  it("contains 6 jobs", () => {
    expect(ETL_JOBS).toHaveLength(6);
  });

  it("each job has id, name, schedule, lastRun, status, records", () => {
    ETL_JOBS.forEach((j) => {
      expect(typeof j.id).toBe("number");
      expect(typeof j.name).toBe("string");
      expect(typeof j.schedule).toBe("string");
      expect(typeof j.lastRun).toBe("string");
      expect(["ok", "warn", "danger"]).toContain(j.status);
      expect(typeof j.records).toBe("number");
    });
  });
});
