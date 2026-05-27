import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  APIError,
  WMCDSS_API_BASE,
  fetchJSON,
  adaptSite,
  fetchSitesFromBackend,
  fetchLatestWeather,
  fetchLatestMarine,
  fetchThresholdsForSite,
  fetchAuditLog,
  requestDecisionFromBackend,
  initFromBackend,
  type BackendSite,
  type AdaptedSite,
} from '../api';

// Minimal fetch response stubs
function okResponse(json: unknown) {
  return { ok: true as const, json: vi.fn().mockResolvedValue(json) };
}
function failResponse(status: number, body = 'error') {
  return { ok: false as const, status, text: vi.fn().mockResolvedValue(body) };
}

// ---------------------------------------------------------------------------
// WMCDSS_API_BASE
// ---------------------------------------------------------------------------

describe('WMCDSS_API_BASE', () => {
  it('defaults to http://localhost:8003/api/v1 in node environment', () => {
    expect(WMCDSS_API_BASE).toBe('http://localhost:8003/api/v1');
  });
});

// ---------------------------------------------------------------------------
// APIError
// ---------------------------------------------------------------------------

describe('APIError', () => {
  it('sets name, status, url, body, and message correctly', () => {
    const err = new APIError({ status: 404, url: '/foo', body: 'not found' });
    expect(err.name).toBe('APIError');
    expect(err.status).toBe(404);
    expect(err.url).toBe('/foo');
    expect(err.body).toBe('not found');
    expect(err.message).toBe('API 404 /foo: not found');
  });

  it('slices body to 200 chars in message but preserves full body on .body', () => {
    const longBody = 'x'.repeat(300);
    const err = new APIError({ status: 500, url: '/bar', body: longBody });
    const prefix = 'API 500 /bar: ';
    expect(err.message).toBe(prefix + 'x'.repeat(200));
    expect(err.body).toBe(longBody);
  });

  it('handles empty body string', () => {
    const err = new APIError({ status: 503, url: '/baz', body: '' });
    expect(err.message).toBe('API 503 /baz: ');
  });

  it('is an instance of Error', () => {
    const err = new APIError({ status: 400, url: '/x', body: 'bad' });
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// fetchJSON
// ---------------------------------------------------------------------------

describe('fetchJSON', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns parsed JSON on successful response', async () => {
    const data = { id: 1, name: 'site' };
    mockFetch.mockResolvedValue(okResponse(data));
    const result = await fetchJSON('/sites');
    expect(result).toEqual(data);
  });

  it('prepends WMCDSS_API_BASE for relative paths', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('/test-path');
    expect(mockFetch).toHaveBeenCalledWith(`${WMCDSS_API_BASE}/test-path`, undefined);
  });

  it('uses absolute URL directly when path starts with http', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchJSON('http://other.host/endpoint');
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe('http://other.host/endpoint');
  });

  it('passes RequestInit options to fetch', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    const init: RequestInit = { method: 'POST', body: '{}' };
    await fetchJSON('/data', init);
    expect(mockFetch).toHaveBeenCalledWith(`${WMCDSS_API_BASE}/data`, init);
  });

  it('throws APIError when response is not ok', async () => {
    mockFetch.mockResolvedValue(failResponse(404, 'not found'));
    await expect(fetchJSON('/missing')).rejects.toBeInstanceOf(APIError);
  });

  it('sets correct status on thrown APIError', async () => {
    mockFetch.mockResolvedValue(failResponse(503, 'unavailable'));
    await expect(fetchJSON('/down')).rejects.toMatchObject({ status: 503 });
  });

  it('falls back to empty body string when text() rejects', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockRejectedValue(new Error('read failed')),
    });
    const err = await fetchJSON('/fail').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).body).toBe('');
  });
});

// ---------------------------------------------------------------------------
// adaptSite
// ---------------------------------------------------------------------------

