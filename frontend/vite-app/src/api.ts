// Backend API adapter — Phase 1 ESM port of ../../api.jsx.
//
// Dual surface:
//   1. ESM exports for subsequent .jsx → .tsx ports inside vite-app/src/.
//   2. window.WMCDSS_API / window.WMCDSS_API_BASE side effects so the
//      legacy Babel Standalone bundle at ../../index.html keeps working
//      if it ever loads this build instead.
//
// Behavior is intentionally byte-equivalent to api.jsx so we can swap
// callers one at a time without subtle drift.

export interface BackendSite {
  id: number;
  code: string;
  name: string;
  kind: 'land' | 'marine' | 'both';
  lat: number;
  lon: number;
  address?: string | null;
  jma_station_id?: string | null;
}

export interface SiteThresholds {
  windSpeed: number;
  waveHeight: number;
  rainfall: number;
  tempLow: number;
  tempHigh: number;
}

export interface AdaptedSite {
  id: number;
  code: string;
  name: string;
  shortName: string;
  type: BackendSite['kind'];
  area: string;
  lat: number;
  lng: number;
  station: string;
  marinePoint: unknown;
  status: string;
  manager: string;
  contractor: string;
  period: string;
  thresholds: SiteThresholds;
  address?: string | null;
  jmaStationId?: string | null;
  backend: true;
}

export interface DecisionRequest {
  siteId: number;
  workType?: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface AiAssistResponse {
  summary: string;
  bullets: string[];
  recommendations: string[];
  analysis_type: string;
  disclaimer: string;
}

const DEFAULT_THRESHOLDS: SiteThresholds = {
  windSpeed: 10,
  waveHeight: 1.5,
  rainfall: 5,
  tempLow: 5,
  tempHigh: 35,
};

declare global {
  interface Window {
    WMCDSS_API_BASE?: string;
    WMCDSS_API?: WmcdssApi;
    SITES?: unknown[];
    MOCK_SITES?: unknown[];
    BACKEND_STATUS?: { ok: boolean; reason?: string; sites?: number; base?: string; error?: string };
  }
}

export const WMCDSS_API_BASE: string = (() => {
  if (typeof window !== 'undefined' && window.WMCDSS_API_BASE) return window.WMCDSS_API_BASE;
  const viteBase = import.meta.env.VITE_WMCDSS_API_BASE;
  if (viteBase) return viteBase;
  if (typeof window === 'undefined') return 'http://localhost:8003/api/v1';
  const host =
    (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
  const port = typeof window !== 'undefined' && window.location ? window.location.port : '';
  if (port === '5173') return `http://${host}:8003/api/v1`;
  return '/api/v1';
})();

if (typeof window !== 'undefined') {
  window.WMCDSS_API_BASE = WMCDSS_API_BASE;
}

export class APIError extends Error {
  status: number;
  url: string;
  body: string;
  constructor({ status, url, body }: { status: number; url: string; body: string }) {
    super(`API ${status} ${url}: ${(body || '').slice(0, 200)}`);
    this.name = 'APIError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export async function fetchJSON<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${WMCDSS_API_BASE}${path}`;
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new APIError({ status: resp.status, url, body });
  }
  return resp.json() as Promise<T>;
}

export function adaptSite(backendSite: BackendSite, mockFallback?: Partial<AdaptedSite>): AdaptedSite {
  const fallback = mockFallback || {};
  return {
    id: backendSite.id,
    code: backendSite.code,
    name: backendSite.name,
    shortName: fallback.shortName || backendSite.name.slice(0, 8),
    type: backendSite.kind,
    area: fallback.area || '',
    lat: backendSite.lat,
    lng: backendSite.lon,
    station: fallback.station || backendSite.jma_station_id || '',
    marinePoint: fallback.marinePoint ?? null,
    status: fallback.status || 'ok',
    manager: fallback.manager || '—',
    contractor: fallback.contractor || '—',
    period: fallback.period || '—',
    thresholds: fallback.thresholds || DEFAULT_THRESHOLDS,
    address: backendSite.address,
    jmaStationId: backendSite.jma_station_id,
    backend: true,
  };
}

export async function fetchSitesFromBackend(): Promise<BackendSite[]> {
  const list = await fetchJSON<BackendSite[]>('/sites');
  return Array.isArray(list) ? list : [];
}

export async function fetchLatestWeather(siteId: number | string): Promise<unknown | null> {
  try {
    return await fetchJSON(`/observations/weather/latest?site_id=${encodeURIComponent(String(siteId))}`);
  } catch (err) {
    if (err instanceof APIError && err.status === 404) return null;
    throw err;
  }
}

export async function fetchLatestMarine(siteId: number | string): Promise<unknown | null> {
  try {
    return await fetchJSON(`/observations/marine/latest?site_id=${encodeURIComponent(String(siteId))}`);
  } catch (err) {
    if (err instanceof APIError && err.status === 404) return null;
    throw err;
  }
}

export async function fetchThresholdsForSite(
  siteId: number | string,
  workType?: string,
): Promise<unknown> {
  const qs = new URLSearchParams({ site_id: String(siteId) });
  if (workType) qs.set('work_type', workType);
  return fetchJSON(`/thresholds?${qs.toString()}`);
}

export async function fetchAuditLog(
  { limit = 50, action, actor }: { limit?: number; action?: string; actor?: string } = {},
): Promise<unknown> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (action) qs.set('action', action);
  if (actor) qs.set('actor', actor);
  return fetchJSON(`/audit?${qs.toString()}`);
}

export async function requestDecisionFromBackend({
  siteId,
  workType,
  windowStart,
  windowEnd,
}: DecisionRequest): Promise<unknown> {
  const now = new Date();
  const t1 = windowEnd || now.toISOString();
  const t0 = windowStart || new Date(now.getTime() - 3 * 3600 * 1000).toISOString();
  return fetchJSON('/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site_id: siteId,
      work_type: workType,
      window_start: t0,
      window_end: t1,
    }),
  });
}

