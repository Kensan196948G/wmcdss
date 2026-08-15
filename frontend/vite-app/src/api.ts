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

import { authHeader, notifyUnauthorized } from './auth-token';

export interface BackendSite {
  id: number | string;
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
  id: number | string;
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
  siteId: number | string;
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

export interface DashboardSiteSummary {
  site_id: string;
  code: string;
  name: string;
  kind: 'land' | 'marine' | 'both';
  status: 'go' | 'caution' | 'stop';
  reason: string;
  work_types: { work_type: string; status: string; reason: string; evaluated: number }[];
  weather_observed_at: string | null;
  marine_observed_at: string | null;
  weather_fresh: boolean;
  marine_fresh: boolean;
  data_complete: boolean;
  latest_weather: {
    temperature_c: number | null;
    humidity_pct: number | null;
    precip_mm: number | null;
    wind_speed_ms: number | null;
    wind_gust_ms: number | null;
  } | null;
  latest_marine: {
    sig_wave_h_m: number | null;
    wave_period_s: number | null;
  } | null;
}

export interface DashboardSummaryResponse {
  generated_at: string;
  count: number;
  sites: DashboardSiteSummary[];
}

export interface BackendWeatherObs {
  id: number;
  site_id: string;
  observed_at: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  precip_mm: number | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  wind_dir_deg: number | null;
  sunshine_h: number | null;
  source?: string | null;
}

export interface BackendMarineObs {
  id: number;
  site_id: string;
  observed_at: string;
  sig_wave_h_m: number | null;
  wave_period_s: number | null;
  wave_dir_deg: number | null;
  tide_level_m: number | null;
  current_speed_ms: number | null;
  current_dir_deg: number | null;
  source?: string | null;
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

export function backendConnected(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.BACKEND_STATUS !== undefined &&
    window.BACKEND_STATUS.ok === true
  );
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

/**
 * バックエンド API への共通 fetch。
 *
 * ここが全ての API 呼び出しの単一の通り道なので、Authorization ヘッダーの
 * 付与もここ 1 箇所で行う。呼び出し側それぞれに付けさせると、付け忘れた
 * 経路だけが 401 になり、しかもそれは「認証を足した時」ではなく
 * 「新しい呼び出しを書いた時」に発覚するため原因が見えにくい。
 *
 * ヘッダーは authHeader() を先に展開し、呼び出し側指定を後に置く。
 * 呼び出し側が明示した Content-Type 等を壊さないためであり、同時に
 * 呼び出し側が意図的に別の Authorization を渡す余地も残る。
 */
export async function fetchJSON<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : `${WMCDSS_API_BASE}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: { ...authHeader(), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 401) {
      // トークンが無効か期限切れ。保持し続けても以降の呼び出しが全て
      // 失敗するだけなので破棄し、ログイン画面へ戻すよう通知する。
      // 破棄してから投げるので、この後の APIError を握り潰す呼び出し側が
      // あっても認証状態は正しく巻き戻る。
      notifyUnauthorized();
    }
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

export async function fetchDashboardSummary(): Promise<DashboardSummaryResponse> {
  return fetchJSON<DashboardSummaryResponse>('/dashboard');
}

export async function fetchWeatherObservations(
  siteId: number | string,
  limit = 48,
): Promise<BackendWeatherObs[]> {
  const qs = new URLSearchParams({ site_id: String(siteId), limit: String(limit) });
  return fetchJSON<BackendWeatherObs[]>(`/observations/weather?${qs.toString()}`);
}

export async function fetchMarineObservations(
  siteId: number | string,
  limit = 48,
): Promise<BackendMarineObs[]> {
  const qs = new URLSearchParams({ site_id: String(siteId), limit: String(limit) });
  return fetchJSON<BackendMarineObs[]>(`/observations/marine?${qs.toString()}`);
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
      adaptSite(bs, (mockSites[idx] as unknown as Partial<AdaptedSite>) || undefined),
    );
    // AdaptedSite は backend 由来（id: number）で data.ts の Site（id: string）と
    // 型が異なる。実行時互換のためここで変換する（既存の dual-surface 契約）。
    window.SITES = adapted as unknown as import('./data').Site[];
    window.BACKEND_STATUS = { ok: true, base: WMCDSS_API_BASE, sites: adapted.length };
    // window.SITES が backend 版（UUID id）へ置き換わったことをページへ通知する。
    // weather-marine / site-pages / dashboard 等はモジュール import の SITES を
    // 参照しているため、このイベントを購読して再解決する必要がある。
    // テスト環境（fakeWindow に dispatchEvent が無い等）では失敗しても無視する。
    try {
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('wmcdss:sites-updated', { detail: { sites: adapted.length } }));
      }
    } catch (e) {
      console.warn('[wmcdss] sites-updated event dispatch failed:', e);
    }
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
  fetchDashboardSummary: typeof fetchDashboardSummary;
  fetchWeatherObservations: typeof fetchWeatherObservations;
  fetchMarineObservations: typeof fetchMarineObservations;
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
  fetchDashboardSummary,
  fetchWeatherObservations,
  fetchMarineObservations,
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
