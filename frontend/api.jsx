/* ============================================
   Backend API adapter
   --------------------------------------------
   Bridges the existing prototype (which expects synchronous
   `window.SITES` and `getDecision(site)`) to the FastAPI backend
   at http://<host>:8003/api/v1. Falls back to mock data when the
   backend is unreachable so the UI keeps rendering offline.
   ============================================ */

const WMCDSS_API_BASE = (() => {
  // Same-host, fixed backend port. Override by setting window.WMCDSS_API_BASE before this script.
  if (typeof window !== 'undefined' && window.WMCDSS_API_BASE) return window.WMCDSS_API_BASE;
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
  return `http://${host}:8003/api/v1`;
})();

window.WMCDSS_API_BASE = WMCDSS_API_BASE;

// --- shape adapters ---------------------------------------------------------

// Backend kind ("land"|"marine"|"both") matches prototype `type`, so we just rename.
// Thresholds aren't returned per-site by /sites yet; we keep mock thresholds for now
// but tag the site with `backend: true` so UI can show real vs. mock provenance.
function adaptSite(backendSite, mockFallback) {
  const fallback = mockFallback || {};
  return {
    id: backendSite.id,
    code: backendSite.code,
    name: backendSite.name,
    shortName: fallback.shortName || backendSite.name.slice(0, 8),
    type: backendSite.kind,
    lat: backendSite.lat,
    lng: backendSite.lon,
    station: fallback.station || backendSite.jma_station_id || '',
    marinePoint: fallback.marinePoint || null,
    status: fallback.status || 'ok',
    manager: fallback.manager || '—',
    contractor: fallback.contractor || '—',
    period: fallback.period || '—',
    thresholds: fallback.thresholds || {
      windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 5, tempHigh: 35,
    },
    address: backendSite.address,
    jmaStationId: backendSite.jma_station_id,
    backend: true,
  };
}

// --- fetchers ---------------------------------------------------------------

// Typed error so callers can branch on status instead of substring-matching messages.
class APIError extends Error {
  constructor({ status, url, body }) {
    super(`API ${status} ${url}: ${(body || '').slice(0, 200)}`);
    this.name = 'APIError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

async function fetchJSON(path, init) {
  const url = path.startsWith('http') ? path : `${WMCDSS_API_BASE}${path}`;
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new APIError({ status: resp.status, url, body });
  }
  return resp.json();
}

async function fetchSitesFromBackend() {
  const list = await fetchJSON('/sites');
  return Array.isArray(list) ? list : [];
}

async function fetchLatestWeather(siteId) {
  try {
    return await fetchJSON(`/observations/weather/latest?site_id=${encodeURIComponent(siteId)}`);
  } catch (err) {
    if (err instanceof APIError && err.status === 404) return null;
    throw err;
  }
}

async function fetchLatestMarine(siteId) {
  try {
    return await fetchJSON(`/observations/marine/latest?site_id=${encodeURIComponent(siteId)}`);
  } catch (err) {
    if (err instanceof APIError && err.status === 404) return null;
    throw err;
  }
}

async function fetchThresholdsForSite(siteId, workType) {
  const qs = new URLSearchParams({ site_id: siteId });
  if (workType) qs.set('work_type', workType);
  return fetchJSON(`/thresholds?${qs.toString()}`);
}

async function fetchAuditLog({ limit = 50, action, actor } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (action) qs.set('action', action);
  if (actor) qs.set('actor', actor);
  return fetchJSON(`/audit?${qs.toString()}`);
}

async function requestDecisionFromBackend({ siteId, workType, windowStart, windowEnd }) {
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

// --- boot-time initialisation ------------------------------------------------
// Called once from index.html before ReactDOM.render so synchronous components
// can keep reading window.SITES.
async function initFromBackend() {
  // Keep the original mock data accessible for fallback / dev offline.
  const mockSites = Array.isArray(window.SITES) ? window.SITES : [];
  window.MOCK_SITES = mockSites;

  try {
    const backendSites = await fetchSitesFromBackend();
    if (backendSites.length === 0) {
      console.warn('[wmcdss] backend returned 0 sites; keeping mock data');
      window.BACKEND_STATUS = { ok: false, reason: 'empty', sites: 0 };
      return false;
    }
    const adapted = backendSites.map((bs, idx) => adaptSite(bs, mockSites[idx]));
    window.SITES = adapted;
    window.BACKEND_STATUS = { ok: true, base: WMCDSS_API_BASE, sites: adapted.length };
    console.info(`[wmcdss] loaded ${adapted.length} sites from ${WMCDSS_API_BASE}`);
    return true;
  } catch (err) {
    console.warn('[wmcdss] backend unreachable, using mock data:', err.message);
    window.BACKEND_STATUS = { ok: false, reason: 'unreachable', error: String(err) };
    return false;
  }
}

window.WMCDSS_API = {
  base: WMCDSS_API_BASE,
  APIError,
  fetchJSON,
  fetchSitesFromBackend,
  fetchLatestWeather,
  fetchLatestMarine,
  fetchThresholdsForSite,
  fetchAuditLog,
  requestDecisionFromBackend,
  initFromBackend,
  adaptSite,
};
