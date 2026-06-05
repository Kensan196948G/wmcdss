// @vitest-environment jsdom
//
// Loop 78 — ConcretePage branch + function coverage for decisions.tsx
//
// Covers:
//   line 187: overallStatus = 'danger' branch — wind exceeds windSpeed threshold
//   line 189: overallStatus = 'warn' branch — wind in 80-99% of windSpeed threshold
//   ConcretePage onChange handler (function coverage — site selector change)
//   MarineWorkPage onChange handler (function coverage — site selector change)
//   lines 352-357: MarineWorkPage no-marine-sites early return
//
// Isolated vi.mock avoids leaking into decisions.test.tsx / decisions-branches.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// --------------------------------------------------------------------------
// Fixture sites
//
//   land_danger  windSpeed = 1,  generateWeather returns wind = 20
//                → getCheckStatus(20, 1) = 'danger' → overallStatus = 'danger'
//
//   land_warn    windSpeed = 10, generateWeather returns wind = 9
//                → getCheckStatus(9, 10): 9 > 10? no → 9 > 8? yes → 'warn'
//                → overallStatus = 'warn'
//
//   marine_a/b   waveHeight = 10 (loose), windSpeed = 100 (loose)
//                → used for MarineWorkPage onChange test
// --------------------------------------------------------------------------

