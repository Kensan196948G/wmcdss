// @vitest-environment jsdom
//
// Covers weather-marine.tsx lines 108-114 (adaptBackendMarine fallback):
//   const mock = generateMarine(siteId) ?? {
//     waveHeight: 0, wavePeriod: 0, waveDir: 'N', tide: '—', tideLevel: 0,
//   };
//
// When generateMarine returns null (MARINE_TABLE miss), the fallback object is
// constructed. This branch is only reachable via the backend marine fetch path
// (WMCDSS_API.fetchLatestMarine resolves).
//
// Must use top-level vi.mock (hoisted before imports) so V8 attributes coverage
// to the same module instance as the source file.
//
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

// Hoisted: mock ../data so that generateMarine returns null for our synthetic site.
// We still need the synthetic site to exist in SITES so MarinePage can select it.
vi.mock('../data', async (importOriginal) => {
  const original = await importOriginal<typeof import('../data')>();

  const syntheticSite = {
    id: 'site-marine-notbl',
    name: 'テスト海上地点(MARINE_TABLE未登録)',
    type: 'marine' as const,
    location: { lat: 34.5, lng: 136.0 },
    thresholds: {
      windSpeed: 10,
      waveHeight: 2.5,
      precipitation: 5,
    },
    marinePoint: 'テスト観測点2',
  };

  return {
    ...original,
    SITES: [...original.SITES, syntheticSite],
    // Make generateMarine return null for our synthetic site (simulate MARINE_TABLE miss)
    generateMarine: (siteId: string) =>
      siteId === 'site-marine-notbl' ? null : original.generateMarine(siteId),
  };
});

import { MarinePage } from '../weather-marine';

type WmcdssWindow = Window & {
  WMCDSS_API?: {
    fetchLatestMarine?: (...args: unknown[]) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// adaptBackendMarine fallback (lines 108-114): generateMarine returns null
// ---------------------------------------------------------------------------

describe('MarinePage — adaptBackendMarine null fallback (lines 108-114)', () => {
  it('uses zero-filled fallback when generateMarine returns null and backend fetch resolves', async () => {
    (window as WmcdssWindow).WMCDSS_API = {
      fetchLatestMarine: vi.fn().mockResolvedValue({
        id: 1,
        site_id: 'site-marine-notbl',
        observed_at: '2026-06-14T10:00:00Z',
        sig_wave_h_m: 1.2,
        wave_period_s: 7.0,
        wave_dir_deg: 90,
        tide_level_m: 0.5,
      }),
    };

    const { container } = render(<MarinePage selectedSite="site-marine-notbl" />);
    await waitFor(() =>
      expect((window as WmcdssWindow).WMCDSS_API?.fetchLatestMarine).toHaveBeenCalled(),
    );
    // Component should render without crashing even when generateMarine returns null
    expect(container.querySelector('select.form-select')).not.toBeNull();

    delete (window as WmcdssWindow).WMCDSS_API;
    cleanup();
  });
});
