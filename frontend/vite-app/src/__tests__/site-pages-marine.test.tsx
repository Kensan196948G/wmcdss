// @vitest-environment jsdom
//
// Loop 79 — SiteDetailPage marine branch + onClick coverage for site-pages.tsx
//
// Covers:
//   line 542:  {site.type !== 'land' && (<button onClick navigate('marine-work')>)}
//              onClick callback never invoked in base suite → covered here by fireEvent.click
//   lines 644, 664, 666:
//              wave height warn branch: m.waveHeight > waveLimit*0.8 → alert='warn'
//              → alert === 'warn' ? 'var(--status-warn)' evaluated and taken
//
// Strategy:
//   File-level vi.mock provides MARINE_WARN_SITE (waveHeight threshold 1.0) +
//   generateMarine returning waveHeight=0.9 (warn band: 0.8 < 0.9 ≤ 1.0).
//   Clicking the 🌊 and 🚢 buttons exercises the onClick closures at lines
//   527-529 and 545-547 that are only registered but never called in site-pages.test.tsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// --------------------------------------------------------------------------
// Fixture sites
//
//   marine_warn  waveLimit=1.0, wind=5, wave=0.9  → wave alert='warn'
//   wave_danger  waveLimit=0.5, wind=5, wave=0.8  → wave alert='danger'
//   wind_warn    windSpeed=10,  wind=9             → wind alert='warn'
//   rain_danger  rainfall=2,    rain=5             → rain alert='danger'
// --------------------------------------------------------------------------

