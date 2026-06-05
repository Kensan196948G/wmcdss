// Phase 1 ESM port of ../../decisions.jsx.
//
// Dual surface (mirrors api.ts / charts.tsx / data.ts):
//   1. Named ESM exports — ConcretePage, MarineWorkPage, CheckItem.
//   2. window.{ConcretePage, MarineWorkPage} side effects so the legacy
//      Babel Standalone bundle keeps rendering these pages if it loads this
//      build instead of decisions.jsx.
//
// This is the first caller that *consumes* charts.tsx via ESM named import,
// validating the dual-surface contract beyond the type-only App.jsx reference.

import { useMemo, useState, type FC } from 'react';
import { LineChart } from './charts';

function nowJSTLabel(): string {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' 時点';
}
import {
  FORECAST_DAYS,
  SITES,
  STATUS_CLASS,
  STATUS_LABEL,
  WEATHER_ICONS,
  generateHourlyWave,
  generateMarine,
  generateWeather,
  getDecision,
  type Site,
  type Status,
} from './data';

type CheckStatus = Status;

export interface CheckItemProps {
  label: string;
  value: number;
  unit: string;
  threshold: number;
  thresholdUnit?: string;
  status: CheckStatus;
}

export const CheckItem: FC<CheckItemProps> = ({
  label,
  value,
  unit,
  threshold,
  thresholdUnit,
  status,
}) => {
  const color =
    status === 'ok'
      ? 'var(--status-ok)'
      : status === 'warn'
      ? 'var(--status-warn)'
      : 'var(--status-danger)';
  const bgColor =
    status === 'ok'
      ? 'var(--status-ok-bg)'
      : status === 'warn'
      ? 'var(--status-warn-bg)'
      : 'var(--status-danger-bg)';
  const icon = status === 'ok' ? '✓' : status === 'warn' ? '△' : '✕';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-light)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: bgColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 14,
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          基準値: {threshold}
          {thresholdUnit || unit}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
          <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>{unit}</span>
        </div>
      </div>
      <span
        className={`badge ${
          status === 'ok' ? 'badge-ok' : status === 'warn' ? 'badge-warn' : 'badge-danger'
        }`}
        style={{ minWidth: 60, justifyContent: 'center' }}
      >
        {status === 'ok' ? '適合' : status === 'warn' ? '注意' : '超過'}
      </span>
    </div>
  );
};

export interface ConcretePageProps {
  selectedSite?: string;
}