describe('adaptSite', () => {
  const backend: BackendSite = {
    id: 1,
    code: 'SITE-01',
    name: 'Test Marine Site Alpha',
    kind: 'marine',
    lat: 35.5,
    lon: 139.8,
    address: 'Tokyo Bay',
    jma_station_id: '44132',
  };

  it('maps id, code, name, lat from backend fields', () => {
    const a = adaptSite(backend);
    expect(a.id).toBe(1);
    expect(a.code).toBe('SITE-01');
    expect(a.name).toBe('Test Marine Site Alpha');
    expect(a.lat).toBe(35.5);
  });

  it('renames lon → lng', () => {
    expect(adaptSite(backend).lng).toBe(139.8);
  });

  it('sets backend: true always', () => {
    expect(adaptSite(backend).backend).toBe(true);
  });

  it('slices name to 8 chars for shortName by default', () => {
    expect(adaptSite(backend).shortName).toBe('Test Mar');
  });

  it('uses mockFallback.shortName when provided', () => {
    expect(adaptSite(backend, { shortName: 'Custom' }).shortName).toBe('Custom');
  });

  it('uses jma_station_id as station by default', () => {
    expect(adaptSite(backend).station).toBe('44132');
  });

  it('uses mockFallback.station over jma_station_id', () => {
    expect(adaptSite(backend, { station: 'OVERRIDE' }).station).toBe('OVERRIDE');
  });

  it('falls back to empty string for station when jma_station_id is null', () => {
    expect(adaptSite({ ...backend, jma_station_id: null }).station).toBe('');
  });

  it('sets marinePoint to null by default', () => {
    expect(adaptSite(backend).marinePoint).toBeNull();
  });

  it('uses mockFallback.marinePoint when provided', () => {
    const point = { lat: 35, lon: 139 };
    expect(adaptSite(backend, { marinePoint: point }).marinePoint).toEqual(point);
  });

  it('sets status to ok by default', () => {
    expect(adaptSite(backend).status).toBe('ok');
  });

  it('sets manager, contractor, period to em-dash by default', () => {
    const a = adaptSite(backend);
    expect(a.manager).toBe('—');
    expect(a.contractor).toBe('—');
    expect(a.period).toBe('—');
  });

  it('applies DEFAULT_THRESHOLDS when not in fallback', () => {
    expect(adaptSite(backend).thresholds).toEqual({
      windSpeed: 10,
      waveHeight: 1.5,
      rainfall: 5,
      tempLow: 5,
      tempHigh: 35,
    });
  });

  it('propagates address and jmaStationId', () => {
    const a = adaptSite(backend);
    expect(a.address).toBe('Tokyo Bay');
    expect(a.jmaStationId).toBe('44132');
  });
});

// ---------------------------------------------------------------------------
// fetchSitesFromBackend
// ---------------------------------------------------------------------------

describe('fetchSitesFromBackend', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('returns array of BackendSite on success', async () => {
    const sites = [{ id: 1, code: 'A', name: 'N', kind: 'land', lat: 0, lon: 0 }];
    mockFetch.mockResolvedValue(okResponse(sites));
    expect(await fetchSitesFromBackend()).toEqual(sites);
  });

  it('returns [] when backend returns a non-array', async () => {
    mockFetch.mockResolvedValue(okResponse({ error: 'unexpected' }));
    expect(await fetchSitesFromBackend()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetchLatestWeather
// ---------------------------------------------------------------------------

describe('fetchLatestWeather', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('returns weather data on success', async () => {
    const data = { temperature_c: 22.4 };
    mockFetch.mockResolvedValue(okResponse(data));
    expect(await fetchLatestWeather(1)).toEqual(data);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(failResponse(404, 'not found'));
    expect(await fetchLatestWeather(1)).toBeNull();
  });

  it('throws APIError on non-404 HTTP errors', async () => {
    mockFetch.mockResolvedValue(failResponse(500, 'server error'));
    await expect(fetchLatestWeather(1)).rejects.toBeInstanceOf(APIError);
  });

  it('includes url-encoded siteId in query string', async () => {
    mockFetch.mockResolvedValue(okResponse(null));
    await fetchLatestWeather('site-01').catch(() => null);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('site_id=site-01');
  });
});

// ---------------------------------------------------------------------------
// fetchLatestMarine
// ---------------------------------------------------------------------------

describe('fetchLatestMarine', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('returns marine data on success', async () => {
    const data = { sig_wave_h_m: 1.2 };
    mockFetch.mockResolvedValue(okResponse(data));
    expect(await fetchLatestMarine(2)).toEqual(data);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(failResponse(404, 'not found'));
    expect(await fetchLatestMarine(2)).toBeNull();
  });

  it('throws APIError on non-404 HTTP errors', async () => {
    mockFetch.mockResolvedValue(failResponse(503, 'unavailable'));
    await expect(fetchLatestMarine(2)).rejects.toBeInstanceOf(APIError);
  });
});

// ---------------------------------------------------------------------------
// fetchThresholdsForSite
// ---------------------------------------------------------------------------

describe('fetchThresholdsForSite', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('includes site_id in query string', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchThresholdsForSite(5);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('site_id=5');
  });

  it('includes work_type when provided', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchThresholdsForSite(5, 'crane');
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('work_type=crane');
  });

  it('omits work_type when not provided', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await fetchThresholdsForSite(5);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).not.toContain('work_type');
  });
});

// ---------------------------------------------------------------------------
// fetchAuditLog
// ---------------------------------------------------------------------------