export async function requestAiEtlDiagnose(jobs: unknown[]): Promise<AiAssistResponse> {
  return fetchJSON<AiAssistResponse>('/ai/etl-diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs }),
  });
}

export async function requestAiRiskSummary(sites: unknown[]): Promise<AiAssistResponse> {
  return fetchJSON<AiAssistResponse>('/ai/risk-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sites }),
  });
}

export async function requestAiReportComment(payload: Record<string, unknown>): Promise<AiAssistResponse> {
  return fetchJSON<AiAssistResponse>('/ai/report-comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function requestAiAnomalyDetect(
  observations: unknown[],
  sourceNote?: string,
): Promise<AiAssistResponse> {
  return fetchJSON<AiAssistResponse>('/ai/anomaly-detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ observations, source_note: sourceNote }),
  });
}

export async function requestAiChat(
  question: string,
  context: Record<string, unknown>,
): Promise<AiAssistResponse> {
  return fetchJSON<AiAssistResponse>('/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
}

export async function initFromBackend(): Promise<boolean> {
  const mockSites = Array.isArray(window.SITES) ? window.SITES : [];
  window.MOCK_SITES = mockSites;

  try {
    const backendSites = await fetchSitesFromBackend();
    if (backendSites.length === 0) {
      console.warn('[wmcdss] backend returned 0 sites; keeping mock data');
      window.BACKEND_STATUS = { ok: false, reason: 'empty', sites: 0 };
      return false;
    }
    const adapted = backendSites.map((bs, idx) =>
      adaptSite(bs, (mockSites[idx] as Partial<AdaptedSite>) || undefined),
    );
    window.SITES = adapted;
    window.BACKEND_STATUS = { ok: true, base: WMCDSS_API_BASE, sites: adapted.length };
    console.info(`[wmcdss] loaded ${adapted.length} sites from ${WMCDSS_API_BASE}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[wmcdss] backend unreachable, using mock data:', msg);
    window.BACKEND_STATUS = { ok: false, reason: 'unreachable', error: String(err) };
    return false;
  }
}

export interface WmcdssApi {
  base: string;
  APIError: typeof APIError;
  fetchJSON: typeof fetchJSON;
  fetchSitesFromBackend: typeof fetchSitesFromBackend;
  fetchLatestWeather: typeof fetchLatestWeather;
  fetchLatestMarine: typeof fetchLatestMarine;
  fetchThresholdsForSite: typeof fetchThresholdsForSite;
  fetchAuditLog: typeof fetchAuditLog;
  requestDecisionFromBackend: typeof requestDecisionFromBackend;
  requestAiEtlDiagnose: typeof requestAiEtlDiagnose;
  requestAiRiskSummary: typeof requestAiRiskSummary;
  requestAiReportComment: typeof requestAiReportComment;
  requestAiAnomalyDetect: typeof requestAiAnomalyDetect;
  requestAiChat: typeof requestAiChat;
  initFromBackend: typeof initFromBackend;
  adaptSite: typeof adaptSite;
}

export const WMCDSS_API: WmcdssApi = {
  base: WMCDSS_API_BASE,
  APIError,
  fetchJSON,
  fetchSitesFromBackend,
  fetchLatestWeather,
  fetchLatestMarine,
  fetchThresholdsForSite,
  fetchAuditLog,
  requestDecisionFromBackend,
  requestAiEtlDiagnose,
  requestAiRiskSummary,
  requestAiReportComment,
  requestAiAnomalyDetect,
  requestAiChat,
  initFromBackend,
  adaptSite,
};

if (typeof window !== 'undefined') {
  window.WMCDSS_API = WMCDSS_API;
}