export const ConcretePage: FC<ConcretePageProps> = ({ selectedSite }) => {
  const [siteId, setSiteId] = useState<string>(selectedSite || SITES[0].id);
  const site: Site = SITES.find((s) => s.id === siteId) || SITES[0];
  const w = generateWeather(site.id);
  // getDecision is kept for parity with the legacy page (used elsewhere in props
  // chains); the local concreteChecks below produce the displayed status.
  void getDecision(site);

  const getCheckStatus = (val: number, thresh: number, invert = false): CheckStatus => {
    if (invert) return val < thresh ? 'danger' : val < thresh * 1.2 ? 'warn' : 'ok';
    return val > thresh ? 'danger' : val > thresh * 0.8 ? 'warn' : 'ok';
  };

  const concreteChecks: CheckItemProps[] = [
    {
      label: '降水量',
      value: w.rain,
      unit: 'mm/h',
      threshold: site.thresholds.rainfall,
      status: getCheckStatus(w.rain, site.thresholds.rainfall),
    },
    {
      label: '風速',
      value: w.wind,
      unit: 'm/s',
      threshold: site.thresholds.windSpeed,
      status: getCheckStatus(w.wind, site.thresholds.windSpeed),
    },
    {
      label: '気温（下限）',
      value: w.temp,
      unit: '℃',
      threshold: site.thresholds.tempLow,
      status:
        w.temp < site.thresholds.tempLow
          ? 'danger'
          : w.temp < site.thresholds.tempLow + 2
          ? 'warn'
          : 'ok',
    },
    {
      label: '気温（上限）',
      value: w.temp,
      unit: '℃',
      threshold: site.thresholds.tempHigh,
      status:
        w.temp > site.thresholds.tempHigh
          ? 'danger'
          : w.temp > site.thresholds.tempHigh - 3
          ? 'warn'
          : 'ok',
    },
    {
      label: '湿度',
      value: w.hum,
      unit: '%',
      threshold: 85,
      thresholdUnit: '% 以下',
      status: w.hum > 85 ? 'warn' : 'ok',
    },
  ];

  const overallStatus: CheckStatus = concreteChecks.some((c) => c.status === 'danger')
    ? 'danger'
    : concreteChecks.some((c) => c.status === 'warn')
    ? 'warn'
    : 'ok';

  const recommendations: Record<CheckStatus, string> = {
    ok: '現在の気象条件はコンクリート打設に適しています。通常の施工手順で作業を進めてください。',
    warn:
      '一部の気象条件が基準値に接近しています。養生条件を確認し、注意しながら施工を進めてください。必要に応じて打設時間の調整を検討してください。',
    danger:
      '気象条件が施工中止基準を超過しています。コンクリート打設を中止し、養生・安全措置を優先してください。条件改善後に再判定を行ってください。',
  };

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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm">📥 PDF出力</button>
          <button className="btn btn-sm btn-primary">🔄 再判定</button>
        </div>
      </div>

      <div className="decision-panel mb-16">
        <div className={`decision-header ${overallStatus}`}>
          <div className="decision-icon">
            {overallStatus === 'ok' ? '✅' : overallStatus === 'warn' ? '⚡' : '⛔'}
          </div>
          <div>
            <div className="decision-title">
              コンクリート打設判定：
              {overallStatus === 'ok' ? '施工可' : overallStatus === 'warn' ? '注意' : '中止推奨'}
            </div>
            <div className="decision-sub">{site.shortName} ／ {nowJSTLabel()}</div>
          </div>
        </div>
        <div className="decision-body">
          <div className={`reason-text ${overallStatus}`}>{recommendations[overallStatus]}</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">判定項目</span>
        </div>
        <div>
          {concreteChecks.map((c, i) => (
            <CheckItem key={i} {...c} />
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <span className="card-title">明日以降の打設見通し</span>
          </div>
          <div className="card-body">
            {FORECAST_DAYS.slice(1, 5).map((d, i) => {
              const st: CheckStatus =
                d.rain >= 60 ? 'danger' : d.rain >= 30 || d.wind >= 8 ? 'warn' : 'ok';
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 0',
                    borderBottom: i < 3 ? '1px solid var(--border-light)' : 'none',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, minWidth: 72 }}>{d.date}</span>
                  <span>{WEATHER_ICONS[d.weather]}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                    {d.tempL}〜{d.tempH}℃ / ☔{d.rain}% / 💨{d.wind}m/s
                  </span>
                  <span className={`badge ${STATUS_CLASS[st]}`}>
                    <span className="badge-dot"></span>
                    {STATUS_LABEL[st]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">養生条件メモ</span>
          </div>
          <div className="card-body">
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>推奨養生期間：</span>
                {w.temp >= 15 ? '5日以上' : w.temp >= 10 ? '7日以上' : '9日以上'}
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>暑中対策：</span>
                {w.temp >= 30 ? '必要（散水養生・遮光シート推奨）' : '不要'}
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>寒中対策：</span>
                {w.temp < 5 ? '必要（保温養生・給熱推奨）' : '不要'}
              </div>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>練混ぜ水温度：</span>
                {w.temp < 10 ? '40℃以下で加温推奨' : '常温で可'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface MarineWorkPageProps {
  selectedSite?: string;
}

interface WorkType {
  type: string;
  waveLimit: number;
  windLimit: number;
}

const WORK_TYPES: WorkType[] = [
  { type: 'クレーン船作業', waveLimit: 0.8, windLimit: 10 },
  { type: '潜水作業', waveLimit: 0.5, windLimit: 8 },
  { type: '台船据付', waveLimit: 1.0, windLimit: 12 },
  { type: '資材運搬船', waveLimit: 1.5, windLimit: 15 },
  { type: '測量船作業', waveLimit: 0.7, windLimit: 8 },
];

export const MarineWorkPage: FC<MarineWorkPageProps> = ({ selectedSite }) => {
  const marineSites = SITES.filter((s) => s.type !== 'land');
  const [siteId, setSiteId] = useState<string>(
    selectedSite && marineSites.find((s) => s.id === selectedSite)
      ? selectedSite
      : marineSites[0]?.id ?? '',
  );
  const site = marineSites.find((s) => s.id === siteId) || marineSites[0];
  const w = site ? generateWeather(site.id) : null;
  const m = site ? generateMarine(site.id) : null;

  const hourlyWave = useMemo(() => generateHourlyWave(), [siteId]);

  if (!site || !w || !m) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        海上工事現場がありません
      </div>
    );
  }

  // waveHeight on a marine site must be non-null — guard explicitly so the
  // structural `number | null` contract from data.ts holds at the boundary.
  const waveLimit = site.thresholds.waveHeight;
  if (waveLimit === null) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        この現場には波高基準が設定されていません
      </div>
    );
  }

  const marineChecks: CheckItemProps[] = [
    {
      label: '有義波高',
      value: m.waveHeight,
      unit: 'm',
      threshold: waveLimit,
      status: m.waveHeight > waveLimit ? 'danger' : m.waveHeight > waveLimit * 0.8 ? 'warn' : 'ok',
    },
    {
      label: '風速',
      value: w.wind,
      unit: 'm/s',
      threshold: site.thresholds.windSpeed,
      status:
        w.wind > site.thresholds.windSpeed
          ? 'danger'
          : w.wind > site.thresholds.windSpeed * 0.8
          ? 'warn'
          : 'ok',
    },
    {
      label: '波周期',
      value: m.wavePeriod,
      unit: '秒',
      threshold: 8,
      thresholdUnit: '秒 以下',
      status: m.wavePeriod > 8 ? 'warn' : 'ok',
    },
    {
      label: '降水量',
      value: w.rain,
      unit: 'mm/h',
      threshold: site.thresholds.rainfall,
      status: w.rain > site.thresholds.rainfall ? 'danger' : 'ok',
    },
  ];

  const overallStatus: CheckStatus = marineChecks.some((c) => c.status === 'danger')
    ? 'danger'
    : marineChecks.some((c) => c.status === 'warn')
    ? 'warn'
    : 'ok';

  const recommendations: Record<CheckStatus, string> = {
    ok: '海象・気象条件は海上作業に適しています。通常の安全手順に従い作業を進めてください。',
    warn: '一部条件が基準値に接近しています。作業船の動揺に注意し、安全監視員の配置を強化してください。',
    danger:
      '海象条件が施工中止基準を超過しています。直ちに海上作業を中止し、船舶の安全確保を最優先してください。',
  };

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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm">📥 PDF出力</button>
          <button className="btn btn-sm btn-primary">🔄 再判定</button>
        </div>
      </div>

      <div className="decision-panel mb-16">
        <div className={`decision-header ${overallStatus}`}>
          <div className="decision-icon">
            {overallStatus === 'ok' ? '✅' : overallStatus === 'warn' ? '⚡' : '⛔'}
          </div>
          <div>
            <div className="decision-title">
              海上作業判定：
              {overallStatus === 'ok' ? '施工可' : overallStatus === 'warn' ? '注意' : '中止推奨'}
            </div>
            <div className="decision-sub">
              {site.shortName} ／ 観測点: {site.marinePoint} ／ {nowJSTLabel()}
            </div>
          </div>
        </div>
        <div className="decision-body">
          <div className={`reason-text ${overallStatus}`}>{recommendations[overallStatus]}</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">判定項目</span>
        </div>
        <div>
          {marineChecks.map((c, i) => (
            <CheckItem key={i} {...c} />
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">波高推移予測（24時間）</span>
        </div>
        <div className="card-body">
          <LineChart
            data={hourlyWave.map((h) => ({ label: `${h.hour}`, value: h.height }))}
            width={800}
            height={200}
            color="#2874a6"
            threshold={waveLimit}
            thresholdLabel={`基準 ${waveLimit}m`}
            yLabel="有義波高 (m)"
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">作業種別ごとの可否</span>
        </div>
        <div className="card-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>作業種別</th>
                <th>波高基準</th>
                <th>風速基準</th>
                <th>現在波高</th>
                <th>現在風速</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {WORK_TYPES.map((work, i) => {
                const wSt: CheckStatus =
                  m.waveHeight > work.waveLimit
                    ? 'danger'
                    : m.waveHeight > work.waveLimit * 0.8
                    ? 'warn'
                    : 'ok';
                const windSt: CheckStatus =
                  w.wind > work.windLimit
                    ? 'danger'
                    : w.wind > work.windLimit * 0.8
                    ? 'warn'
                    : 'ok';
                const st: CheckStatus =
                  wSt === 'danger' || windSt === 'danger'
                    ? 'danger'
                    : wSt === 'warn' || windSt === 'warn'
                    ? 'warn'
                    : 'ok';
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{work.type}</td>
                    <td>{work.waveLimit} m</td>
                    <td>{work.windLimit} m/s</td>
                    <td
                      style={{
                        color: wSt !== 'ok' ? `var(--status-${wSt})` : 'inherit',
                        fontWeight: wSt !== 'ok' ? 600 : 400,
                      }}
                    >
                      {m.waveHeight} m
                    </td>
                    <td
                      style={{
                        color: windSt !== 'ok' ? `var(--status-${windSt})` : 'inherit',
                        fontWeight: windSt !== 'ok' ? 600 : 400,
                      }}
                    >
                      {w.wind} m/s
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[st]}`}>
                        <span className="badge-dot"></span>
                        {STATUS_LABEL[st]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

declare global {
  interface Window {
    ConcretePage?: typeof ConcretePage;
    MarineWorkPage?: typeof MarineWorkPage;
    CheckItem?: typeof CheckItem;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, { ConcretePage, MarineWorkPage, CheckItem });
}
