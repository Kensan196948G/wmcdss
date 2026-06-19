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
  FORECAST_DAYS,
  SITES,
  WEATHER_ICONS,
  generateHourlyWave,
  generateHourlyWind,
  generateMarine,
  generateWeather,
  type CompassDir,
  type WeatherSample,
  type MarineSample,
} from './data';

// ---------------------------------------------------------------------------
// Backend response shapes (as documented by the API)
// ---------------------------------------------------------------------------

interface BackendWeatherObs {
  id: number;
  site_id: string;
  observed_at: string;
  temperature_c: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  precip_mm: number | null;
  wind_speed_ms: number | null;
  wind_dir_deg: number | null;
}

interface BackendMarineObs {
  id: number;
  site_id: string;
  observed_at: string;
  sig_wave_h_m: number | null;
  wave_period_s: number | null;
  wave_dir_deg: number | null;
  tide_level_m: number | null;
  source?: string | null;
}

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
  const mock = generateWeather(obs.site_id);
  return {
    temp:     obs.temperature_c  ?? mock.temp,
    hum:      obs.humidity_pct   ?? mock.hum,
    pressure: obs.pressure_hpa   ?? mock.pressure,
    wind:     obs.wind_speed_ms  ?? mock.wind,
    windDir:  obs.wind_dir_deg != null ? degToCompass(obs.wind_dir_deg) : mock.windDir,
    rain:     obs.precip_mm      ?? mock.rain,
  };
}

