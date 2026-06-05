// Site Pages — List / Register / Detail.
//
// Phase 1 ESM port of frontend/site-pages.jsx (Loop 24). Mirrors the original
// `window.*` surface (Babel Standalone fallback compatibility) while exposing
// typed named exports.
//
// Type design highlights:
// - `NavigateFn` is the single navigation contract — `(page, siteId?) => void`.
//   The router's allowed page strings live in app.jsx (still pre-ESM), so we
//   keep `page: string` until Loop 25+ ports the router and we can replace it
//   with a literal union without churn here.
// - `SiteListFilter = Status | 'all'` narrows the filter state — the four
//   filter buttons cannot drift from the Status union without a compile error.
// - `RegisterForm` makes the `+e.target.value` numeric coerce explicit by
//   typing windSpeed/waveHeight/rainfall/tempLow/tempHigh as `number`. The
//   `marinePoint` field is optional because the original .jsx initial state
//   omitted it; we add it as `string | undefined` to match runtime behavior.
// - `DetailTab = 'overview' | ...` future-proofs the tab state for when more
//   tabs are added (currently only 'overview' is referenced — kept as a union
//   so the rest of the codebase can extend).
// - `waveLimit !== null` guard is the 5th caller-side execution of the
//   `SiteThresholds.waveHeight: number | null` contract introduced in Loop 18.
//   Loop 19/20/21/22 ports already executed it; this file picks up land sites
//   safely without divergent fallback logic.

import { useMemo, useState, type ChangeEvent } from 'react';
import { ChartColors, LineChart } from './charts';

function nowJSTLabel(): string {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' 時点';
}
import {
  SITES,
  STATUS_CLASS,
  STATUS_LABEL,
  TYPE_LABEL,
  generateHourlyWind,
  generateMarine,
  generateWeather,
  getDecision,
  type SiteKind,
  type Status,
} from './data';

type NavigateFn = (page: string, siteId?: string) => void;
type SiteListFilter = Status | 'all';
type DetailTab = 'overview';

interface RegisterForm {
  name: string;
  type: SiteKind;
  lat: string;
  lng: string;
  station: string;
  marinePoint?: string;
  manager: string;
  contractor: string;
  periodStart: string;
  periodEnd: string;
  windSpeed: number;
  waveHeight: number;
  rainfall: number;
  tempLow: number;
  tempHigh: number;
}

const INITIAL_FORM: RegisterForm = {
  name: '',
  type: 'marine',
  lat: '',
  lng: '',
  station: '',
  manager: '',
  contractor: '',
  periodStart: '',
  periodEnd: '',
  windSpeed: 10,
  waveHeight: 1.5,
  rainfall: 5,
  tempLow: 5,
  tempHigh: 35,
};

const FILTER_BUTTONS: ReadonlyArray<[SiteListFilter, string]> = [
  ['all', 'すべて'],
  ['ok', '施工可'],
  ['warn', '注意'],
  ['danger', '中止推奨'],
];

const STATION_OPTIONS = [
  '東京（気象台）',
  '横浜（気象台）',
  '千葉（気象台）',
  '川崎',
  '木更津',
] as const;

const MARINE_POINT_OPTIONS = [
  '東京湾北部',
  '東京湾中部',
  '東京湾南部',
  '東京湾東部',
] as const;

// ---------- Site List ----------

interface SiteListPageProps {
  navigate: NavigateFn;
}