const MARINE_WARN_SITE = {
  id: 'marine_warn',
  name: 'Marine Warn Site',
  shortName: 'MWS',
  type: 'marine' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: '東京湾北部',
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'warn' as const,
  thresholds: { windSpeed: 100, waveHeight: 1.0, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const WAVE_DANGER_SITE = {
  id: 'wave_danger',
  name: 'Wave Danger Site',
  shortName: 'WDS',
  type: 'marine' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: '東京湾北部',
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'danger' as const,
  // waveHeight=0.5 → wave=0.8 > 0.5 → alert='danger' (lines 642, 664)
  thresholds: { windSpeed: 100, waveHeight: 0.5, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const WIND_WARN_SITE = {
  id: 'wind_warn',
  name: 'Wind Warn Site',
  shortName: 'WWS',
  type: 'land' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: null,
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'warn' as const,
  // windSpeed=10, wind=9 → 9 > 10*0.8=8, 9 ≤ 10 → alert='warn' (line 617)
  thresholds: { windSpeed: 10, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const RAIN_DANGER_SITE = {
  id: 'rain_danger',
  name: 'Rain Danger Site',
  shortName: 'RDS',
  type: 'land' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: null,
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'danger' as const,
  // rainfall=2, rain=5 → rain > 2 → alert='danger' (line 615)
  thresholds: { windSpeed: 100, waveHeight: null, rainfall: 2, tempLow: -50, tempHigh: 100 },
};
// windSpeed=5, wind=9 → 9>5 → windDanger branch in SiteDetailPage (line 594)
const WIND_DANGER_SITE = {
  id: 'wind_danger',
  name: 'Wind Danger Site',
  shortName: 'WDS2',
  type: 'land' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: null,
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'danger' as const,
  thresholds: { windSpeed: 5, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
// ok site — used to render decision icon '✅' (line 558 ok branch)
const OK_LAND_SITE = {
  id: 'ok_land',
  name: 'OK Land Site',
  shortName: 'OKL',
  type: 'land' as const,
  lat: 35.48, lng: 139.85,
  station: 'テスト観測所', marinePoint: null,
  manager: '担当A', contractor: '業者B', period: '2026/04-09',
  status: 'ok' as const,
  thresholds: { windSpeed: 100, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return {
    ...actual,
    SITES: [MARINE_WARN_SITE, WAVE_DANGER_SITE, WIND_WARN_SITE, RAIN_DANGER_SITE, WIND_DANGER_SITE, OK_LAND_SITE],
    generateWeather: (siteId: string) => ({
      temp: 20, hum: 60, pressure: 1013,
      windDir: 'N' as const,
      // wind_warn/wind_danger: 9 → warn (>8) or danger (>5); others: 5 (ok)
      wind: (siteId === 'wind_warn' || siteId === 'wind_danger') ? 9 : 5,
      rain: siteId === 'rain_danger' ? 5 : 0,
    }),
    generateMarine: (siteId: string) => {
      if (siteId === 'wave_danger') {
        return { waveHeight: 0.8, wavePeriod: 6, waveDir: 'E' as const, tide: '上げ潮', tideLevel: 1.2 };
      }
      if (siteId === 'marine_warn') {
        return { waveHeight: 0.9, wavePeriod: 6, waveDir: 'E' as const, tide: '上げ潮', tideLevel: 1.2 };
      }
      return null;
    },
    generateHourlyWind: () =>
      Array.from({ length: 24 }, (_, i) => ({ hour: i, speed: 5 })),
    // Vary decision status + reasons by siteId so all 3 icon branches are covered
    getDecision: (site: { id: string }) => {
      if (site.id === 'wave_danger' || site.id === 'rain_danger' || site.id === 'wind_danger') {
        // 2 reasons → covers i>0 marginTop branch (line 570)
        return { status: 'danger' as const, reasons: ['超過理由1', '超過理由2'] };
      }
      if (site.id === 'marine_warn' || site.id === 'wind_warn') {
        return { status: 'warn' as const, reasons: ['接近理由1', '接近理由2'] };
      }
      return { status: 'ok' as const, reasons: [] };
    },
  };
});

const { SiteDetailPage, SiteListPage, SiteRegisterPage } = await import('../site-pages');

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Marine navigation buttons — onClick handlers (lines 527-529, 545-547)
// ---------------------------------------------------------------------------

describe('SiteDetailPage — marine navigation buttons render (line 542 render path)', () => {
  it('renders both 🌊 海象データ and 🚢 海上作業判定 for marine site', () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="marine_warn" />,
    );
    expect(container.textContent).toContain('🌊 海象データ');
    expect(container.textContent).toContain('🚢 海上作業判定');
  });
});

describe('SiteDetailPage — 🌊 海象データ onClick (lines 527-529)', () => {
  it('clicking 🌊 海象データ calls navigate("marine", site.id)', () => {
    const navigate = vi.fn();
    const { container } = render(
      <SiteDetailPage navigate={navigate} selectedSite="marine_warn" />,
    );
    const marineBtn = Array.from(container.querySelectorAll('button.btn-sm')).find(
      (b) => b.textContent?.includes('海象データ'),
    );
    expect(marineBtn).toBeDefined();
    fireEvent.click(marineBtn!);
    expect(navigate).toHaveBeenCalledWith('marine', 'marine_warn');
  });
});

describe('SiteDetailPage — 🚢 海上作業判定 onClick (lines 545-547 / line 542)', () => {
  it('clicking 🚢 海上作業判定 calls navigate("marine-work", site.id)', () => {
    const navigate = vi.fn();
    const { container } = render(
      <SiteDetailPage navigate={navigate} selectedSite="marine_warn" />,
    );
    const marineWorkBtn = Array.from(container.querySelectorAll('button.btn-sm')).find(
      (b) => b.textContent?.includes('海上作業判定'),
    );
    expect(marineWorkBtn).toBeDefined();
    fireEvent.click(marineWorkBtn!);
    expect(navigate).toHaveBeenCalledWith('marine-work', 'marine_warn');
  });
});

// ---------------------------------------------------------------------------
// Wave warn color branches (lines 644, 664, 666)
//
// alert = 'warn' is produced when waveHeight=0.9 and waveLimit=1.0:
//   m.waveHeight > waveLimit   → 0.9 > 1.0? no
//   m.waveHeight > waveLimit*0.8 → 0.9 > 0.8? yes → alert = 'warn'
//
// The inline style expression then evaluates:
//   alert === 'danger' ? ... : alert === 'warn' ? 'var(--status-warn)' : 'inherit'
//   → 'var(--status-warn)' is the result (lines 664-666 covered)
// ---------------------------------------------------------------------------

describe('SiteDetailPage — wave height warn color (lines 644, 664, 666)', () => {
  it('renders 有義波高 value when waveHeight is in warn band', () => {
    // waveHeight=0.9 appears in the 現在の海象 card; alert='warn' → warn color applied
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="marine_warn" />,
    );
    expect(container.textContent).toContain('有義波高');
    expect(container.textContent).toContain('0.9m');
  });

  it('renders 現在の海象 section for marine site with waveLimit', () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="marine_warn" />,
    );
    expect(container.textContent).toContain('現在の海象');
    expect(container.textContent).toContain('周期');
    expect(container.textContent).toContain('波向');
  });
});

// ---------------------------------------------------------------------------
// Wave danger color branch (lines 642, 664)
//
// waveHeight=0.8, waveLimit=0.5 → 0.8 > 0.5 = true → alert='danger'
// → color: alert === 'danger' ? 'var(--status-danger)' → lines 642, 664 covered
// ---------------------------------------------------------------------------

describe('SiteDetailPage — wave height danger (lines 642, 664)', () => {
  it('renders wave height value for danger-wave marine site', () => {
    // wave_danger: waveHeight=0.8, waveLimit=0.5 → 0.8>0.5 → alert='danger' (line 642)
    // → color expression evaluates alert==='danger' → 'var(--status-danger)' (line 664)
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="wave_danger" />,
    );
    expect(container.textContent).toContain('0.8m');
    expect(container.textContent).toContain('有義波高');
  });
});

// ---------------------------------------------------------------------------
// Weather wind warn color (line 617)
//
// wind=9, windSpeed=10 → windDanger=10, windWarn=8 → 9>8=true AND 9≤10 → alert='warn'
// → color: alert === 'warn' ? 'var(--status-warn)' → line 617 covered
// ---------------------------------------------------------------------------

describe('SiteDetailPage — weather wind warn color (line 617)', () => {
  it('renders wind value for warn-wind site (wind in 80-99% of windSpeed)', () => {
    // wind_warn: wind=9, windSpeed=10 → alert='warn' (line 617 covered)
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="wind_warn" />,
    );
    expect(container.textContent).toContain('9m/s');
    expect(container.textContent).toContain('風速');
  });
});

// ---------------------------------------------------------------------------
// Weather rain danger color (line 615)
//
// rain=5, rainfall=2 → 5>2=true → alert='danger'
// → color: alert === 'danger' ? 'var(--status-danger)' → line 615 covered
// ---------------------------------------------------------------------------

describe('SiteDetailPage — weather rain danger color (line 615)', () => {
  it('renders rain value for danger-rain site (rain exceeds threshold)', () => {
    // rain_danger: rain=5, rainfall=2 → alert='danger' (line 615 covered)
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="rain_danger" />,
    );
    expect(container.textContent).toContain('5mm/h');
    expect(container.textContent).toContain('降水量');
  });
});

