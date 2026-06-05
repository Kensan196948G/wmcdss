// Phase 1 ESM port of ../../analysis.jsx.
//
// Dual surface (mirrors api.ts / charts.tsx / data.ts / decisions.tsx /
// dashboard.tsx / weather-marine.tsx):
//   1. Named ESM exports — HistoricalPage, Wave50Page.
//   2. window.{HistoricalPage, Wave50Page} side effects so the legacy Babel
//      Standalone bundle keeps rendering these pages if it loads this build
//      instead of analysis.jsx.

import { useEffect, useMemo, useState, type FC } from 'react';
import { BarChart, ChartColors, LineChart } from './charts';
import { SITES, generateHistoricalMonthly } from './data';

// Backend API base URL — injected at runtime via window.WMCDSS_API_BASE or
// falls back to same-origin so the dev proxy can handle /api/v1 routes.
function getApiBase(): string {
  return (
    (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE ??
    '/api/v1'
  );
}

// Month index 0–11 → Japanese label
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

// Backend /observations/historical response shape
interface HistoricalBackendMonth {
  month: number;
  avg_wind_ms: number | null;
  max_wind_ms: number | null;
  avg_temp_c: number | null;
  total_rain_mm: number | null;
  rain_days: number | null;
  avg_wave_h_m: number | null;
  max_wave_h_m: number | null;
}

interface HistoricalBackendResponse {
  site_id: string;
  year: number;
  data_source: string;
  months: HistoricalBackendMonth[];
}

// Backend /analysis/wave50 response shape
interface Wave50AnnualMax {
  year: number;
  max_wave_h_m: number;
}

interface Wave50ReturnPeriod {
  period_years: number;
  wave_h_m: number;
}

interface Wave50BackendResponse {
  site_id: string;
  method: string;
  data_years: number;
  sufficient_data: boolean;
  annual_max: Wave50AnnualMax[];
  return_periods: Wave50ReturnPeriod[];
  note?: string;
}

type MetricKey = 'wind' | 'wave' | 'rain';

interface MetricSpec {
  data: { label: string; value: number }[];
  label: string;
  color: string;
}

interface HistoricalPageProps {
  navigate?: (page: string, payload?: unknown) => void;
  selectedSite?: string;
}

export const HistoricalPage: FC<HistoricalPageProps> = ({ selectedSite }) => {
  const [siteId, setSiteId] = useState<string>(selectedSite || SITES[0].id);
  const [year, setYear] = useState<string>('2025');
  const [metric, setMetric] = useState<MetricKey>('wind');
  const [loading, setLoading] = useState(false);
  const [isSampleData, setIsSampleData] = useState(false);
  // backendMonthly: null = not yet fetched / fallback to mock
  const [backendMonthly, setBackendMonthly] = useState<HistoricalBackendMonth[] | null>(null);

  const site = SITES.find((s) => s.id === siteId) || SITES[0];

  // Fetch historical data from backend whenever site or year changes.
  // Backend is only attempted when window.WMCDSS_API or window.WMCDSS_API_BASE
  // is explicitly set — avoids unwanted fetch calls in test / demo environments.
  useEffect(() => {
    const api = (window as Window & { WMCDSS_API?: { fetchJSON?: (path: string) => Promise<unknown> } }).WMCDSS_API;
    const configuredApiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE;

    if (!api?.fetchJSON && !configuredApiBase) {
      // No backend configured — use sample data immediately
      setBackendMonthly(null);
      setIsSampleData(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setIsSampleData(false);

    (async () => {
      try {
        let data: HistoricalBackendResponse | null = null;

        if (api?.fetchJSON) {
          data = (await api.fetchJSON(
            `/observations/historical?site_id=${siteId}&year=${year}`,
          )) as HistoricalBackendResponse;
        } else {
          // Direct fetch using configured base URL
          const resp = await fetch(
            `${configuredApiBase}/observations/historical?site_id=${siteId}&year=${year}`,
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          data = (await resp.json()) as HistoricalBackendResponse;
        }

        if (!cancelled && data?.months && Array.isArray(data.months)) {
          setBackendMonthly(data.months);
        } else if (!cancelled) {
          setBackendMonthly(null);
          setIsSampleData(true);
        }
      } catch {
        if (!cancelled) {
          setBackendMonthly(null);
          setIsSampleData(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [siteId, year]);

  // Mock fallback (used when backend is unavailable)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mockMonthly = useMemo(() => generateHistoricalMonthly(), [siteId, year]);

  const chartData: Record<MetricKey, MetricSpec> = useMemo(() => {
    if (backendMonthly) {
      // Build 12-entry arrays from backend data, filling missing months with 0
      const byMonth: Record<number, HistoricalBackendMonth> = {};
      for (const m of backendMonthly) byMonth[m.month] = m;

      return {
        wind: {
          data: MONTH_LABELS.map((lbl, i) => ({
            label: lbl,
            value: byMonth[i + 1]?.max_wind_ms ?? 0,
          })),
          label: '最大風速 (m/s)',
          color: ChartColors.blue,
        },
        wave: {
          data: MONTH_LABELS.map((lbl, i) => ({
            label: lbl,
            value: byMonth[i + 1]?.max_wave_h_m ?? 0,
          })),
          label: '最大波高 (m)',
          color: ChartColors.lightBlue,
        },
        rain: {
          data: MONTH_LABELS.map((lbl, i) => ({
            label: lbl,
            value: byMonth[i + 1]?.total_rain_mm ?? 0,
          })),
          label: '月間降水量 (mm)',
          color: ChartColors.lightBlue,
        },
      };
    }

    // Fallback to mock data
    return {
      wind: {
        data: mockMonthly.map((m) => ({ label: m.month, value: m.maxWind })),
        label: '最大風速 (m/s)',
        color: ChartColors.blue,
      },
      wave: {
        data: mockMonthly.map((m) => ({ label: m.month, value: m.maxWave })),
        label: '最大波高 (m)',
        color: ChartColors.lightBlue,
      },
      rain: {
        data: mockMonthly.map((m) => ({ label: m.month, value: m.totalRain })),
        label: '月間降水量 (mm)',
        color: ChartColors.lightBlue,
      },
    };
  }, [backendMonthly, mockMonthly]);

  // For the table — use backend monthly or mock monthly
  const tableMonthly = useMemo(() => {
    if (backendMonthly) {
      const byMonth: Record<number, HistoricalBackendMonth> = {};
      for (const m of backendMonthly) byMonth[m.month] = m;
      return MONTH_LABELS.map((lbl, i) => {
        const bm = byMonth[i + 1];
        return {
          month: lbl,
          avgWind: bm?.avg_wind_ms ?? 0,
          maxWind: bm?.max_wind_ms ?? 0,
          avgWave: bm?.avg_wave_h_m ?? 0,
          maxWave: bm?.max_wave_h_m ?? 0,
          rainDays: bm?.rain_days ?? 0,
          totalRain: bm?.total_rain_mm ?? 0,
        };
      });
    }
    return mockMonthly;
  }, [backendMonthly, mockMonthly]);

  const current = chartData[metric];
  const waveLimit = site.thresholds.waveHeight;
  // LineChartProps.threshold is `number | undefined` — coerce null to undefined
  // ("this site has no wave threshold" = "no threshold line"). Keeps charts.tsx
  // contract narrow; the null-vs-number distinction is meaningful only on the
  // marine-decision path (see decisions.tsx / weather-marine.tsx).
  const chartThreshold: number | undefined =
    metric === 'wind' ? site.thresholds.windSpeed : waveLimit ?? undefined;

  const metricButtons: [MetricKey, string][] = [
    ['wind', '風速'],
    ['wave', '波高'],
    ['rain', '降水量'],
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>
            現場
          </label>
          <select
            className="form-select"
            style={{ width: 220 }}
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
          <label className="form-label" style={{ margin: 0 }}>
            年度
          </label>
          <select
            className="form-select"
            style={{ width: 120 }}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            {['2025', '2024', '2023', '2022', '2021'].map((y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {metricButtons.map(([k, l]) => (
            <button
              key={k}
              className={`btn btn-sm ${metric === k ? 'btn-primary' : ''}`}
              onClick={() => setMetric(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">
            {current.label} — {year}年 月別推移
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {loading && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>データ取得中...</span>
            )}
            {!loading && isSampleData && (
              <span className="badge badge-warn" style={{ fontSize: 11 }}>サンプルデータ</span>
            )}
            <button className="btn btn-sm">📥 CSV出力</button>
          </div>
        </div>
        <div className="card-body">
          {metric === 'rain' ? (
            <BarChart
              data={current.data}
              width={800}
              height={220}
              color={current.color}
              yLabel={current.label}
            />
          ) : (
            <LineChart
              data={current.data}
              width={800}
              height={220}
              color={current.color}
              yLabel={current.label}
              threshold={chartThreshold}
              thresholdLabel="基準値"
            />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">月別集計データ</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>月</th>
                <th>平均風速</th>
                <th>最大風速</th>
                <th>平均波高</th>
                <th>最大波高</th>
                <th>降雨日数</th>
                <th>月間降水量</th>
              </tr>
            </thead>
            <tbody>
              {tableMonthly.map((m, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{m.month}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.avgWind} m/s</td>
                  <td
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color:
                        m.maxWind > site.thresholds.windSpeed
                          ? 'var(--status-danger)'
                          : 'inherit',
                    }}
                  >
                    {m.maxWind} m/s
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.avgWave} m</td>
                  <td
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color:
                        waveLimit !== null && m.maxWave > waveLimit
                          ? 'var(--status-danger)'
                          : 'inherit',
                    }}
                  >
                    {m.maxWave} m
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.rainDays}日</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.totalRain} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

type WavePointKey = '東京湾北部' | '東京湾中部' | '東京湾南部' | '東京湾東部';
type MethodKey = 'gumbel' | 'weibull' | 'genpareto';

interface ReturnPeriodRow {
  period: number;
  wave: string;
  wind: string;
}

interface Wave50PageProps {
  selectedSite?: string;
}

export const Wave50Page: FC<Wave50PageProps> = ({ selectedSite }) => {
  const [point, setPoint] = useState<WavePointKey>('東京湾北部');
  const [method, setMethod] = useState<MethodKey>('gumbel');
  const [backendData, setBackendData] = useState<Wave50BackendResponse | null>(null);
  const [insufficientWarning, setInsufficientWarning] = useState(false);

  // Effective site_id for backend calls: prop → SITES[0]
  const effectiveSiteId = selectedSite ?? SITES[0].id;

  // Fetch wave50 analysis from backend whenever site or method changes.
  // Only runs when window.WMCDSS_API or window.WMCDSS_API_BASE is configured.
  useEffect(() => {
    // genpareto is local-only (not supported by backend)
    if (method === 'genpareto') {
      setBackendData(null);
      setInsufficientWarning(false);
      return;
    }

    const api = (window as Window & { WMCDSS_API?: { fetchJSON?: (path: string) => Promise<unknown> } }).WMCDSS_API;
    const configuredApiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE;

    if (!api?.fetchJSON && !configuredApiBase) {
      // No backend configured — use static fallback
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let data: Wave50BackendResponse | null = null;

        if (api?.fetchJSON) {
          data = (await api.fetchJSON(
            `/analysis/wave50?site_id=${effectiveSiteId}&method=${method}`,
          )) as Wave50BackendResponse;
        } else {
          const resp = await fetch(
            `${configuredApiBase}/analysis/wave50?site_id=${effectiveSiteId}&method=${method}`,
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          data = (await resp.json()) as Wave50BackendResponse;
        }

        if (!cancelled && data) {
          setBackendData(data);
          setInsufficientWarning(data.sufficient_data === false);
        }
      } catch {
        if (!cancelled) {
          setBackendData(null);
          setInsufficientWarning(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [effectiveSiteId, method]);

  // ---- Static fallback (used when backend data not available) ----
  const fallbackReturnPeriods = useMemo<ReturnPeriodRow[]>(() => {
    const base =
      point === '東京湾北部' ? 2.8 : point === '東京湾中部' ? 3.2 : point === '東京湾南部' ? 3.8 : 3.0;
    return [
      { period: 1, wave: (base * 0.6).toFixed(2), wind: (12 * 0.65).toFixed(1) },
      { period: 2, wave: (base * 0.72).toFixed(2), wind: (12 * 0.75).toFixed(1) },
      { period: 5, wave: (base * 0.82).toFixed(2), wind: (12 * 0.85).toFixed(1) },
      { period: 10, wave: (base * 0.9).toFixed(2), wind: (12 * 0.92).toFixed(1) },
      { period: 20, wave: (base * 0.95).toFixed(2), wind: (12 * 0.97).toFixed(1) },
      { period: 30, wave: (base * 0.98).toFixed(2), wind: (12 * 0.99).toFixed(1) },
      { period: 50, wave: base.toFixed(2), wind: '12.0' },
      { period: 100, wave: (base * 1.08).toFixed(2), wind: (12 * 1.06).toFixed(1) },
    ];
  }, [point]);

  const fallbackAnnualMax = useMemo(() => {
    const base = point === '東京湾北部' ? 1.8 : 2.1;
    return Array.from({ length: 20 }, (_, i) => ({
      label: `${2006 + i}`,
      value: +(base + Math.random() * 1.2 + Math.sin(i * 0.5) * 0.3).toFixed(2),
    }));
  }, [point]);

  // ---- Derived display values ----
  const returnPeriods: ReturnPeriodRow[] = useMemo(() => {
    if (backendData?.return_periods?.length) {
      return backendData.return_periods.map((rp) => ({
        period: rp.period_years,
        wave: rp.wave_h_m.toFixed(2),
        wind: '—',
      }));
    }
    return fallbackReturnPeriods;
  }, [backendData, fallbackReturnPeriods]);

  const annualMax = useMemo(() => {
    if (backendData?.annual_max?.length) {
      return backendData.annual_max.map((a) => ({
        label: String(a.year),
        value: a.max_wave_h_m,
      }));
    }
    return fallbackAnnualMax;
  }, [backendData, fallbackAnnualMax]);

  const wavePoints: WavePointKey[] = ['東京湾北部', '東京湾中部', '東京湾南部', '東京湾東部'];
  const methodLabel: Record<MethodKey, string> = {
    gumbel: 'Gumbel',
    weibull: 'Weibull',
    genpareto: 'GenPareto',
  };
  const methodFullLabel: Record<MethodKey, string> = {
    gumbel: 'Gumbel極値分布',
    weibull: 'Weibull分布',
    genpareto: '一般化パレート分布',
  };

  const annualAvg = annualMax.reduce((a, b) => a + b.value, 0) / annualMax.length;
  const annualMaxObserved = Math.max(...annualMax.map((a) => a.value));

  // Conditions metadata — prefer backend data when available
  const dataPeriod = useMemo(() => {
    if (backendData?.annual_max?.length) {
      const years = backendData.annual_max.map((a) => a.year);
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      return `${minYear}年〜${maxYear}年（${backendData.data_years}年間）`;
    }
    return '2006年〜2025年（20年間）';
  }, [backendData]);

  const dataSource = backendData
    ? '気象庁 波浪ナウキャスト (backend DB)'
    : '気象庁 沿岸波浪モデル（5km格子）';

  const sampleCount = backendData
    ? String(backendData.data_years)
    : '20';

  const conditions: [string, string][] = [
    ['データ期間', dataPeriod],
    ['観測点', point],
    ['データソース', dataSource],
    ['推定手法', methodFullLabel[method]],
    ['サンプル数', `${sampleCount}（年最大値）`],
    ['最終算出日', '2026/05/01'],
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>
            観測点
          </label>
          <select
            className="form-select"
            style={{ width: 200 }}
            value={point}
            onChange={(e) => setPoint(e.target.value as WavePointKey)}
          >
            {wavePoints.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>
            推定手法
          </label>
          <select
            className="form-select"
            style={{ width: 180 }}
            value={method}
            onChange={(e) => setMethod(e.target.value as MethodKey)}
          >
            <option value="gumbel">Gumbel分布</option>
            <option value="weibull">Weibull分布</option>
            <option value="genpareto">一般化パレート分布</option>
          </select>
        </div>
        <button className="btn btn-sm">📥 Excel出力</button>
      </div>

      {insufficientWarning && (
        <div style={{
          background: 'var(--status-warn-bg, #fffbeb)',
          border: '1px solid var(--status-warn-border, #fcd34d)',
          borderRadius: 'var(--radius-md, 6px)',
          padding: '10px 16px',
          fontSize: 13,
          color: 'var(--status-warn, #d97706)',
          fontWeight: 500,
          marginBottom: 16,
        }}>
          ⚠️ データ期間が短いため推定精度が低い可能性があります
        </div>
      )}

      <div className="grid-3 mb-16">
        <div className="stat-card" style={{ borderLeft: '4px solid var(--blue-400)' }}>
          <div className="stat-label">50年確率波高</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {returnPeriods.find((r) => r.period === 50)?.wave}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">
            {point} ／ {methodLabel[method]}分布
          </div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--status-warn)' }}>
          <div className="stat-label">年最大波高（平均）</div>
          <div className="stat-value" style={{ color: 'var(--status-warn)' }}>
            {annualAvg.toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">過去20年間</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--status-danger)' }}>
          <div className="stat-label">観測最大波高</div>
          <div className="stat-value" style={{ color: 'var(--status-danger)' }}>
            {annualMaxObserved.toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">過去20年間</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">年最大有義波高推移(過去20年)</span>
        </div>
        <div className="card-body">
          <LineChart
            data={annualMax}
            width={800}
            height={220}
            color={ChartColors.blue}
            yLabel="有義波高 (m)"
          />
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">再現期間別推定値</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>再現期間</th>
                <th>確率波高 (m)</th>
                <th>確率風速 (m/s)</th>
                <th>信頼区間（95%）</th>
              </tr>
            </thead>
            <tbody>
              {returnPeriods.map((r, i) => (
                <tr
                  key={i}
                  style={{ background: r.period === 50 ? 'var(--blue-50)' : 'transparent' }}
                >
                  <td style={{ fontWeight: r.period === 50 ? 700 : 500 }}>
                    {r.period}年
                    {r.period === 50 && (
                      <span className="badge badge-info" style={{ marginLeft: 8 }}>
                        設計基準
                      </span>
                    )}
                  </td>
                  <td
                    style={{
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: r.period === 50 ? 'var(--blue-600)' : 'inherit',
                    }}
                  >
                    {r.wave} m
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.wind} m/s</td>
                  <td
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    ±{(+r.wave * 0.12).toFixed(2)} m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">分析条件</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
            {conditions.map(([k, v], i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <span style={{ color: 'var(--text-muted)', minWidth: 120 }}>{k}</span>
                <span style={{ fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

declare global {
  interface Window {
    HistoricalPage?: typeof HistoricalPage;
    Wave50Page?: typeof Wave50Page;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { HistoricalPage, Wave50Page });
}
