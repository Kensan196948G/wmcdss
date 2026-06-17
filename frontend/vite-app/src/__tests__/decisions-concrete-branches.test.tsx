// @vitest-environment jsdom
//
// ConcretePage + MarineWorkPage branch coverage for decisions.tsx
//
// Targets:
//   line 414: w.temp >= 15 → '5日以上' (outer-true) — already covered by decisions.test.tsx
//             w.temp >= 10 (10≤temp<15) → '7日以上'  ← NEW
//             w.temp < 10               → '9日以上'  ← NEW
//   line 418: w.temp >= 30 → '必要（散水養生・遮光シート推奨）' ← NEW
//   line 422: w.temp < 5  → '必要（保温養生・給熱推奨）'       ← NEW (temp=3 covers both 414+'9日以上' and 422 true)
//   line 555: w.rain > site.thresholds.rainfall → 'danger' (rain danger) ← NEW
//
// Isolation: this file uses vi.doMock per test and does NOT have a top-level vi.mock,
// so it does not interfere with decisions-branches.test.tsx.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// ConcretePage — nested ternary temp branches (line 414)
// ---------------------------------------------------------------------------

describe('ConcretePage — temp < 10 → 9日以上 (line 414 inner-false) + 保温養生 (line 422 true)', () => {
  it('renders 9日以上 and 保温養生 when temp=3', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        generateWeather: () => ({
          temp: 3, hum: 60, pressure: 1013,
          wind: 2, windDir: 'N' as const, rain: 0,
        }),
        getDecision: () => ({ status: 'ok' as const, reasons: [] }),
      };
    });
    return import('../decisions').then(({ ConcretePage }) => {
      const { container } = render(<ConcretePage />);
      // line 414: temp=3 < 10 → '9日以上'
      expect(container.textContent).toContain('9日以上');
      // line 422: temp=3 < 5 → '必要（保温養生・給熱推奨）'
      expect(container.textContent).toContain('必要（保温養生・給熱推奨）');
      vi.doUnmock('../data');
    });
  });
});

describe('ConcretePage — 10 ≤ temp < 15 → 7日以上 (line 414 inner-true)', () => {
  it('renders 7日以上 when temp=12', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        generateWeather: () => ({
          temp: 12, hum: 60, pressure: 1013,
          wind: 2, windDir: 'N' as const, rain: 0,
        }),
        getDecision: () => ({ status: 'ok' as const, reasons: [] }),
      };
    });
    return import('../decisions').then(({ ConcretePage }) => {
      const { container } = render(<ConcretePage />);
      // line 414: temp=12, 12 >= 15? no → 12 >= 10? yes → '7日以上'
      expect(container.textContent).toContain('7日以上');
      vi.doUnmock('../data');
    });
  });
});

describe('ConcretePage — temp >= 30 → 散水養生 (line 418 true)', () => {
  it('renders 散水養生 when temp=35', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        generateWeather: () => ({
          temp: 35, hum: 40, pressure: 1013,
          wind: 2, windDir: 'N' as const, rain: 0,
        }),
        getDecision: () => ({ status: 'ok' as const, reasons: [] }),
      };
    });
    return import('../decisions').then(({ ConcretePage }) => {
      const { container } = render(<ConcretePage />);
      // line 418: temp=35 >= 30 → '必要（散水養生・遮光シート推奨）'
      expect(container.textContent).toContain('必要（散水養生・遮光シート推奨）');
      vi.doUnmock('../data');
    });
  });
});

// ---------------------------------------------------------------------------
// MarineWorkPage — rain danger branch (line 555)
//
// marineChecks includes:
//   { label: '降水量', status: w.rain > site.thresholds.rainfall ? 'danger' : 'ok' }
// Need w.rain > rainfall to exercise the 'danger' true branch.
// ---------------------------------------------------------------------------

describe('MarineWorkPage — rain > rainfall threshold → danger (line 555)', () => {
  it('renders 中止推奨 badge in the rain row when rain exceeds threshold', () => {
    vi.resetModules();
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../data')>();
      return {
        ...actual,
        SITES: [
          {
            id: 'marine_rain_danger',
            name: 'Marine Rain Danger',
            shortName: 'MRD',
            type: 'marine' as const,
            lat: 35.6, lng: 139.7,
            station: '東京', marinePoint: '東京湾北部',
            manager: '—', contractor: '—', period: '—',
            status: 'danger' as const,
            thresholds: {
              windSpeed: 100,
              waveHeight: 20,
              rainfall: 5,   // low threshold so rain=20 exceeds it
              tempLow: -50,
              tempHigh: 100,
            },
          },
        ],
        generateWeather: () => ({
          temp: 20, hum: 80, pressure: 1010,
          wind: 2, windDir: 'N' as const,
          rain: 20, // > rainfall=5 → 'danger' at line 555
        }),
        generateMarine: () => ({
          waveHeight: 0.2,
          wavePeriod: 5,
          waveDir: 'E' as const,
          tide: '上げ潮',
          tideLevel: 1.0,
        }),
        getDecision: () => ({ status: 'danger' as const, reasons: ['降水量超過'] }),
      };
    });
    return import('../decisions').then(({ MarineWorkPage }) => {
      const { container } = render(<MarineWorkPage selectedSite="marine_rain_danger" />);
      // The rain danger branch yields status='danger' → CheckItem renders '中止推奨' badge
      expect(container.textContent).toContain('中止推奨');
      vi.doUnmock('../data');
    });
  });
});