export function SiteListPage({ navigate }: SiteListPageProps) {
  const [filter, setFilter] = useState<SiteListFilter>('all');
  const [search, setSearch] = useState('');

  const filtered = SITES.filter((s) => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (search && !s.name.includes(search) && !s.shortName.includes(search)) return false;
    return true;
  });

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ display: 'flex', gap: 8 }}>
          {FILTER_BUTTONS.map(([v, l]) => (
            <button
              key={v}
              className={`btn btn-sm ${filter === v ? 'btn-primary' : ''}`}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            placeholder="現場名で検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, padding: '6px 12px', fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={() => navigate('site-register')}>
            ＋ 新規登録
          </button>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>ステータス</th>
              <th>現場名</th>
              <th>工種</th>
              <th>観測所</th>
              <th>担当者</th>
              <th>施工者</th>
              <th>気温</th>
              <th>風速</th>
              <th>波高</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((site) => {
              const w = generateWeather(site.id);
              const m = generateMarine(site.id);
              const waveLimit = site.thresholds.waveHeight;
              const windWarn = site.thresholds.windSpeed * 0.8;
              const waveWarn = waveLimit !== null ? waveLimit * 0.8 : null;
              return (
                <tr
                  key={site.id}
                  className="clickable"
                  onClick={() => navigate('site-detail', site.id)}
                >
                  <td>
                    <span className={`badge ${STATUS_CLASS[site.status]}`}>
                      <span className="badge-dot"></span>
                      {STATUS_LABEL[site.status]}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{site.name}</td>
                  <td>{TYPE_LABEL[site.type]}</td>
                  <td>{site.station}</td>
                  <td>{site.manager}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {site.contractor}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{w.temp}℃</td>
                  <td
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color:
                        w.wind > site.thresholds.windSpeed
                          ? 'var(--status-danger)'
                          : w.wind > windWarn
                          ? 'var(--status-warn)'
                          : 'inherit',
                    }}
                  >
                    {w.wind} m/s
                  </td>
                  <td
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color:
                        m && waveLimit !== null && waveWarn !== null && m.waveHeight > waveLimit
                          ? 'var(--status-danger)'
                          : m && waveWarn !== null && m.waveHeight > waveWarn
                          ? 'var(--status-warn)'
                          : 'inherit',
                    }}
                  >
                    {m ? `${m.waveHeight} m` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Site Register ----------

interface SiteRegisterPageProps {
  navigate: NavigateFn;
}

export function SiteRegisterPage({ navigate }: SiteRegisterPageProps) {
  const [form, setForm] = useState<RegisterForm>(INITIAL_FORM);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof RegisterForm>(key: K, val: RegisterForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    try {
      const api = (window as Window & { WMCDSS_API?: { fetchJSON?: Function } }).WMCDSS_API;
      if (api?.fetchJSON) {
        await api.fetchJSON('/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: `SITE-${Date.now().toString(36).toUpperCase()}`,
            name: form.name,
            kind: form.type,
            lat: Number(form.lat),
            lon: Number(form.lng),
            jma_station_id: form.station || null,
            address: null,
          }),
        });
      }
    } catch {
      // バックエンド未接続時はフォールバック（モック動作）
    }
    setSaved(true);
    setTimeout(() => navigate('sites'), 1200);
  };

  const setText =
    (key: keyof RegisterForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      update(key, e.target.value as RegisterForm[typeof key]);
    };

  const setNumber =
    (key: keyof RegisterForm) => (e: ChangeEvent<HTMLInputElement>) => {
      update(key, Number(e.target.value) as RegisterForm[typeof key]);
    };

  return (
    <div style={{ maxWidth: 800 }}>
      {saved && (
        <div
          style={{
            background: 'var(--status-ok-bg)',
            border: '1px solid var(--status-ok-border)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--status-ok)',
            fontWeight: 600,
          }}
        >
          ✓ 現場を登録しました。現場一覧へ移動します…
        </div>
      )}

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">基本情報</span>
        </div>
        <div className="card-body">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">現場名 *</label>
              <input
                className="form-input"
                value={form.name}
                onChange={setText('name')}
                placeholder="例: 東京港臨海大橋建設工事"
              />
            </div>
            <div className="form-group">
              <label className="form-label">工種 *</label>
              <select className="form-select" value={form.type} onChange={setText('type')}>
                <option value="land">陸上工事</option>
                <option value="marine">海上工事</option>
                <option value="both">陸上＋海上</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">緯度</label>
              <input
                className="form-input"
                type="number"
                step="0.0001"
                value={form.lat}
                onChange={setText('lat')}
                placeholder="35.6195"
              />
            </div>
            <div className="form-group">
              <label className="form-label">経度</label>
              <input
                className="form-input"
                type="number"
                step="0.0001"
                value={form.lng}
                onChange={setText('lng')}
                placeholder="139.7745"
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">最寄り気象観測所</label>
              <select className="form-select" value={form.station} onChange={setText('station')}>
                <option value="">自動検出</option>
                {STATION_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">海象観測点</label>
              <select
                className="form-select"
                value={form.marinePoint ?? ''}
                onChange={setText('marinePoint')}
              >
                <option value="">なし</option>
                {MARINE_POINT_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">現場担当者</label>
              <input className="form-input" value={form.manager} onChange={setText('manager')} />
            </div>
            <div className="form-group">
              <label className="form-label">施工者</label>
              <input
                className="form-input"
                value={form.contractor}
                onChange={setText('contractor')}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">工期開始</label>
              <input
                className="form-input"
                type="date"
                value={form.periodStart}
                onChange={setText('periodStart')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">工期終了</label>
              <input
                className="form-input"
                type="date"
                value={form.periodEnd}
                onChange={setText('periodEnd')}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">施工中止基準</span>
        </div>
        <div className="card-body">
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">最大風速 (m/s)</label>
              <input
                className="form-input"
                type="number"
                value={form.windSpeed}
                onChange={setNumber('windSpeed')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">有義波高 (m)</label>
              <input
                className="form-input"
                type="number"
                step="0.1"
                value={form.waveHeight}
                onChange={setNumber('waveHeight')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">降水量 (mm/h)</label>
              <input
                className="form-input"
                type="number"
                value={form.rainfall}
                onChange={setNumber('rainfall')}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">気温下限 (℃)</label>
              <input
                className="form-input"
                type="number"
                value={form.tempLow}
                onChange={setNumber('tempLow')}
              />
            </div>
            <div className="form-group">
              <label className="form-label">気温上限 (℃)</label>
              <input
                className="form-input"
                type="number"
                value={form.tempHigh}
                onChange={setNumber('tempHigh')}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={() => { void handleSave(); }}>
          登録する
        </button>
        <button className="btn" onClick={() => navigate('sites')}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ---------- Site Detail ----------

interface SiteDetailPageProps {
  navigate: NavigateFn;
  selectedSite?: string;
}

export function SiteDetailPage({ navigate, selectedSite }: SiteDetailPageProps) {
  const site = SITES.find((s) => s.id === selectedSite) ?? SITES[0];
  const w = generateWeather(site.id);
  const m = generateMarine(site.id);
  const decision = getDecision(site);
  const [, /* tab */ _setTab] = useState<DetailTab>('overview');
  const hourlyWind = useMemo(() => generateHourlyWind(), []);
  void _setTab;

  const waveLimit = site.thresholds.waveHeight;
  const windDanger = site.thresholds.windSpeed;
  const windWarn = windDanger * 0.8;

  return (
    <div>
      {/* Site header */}
      <div className="card mb-16">
        <div
          className="card-body"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{site.name}</div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                display: 'flex',
                gap: 16,
              }}
            >
              <span>{TYPE_LABEL[site.type]}</span>
              <span>📍 {site.station}</span>
              <span>👤 {site.manager}</span>
              <span>🏗 {site.contractor}</span>
              <span>📅 {site.period}</span>
            </div>
          </div>
          <span
            className={`badge ${STATUS_CLASS[decision.status]}`}
            style={{ fontSize: 14, padding: '6px 16px' }}
          >
            <span className="badge-dot"></span>
            {STATUS_LABEL[decision.status]}
          </span>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            navigate('weather', site.id);
          }}
        >
          📊 気象データ
        </button>
        {site.type !== 'land' && (
          <button
            className="btn btn-sm"
            onClick={() => {
              navigate('marine', site.id);
            }}
          >
            🌊 海象データ
          </button>
        )}
        <button
          className="btn btn-sm"
          onClick={() => {
            navigate('concrete', site.id);
          }}
        >
          🏗 打設判定
        </button>
        {site.type !== 'land' && (
          <button
            className="btn btn-sm"
            onClick={() => {
              navigate('marine-work', site.id);
            }}
          >
            🚢 海上作業判定
          </button>
        )}
      </div>

      {/* Decision summary */}
      <div className="decision-panel mb-16">
        <div className={`decision-header ${decision.status}`}>
          <div className="decision-icon">
            {decision.status === 'ok' ? '✅' : decision.status === 'warn' ? '⚡' : '⛔'}
          </div>
          <div>
            <div className="decision-title">総合判定：{STATUS_LABEL[decision.status]}</div>
            <div className="decision-sub">{nowJSTLabel()}</div>
          </div>
        </div>
        <div className="decision-body">
          {decision.reasons.map((r, i) => (
            <div
              key={i}
              className={`reason-text ${decision.status}`}
              style={{ marginTop: i > 0 ? 8 : 0 }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>

      {/* Current conditions */}
      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header">
            <span className="card-title">現在の気象</span>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {(
                [
                  ['気温', `${w.temp}℃`, null],
                  ['湿度', `${w.hum}%`, null],
                  ['気圧', `${w.pressure}hPa`, null],
                  [
                    '風速',
                    `${w.wind}m/s`,
                    w.wind > windDanger ? 'danger' : w.wind > windWarn ? 'warn' : null,
                  ],
                  ['風向', w.windDir, null],
                  [
                    '降水量',
                    `${w.rain}mm/h`,
                    w.rain > site.thresholds.rainfall ? 'danger' : null,
                  ],
                ] as Array<[string, string, 'danger' | 'warn' | null]>
              ).map(([label, val, alert], i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color:
                        alert === 'danger'
                          ? 'var(--status-danger)'
                          : alert === 'warn'
                          ? 'var(--status-warn)'
                          : 'inherit',
                    }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {m && waveLimit !== null ? (
          <div className="card">
            <div className="card-header">
              <span className="card-title">現在の海象</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {(
                  [
                    [
                      '有義波高',
                      `${m.waveHeight}m`,
                      m.waveHeight > waveLimit
                        ? 'danger'
                        : m.waveHeight > waveLimit * 0.8
                        ? 'warn'
                        : null,
                    ],
                    ['周期', `${m.wavePeriod}s`, null],
                    ['波向', m.waveDir, null],
                    ['潮汐', m.tide, null],
                    ['潮位', `${m.tideLevel}m`, null],
                  ] as Array<[string, string, 'danger' | 'warn' | null]>
                ).map(([label, val, alert], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        fontVariantNumeric: 'tabular-nums',
                        color:
                          alert === 'danger'
                            ? 'var(--status-danger)'
                            : alert === 'warn'
                            ? 'var(--status-warn)'
                            : 'inherit',
                      }}
                    >
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <span className="card-title">施工中止基準</span>
            </div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {(
                  [
                    ['最大風速', `${windDanger} m/s`],
                    ['降水量', `${site.thresholds.rainfall} mm/h`],
                    ['気温下限', `${site.thresholds.tempLow}℃`],
                    ['気温上限', `${site.thresholds.tempHigh}℃`],
                  ] as Array<[string, string]>
                ).map(([l, v], i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-light)',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Wind chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">本日の風速推移</span>
        </div>
        <div className="card-body">
          <LineChart
            data={hourlyWind.map((h) => ({ label: `${h.hour}時`, value: h.speed }))}
            width={800}
            height={180}
            color={ChartColors.blue}
            threshold={windDanger}
            thresholdLabel={`基準値 ${windDanger}m/s`}
            yLabel="風速 (m/s)"
          />
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    SiteListPage?: typeof SiteListPage;
    SiteRegisterPage?: typeof SiteRegisterPage;
    SiteDetailPage?: typeof SiteDetailPage;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { SiteListPage, SiteRegisterPage, SiteDetailPage });
}
