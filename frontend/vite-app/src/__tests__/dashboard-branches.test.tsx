// @vitest-environment jsdom
//
// Loop 78 — dashboard.tsx branch + function coverage
//
// Covers:
//   line 132: wind warn color — w.wind in 80-99% of site.thresholds.windSpeed
//   line 141: wave warn color — m.waveHeight in 80-99% of waveLimit
//   setTimeout invalidateSize callback inside MapView first useEffect
//   DashboardPage navigate callbacks (function coverage)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// --------------------------------------------------------------------------
// Fixture sites
//
//   warn_wind  windSpeed = 10, generateWeather returns wind = 9
//              → 9 > 10 = false (not danger), 9 > 8 = true → 'var(--status-warn)'
//              → line 132 covered
//
//   warn_wave  waveHeight = 1.0, generateMarine returns waveHeight = 0.9
//              → 0.9 > 1.0 = false (not danger), 0.9 > 0.8 = true → 'var(--status-warn)'
//              → line 141 covered
// --------------------------------------------------------------------------

const WARN_WIND_SITE = {
  id: 'warn_wind', name: 'Warn Wind', shortName: 'WW',
  type: 'land' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: null,
  manager: '—', contractor: '—', period: '—',
  status: 'warn' as const,
  thresholds: { windSpeed: 10, waveHeight: null, rainfall: 100, tempLow: -50, tempHigh: 100 },
};

const WARN_WAVE_SITE = {
  id: 'warn_wave', name: 'Warn Wave', shortName: 'WWv',
  type: 'marine' as const,
  lat: 35.0, lng: 139.0, station: 'テスト', marinePoint: '東京湾',
  manager: '—', contractor: '—', period: '—',
  status: 'warn' as const,
  thresholds: { windSpeed: 100, waveHeight: 1.0, rainfall: 100, tempLow: -50, tempHigh: 100 },
};

vi.mock('../data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data')>();
  return {
    ...actual,
    SITES: [WARN_WIND_SITE, WARN_WAVE_SITE],
    // wind = 9: warn for WARN_WIND_SITE (windSpeed=10, 80%=8) → line 132 branch
    generateWeather: () => ({
      temp: 20, hum: 60, pressure: 1013,
      wind: 9, windDir: 'N' as const, rain: 0,
    }),
    // waveHeight = 0.9: warn for WARN_WAVE_SITE (waveLimit=1.0, 80%=0.8) → line 141 branch
    generateMarine: (siteId: string) =>
      siteId === 'warn_wave'
        ? { waveHeight: 0.9, wavePeriod: 6, waveDir: 'E' as const, tide: '上げ潮', tideLevel: 1.2 }
        : null,
    getDecision: () => ({ status: 'warn' as const, reasons: ['風速基準に接近'] }),
  };
});

// Leaflet mock — matches the pattern in dashboard.test.tsx
const mockMap = {
  setView: vi.fn().mockReturnThis(),
  invalidateSize: vi.fn(),
  removeLayer: vi.fn(),
};
const mockMarker = {
  addTo: vi.fn().mockReturnThis(),
  bindPopup: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
};
const mockL = {
  map: vi.fn().mockReturnValue(mockMap),
  control: { zoom: vi.fn().mockReturnValue({ addTo: vi.fn() }) },
  tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
  divIcon: vi.fn().mockReturnValue({}),
  marker: vi.fn().mockReturnValue(mockMarker),
};

const { SiteStatusCard, MapView, DashboardPage } = await import('../dashboard');

