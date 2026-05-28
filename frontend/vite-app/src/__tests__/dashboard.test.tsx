// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  AlertBanner,
  SiteStatusCard,
  MapView,
  DashboardPage,
  type MapViewProps,
} from "../dashboard";
import { SITES } from "../data";
import type { Site } from "../data";

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
  vi.stubGlobal("L", mockL);
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

const allOkSites: Site[] = SITES.map((s) => ({ ...s, status: "ok" as const }));
const withDanger: Site[] = SITES.map((s, i) =>
  i === 0
    ? { ...s, status: "danger" as const }
    : { ...s, status: "ok" as const },
);
const withWarn: Site[] = SITES.map((s, i) =>
  i === 0 ? { ...s, status: "warn" as const } : { ...s, status: "ok" as const },
);

describe("AlertBanner", () => {
  it("returns null when all sites are ok (no banner rendered)", () => {
    const { container } = render(<AlertBanner sites={allOkSites} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders 中止推奨 banner for a danger site", () => {
    const { container } = render(<AlertBanner sites={withDanger} />);
    expect(container.textContent).toContain("中止推奨");
  });

  it("renders 注意 banner for a warn site", () => {
    const { container } = render(<AlertBanner sites={withWarn} />);
    expect(container.textContent).toContain("注意");
  });

  it("renders site shortName in the banner", () => {
    const { container } = render(<AlertBanner sites={withDanger} />);
    expect(container.textContent).toContain(withDanger[0].shortName);
  });

  it("renders both banners when both danger and warn sites exist", () => {
    const mixed: Site[] = SITES.map((s, i) => ({
      ...s,
      status: (i === 0 ? "danger" : i === 1 ? "warn" : "ok") as
        | "ok"
        | "warn"
        | "danger",
    }));
    const { container } = render(<AlertBanner sites={mixed} />);
    expect(container.textContent).toContain("中止推奨");
    expect(container.textContent).toContain("注意");
  });
});

// ---------------------------------------------------------------------------
// SiteStatusCard
// ---------------------------------------------------------------------------

describe("SiteStatusCard", () => {
  const site = SITES[0];
  const onClick = vi.fn();

  it("renders site shortName", () => {
    const { container } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    expect(container.textContent).toContain(site.shortName);
  });

  it("renders decision badge with STATUS_LABEL text", () => {
    const { container } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    // Decision badge shows 施工可 / 注意 / 中止推奨
    const badgeTexts = ["施工可", "注意", "中止推奨"];
    const hasOneBadge = badgeTexts.some((t) =>
      container.textContent?.includes(t),
    );
    expect(hasOneBadge).toBe(true);
  });

  it("renders temperature and wind speed metrics", () => {
    const { container } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    expect(container.textContent).toContain("℃");
    expect(container.textContent).toContain("m/s");
  });

  it("renders normal padding by default and compact padding with density=compact", () => {
    const { container: normal } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    const { container: compact } = render(
      <SiteStatusCard site={site} onClick={onClick} density="compact" />,
    );
    const normalBody = normal.querySelector(".card-body") as HTMLElement;
    const compactBody = compact.querySelector(".card-body") as HTMLElement;
    expect(normalBody.style.padding).not.toBe(compactBody.style.padding);
  });

  it("shows wave height for a marine site", () => {
    const marineSite = SITES.find(
      (s) => s.type === "marine" && s.thresholds.waveHeight !== null,
    )!;
    const { container } = render(
      <SiteStatusCard site={marineSite} onClick={onClick} />,
    );
    expect(container.textContent).toContain("波高");
  });

  it("shows rainfall for a land site (no waveHeight)", () => {
    const landSite = SITES.find((s) => s.thresholds.waveHeight === null)!;
    const { container } = render(
      <SiteStatusCard site={landSite} onClick={onClick} />,
    );
    expect(container.textContent).toContain("降水");
  });

  it("invokes onClick with site.id when the card is clicked", () => {
    const click = vi.fn();
    const { container } = render(
      <SiteStatusCard site={site} onClick={click} />,
    );
    const card = container.querySelector(".card") as HTMLElement;
    fireEvent.click(card);
    expect(click).toHaveBeenCalledWith(site.id);
  });

  it("mouseover sets box-shadow to var(--shadow-md) on the card", () => {
    const { container } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    const card = container.querySelector(".card") as HTMLElement;
    fireEvent.mouseOver(card);
    expect(card.style.boxShadow).toBe("var(--shadow-md)");
  });

  it("mouseout resets box-shadow to var(--shadow-sm)", () => {
    const { container } = render(
      <SiteStatusCard site={site} onClick={onClick} />,
    );
    const card = container.querySelector(".card") as HTMLElement;
    fireEvent.mouseOver(card);
    fireEvent.mouseOut(card);
    expect(card.style.boxShadow).toBe("var(--shadow-sm)");
  });
});

// ---------------------------------------------------------------------------
// MapView (Leaflet mock)
// ---------------------------------------------------------------------------

describe("MapView", () => {
  it("renders a div container", () => {
    const { container } = render(<MapView sites={SITES} />);
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("calls L.map once on mount", () => {
    render(<MapView sites={SITES} />);
    expect(mockL.map).toHaveBeenCalledTimes(1);
  });

  it("calls L.marker for each site", () => {
    render(<MapView sites={SITES} />);
    expect(mockL.marker).toHaveBeenCalledTimes(SITES.length);
  });

  it("does not call onSiteClick at render time (only on marker click)", () => {
    const onSiteClick = vi.fn();
    render(<MapView sites={SITES} onSiteClick={onSiteClick} />);
    expect(onSiteClick).not.toHaveBeenCalled();
  });

  it("invokes onSiteClick when the leaflet marker.on click handler fires", () => {
    const onSiteClick = vi.fn();
    render(<MapView sites={SITES} onSiteClick={onSiteClick} />);
    // marker.on was called with ('click', handler) for each site — grab the
    // handler from the last marker call and invoke it manually.
    const lastCall =
      mockMarker.on.mock.calls[mockMarker.on.mock.calls.length - 1];
    expect(lastCall[0]).toBe("click");
    const handler = lastCall[1] as () => void;
    handler();
    expect(onSiteClick).toHaveBeenCalledTimes(1);
    expect(onSiteClick).toHaveBeenCalledWith(expect.any(String));
  });

  it("marker click handler is a no-op when onSiteClick is omitted (no throw)", () => {
    render(<MapView sites={SITES} />);
    const lastCall =
      mockMarker.on.mock.calls[mockMarker.on.mock.calls.length - 1];
    const handler = lastCall[1] as () => void;
    expect(() => handler()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

describe("DashboardPage", () => {
  const navigate = vi.fn();

  it("renders stat cards for 管理現場数, 施工可, 注意, 中止推奨", () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain("管理現場数");
    expect(container.textContent).toContain("施工可");
    expect(container.textContent).toContain("注意");
    expect(container.textContent).toContain("中止推奨");
  });

  it("renders 現場マップ card title", () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain("現場マップ");
  });

  it("renders site status cards for all sites", () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain(
      `現場ステータス（${SITES.length}件）`,
    );
  });

  it("renders 週間天気予報 section", () => {
    const { container } = render(<DashboardPage navigate={navigate} />);
    expect(container.textContent).toContain("週間天気予報");
  });
});