/** Adapt backend marine observation to the local MarineSample shape. */
function adaptBackendMarine(obs: BackendMarineObs, siteId: string): MarineSample {
  const mock = generateMarine(siteId) ?? {
    waveHeight: 0,
    wavePeriod: 0,
    waveDir: 'N' as CompassDir,
    tide: '—',
    tideLevel: 0,
  };
  return {
    waveHeight: obs.sig_wave_h_m   ?? mock.waveHeight,
    wavePeriod: obs.wave_period_s  ?? mock.wavePeriod,
    waveDir:    obs.wave_dir_deg != null ? degToCompass(obs.wave_dir_deg) : mock.waveDir,
    tide:       mock.tide,
    tideLevel:  obs.tide_level_m   ?? mock.tideLevel,
  };
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
// WeatherPage
// ---------------------------------------------------------------------------

export const WeatherPage: FC<PageProps> = ({ selectedSite }) => {
  const [siteId, setSiteId] = useState<string>(selectedSite || SITES[0].id);
  const site = SITES.find((s) => s.id === siteId) || SITES[0];

  // Backend data state
  const [backendW, setBackendW] = useState<WeatherSample | null>(null);
  const [obsTime, setObsTime]   = useState<string>('');
  const [isLiveData, setIsLiveData] = useState(false);

  useEffect(() => {
    setBackendW(null);
    setObsTime('');
    setIsLiveData(false);

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

  const w = backendW ?? generateWeather(site.id);

  const hourlyWind = useMemo(() => generateHourlyWind(), [siteId]);
  const [tab, setTab] = useState<WeatherTab>('current');

  const hourlyTemp = useMemo(() => {
    const out: { hour: number; temp: number }[] = [];
    for (let h = 0; h < 24; h++) {
      const base = w.temp - 3 + Math.sin(((h - 6) / 24) * Math.PI * 2) * 4;
      out.push({ hour: h, temp: +(base + (Math.random() - 0.5)).toFixed(1) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const hourlyRain = useMemo(() => {
    const out: { hour: number; rain: number }[] = [];
    for (let h = 0; h < 24; h++) {
      out.push({ hour: h, rain: +Math.max(0, w.rain + (Math.random() - 0.7) * 3).toFixed(1) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const windLimit = site.thresholds.windSpeed;
  const rainLimit = site.thresholds.rainfall;
  const statCards: StatItem[] = [
    { label: '気温', value: w.temp, unit: '℃', icon: '🌡' },
    { label: '湿度', value: w.hum, unit: '%', icon: '💧' },
    { label: '気圧', value: w.pressure, unit: 'hPa', icon: '📊' },
    {
      label: '風速',
      value: w.wind,
      unit: 'm/s',
      icon: '💨',
      alert: w.wind > windLimit ? 'danger' : w.wind > windLimit * 0.8 ? 'warn' : null,
    },
    { label: '風向', value: w.windDir, unit: '', icon: '🧭' },
    {
      label: '降水量',
      value: w.rain,
      unit: 'mm/h',
      icon: '🌧',
      alert: w.rain > rainLimit ? 'danger' : null,
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
            {SITES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span
            className={`badge ${isLiveData ? 'badge-ok' : 'badge-warn'}`}
            style={{ fontSize: 11 }}
          >
            {isLiveData ? '実データ' : 'サンプルデータ'}
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
                {hourlyWind.map((h, i) => (
                  <tr key={i}>
                    <td>{String(h.hour).padStart(2, '0')}:00</td>
                    <td>{hourlyTemp[i]?.temp}</td>
                    <td>{w.hum + Math.round((Math.random() - 0.5) * 8)}</td>
                    <td
                      style={{
                        color: h.speed > windLimit ? 'var(--status-danger)' : 'inherit',
                      }}
                    >
                      {h.speed}
                    </td>
                    <td>{w.windDir}</td>
                    <td>{hourlyRain[i]?.rain}</td>
                    <td>{(w.pressure + (Math.random() - 0.5) * 2).toFixed(1)}</td>
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
  const marineSites = useMemo(() => SITES.filter((s) => s.type !== 'land'), []);
  const fallbackId = marineSites[0]?.id ?? '';
  const initialId =
    selectedSite && marineSites.find((s) => s.id === selectedSite) ? selectedSite : fallbackId;
  const [siteId, setSiteId] = useState<string>(initialId);
  const site = marineSites.find((s) => s.id === siteId) || marineSites[0];

  // Backend data state
  const [backendM, setBackendM] = useState<MarineSample | null>(null);
  const [obsTime, setObsTime]   = useState<string>('');
  const [isLiveData, setIsLiveData] = useState(false);
  const [marineSource, setMarineSource] = useState<string>('');

  useEffect(() => {
    if (!site) return;
    setBackendM(null);
    setObsTime('');
    setIsLiveData(false);
    setMarineSource('');

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

  const hourlyWave = useMemo(() => generateHourlyWave(), [siteId]);

  if (!site) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海象データのある現場がありません
      </div>
    );
  }

  const m = backendM ?? generateMarine(site.id);
  const isReferenceMarine = marineSource === 'open_meteo_marine_info';

  if (!m) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海象データのある現場がありません
      </div>
    );
  }

  // marineSites filter guarantees this is set, but the type contract says
  // `number | null` — narrow explicitly so the comparisons below type-check.
  const waveLimit = site.thresholds.waveHeight;
  if (waveLimit === null) {
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
            className={`badge ${isLiveData ? 'badge-ok' : 'badge-warn'}`}
            style={{ fontSize: 11 }}
          >
            {isLiveData ? '実データ' : 'サンプルデータ'}
          </span>
          {isReferenceMarine && (
            <span className="badge badge-warn">情報共有用</span>
          )}
          <span className="badge badge-info">観測点: {site.marinePoint}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            観測日時: {obsTime || 'サンプルデータ'}
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
                m.waveHeight > waveLimit
                  ? 'var(--status-danger)'
                  : m.waveHeight > waveLimit * 0.8
                  ? 'var(--status-warn)'
                  : 'var(--blue-600)',
            }}
          >
            {m.waveHeight}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">基準値: {waveLimit}m</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">⏱ 波周期</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m.wavePeriod}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>秒</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">🧭 卓越波向</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m.waveDir}
          </div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="stat-card">
          <div className="stat-label">🌊 潮汐</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m.tide}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">📏 潮位</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {m.tideLevel}
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
            threshold={waveLimit}
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
              {hourlyWave.map((h, i) => (
                <tr key={i}>
                  <td>{String(h.hour).padStart(2, '0')}:00</td>
                  <td
                    style={{
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: h.height > waveLimit ? 'var(--status-danger)' : 'inherit',
                    }}
                  >
                    {h.height}
                  </td>
                  <td>{(m.wavePeriod + (Math.random() - 0.5) * 1.5).toFixed(1)}</td>
                  <td>{m.waveDir}</td>
                  <td>{(m.tideLevel + Math.sin((i / 6) * Math.PI) * 0.3).toFixed(2)}</td>
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