beforeEach(() => {
  vi.stubGlobal('L', mockL);
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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// SiteStatusCard — wind warn color (line 132)
// ---------------------------------------------------------------------------

describe('SiteStatusCard — wind warn color (line 132)', () => {
  it('renders wind value when wind is in warn band (80-99% of windSpeed)', () => {
    // wind=9, windSpeed=10 → 9 > 10? no → 9 > 8? yes → 'var(--status-warn)' at line 132
    const { container } = render(
      <SiteStatusCard site={WARN_WIND_SITE} onClick={vi.fn()} />,
    );
    expect(container.textContent).toContain('9');
    expect(container.textContent).toContain('m/s');
  });

  it('SiteStatusCard renders without error for warn-wind site', () => {
    const { container } = render(
      <SiteStatusCard site={WARN_WIND_SITE} onClick={vi.fn()} />,
    );
    expect(container.querySelector('.card')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SiteStatusCard — wave warn color (line 141)
// ---------------------------------------------------------------------------

describe('SiteStatusCard — wave warn color (line 141)', () => {
  it('renders wave height value when wave is in warn band (80-99% of waveLimit)', () => {
    // waveHeight=0.9, waveLimit=1.0 → 0.9 > 1.0? no → 0.9 > 0.8? yes → 'var(--status-warn)' at line 141
    const { container } = render(
      <SiteStatusCard site={WARN_WAVE_SITE} onClick={vi.fn()} />,
    );
    expect(container.textContent).toContain('0.9');
    expect(container.textContent).toContain('波高');
  });

  it('wave warn renders the 波高 section (m && waveLimit !== null branch)', () => {
    const { container } = render(
      <SiteStatusCard site={WARN_WAVE_SITE} onClick={vi.fn()} />,
    );
    const bodyText = container.textContent ?? '';
    expect(bodyText).toContain('波高');
    expect(bodyText).not.toContain('降水');
  });
});

// ---------------------------------------------------------------------------
// MapView — setTimeout invalidateSize callback (function coverage)
//
// The first useEffect schedules `setTimeout(() => map.invalidateSize(), 100)`.
// With fake timers + advanceTimersByTime(100) the callback fires and
// mockMap.invalidateSize is called.
// ---------------------------------------------------------------------------

describe('MapView — setTimeout invalidateSize callback', () => {
  it('calls map.invalidateSize after 100ms delay', () => {
    vi.useFakeTimers();
    render(<MapView sites={[WARN_WIND_SITE]} />);
    expect(mockMap.invalidateSize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(mockMap.invalidateSize).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// DashboardPage — navigate callbacks (function coverage)
//
// DashboardPage defines two anonymous callbacks that call navigate():
//   • MapView onSiteClick={(id) => { navigate('site-detail', id); }}
//   • SiteStatusCard onClick={(id) => navigate('site-detail', id)}
//
// These are separate function expressions from the navigate mock itself;
// V8 counts them as distinct functions that must be invoked to achieve
// full function coverage.
// ---------------------------------------------------------------------------

describe('DashboardPage — navigate callbacks', () => {
  it('clicking a SiteStatusCard within DashboardPage calls navigate("site-detail", id)', () => {
    const navigate = vi.fn();
    const { container } = render(<DashboardPage navigate={navigate} />);
    // SiteStatusCards have style.cursor === 'pointer' — find and click the first one
    const clickableCard = Array.from(container.querySelectorAll('.card')).find(
      (el) => (el as HTMLElement).style.cursor === 'pointer',
    ) as HTMLElement | undefined;
    expect(clickableCard).toBeDefined();
    fireEvent.click(clickableCard!);
    expect(navigate).toHaveBeenCalledWith('site-detail', expect.any(String));
  });

  it('invoking the MapView marker click handler calls navigate("site-detail", id)', () => {
    const navigate = vi.fn();
    render(<DashboardPage navigate={navigate} />);
    // marker.on('click', handler) was called for each site —
    // pick the handler registered for the first site and invoke it
    const clickCalls = mockMarker.on.mock.calls.filter((c: unknown[]) => c[0] === 'click');
    expect(clickCalls.length).toBeGreaterThan(0);
    const handler = clickCalls[0][1] as () => void;
    handler();
    expect(navigate).toHaveBeenCalledWith('site-detail', expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// DashboardPage — selectedArea true branches (lines 263, 340)
//
// Clicking a non-'全国' area button sets selectedArea to that area name.
// This triggers:
//   line 263: visibleSites = SITES.filter(s => s.area === selectedArea)  ← true branch
//   line 340: `/ ${selectedArea}` in the heading label                   ← true branch
// ---------------------------------------------------------------------------

describe('DashboardPage — selectedArea area filter (lines 263, 340)', () => {
  it('clicking a non-全国 area button filters visibleSites and shows area in heading', () => {
    const { container } = render(<DashboardPage navigate={vi.fn()} />);

    // All area filter buttons: find one that is not '全国'
    const areaButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent !== '全国',
    );
    expect(areaButtons.length).toBeGreaterThan(0);

    // Click the first non-全国 area button (e.g. '北海道')
    const targetButton = areaButtons[0];
    const areaName = targetButton.textContent ?? '';
    fireEvent.click(targetButton);

    // Line 340: the status count label contains `/ ${areaName}`
    expect(container.textContent).toContain(`/ ${areaName}`);
  });

  it('clicking the same area button twice toggles selectedArea back to null', () => {
    const { container } = render(<DashboardPage navigate={vi.fn()} />);

    const areaButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent !== '全国',
    );
    const targetButton = areaButtons[0];
    const areaName = targetButton.textContent ?? '';

    // First click: set selectedArea
    fireEvent.click(targetButton);
    expect(container.textContent).toContain(`/ ${areaName}`);

    // Second click: toggle back to null — selectedArea becomes null
    // The status label goes from "N件 / エリア名" back to "N件"
    fireEvent.click(targetButton);
    expect(container.textContent).not.toContain(`件 / ${areaName}`);
  });
});

// ---------------------------------------------------------------------------
// DashboardPage — '全国' button click (line 311 true branch)
//
// The area button handler:
//   onClick={() => setSelectedArea(area === '全国' ? null : area === selectedArea ? null : area)}
//
// When area === '全国': the first ternary fires (true branch) → null
// This branch is never tested in the tests above (only non-全国 buttons are clicked).
// To exercise it: first set a non-全国 area, then click '全国' to reset.
// ---------------------------------------------------------------------------

describe('DashboardPage — 全国 button resets selectedArea (line 311 area===全国 true branch)', () => {
  it('clicking 全国 button clears selectedArea and removes area name from heading', () => {
    const { container } = render(<DashboardPage navigate={vi.fn()} />);

    // Find a non-全国 area button and click it to set selectedArea
    const nonZenkokuButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent !== '全国',
    ) as HTMLElement | undefined;
    expect(nonZenkokuButton).toBeDefined();
    const areaName = nonZenkokuButton!.textContent ?? '';
    fireEvent.click(nonZenkokuButton!);
    expect(container.textContent).toContain(`/ ${areaName}`);

    // Now click the '全国' button — area==='全国' → true branch → setSelectedArea(null)
    const zenkokuButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '全国',
    ) as HTMLElement | undefined;
    expect(zenkokuButton).toBeDefined();
    fireEvent.click(zenkokuButton!);

    // selectedArea is now null → heading no longer contains "/ エリア名"
    expect(container.textContent).not.toContain(`/ ${areaName}`);
  });
});