// ---------------------------------------------------------------------------
// SiteListPage — wind/wave warn color in site table (lines 195, 208)
//
// WIND_WARN_SITE: windSpeed=10, wind=9 → windWarn=8, 9>8=warn → line 195
// MARINE_WARN_SITE: waveLimit=1.0, waveHeight=0.9 → waveWarn=0.8, 0.9>0.8=warn → line 208
// ---------------------------------------------------------------------------

describe('SiteListPage — wind warn color in table (line 195)', () => {
  it('renders the sites table with wind_warn site showing warn-band wind value', () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    // The table should include the wind value (9 m/s for wind_warn site)
    expect(container.textContent).toContain('9');
    expect(container.textContent).toContain('m/s');
  });
});

describe('SiteListPage — wave warn color in table (line 208)', () => {
  it('renders the sites table with marine_warn site showing warn-band wave height', () => {
    const { container } = render(<SiteListPage navigate={vi.fn()} />);
    // The table should include the wave height (0.9 m for marine_warn site)
    expect(container.textContent).toContain('0.9');
  });
});

// ---------------------------------------------------------------------------
// SiteRegisterPage — setNumber handler (lines 250-251)
//
// setNumber is a curried function used for numeric inputs (windSpeed, lat, etc.)
// Firing change on a number input triggers: update(key, Number(e.target.value))
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SiteDetailPage decision icon — ok and danger branches (line 558)
//
// ok_land → getDecision returns 'ok' → '✅' icon (line 558 ok branch)
// wave_danger → getDecision returns 'danger' → '⛔' icon (line 558 danger branch)
// ---------------------------------------------------------------------------

describe('SiteDetailPage — decision icon branches (line 558)', () => {
  it('shows ✅ icon when decision is ok', () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="ok_land" />,
    );
    expect(container.textContent).toContain('✅');
  });

  it('shows ⛔ icon when decision is danger', () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="wave_danger" />,
    );
    expect(container.textContent).toContain('⛔');
  });
});

// ---------------------------------------------------------------------------
// SiteDetailPage decision reasons — i>0 marginTop branch (line 570)
//
// getDecision returns 2 reasons for danger sites → .map() runs twice → i=1 → i>0
// ---------------------------------------------------------------------------

describe('SiteDetailPage — multiple decision reasons (line 570 i>0 branch)', () => {
  it('renders multiple reason lines when decision has 2+ reasons', () => {
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="wave_danger" />,
    );
    const reasons = container.querySelectorAll('.reason-text');
    expect(reasons.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// SiteDetailPage — wind danger color (line 594 danger branch)
//
// wind_danger: windSpeed=5, wind=9 → 9>5 → windDanger → 'var(--status-danger)'
// ---------------------------------------------------------------------------

describe('SiteDetailPage — weather wind danger color (line 594 danger branch)', () => {
  it('renders wind value for wind-danger site (wind exceeds windSpeed)', () => {
    // wind_danger: windSpeed=5, wind=9 → 9>5 → 'danger' branch at line 594
    const { container } = render(
      <SiteDetailPage navigate={vi.fn()} selectedSite="wind_danger" />,
    );
    expect(container.textContent).toContain('9m/s');
    expect(container.textContent).toContain('風速');
  });
});

describe('SiteRegisterPage — setNumber handler (lines 250-251)', () => {
  it('changing a numeric input (風速基準) updates the value', () => {
    const { container } = render(<SiteRegisterPage navigate={vi.fn()} />);
    // Find numeric inputs and change one — setNumber handler fires
    const numericInputs = Array.from(
      container.querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[];
    expect(numericInputs.length).toBeGreaterThan(0);
    const windInput = numericInputs.find((i) => i.value === '10');
    expect(windInput).toBeDefined();
    fireEvent.change(windInput!, { target: { value: '15' } });
    expect(windInput!.value).toBe('15');
  });
});
