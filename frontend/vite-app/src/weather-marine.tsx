// Phase 1 ESM port of ../../weather-marine.jsx.
//
// Dual surface (mirrors api.ts / charts.tsx / data.ts / decisions.tsx / dashboard.tsx):
//   1. Named ESM exports — WeatherPage, MarinePage.
//   2. window.{WeatherPage, MarinePage} side effects so the legacy Babel
//      Standalone bundle keeps rendering these pages if it loads this build
//      instead of weather-marine.jsx.

import { useEffect, useMemo, useState, type FC } from 'react';
import { BarChart, ChartColors, LineChart, WindRose } from './charts';
import {
  backendConnected,
  fetchMarineObservations,
  fetchWeatherObservations,
} from './api';
import {
  FORECAST_DAYS,
  SITES,
  WEATHER_ICONS,
  generateHourlyWave,
  generateHourlyWind,
  generateMarine,
  generateWeather,
  type CompassDir,
  type MarineSample,
  type Site,
  type WeatherSample,
} from './data';

// ---------------------------------------------------------------------------
// Backend response shapes (as documented by the API)
// ---------------------------------------------------------------------------

import type { BackendMarineObs, BackendWeatherObs } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert 0-360° bearing to 16-point compass direction. */
function degToCompass(deg: number): CompassDir {
  const dirs: CompassDir[] = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Format ISO8601 timestamp to readable Japanese locale string. */
function formatObsTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Current date/time in Japanese locale (used for hardcoded-date replacement). */
function nowJa(): string {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Adapt backend weather observation to the local WeatherSample shape. */
function adaptBackendWeather(obs: BackendWeatherObs): WeatherSample {
  // 実データ接続時は欠測値をモックで埋めない。「—」表示して
  // 実値と混同させない（誤判定の防止）。
  return {
    temp:     obs.temperature_c  ?? null,
    hum:      obs.humidity_pct   ?? null,
    pressure: obs.pressure_hpa   ?? null,
    wind:     obs.wind_speed_ms  ?? null,
    windDir:  obs.wind_dir_deg != null ? degToCompass(obs.wind_dir_deg) : null,
    rain:     obs.precip_mm      ?? null,
  };
}

/** Adapt backend marine observation to the local MarineSample shape. */
function adaptBackendMarine(obs: BackendMarineObs, siteId: string): MarineSample {
  void siteId; // モック埋めを廃止したため siteId は参照しない（互換のため残置）
  return {
    waveHeight: obs.sig_wave_h_m   ?? null,
    wavePeriod: obs.wave_period_s  ?? null,
    waveDir:    obs.wave_dir_deg != null ? degToCompass(obs.wave_dir_deg) : null,
    tide:       null,
    tideLevel:  obs.tide_level_m   ?? null,
  };
}

function fmtVal(v: number | null | undefined, digits = 1, suffix = ''): string {
  return v == null || Number.isNaN(v) ? '—' : `${v.toFixed(digits)}${suffix}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WeatherTab = 'current' | 'hourly' | 'table';

interface PageProps {
  navigate?: (page: string, payload?: unknown) => void;
  selectedSite?: string;
}

type StatAlert = 'danger' | 'warn' | null;

interface StatItem {
  label: string;
  value: number | string;
  unit: string;
  icon: string;
  alert?: StatAlert;
}

// ---------------------------------------------------------------------------
// Live SITES accessor
//
// data.ts の `export const SITES` はモジュールロード時の固定値であり、
// initFromBackend() が window.SITES を backend 版（UUID id）へ置き換えても
// 静的 import 側は更新されない。気象/海象の観測 API は UUID を要求するため、
// このフックで window.SITES（backend 版）を参照し、置き換え完了イベントで
// 再レンダリングする。
// ---------------------------------------------------------------------------

export function useLiveSites(): Site[] {
  // window.SITES は initFromBackend() 成功後に backend 版（AdaptedSite, id: number）
  // へ置き換わる。それ以外（初期値・テストの vi.doMock）は data.ts の
  // mock Site（id: string）なので、モジュール import の SITES を使う。
  const isBackendSite = (s: unknown): s is Site => {
    if (s == null || typeof s !== 'object') return false;
    const id = (s as { id?: unknown }).id;
    return typeof id === 'number';
  };

  const [sites, setSites] = useState<Site[]>(() => {
    const live = (window as Window & { SITES?: unknown }).SITES;
    if (Array.isArray(live) && live.length > 0 && isBackendSite(live[0])) {
      return live as Site[];
    }
    return SITES;
  });

  useEffect(() => {
    const onUpdated = () => {
      const live = (window as Window & { SITES?: unknown }).SITES;
      if (Array.isArray(live) && live.length > 0 && isBackendSite(live[0])) {
        setSites(live as Site[]);
      }
    };
    window.addEventListener('wmcdss:sites-updated', onUpdated);
    return () => window.removeEventListener('wmcdss:sites-updated', onUpdated);
  }, []);

  return sites;
}

// ---------------------------------------------------------------------------
// WeatherPage
// ---------------------------------------------------------------------------

export const WeatherPage: FC<PageProps> = ({ selectedSite }) => {
  const liveSites = useLiveSites();
  const [siteId, setSiteId] = useState<string>(
    () => selectedSite || (liveSites[0]?.id ?? SITES[0].id),
  );
  const site = liveSites.find((s) => s.id === siteId) || liveSites[0] || SITES[0];

  // liveSites が backend 版（UUID）へ置き換わったら、選択中 id が mock id の
  // ままだと API が 422 になるため、backend 版の先頭サイトへ追従させる。
  // ユーザーが明示的に選択済み（selectedSite が UUID）の場合はそれを維持する。
  useEffect(() => {
    if (liveSites.length === 0) return;
    const exists = liveSites.some((s) => s.id === siteId);
    if (!exists) {
      setSiteId(liveSites[0].id);
    }
  }, [liveSites, siteId]);

  // Backend data state
  const [backendW, setBackendW] = useState<WeatherSample | null>(null);
  const [obsTime, setObsTime]   = useState<string>('');
  const [isLiveData, setIsLiveData] = useState(false);
  const [hourlyObs, setHourlyObs] = useState<BackendWeatherObs[] | null>(null);

  useEffect(() => {
    setBackendW(null);
    setObsTime('');
    setIsLiveData(false);
    setHourlyObs(null);

    const api = (window as Window & { WMCDSS_API?: { fetchLatestWeather?: (id: string) => Promise<unknown> } }).WMCDSS_API;
    if (!api?.fetchLatestWeather) return;

    let cancelled = false;
    api.fetchLatestWeather(site.id).then((raw) => {
      if (cancelled || !raw || typeof raw !== 'object') return;
      const obs = raw as BackendWeatherObs;
      setBackendW(adaptBackendWeather(obs));
      setObsTime(obs.observed_at ? formatObsTime(obs.observed_at) : '');
      setIsLiveData(true);
    }).catch(() => {
      // silently fall back to mock data
    });

    return () => { cancelled = true; };
  }, [site.id]);

  // 実データ接続時はモックにフォールバックしない。取得失敗時は「—」表示。
  const w = backendW ?? (backendConnected() ? null : generateWeather(site.id));

  useEffect(() => {
    if (!backendConnected()) return;
    let cancelled = false;
    fetchWeatherObservations(site.id, 48)
      .then((rows) => { if (!cancelled) setHourlyObs(rows); })
      .catch(() => { if (!cancelled) setHourlyObs([]); });
    return () => { cancelled = true; };
  }, [site.id]);

  const hourlyWind = useMemo(() => {
    if (hourlyObs) {
      return hourlyObs
        .map((o) => ({
          hour: new Date(o.observed_at).getHours(),
          speed: o.wind_speed_ms ?? 0,
        }))
        .reverse();
    }
    return generateHourlyWind();
  }, [hourlyObs, siteId]);
  const [tab, setTab] = useState<WeatherTab>('current');

  const hourlyTemp = useMemo(() => {
    if (hourlyObs) {
      return hourlyObs
        .map((o) => ({
          hour: new Date(o.observed_at).getHours(),
          temp: o.temperature_c ?? 0,
        }))
        .reverse();
    }
    if (w == null) return [];
    const out: { hour: number; temp: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const base = (w.temp ?? 15) - 3 + Math.sin(((h - 6) / 24) * Math.PI * 2) * 4;
      out.push({ hour: h, temp: +(base + (Math.random() - 0.5)).toFixed(1) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourlyObs, siteId, w]);

  const hourlyRain = useMemo(() => {
    if (hourlyObs) {
      return hourlyObs
        .map((o) => ({
          hour: new Date(o.observed_at).getHours(),
          rain: o.precip_mm ?? 0,
        }))
        .reverse();
    }
    if (w == null) return [];
    const out: { hour: number; rain: number }[] = [];
    for (let h = 0; h < 24; h++) {
      out.push({ hour: h, rain: +Math.max(0, (w.rain ?? 0) + (Math.random() - 0.7) * 3).toFixed(1) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hourlyObs, siteId, w]);

  const windLimit = site.thresholds.windSpeed;
  const rainLimit = site.thresholds.rainfall;
  const statCards: StatItem[] = [
    { label: '気温', value: w ? fmtVal(w.temp, 1, '') : '—', unit: '℃', icon: '🌡' },
    { label: '湿度', value: w ? fmtVal(w.hum, 0, '') : '—', unit: '%', icon: '💧' },
    { label: '気圧', value: w ? fmtVal(w.pressure, 1, '') : '—', unit: 'hPa', icon: '📊' },
    {
      label: '風速',
      value: w ? fmtVal(w.wind, 1, '') : '—',
      unit: 'm/s',
      icon: '💨',
      alert: w && w.wind != null && w.wind > windLimit ? 'danger'
        : w && w.wind != null && w.wind > windLimit * 0.8 ? 'warn' : null,
    },
    { label: '風向', value: w?.windDir ?? '—', unit: '', icon: '🧭' },
    {
      label: '降水量',
      value: w ? fmtVal(w.rain, 1, '') : '—',
      unit: 'mm/h',
      icon: '🌧',
      alert: w && w.rain != null && w.rain > rainLimit ? 'danger' : null,
    },
  ];

  const tabs: [WeatherTab, string][] = [
    ['current', 'リアルタイム'],
    ['hourly', '時間推移'],
    ['table', 'データ表'],
  ];

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>
            現場選択
          </label>
          <select
            className="form-select"
            style={{ width: 280 }}
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {liveSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            className={`badge ${isLiveData ? 'badge-ok' : backendConnected() ? 'badge-danger' : 'badge-warn'}`}
            style={{ fontSize: 11 }}
          >
            {isLiveData ? '実データ' : backendConnected() ? 'データなし' : 'サンプルデータ'}
          </span>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            観測所: {site.station} ／ 最終取得: {obsTime || nowJa()}
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            className={`tab ${tab === k ? 'active' : ''}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'current' && (
        <div>
          <div className="grid-3 mb-16">
            {statCards.map((item, i) => (
              <div className="stat-card" key={i}>
                <div className="stat-label">
                  {item.icon} {item.label}
                </div>
                <div
                  className="stat-value"
                  style={{
                    color:
                      item.alert === 'danger'
                        ? 'var(--status-danger)'
                        : item.alert === 'warn'
                        ? 'var(--status-warn)'
                        : 'var(--blue-600)',
                  }}
                >
                  {item.value}
                  <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>{item.unit}</span>
                </div>
                {item.alert && (
                  <div
                    className="stat-sub"
                    style={{
                      color:
                        item.alert === 'danger' ? 'var(--status-danger)' : 'var(--status-warn)',
                    }}
                  >
                    基準値{item.alert === 'danger' ? '超過' : '接近'}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <span className="card-title">風配図</span>
              </div>
              <div className="card-body" style={{ display: 'flex', justifyContent: 'center' }}>
                {backendConnected() ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '24px 0' }}>
                    風配図は観測データの蓄積後に表示されます（現在は固定サンプルを表示しません）。
                  </div>
                ) : (
                  <WindRose
                    data={[
                      { dir: 'N', value: 2.1 },
                      { dir: 'NE', value: 1.8 },
                      { dir: 'E', value: 2.5 },
                      { dir: 'SE', value: 3.2 },
                      { dir: 'S', value: 4.8 },
                      { dir: 'SW', value: 5.1 },
                      { dir: 'W', value: 3.5 },
                      { dir: 'NW', value: 2.2 },
                    ]}
                    size={200}
                  />
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">週間予報</span>
              </div>
              <div className="card-body">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>天気</th>
                      <th>気温</th>
                      <th>降水確率</th>
                      <th>風速</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FORECAST_DAYS.map((d, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{d.date}</td>
                        <td>
                          {WEATHER_ICONS[d.weather]} {d.weather}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {d.tempL}〜{d.tempH}℃
                        </td>
                        <td
                          style={{
                            fontVariantNumeric: 'tabular-nums',
                            color:
                              d.rain >= 60
                                ? 'var(--status-danger)'
                                : d.rain >= 40
                                ? 'var(--status-warn)'
                                : 'inherit',
                          }}
                        >
                          {d.rain}%
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{d.wind} m/s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  ※ 固定サンプル表示です。予報API未接続のため施工判断には使用できません。
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'hourly' && (
        <div>
          <div className="card mb-16">
            <div className="card-header">
              <span className="card-title">風速推移(24時間)</span>
            </div>
            <div className="card-body">
              <LineChart
                data={hourlyWind.map((h) => ({ label: `${h.hour}`, value: h.speed }))}
                width={800}
                height={200}
                threshold={windLimit}
                thresholdLabel={`基準 ${windLimit}m/s`}
                yLabel="風速 (m/s)"
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <span className="card-title">気温推移(24時間)</span>
              </div>
              <div className="card-body">
                <LineChart
                  data={hourlyTemp.map((h) => ({ label: `${h.hour}`, value: h.temp }))}
                  width={400}
                  height={160}
                  color={ChartColors.amber}
                  yLabel="気温 (℃)"
                />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">降水量推移(24時間)</span>
              </div>
              <div className="card-body">
                <BarChart
                  data={hourlyRain.map((h) => ({ label: `${h.hour}`, value: h.rain }))}
                  width={400}
                  height={160}
                  color={ChartColors.lightBlue}
                  yLabel="降水量 (mm)"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'table' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">時間別観測データ</span>
            <button className="btn btn-sm">📥 CSV出力</button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>気温(℃)</th>
                  <th>湿度(%)</th>
                  <th>風速(m/s)</th>
                  <th>風向</th>
                  <th>降水量(mm)</th>
                  <th>気圧(hPa)</th>
                </tr>
              </thead>
              <tbody>
                {hourlyObs
                  ? hourlyObs.map((o, i) => (
                      <tr key={i}>
                        <td>{formatObsTime(o.observed_at)}</td>
                        <td>{fmtVal(o.temperature_c, 1)}</td>
                        <td>{fmtVal(o.humidity_pct, 0)}</td>
                        <td style={{ color: (o.wind_speed_ms ?? 0) > windLimit ? 'var(--status-danger)' : 'inherit' }}>
                          {fmtVal(o.wind_speed_ms, 1)}
                        </td>
                        <td>{o.wind_dir_deg != null ? degToCompass(o.wind_dir_deg) : '—'}</td>
                        <td>{fmtVal(o.precip_mm, 1)}</td>
                        <td>{fmtVal(o.pressure_hpa, 1)}</td>
                      </tr>
                    ))
                  : hourlyWind.map((h, i) => (
                      <tr key={i}>
                        <td>{String(h.hour).padStart(2, '0')}:00</td>
                        <td>{hourlyTemp[i]?.temp}</td>
                        <td>{w ? fmtVal(w.hum, 0) : '—'}</td>
                        <td style={{ color: h.speed > windLimit ? 'var(--status-danger)' : 'inherit' }}>
                          {h.speed}
                        </td>
                        <td>{w?.windDir ?? '—'}</td>
                        <td>{hourlyRain[i]?.rain}</td>
                        <td>{w ? fmtVal(w.pressure, 1) : '—'}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MarinePage
// ---------------------------------------------------------------------------

export const MarinePage: FC<PageProps> = ({ selectedSite }) => {
  const liveSites = useLiveSites();
  const marineSites = useMemo(() => liveSites.filter((s) => s.type !== 'land'), [liveSites]);
  const fallbackId = marineSites[0]?.id ?? '';
  const initialId =
    selectedSite && marineSites.find((s) => s.id === selectedSite) ? selectedSite : fallbackId;
  const [siteId, setSiteId] = useState<string>(initialId);
  const site = marineSites.find((s) => s.id === siteId) || marineSites[0];

  // liveSites が backend 版（UUID）へ置き換わったら選択 id を追従させる。
  useEffect(() => {
    if (marineSites.length === 0) return;
    const exists = marineSites.some((s) => s.id === siteId);
    if (!exists) {
      setSiteId(marineSites[0].id);
    }
  }, [marineSites, siteId]);

  // Backend data state
  const [backendM, setBackendM] = useState<MarineSample | null>(null);
  const [obsTime, setObsTime]   = useState<string>('');
  const [isLiveData, setIsLiveData] = useState(false);
  const [marineSource, setMarineSource] = useState<string>('');
  const [hourlyObs, setHourlyObs] = useState<BackendMarineObs[] | null>(null);

  useEffect(() => {
    if (!site) return;
    setBackendM(null);
    setObsTime('');
    setIsLiveData(false);
    setMarineSource('');
    setHourlyObs(null);

    const api = (window as Window & { WMCDSS_API?: { fetchLatestMarine?: (id: string) => Promise<unknown> } }).WMCDSS_API;
    if (!api?.fetchLatestMarine) return;

    let cancelled = false;
    api.fetchLatestMarine(site.id).then((raw) => {
      if (cancelled || !raw || typeof raw !== 'object') return;
      const obs = raw as BackendMarineObs;
      setBackendM(adaptBackendMarine(obs, site.id));
      setObsTime(obs.observed_at ? formatObsTime(obs.observed_at) : '');
      setMarineSource(obs.source || '');
      setIsLiveData(true);
    }).catch(() => {
      // silently fall back to mock data
    });

    return () => { cancelled = true; };
  }, [site?.id]);

  useEffect(() => {
    if (!site || !backendConnected()) return;
    let cancelled = false;
    fetchMarineObservations(site.id, 48)
      .then((rows) => { if (!cancelled) setHourlyObs(rows); })
      .catch(() => { if (!cancelled) setHourlyObs([]); });
    return () => { cancelled = true; };
  }, [site?.id]);

  const hourlyWave = useMemo(() => {
    if (hourlyObs) {
      return hourlyObs
        .map((o) => ({
          hour: new Date(o.observed_at).getHours(),
          height: o.sig_wave_h_m ?? 0,
        }))
        .reverse();
    }
    return generateHourlyWave();
  }, [hourlyObs, siteId]);

  if (!site) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海象データのある現場がありません
      </div>
    );
  }

  // 実データ接続時はモックにフォールバックしない。
  const m = backendM ?? (backendConnected() ? null : generateMarine(site.id));
  const isReferenceMarine = marineSource === 'open_meteo_marine_info';

  if (!m && !backendConnected()) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海象データのある現場がありません
      </div>
    );
  }

  // marineSites filter guarantees this is set, but the type contract says
  // `number | null` — narrow explicitly so the comparisons below type-check.
  const waveLimit = site.thresholds.waveHeight;
  if (waveLimit === null && !backendConnected()) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海象データのある現場がありません
      </div>
    );
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>
            現場選択
          </label>
          <select
            className="form-select"
            style={{ width: 280 }}
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            {marineSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            className={`badge ${isLiveData ? 'badge-ok' : backendConnected() ? 'badge-danger' : 'badge-warn'}`}
            style={{ fontSize: 11 }}
          >
            {isLiveData ? '実データ' : backendConnected() ? 'データなし' : 'サンプルデータ'}
          </span>
          {isReferenceMarine && (
            <span className="badge badge-warn">情報共有用</span>
          )}
          <span className="badge badge-info">観測点: {site.marinePoint}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            観測日時: {obsTime || (backendConnected() ? 'データなし' : 'サンプルデータ')}
          </span>
        </div>
      </div>

      {isReferenceMarine && (
        <div
          className="mb-16"
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            fontSize: 13,
            background: 'rgba(217, 119, 6, 0.12)',
            color: 'var(--status-warn, #d97706)',
          }}
        >
          Open-Meteo Marine API の参考海象です。情報共有用であり、施工可否判定の根拠には使用しません。
        </div>
      )}

      <div className="grid-3 mb-16">
        <div className="stat-card">
          <div className="stat-label">🌊 有義波高</div>
          <div
            className="stat-value"
            style={{
              color:
                m && m.waveHeight != null && waveLimit != null && m.waveHeight > waveLimit
                  ? 'var(--status-danger)'
                  : m && m.waveHeight != null && waveLimit != null && m.waveHeight > waveLimit * 0.8
                  ? 'var(--status-warn)'
                  : 'var(--blue-600)',
            }}
          >
            {m ? fmtVal(m.waveHeight, 2) : '—'}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">基準値: {waveLimit}m</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">⏱ 波周期</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m ? fmtVal(m.wavePeriod, 1) : '—'}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>秒</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">🧭 卓越波向</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m?.waveDir ?? '—'}
          </div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="stat-card">
          <div className="stat-label">🌊 潮汐</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m?.tide ?? '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">📏 潮位</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m ? fmtVal(m.tideLevel, 2) : '—'}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">有義波高推移(24時間)</span>
        </div>
        <div className="card-body">
          <LineChart
            data={hourlyWave.map((h) => ({ label: `${h.hour}`, value: h.height }))}
            width={800}
            height={200}
            color="#2874a6"
            threshold={waveLimit ?? undefined}
            thresholdLabel={`基準 ${waveLimit}m`}
            yLabel="波高 (m)"
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">時間別海象データ</span>
          <button className="btn btn-sm">📥 CSV出力</button>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>時刻</th>
                <th>有義波高(m)</th>
                <th>周期(s)</th>
                <th>波向</th>
                <th>潮位(m)</th>
              </tr>
            </thead>
            <tbody>
              {hourlyObs
                ? hourlyObs.map((o, i) => (
                    <tr key={i}>
                      <td>{formatObsTime(o.observed_at)}</td>
                      <td
                        style={{
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: waveLimit != null && (o.sig_wave_h_m ?? 0) > waveLimit ? 'var(--status-danger)' : 'inherit',
                        }}
                      >
                        {fmtVal(o.sig_wave_h_m, 2)}
                      </td>
                      <td>{fmtVal(o.wave_period_s, 1)}</td>
                      <td>{o.wave_dir_deg != null ? degToCompass(o.wave_dir_deg) : '—'}</td>
                      <td>{fmtVal(o.tide_level_m, 2)}</td>
                    </tr>
                  ))
                : hourlyWave.map((h, i) => (
                    <tr key={i}>
                      <td>{String(h.hour).padStart(2, '0')}:00</td>
                      <td
                        style={{
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: waveLimit != null && h.height > waveLimit ? 'var(--status-danger)' : 'inherit',
                        }}
                      >
                        {h.height}
                      </td>
                      <td>{m ? fmtVal(m.wavePeriod, 1) : '—'}</td>
                      <td>{m?.waveDir ?? '—'}</td>
                      <td>{m ? fmtVal(m.tideLevel, 2) : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

declare global {
  interface Window {
    WeatherPage?: typeof WeatherPage;
    MarinePage?: typeof MarinePage;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { WeatherPage, MarinePage });
}