const LAND_DANGER = {
  id: 'land_danger', name: 'Danger Land', shortName: 'DG',
  type: 'land' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: null,
  manager: '—', contractor: '—', period: '—',
  status: 'danger' as const,
  thresholds: { windSpeed: 1, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const LAND_WARN = {
  id: 'land_warn', name: 'Warn Land', shortName: 'WN',
  type: 'land' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: null,
  manager: '—', contractor: '—', period: '—',
  status: 'warn' as const,
  thresholds: { windSpeed: 10, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const MARINE_A = {
  id: 'marine_a', name: 'Marine A', shortName: 'MA',
  type: 'marine' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: '東京湾',
  manager: '—', contractor: '—', period: '—',
  status: 'ok' as const,
  thresholds: { windSpeed: 100, waveHeight: 10, rainfall: 100, tempLow: -50, tempHigh: 100 },
};
const MARINE_B = {
  id: 'marine_b', name: 'Marine B', shortName: 'MB',
  type: 'marine' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: '東京湾',
  manager: '—', contractor: '—', period: '—',
  status: 'ok' as const,
  thresholds: { windSpeed: 100, waveHeight: 10, rainfall: 100, tempLow: -50, tempHigh: 100 },
};

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return {
    ...actual,
    SITES: [LAND_DANGER, LAND_WARN, MARINE_A, MARINE_B],
    generateWeather: (siteId: string) => ({
      temp: 20,
      hum: 60,
      pressure: 1013,
      // land_danger → wind=20 (> windSpeed=1 → danger)
      // others      → wind=9  (> 10*0.8=8 AND ≤ 10 → warn for land_warn)
      wind: siteId === 'land_danger' ? 20 : 9,
      windDir: 'N' as const,
      rain: 0,
    }),
    generateMarine: () => ({
      waveHeight: 0.5, wavePeriod: 6, waveDir: 'E' as const,
      tide: '上げ潮', tideLevel: 1.2,
    }),
    getDecision: () => ({ status: 'ok' as const, reasons: [] }),
    generateHourlyWave: () =>
      Array.from({ length: 24 }, (_, i) => ({ hour: i, height: 0.5 })),
  };
});

const { ConcretePage, MarineWorkPage } = await import('../decisions');

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ConcretePage — overallStatus 'danger' branch (line 187)
// ---------------------------------------------------------------------------

describe('ConcretePage — overallStatus danger (line 187)', () => {
  it('shows 中止推奨 heading when at least one check exceeds threshold', () => {
    // land_danger: windSpeed=1, wind=20 → getCheckStatus(20,1)='danger'
    // → overallStatus = 'danger' (line 187 branch taken)
    const { container } = render(<ConcretePage selectedSite="land_danger" />);
    expect(container.textContent).toContain('中止推奨');
  });

  it('renders the danger recommendation text (recommendations.danger)', () => {
    const { container } = render(<ConcretePage selectedSite="land_danger" />);
    expect(container.textContent).toContain('コンクリート打設を中止し');
  });
});

// ---------------------------------------------------------------------------
// ConcretePage — overallStatus 'warn' branch (line 189)
// ---------------------------------------------------------------------------

describe('ConcretePage — overallStatus warn (line 189)', () => {
  it('shows 注意 heading when checks are in the warn band', () => {
    // land_warn: windSpeed=10, wind=9 → 9>10*0.8=8 AND 9≤10 → 'warn'
    // → overallStatus = 'warn' (line 189 branch taken)
    const { container } = render(<ConcretePage selectedSite="land_warn" />);
    expect(container.textContent).toContain('注意');
  });

  it('renders the warn recommendation text (recommendations.warn)', () => {
    const { container } = render(<ConcretePage selectedSite="land_warn" />);
    expect(container.textContent).toContain('一部の気象条件が基準値に接近しています');
  });
});

// ---------------------------------------------------------------------------
// ConcretePage — onChange handler (function coverage)
// ---------------------------------------------------------------------------

describe('ConcretePage — onChange handler', () => {
  it('selecting a different site updates the form-select value', () => {
    const { container } = render(<ConcretePage selectedSite="land_danger" />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe('land_danger');
    fireEvent.change(select, { target: { value: 'land_warn' } });
    // After onChange, React re-renders → new siteId → select reflects updated value
    expect(select.value).toBe('land_warn');
  });
});

// ---------------------------------------------------------------------------
// MarineWorkPage — onChange handler (function coverage)
// ---------------------------------------------------------------------------

describe('MarineWorkPage — onChange handler', () => {
  it('selecting a different marine site updates the form-select value', () => {
    const { container } = render(<MarineWorkPage selectedSite="marine_a" />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe('marine_a');
    fireEvent.change(select, { target: { value: 'marine_b' } });
    expect(select.value).toBe('marine_b');
  });
});

// ---------------------------------------------------------------------------
// ConcretePage — temperature danger/warn branches (lines 159, 161, 171, 173)
//
// The file-level mock returns temp=20 with wide thresholds so the temp checks
// always resolve to 'ok'. These vi.doMock sub-tests supply narrow thresholds
// and extreme temps to exercise each branch independently.
//
//   line 159: temp < tempLow → 'danger'       (e.g. temp=5,  tempLow=25)
//   line 161: temp < tempLow+2 → 'warn'       (e.g. temp=20, tempLow=19)
//   line 171: temp > tempHigh → 'danger'      (e.g. temp=35, tempHigh=10)
//   line 173: temp > tempHigh-3 → 'warn'      (e.g. temp=20, tempHigh=22)
// ---------------------------------------------------------------------------

const makeTempSite = (id: string, tempLow: number, tempHigh: number) => ({
  id, name: id, shortName: id.slice(0, 3).toUpperCase(),
  type: 'land' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: null,
  manager: '—', contractor: '—', period: '—',
  status: 'ok' as const,
  thresholds: { windSpeed: 100, waveHeight: null, rainfall: 100, tempLow, tempHigh },
});

describe('ConcretePage — temperature branches (lines 159, 161, 171, 173)', () => {
  it('line 159: temp < tempLow → danger (overallStatus danger, 中止推奨 shown)', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [makeTempSite('low_d', 25, 100)],
        // temp=5 < tempLow=25 → 'danger' on line 159
        generateWeather: () => ({ temp: 5, hum: 60, pressure: 1013, wind: 5, windDir: 'N' as const, rain: 0 }),
        getDecision: () => ({ status: 'danger' as const, reasons: [] }),
        generateHourlyWave: () => [],
      };
    });
    return import('../decisions').then(({ ConcretePage: CP }) => {
      const { container } = render(<CP selectedSite="low_d" />);
      expect(container.textContent).toContain('コンクリート打設を中止し');
      vi.doUnmock('../data');
    });
  });

  it('line 161: temp in [tempLow, tempLow+2) → warn (一部の気象条件が基準値に接近)', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [makeTempSite('low_w', 19, 100)],
        // temp=20: 20 < 19? no → 20 < 19+2=21? yes → 'warn' on line 161
        generateWeather: () => ({ temp: 20, hum: 60, pressure: 1013, wind: 5, windDir: 'N' as const, rain: 0 }),
        getDecision: () => ({ status: 'warn' as const, reasons: [] }),
        generateHourlyWave: () => [],
      };
    });
    return import('../decisions').then(({ ConcretePage: CP }) => {
      const { container } = render(<CP selectedSite="low_w" />);
      expect(container.textContent).toContain('一部の気象条件が基準値に接近しています');
      vi.doUnmock('../data');
    });
  });

  it('line 171: temp > tempHigh → danger (中止推奨 shown)', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [makeTempSite('high_d', -50, 10)],
        // temp=35 > tempHigh=10 → 'danger' on line 171
        generateWeather: () => ({ temp: 35, hum: 60, pressure: 1013, wind: 5, windDir: 'N' as const, rain: 0 }),
        getDecision: () => ({ status: 'danger' as const, reasons: [] }),
        generateHourlyWave: () => [],
      };
    });
    return import('../decisions').then(({ ConcretePage: CP }) => {
      const { container } = render(<CP selectedSite="high_d" />);
      expect(container.textContent).toContain('コンクリート打設を中止し');
      vi.doUnmock('../data');
    });
  });

  it('line 173: temp in (tempHigh-3, tempHigh] → warn (注意 shown)', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [makeTempSite('high_w', -50, 22)],
        // temp=20: 20 > 22? no → 20 > 22-3=19? yes → 'warn' on line 173
        generateWeather: () => ({ temp: 20, hum: 60, pressure: 1013, wind: 5, windDir: 'N' as const, rain: 0 }),
        getDecision: () => ({ status: 'warn' as const, reasons: [] }),
        generateHourlyWave: () => [],
      };
    });
    return import('../decisions').then(({ ConcretePage: CP }) => {
      const { container } = render(<CP selectedSite="high_w" />);
      expect(container.textContent).toContain('一部の気象条件が基準値に接近しています');
      vi.doUnmock('../data');
    });
  });
});

// ---------------------------------------------------------------------------
// MarineWorkPage — no-marine-sites early return (lines 352-357)
// ---------------------------------------------------------------------------
//
// Uses vi.doMock to override the file-level mock with a land-only SITES array.
// marineSites = SITES.filter(s => s.type !== 'land') → []
// → site is undefined → the early-return block (lines 352-357) is hit.

describe('MarineWorkPage — no-marine-sites fallback (lines 352-357)', () => {
  it('renders fallback message when SITES contains no marine entries', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [LAND_DANGER, LAND_WARN],
        generateWeather: () => ({
          temp: 20, hum: 60, pressure: 1013, wind: 5,
          windDir: 'N' as const, rain: 0,
        }),
        generateMarine: () => null,
        getDecision: () => ({ status: 'ok' as const, reasons: [] }),
        generateHourlyWave: () => [],
      };
    });
    return import('../decisions').then(({ MarineWorkPage: MWP }) => {
      const { container } = render(<MWP />);
      expect(container.textContent).toContain('海上工事現場がありません');
      vi.doUnmock('../data');
    });
  });
});
