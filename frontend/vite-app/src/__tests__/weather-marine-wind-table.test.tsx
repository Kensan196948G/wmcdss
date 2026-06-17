// @vitest-environment jsdom
//
// Covers weather-marine.tsx line 462 (hourly wind table color ternary):
//   color: h.speed > windLimit ? 'var(--status-danger)' : 'inherit'
//
// The true branch ('var(--status-danger)') is only reached when at least one
// hourlyWind entry exceeds the site's windSpeed threshold. The default
// generateHourlyWind() generates speeds ~1-7 m/s, well below site-01's 10 m/s
// limit. We mock generateHourlyWind to return speeds above 10 m/s.
//
// Must use top-level vi.mock (hoisted before imports) for V8 attribution.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data')>();
  return {
    ...original,
    // Return 24 hourly points all above site-01's windSpeed threshold of 10 m/s
    generateHourlyWind: () =>
      Array.from({ length: 24 }, (_, i) => ({ hour: i, speed: 15.0 })),
  };
});

import { WeatherPage } from '../weather-marine';

describe('WeatherPage — hourly table wind speed danger branch (line 462)', () => {
  it('applies danger color when h.speed > windLimit in table tab', () => {
    const { container } = render(<WeatherPage selectedSite="site-01" />);

    // Switch to the table tab (button text is 'データ表')
    const tableTab = Array.from(container.querySelectorAll('button.tab')).find(
      (b) => b.textContent?.includes('データ表'),
    );
    if (tableTab) fireEvent.click(tableTab);

    // The hourly data table should render with danger-styled cells
    const table = container.querySelector('table.data-table');
    expect(table).not.toBeNull();

    // Every wind-speed cell should have danger color since speed(15) > windLimit(10)
    const rows = table!.querySelectorAll('tbody tr');
    expect(rows.length).toBe(24);

    // At least one td should have 'var(--status-danger)' style
    const cells = Array.from(table!.querySelectorAll('tbody tr td:nth-child(4)'));
    const dangerCells = cells.filter(
      (td) => (td as HTMLElement).style.color === 'var(--status-danger)',
    );
    expect(dangerCells.length).toBeGreaterThan(0);

    cleanup();
  });
});
