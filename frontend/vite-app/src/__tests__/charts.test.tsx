// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  ChartColors,
  LineChart,
  BarChart,
  WindRose,
  Sparkline,
  GaugeMeter,
  type SeriesPoint,
  type DirectionPoint,
} from '../charts';

// ---------------------------------------------------------------------------
// ChartColors
// ---------------------------------------------------------------------------

describe('ChartColors', () => {
  it('has all expected color keys', () => {
    const keys = ['blue', 'lightBlue', 'green', 'amber', 'red', 'gray', 'gridLine', 'text'];
    for (const k of keys) {
      expect(ChartColors).toHaveProperty(k);
    }
  });

  it('all values are hex color strings', () => {
    for (const v of Object.values(ChartColors)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// ---------------------------------------------------------------------------
// LineChart
// ---------------------------------------------------------------------------

const SERIES: SeriesPoint[] = [
  { label: '0h', value: 2.0 },
  { label: '6h', value: 4.5 },
  { label: '12h', value: 3.1 },
];

describe('LineChart', () => {
  it('returns null for empty data', () => {
    const { container } = render(<LineChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG element for valid data', () => {
    const { container } = render(<LineChart data={SERIES} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('SVG viewBox reflects default 400×160 dimensions', () => {
    const { container } = render(<LineChart data={SERIES} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 160');
  });

  it('renders threshold dashed line when threshold is provided', () => {
    const { container } = render(<LineChart data={SERIES} threshold={3.5} />);
    const dashLines = container.querySelectorAll('line[stroke-dasharray]');
    expect(dashLines.length).toBeGreaterThan(0);
  });

  it('does not render threshold line when threshold is omitted', () => {
    const { container } = render(<LineChart data={SERIES} />);
    const dashLines = container.querySelectorAll('line[stroke-dasharray]');
    expect(dashLines.length).toBe(0);
  });

  it('renders thresholdLabel text when both threshold and label are provided', () => {
    const { container } = render(
      <LineChart data={SERIES} threshold={3.5} thresholdLabel="danger line" />
    );
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t?.includes('danger line'))).toBe(true);
  });

  it('renders yLabel when provided', () => {
    const { container } = render(<LineChart data={SERIES} yLabel="m/s" />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t?.includes('m/s'))).toBe(true);
  });

  it('renders a circle per data point', () => {
    const { container } = render(<LineChart data={SERIES} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(SERIES.length);
  });

  it('respects custom width and height', () => {
    const { container } = render(<LineChart data={SERIES} width={600} height={200} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 600 200');
  });
});

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

describe('BarChart', () => {
  it('returns null for empty data', () => {
    const { container } = render(<BarChart data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG with correct default viewBox', () => {
    const { container } = render(<BarChart data={SERIES} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 160');
  });

  it('renders one rect per data point', () => {
    const { container } = render(<BarChart data={SERIES} />);
    const rects = container.querySelectorAll('rect');
    expect(rects.length).toBe(SERIES.length);
  });

  it('renders yLabel text when provided', () => {
    const { container } = render(<BarChart data={SERIES} yLabel="mm" />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t?.includes('mm'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WindRose
// ---------------------------------------------------------------------------

const WIND_DATA: DirectionPoint[] = [
  { dir: 'N', value: 5 },
  { dir: 'NE', value: 8 },
  { dir: 'SW', value: 3 },
];

describe('WindRose', () => {
  it('renders an SVG element', () => {
    const { container } = render(<WindRose data={WIND_DATA} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders all 8 direction labels', () => {
    const { container } = render(<WindRose data={WIND_DATA} />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    for (const dir of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
      expect(texts.some(t => t === dir)).toBe(true);
    }
  });

  it('renders a circle per data point (excluding 4 background grid circles)', () => {
    // WindRose always renders 4 concentric background circles (fill="none") for the grid
    // Data circles use fill={ChartColors.blue} with opacity="0.7"
    const { container } = render(<WindRose data={WIND_DATA} />);
    const dataDots = container.querySelectorAll(`circle[fill="${ChartColors.blue}"]`);
    expect(dataDots.length).toBe(WIND_DATA.length);
  });

  it('handles N direction correctly (angles[0] = 0 which is falsy — uses ?? not ||)', () => {
    // Bug fixed in Loop 17: angles[dirs.indexOf('N')] ?? angles[0]
    // 'N' is at index 0 → angle = ((0*45-90)*π/180) = -π/2 (not 0)
    // The actual value is -1.5708... which is truthy, so || would also work here
    // but ?? is semantically correct for "use fallback only if undefined/null"
    const northData: DirectionPoint[] = [{ dir: 'N', value: 10 }];
    const { container } = render(<WindRose data={northData} />);
    const dataDots = container.querySelectorAll(`circle[fill="${ChartColors.blue}"]`);
    expect(dataDots.length).toBe(1);
  });

  it('handles empty data gracefully (4 grid circles remain, 0 data circles)', () => {
    // The 4 concentric background circles always render; data circles = 0
    const { container } = render(<WindRose data={[]} />);
    const dataDots = container.querySelectorAll(`circle[fill="${ChartColors.blue}"]`);
    expect(dataDots.length).toBe(0);
  });

  it('respects custom size', () => {
    const { container } = render(<WindRose data={WIND_DATA} size={240} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 240 240');
  });
});

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

describe('Sparkline', () => {
  it('returns null for empty values', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for single value (< 2 points)', () => {
    const { container } = render(<Sparkline values={[5]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders SVG for >= 2 values', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5, 4]} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders exactly one polyline', () => {
    const { container } = render(<Sparkline values={[1, 3, 2]} />);
    expect(container.querySelectorAll('polyline').length).toBe(1);
  });

  it('uses default 80×24 dimensions', () => {
    const { container } = render(<Sparkline values={[1, 2]} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 80 24');
  });
});

// ---------------------------------------------------------------------------
// GaugeMeter
// ---------------------------------------------------------------------------

describe('GaugeMeter', () => {
  it('renders an SVG element', () => {
    const { container } = render(<GaugeMeter value={5} max={10} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('displays the value as text', () => {
    const { container } = render(<GaugeMeter value={7} max={10} />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t === '7')).toBe(true);
  });

  it('displays unit when provided', () => {
    const { container } = render(<GaugeMeter value={5} max={10} unit="m/s" />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t?.includes('m/s'))).toBe(true);
  });

  it('displays label when provided', () => {
    const { container } = render(<GaugeMeter value={5} max={10} label="Wind Speed" />);
    const texts = [...container.querySelectorAll('text')].map(t => t.textContent);
    expect(texts.some(t => t?.includes('Wind Speed'))).toBe(true);
  });

  it('renders threshold marker circle when threshold is provided', () => {
    // Loop 17 fix: threshAngle !== null (not threshAngle &&) so threshold=0 also renders marker
    const { container } = render(<GaugeMeter value={5} max={10} threshold={8} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('renders threshold marker when threshAngle computes to 0 (Loop 17 silent bug fix)', () => {
    // threshAngle = startAngle + (threshold/max) * range = -210 + (8.75/10)*240 = -210+210 = 0
    // With old `threshAngle && ...`: 0 is falsy → no marker rendered (the bug)
    // With fix `threshAngle !== null && ...`: 0 !== null → marker renders correctly
    const { container } = render(<GaugeMeter value={5} max={10} threshold={8.75} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('uses red color when value exceeds threshold (danger zone)', () => {
    // value=9 > threshold=8 → color = red
    const { container } = render(<GaugeMeter value={9} max={10} threshold={8} />);
    const valueText = [...container.querySelectorAll('text')].find(t => t.textContent === '9');
    expect(valueText?.getAttribute('fill')).toBe(ChartColors.red);
  });

  it('uses amber color when value is in 80-100% of threshold (warn zone)', () => {
    // value=7 > threshold*0.8 = 8*0.8=6.4, but 7 < 8 → color = amber
    const { container } = render(<GaugeMeter value={7} max={10} threshold={8} />);
    const valueText = [...container.querySelectorAll('text')].find(t => t.textContent === '7');
    expect(valueText?.getAttribute('fill')).toBe(ChartColors.amber);
  });

  it('uses blue color when value is below 80% of threshold (ok zone)', () => {
    // value=3 < threshold*0.8 = 8*0.8=6.4 → color = blue
    const { container } = render(<GaugeMeter value={3} max={10} threshold={8} />);
    const valueText = [...container.querySelectorAll('text')].find(t => t.textContent === '3');
    expect(valueText?.getAttribute('fill')).toBe(ChartColors.blue);
  });

  it('respects custom size in viewBox', () => {
    const { container } = render(<GaugeMeter value={5} max={10} size={200} />);
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 200 200');
  });
});