describe('fetchAuditLog', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('uses default limit=50 when called without args', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    await fetchAuditLog();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('limit=50');
  });

  it('uses custom limit when provided', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    await fetchAuditLog({ limit: 10 });
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('limit=10');
  });

  it('includes action filter when provided', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    await fetchAuditLog({ action: 'observation.weather.ingest' });
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('action=observation.weather.ingest');
  });

  it('includes actor filter when provided', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    await fetchAuditLog({ actor: 'admin' });
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('actor=admin');
  });

  it('omits action and actor when not provided', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    await fetchAuditLog({ limit: 5 });
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).not.toContain('action=');
    expect(url).not.toContain('actor=');
  });
});

// ---------------------------------------------------------------------------
// requestDecisionFromBackend
// ---------------------------------------------------------------------------

describe('requestDecisionFromBackend', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => { mockFetch = vi.fn(); vi.stubGlobal('fetch', mockFetch); });
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to /decisions with correct Content-Type header', async () => {
    mockFetch.mockResolvedValue(okResponse({ status: 'ok' }));
    await requestDecisionFromBackend({
      siteId: 1, workType: 'crane',
      windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-01-01T03:00:00Z',
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('includes site_id and work_type in JSON body', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await requestDecisionFromBackend({
      siteId: 42, workType: 'concrete',
      windowStart: '2026-01-01T00:00:00Z', windowEnd: '2026-01-01T03:00:00Z',
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.site_id).toBe(42);
    expect(body.work_type).toBe('concrete');
  });

  it('uses provided windowStart and windowEnd verbatim', async () => {
    mockFetch.mockResolvedValue(okResponse({}));
    await requestDecisionFromBackend({
      siteId: 1,
      windowStart: '2026-05-01T00:00:00Z',
      windowEnd: '2026-05-01T06:00:00Z',
    });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.window_start).toBe('2026-05-01T00:00:00Z');
    expect(body.window_end).toBe('2026-05-01T06:00:00Z');
  });

  it('generates a 3-hour default window when windowStart/End not provided', async () => {
    const before = Date.now();
    mockFetch.mockResolvedValue(okResponse({}));
    await requestDecisionFromBackend({ siteId: 1 });
    const after = Date.now();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const t0 = new Date(body.window_start as string).getTime();
    const t1 = new Date(body.window_end as string).getTime();
    expect(t1).toBeGreaterThanOrEqual(before);
    expect(t1).toBeLessThanOrEqual(after);
    const diff = t1 - t0;
    expect(diff).toBeGreaterThanOrEqual(3 * 3600 * 1000 - 1000);
    expect(diff).toBeLessThanOrEqual(3 * 3600 * 1000 + 1000);
  });
});

// ---------------------------------------------------------------------------
// initFromBackend
// ---------------------------------------------------------------------------

describe('initFromBackend', () => {
  type FakeWindow = {
    SITES: unknown[];
    MOCK_SITES: unknown;
    BACKEND_STATUS: unknown;
  };
  const fakeWindow: FakeWindow = { SITES: [], MOCK_SITES: undefined, BACKEND_STATUS: undefined };
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeWindow.SITES = [];
    fakeWindow.MOCK_SITES = undefined;
    fakeWindow.BACKEND_STATUS = undefined;
    vi.stubGlobal('window', fakeWindow);
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns true and populates window.SITES when backend has sites', async () => {
    const sites: BackendSite[] = [
      { id: 1, code: 'A', name: 'Alpha Site', kind: 'land', lat: 35, lon: 139, jma_station_id: '44132' },
    ];
    mockFetch.mockResolvedValue(okResponse(sites));
    const result = await initFromBackend();
    expect(result).toBe(true);
    expect(Array.isArray(fakeWindow.SITES)).toBe(true);
    expect((fakeWindow.SITES as AdaptedSite[])[0].id).toBe(1);
    expect((fakeWindow.BACKEND_STATUS as { ok: boolean }).ok).toBe(true);
  });

  it('returns false when backend returns 0 sites', async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    const result = await initFromBackend();
    expect(result).toBe(false);
    expect((fakeWindow.BACKEND_STATUS as { ok: boolean; reason: string }).reason).toBe('empty');
  });

  it('returns false when fetch throws (backend unreachable)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'));
    const result = await initFromBackend();
    expect(result).toBe(false);
    expect((fakeWindow.BACKEND_STATUS as { ok: boolean; reason: string }).reason).toBe('unreachable');
  });

  it('saves existing SITES as MOCK_SITES before overwriting', async () => {
    fakeWindow.SITES = [{ id: 'mock-01' }];
    mockFetch.mockResolvedValue(okResponse([]));
    await initFromBackend();
    expect(Array.isArray(fakeWindow.MOCK_SITES)).toBe(true);
    expect((fakeWindow.MOCK_SITES as unknown[])[0]).toEqual({ id: 'mock-01' });
  });
});
