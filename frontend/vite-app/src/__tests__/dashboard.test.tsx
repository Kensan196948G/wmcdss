// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import {
  AlertBanner,
  SiteStatusCard,
  MapView,
  DashboardPage,
  type MapViewProps,
} from '../dashboard';
import { SITES } from '../data';
import type { Site } from '../data';

// ---------------------------------------------------------------------------
// Leaflet global mock (used by MapView / DashboardPage)
// ---------------------------------------------------------------------------

const mockMarker = {
  addTo: vi.fn().mockReturnThis(),
  bindPopup: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
};
const mockMap = {
  setView: vi.fn().mockReturnThis(),
  invalidateSize: vi.fn(),
  removeLayer: vi.fn(),
};
const mockL = {
  map: vi.fn().mockReturnValue(mockMap),
  control: { zoom: vi.fn().mockReturnValue({ addTo: vi.fn() }) },
  tileLayer: vi.fn().mockReturnValue({ addTo: vi.fn() }),
  divIcon: vi.fn().mockReturnValue({}),
  marker: vi.fn().mockReturnValue(mockMarker),
};

beforeEach(() => {
  vi.stubGlobal('L', mockL);
  vi.clearAllMocks();
  // Reset mock return values after clearAllMocks
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
// AlertBanner
// ---------------------------------------------------------------------------

const allOkSites: Site[] = SITES.map((s) => ({ ...s, status: 'ok' as const }));
const withDanger: Site[] = SITES.map((s, i) =>
  i === 0 ? { ...s, status: 'danger' as const } : { ...s, status: 'ok' as const }
);
const withWarn: Site[] = SITES.map((s, i) =>
  i === 0 ? { ...s, status: 'warn' as const } : { ...s, status: 'ok' as const }
);

describe('AlertBanner', () => {
  it('returns null when all sites are ok (no banner rendered)', () => {
    const { container } = render(<AlertBanner sites={allOkSites} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders 中止推奨 banner for a danger site', () => {
    const { container } = render(<AlertBanner sites={withDanger} />);
    expect(container.textContent).toContain('中止推奨');
  });

  it('renders 注意 banner for a warn site', () => {
    const { container } = render(<AlertBanner sites={withWarn} />);
    expect(container.textContent).toContain('注意');
  });

  it('renders site shortName in the banner', () => {
    const { container } = render(<AlertBanner sites={withDanger} />);
    expect(container.textContent).toContain(withDanger[0].shortName);
  });

  it('renders both banners when both danger and warn sites exist', () => {
    const mixed: Site[] = SITES.map((s, i) => ({
      ...s,
      status: (i === 0 ? 'danger' : i === 1 ? 'warn' : 'ok') as 'ok' | 'warn' | 'danger',
    }));
    const { container } = render(<AlertBanner sites={mixed} />);
    expect(container.textContent).toContain('中止推奨');
    expect(container.textContent).toContain('注意');
  });
});

// ---------------------------------------------------------------------------
// SiteStatusCard
// ---------------------------------------------------------------------------

describe('SiteStatusCard', () => {
  const site = SITES[0];
  const onClick = vi.fn();

  it('renders site shortName', () => {
    const { container } = render(<SiteStatusCard site={site} onClick={onClick} />);
    expect(container.textContent).toContain(site.shortName);
  });

  it('renders decision badge with STATUS_LABEL text', () => {
    const { container } = render(<SiteStatusCard site={site} onClick={onClick} />);
    // Decision badge shows 施工可 / 注意 / 中止推奨
    const badgeTexts = ['施工可', '注意', '中止推奨'];
    const hasOneBadge = badgeTexts.some((t) => container.textContent?.includes(t));
    expect(hasOneBadge).toBe(true);
  });

  it('renders temperature and wind speed metrics', () => {
    const { container } = render(<SiteStatusCard site={site} onClick={onClick} />);
    expect(container.textContent).toContain('℃');
    expect(container.textContent).toContain('m/s');
  });

  it('renders normal padding by default and compact padding with density=compact', () => {
    const { container: normal } = render(<SiteStatusCard site={site} onClick={onClick} />);
    const { container: compact } = render(
      <SiteStatusCard site={site} onClick={onClick} density="compact" />
    );
    const normalBody = normal.querySelector('.card-body') as HTMLElement;
    const compactBody = compact.querySelector('.card-body') as HTMLElement;
    expect(normalBody.style.padding).not.toBe(compactBody.style.padding);
  });

  it('shows wave height for a marine site', () => {
    const marineSite = SITES.find((s) => s.type === 'marine' && s.thresholds.waveHeight !== null)!;
    const { container } = render(<SiteStatusCard site={marineSite} onClick={onClick} />);
    expect(container.textContent).toContain('波高');
  });

  it('shows rainfall for a land site (no waveHeight)', () => {
    const landSite = SITES.find((s) => s.thresholds.waveHeight === null)!;
    const { container } = render(<SiteStatusCard site={landSite} onClick={onClick} />);
    expect(container.textContent).toContain('降水');
  });
});

// ---------------------------------------------------------------------------
// MapView (Leaflet mock)
// ---------------------------------------------------------------------------

describe('MapView', () => {
  it('renders a div container', () => {
    const { container } = render(<MapView sites={SITES} />);
    expect(container.querySelector('div')).not.toBeNull();
  });

  it('calls L.map once on mount', () => {
    render(<MapView sites={SITES} />);
    expect(mockL.map).toHaveBeenCalledTimes(1);
  });

  it('calls L.marker for each site', () => {
    render(<MapView sites={SITES} />);
    expect(mockL.marker).toHaveBeenCalledTimes(SITES.length);
  });

  it('does not call onSiteClick at render time (only on marker click)', () => {
    const onSiteClick = vi.fn();
    render(<MapView sites={SITES} onSiteClick={onSiteClick} />);
    expect(onSiteClick).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

describe('DashboardPage', () => {
  const navigate = vi.fn();

  it('renders stat cards for 管理現場数, 施工可, 注意, 中止推奨', () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain('管理現場数');
    expect(container.textContent).toContain('施工可');
    expect(container.textContent).toContain('注意');
    expect(container.textContent).toContain('中止推奨');
  });

  it('renders 現場マップ card title', () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain('現場マップ');
  });

  it('renders site status cards for all sites', () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain(`現場ステータス（${SITES.length}件）`);
  });

  it('renders 週間天気予報 section', () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain('週間天気予報');
  });
});
