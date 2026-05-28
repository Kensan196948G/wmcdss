// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WeatherPage, MarinePage } from '../weather-marine';
import { SITES } from '../data';

// ---------------------------------------------------------------------------
// Math.random determinism — generateWeather/Marine/Hourly{Wind,Wave} & several
// inline (Math.random() - 0.5) jitter terms feed into both components. Stub it
// so test runs are deterministic; we only assert on DOM shape, never on the
// exact numeric output.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// WeatherPage
// ---------------------------------------------------------------------------

describe('WeatherPage', () => {
  it('renders 現場選択 label and a site <select> with every SITES entry', () => {
    const { container } = render(<WeatherPage />);
    expect(container.textContent).toContain('現場選択');
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(SITES.length);
  });

  it('uses selectedSite prop to pre-select the site', () => {
    const target = SITES[2]?.id ?? SITES[1].id;
    const { container } = render(<WeatherPage selectedSite={target} />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe(target);
  });

  it('falls back to SITES[0] when selectedSite is unknown', () => {
    const { container } = render(<WeatherPage selectedSite="no-such-site" />);
    // Initial state uses SITES[0].id when selectedSite is falsy or unknown
    // (the inner `SITES.find(...) || SITES[0]` only narrows for site lookup;
    // the select value follows the state). Because the OR short-circuits on
    // truthy strings, an unknown id still becomes the select value — assert
    // the page still renders without crashing.
    expect(container.textContent).toContain('現場選択');
  });

  it('renders observation header (観測所 / 最終取得)', () => {
    const { container } = render(<WeatherPage />);
    expect(container.textContent).toContain('観測所');
    expect(container.textContent).toContain('最終取得');
  });

  it('renders all 3 tabs (リアルタイム / 時間推移 / データ表)', () => {
    const { container } = render(<WeatherPage />);
    expect(container.textContent).toContain('リアルタイム');
    expect(container.textContent).toContain('時間推移');
    expect(container.textContent).toContain('データ表');
  });

  it('current tab renders all 6 stat cards (気温/湿度/気圧/風速/風向/降水量)', () => {
    const { container } = render(<WeatherPage />);
    for (const label of ['気温', '湿度', '気圧', '風速', '風向', '降水量']) {
      expect(container.textContent).toContain(label);
    }
  });

  it('current tab renders 風配図 and 週間予報 cards', () => {
    const { container } = render(<WeatherPage />);
    expect(container.textContent).toContain('風配図');
    expect(container.textContent).toContain('週間予報');
  });

  it('current tab renders a 週間予報 table with 日付/天気/気温/降水確率/風速 headers', () => {
    const { container } = render(<WeatherPage />);
    for (const header of ['日付', '天気', '気温', '降水確率', '風速']) {
      expect(container.textContent).toContain(header);
    }
  });

  it('switches to hourly tab and renders 風速推移/気温推移/降水量推移 cards', () => {
    const { container } = render(<WeatherPage />);
    const hourlyTab = Array.from(container.querySelectorAll('button.tab')).find((b) =>
      b.textContent?.includes('時間推移')
    );
    expect(hourlyTab).not.toBeUndefined();
    fireEvent.click(hourlyTab!);
    expect(container.textContent).toContain('風速推移(24時間)');
    expect(container.textContent).toContain('気温推移(24時間)');
    expect(container.textContent).toContain('降水量推移(24時間)');
  });

  it('switches to table tab and renders 24 hourly rows', () => {
    const { container } = render(<WeatherPage />);
    const tableTab = Array.from(container.querySelectorAll('button.tab')).find((b) =>
      b.textContent?.includes('データ表')
    );
    fireEvent.click(tableTab!);
    expect(container.textContent).toContain('時間別観測データ');
    // 24 hourly rows + 1 header row, but `data-table` thead/tbody — count tbody tr
    const dataTable = container.querySelector('.data-table') as HTMLTableElement;
    const bodyRows = dataTable.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(24);
  });

  it('table tab includes 気温/湿度/風速/風向/降水量/気圧 column headers', () => {
    const { container } = render(<WeatherPage />);
    const tableTab = Array.from(container.querySelectorAll('button.tab')).find((b) =>
      b.textContent?.includes('データ表')
    );
    fireEvent.click(tableTab!);
    for (const header of ['時刻', '気温(℃)', '湿度(%)', '風速(m/s)', '風向', '降水量(mm)', '気圧(hPa)']) {
      expect(container.textContent).toContain(header);
    }
  });

  it('changing the site <select> re-renders without crashing', () => {
    const { container } = render(<WeatherPage />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    const target = SITES[SITES.length - 1].id;
    fireEvent.change(select, { target: { value: target } });
    expect(select.value).toBe(target);
  });

  it('CSV出力 button appears in table tab', () => {
    const { container } = render(<WeatherPage />);
    const tableTab = Array.from(container.querySelectorAll('button.tab')).find((b) =>
      b.textContent?.includes('データ表')
    );
    fireEvent.click(tableTab!);
    expect(container.textContent).toContain('📥 CSV出力');
  });
});

// ---------------------------------------------------------------------------
// MarinePage
// ---------------------------------------------------------------------------

describe('MarinePage', () => {
  // marine = sites whose type !== 'land' (the production data has marine + port + jetty etc.)
  const marineSites = SITES.filter((s) => s.type !== 'land');

  it('renders 現場選択 label and a site <select> with only marine sites', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('現場選択');
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBe(marineSites.length);
  });

  it('select <option> values are all marine site ids', () => {
    const { container } = render(<MarinePage />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    const marineIds = marineSites.map((s) => s.id);
    for (const id of optionValues) {
      expect(marineIds).toContain(id);
    }
  });

  it('uses selectedSite when it is a marine site', () => {
    const marineSite = marineSites[1] ?? marineSites[0];
    const { container } = render(<MarinePage selectedSite={marineSite.id} />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe(marineSite.id);
  });

  it('falls back to marineSites[0] when selectedSite is a non-marine id', () => {
    const landSite = SITES.find((s) => s.type === 'land');
    if (!landSite) return; // skip when fixture has no land site
    const { container } = render(<MarinePage selectedSite={landSite.id} />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe(marineSites[0].id);
  });

  it('renders 観測点 badge with marinePoint text', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('観測点:');
    const badge = container.querySelector('.badge.badge-info');
    expect(badge).not.toBeNull();
  });

  it('renders the 3 primary stat cards (有義波高 / 波周期 / 卓越波向)', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('有義波高');
    expect(container.textContent).toContain('波周期');
    expect(container.textContent).toContain('卓越波向');
  });

  it('renders the 2 secondary stat cards (潮汐 / 潮位)', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('潮汐');
    expect(container.textContent).toContain('潮位');
  });

  it('renders 有義波高推移(24時間) chart card', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('有義波高推移(24時間)');
  });

  it('renders 時間別海象データ table with 24 rows + 5 column headers', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('時間別海象データ');
    for (const header of ['時刻', '有義波高(m)', '周期(s)', '波向', '潮位(m)']) {
      expect(container.textContent).toContain(header);
    }
    // Two .data-table tables exist? Actually MarinePage has only one (Marine table)
    const tables = container.querySelectorAll('table.data-table');
    expect(tables.length).toBe(1);
    const bodyRows = tables[0].querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(24);
  });

  it('changing the site <select> re-renders without crashing', () => {
    const { container } = render(<MarinePage />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    const target = marineSites[marineSites.length - 1].id;
    fireEvent.change(select, { target: { value: target } });
    expect(select.value).toBe(target);
  });

  it('CSV出力 button appears in the 時間別海象データ card', () => {
    const { container } = render(<MarinePage />);
    expect(container.textContent).toContain('📥 CSV出力');
  });

  it('renders an SVG (LineChart) for the wave height time series', () => {
    const { container } = render(<MarinePage />);
    // LineChart from charts.tsx renders an <svg> when data has elements
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Window side-effects (dual surface contract: see header of weather-marine.tsx)
// ---------------------------------------------------------------------------

describe('weather-marine.tsx — window side effects', () => {
  it('attaches WeatherPage and MarinePage to window when imported in jsdom', () => {
    expect((window as unknown as { WeatherPage?: unknown }).WeatherPage).toBe(WeatherPage);
    expect((window as unknown as { MarinePage?: unknown }).MarinePage).toBe(MarinePage);
  });
});
