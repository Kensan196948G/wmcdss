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

import { useEffect, useMemo, useState, useCallback, type FC } from 'react';
import { LineChart } from './charts';
import {
  backendConnected,
  requestDecisionFromBackend,
} from './api';

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
import { useLiveSites } from './weather-marine';

type CheckStatus = Status;

interface AiResult {
  status: 'go' | 'caution' | 'stop';
  summary: string;
  issues: string[];
  warnings: string[];
  recommendations: string[];
  confidence: '高' | '中' | '低';
  analysis_type: string;
  disclaimer: string;
}

interface AiAssistResponse {
  summary: string;
  bullets: string[];
  recommendations: string[];
  analysis_type: string;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// 実データ判定（バックエンド /decisions）用のヘルパー
// ---------------------------------------------------------------------------

interface SnapshotRule {
  work_type: string;
  metric: string;
  op: string;
  value: number;
  severity: 'warn' | 'stop';
  note?: string | null;
  observed?: number | null;
}

interface BackendDecision {
  status: 'go' | 'caution' | 'stop';
  reason: string;
  inputs: Record<string, number | null>;
  thresholds_snapshot: {
    rules?: SnapshotRule[];
    unevaluated?: SnapshotRule[];
  };
}

const METRIC_LABELS: Record<string, string> = {
  wind_speed_ms: '風速',
  wind_gust_ms: '最大瞬間風速',
  precip_mm_1h: '降水量',
  temperature_c: '気温',
  humidity_pct: '湿度',
  sig_wave_h_m: '有義波高',
  wave_period_s: '波周期',
};

const METRIC_UNITS: Record<string, string> = {
  wind_speed_ms: 'm/s',
  wind_gust_ms: 'm/s',
  precip_mm_1h: 'mm/h',
  temperature_c: '℃',
  humidity_pct: '%',
  sig_wave_h_m: 'm',
  wave_period_s: '秒',
};

function decisionStatusToCheck(status: 'go' | 'caution' | 'stop'): Status {
  return status === 'stop' ? 'danger' : status === 'caution' ? 'warn' : 'ok';
}

function snapshotChecks(
  snapshot: BackendDecision['thresholds_snapshot'],
): CheckItemProps[] {
  const out: CheckItemProps[] = [];
  const seen = new Set<string>();
  for (const rule of snapshot.rules ?? []) {
    const key = `${rule.metric}:${rule.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: `${METRIC_LABELS[rule.metric] ?? rule.metric}`,
      value: rule.observed ?? '欠測',
      unit: METRIC_UNITS[rule.metric] ?? '',
      threshold: rule.value,
      status: rule.severity === 'stop' ? 'danger' : 'warn',
      thresholdUnit: METRIC_UNITS[rule.metric] ?? '',
    });
  }
  for (const rule of snapshot.unevaluated ?? []) {
    out.push({
      label: `${METRIC_LABELS[rule.metric] ?? rule.metric}（欠測）`,
      value: '—',
      unit: METRIC_UNITS[rule.metric] ?? '',
      threshold: rule.value,
      status: 'warn',
    });
  }
  return out;
}

function inputsToWeather(
  inputs: Record<string, number | null>,
): { temp: number | null; hum: number | null; wind: number | null; rain: number | null } {
  return {
    temp: inputs.temperature_c ?? null,
    hum: inputs.humidity_pct ?? null,
    wind: inputs.wind_speed_ms ?? null,
    rain: inputs.precip_mm_1h ?? null,
  };
}

function inputsToMarine(
  inputs: Record<string, number | null>,
): {
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDir: string | null;
  tide: string | null;
  tideLevel: number | null;
} {
  return {
    waveHeight: inputs.sig_wave_h_m ?? null,
    wavePeriod: inputs.wave_period_s ?? null,
    waveDir: null,
    tide: null,
    tideLevel: null,
  };
}

async function postAiAssist(path: string, payload: unknown): Promise<AiAssistResponse> {
  const apiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE
    ?? '/api/v1';
  const resp = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json() as AiAssistResponse;
}

const AiAssistPanel: FC<{ title: string; result: AiAssistResponse | null }> = ({ title, result }) => {
  if (!result) return null;
  return (
    <div className="card mb-16" style={{ borderColor: 'var(--blue-300)' }}>
      <div className="card-header" style={{ background: 'var(--blue-50)' }}>
        <span className="card-title">
          {title}
          <span className="badge badge-info" style={{ marginLeft: 8 }}>
            {result.analysis_type === 'claude_ai' ? 'Claude AI' : 'ルールベース'}
          </span>
        </span>
      </div>
      <div className="card-body" style={{ fontSize: 13, lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{result.summary}</div>
        {result.bullets.map((line, idx) => (
          <div key={`b-${idx}`} style={{ color: 'var(--text-secondary)' }}>・{line}</div>
        ))}
        {result.recommendations.map((line, idx) => (
          <div key={`r-${idx}`} style={{ color: 'var(--blue-600)' }}>推奨: {line}</div>
        ))}
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
          {result.disclaimer}
        </div>
      </div>
    </div>
  );
};

export interface CheckItemProps {
  label: string;
  value: number | string;
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
  const liveSites = useLiveSites();
  const [siteId, setSiteId] = useState<string>((selectedSite || liveSites[0]?.id) ?? SITES[0].id);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAudience, setAiAudience] = useState<'field' | 'manager'>('field');
  const [windowAiResult, setWindowAiResult] = useState<AiAssistResponse | null>(null);
  const [windowAiLoading, setWindowAiLoading] = useState(false);
  const [backendDecision, setBackendDecision] = useState<BackendDecision | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const site: Site = liveSites.find((s) => s.id === siteId) || liveSites[0] || SITES[0];
  useEffect(() => {
    if (liveSites.length === 0) return;
    const exists = liveSites.some((s) => s.id === siteId);
    if (!exists) setSiteId(liveSites[0].id);
  }, [liveSites, siteId]);
  const live = backendDecision != null;
  const w = live
    ? inputsToWeather(backendDecision.inputs)
    : (generateWeather(site.id) as unknown as {
        temp: number; hum: number; wind: number; rain: number;
      });
  // チェック表・養生メモ用の非 null ビュー（実データ欠測時は安全側の代替値）
  const wv = {
    temp: w.temp ?? 15,
    hum: w.hum ?? 60,
    wind: w.wind ?? 0,
    rain: w.rain ?? 0,
  };
  // getDecision is kept for parity with the legacy page (used elsewhere in props
  // chains); the local concreteChecks below produce the displayed status.
  void getDecision(site);

  const loadDecision = useCallback(async () => {
    if (!backendConnected()) return;
    setDecisionLoading(true);
    try {
      const raw = (await requestDecisionFromBackend({
        siteId: site.id,
        workType: 'concrete',
      })) as BackendDecision;
      setBackendDecision(raw);
    } catch {
      setBackendDecision(null);
    } finally {
      setDecisionLoading(false);
    }
  }, [site.id]);

  useEffect(() => {
    if (backendConnected()) {
      void loadDecision();
    }
  }, [loadDecision]);

  const handleAiAnalyze = useCallback(async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const apiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE
        ?? '/api/v1';
      const resp = await fetch(`${apiBase}/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: site.id,
          work_type: 'concrete',
          audience: aiAudience,
          weather: { temp: w.temp, hum: w.hum, wind: w.wind, rain: w.rain },
          marine: null,
          thresholds: site.thresholds,
        }),
      });
      if (resp.ok) {
        setAiResult(await resp.json());
      }
    } catch {
      // ignore network errors — AI analysis is optional
    } finally {
      setAiLoading(false);
    }
  }, [aiAudience, site.id, site.thresholds, w.temp, w.hum, w.wind, w.rain]);

  const getCheckStatus = (val: number | null, thresh: number, invert = false): CheckStatus => {
    if (val == null) return 'warn';
    if (invert) return val < thresh ? 'danger' : val < thresh * 1.2 ? 'warn' : 'ok';
    return val > thresh ? 'danger' : val > thresh * 0.8 ? 'warn' : 'ok';
  };

  const handleWorkWindowAi = async () => {
    setWindowAiLoading(true);
    try {
      setWindowAiResult(await postAiAssist('/ai/chat', {
        question: 'コンクリート打設に適した作業時間帯を提案してください。午前・午後など実務で使える表現にしてください。',
        context: {
          site: site.shortName,
          weather: { temp: w.temp, hum: w.hum, wind: w.wind, rain: w.rain },
          thresholds: site.thresholds,
          forecast: FORECAST_DAYS.slice(0, 5),
          note: 'AIは作業計画補助のみ。最終判断は施工判定と現場責任者が行う。',
        },
      }));
    } catch {
      setWindowAiResult(null);
    } finally {
      setWindowAiLoading(false);
    }
  };

  const concreteChecks: CheckItemProps[] = live
    ? snapshotChecks(backendDecision.thresholds_snapshot)
    : [
        {
          label: '降水量',
          value: wv.rain,
          unit: 'mm/h',
          threshold: site.thresholds.rainfall,
          status: getCheckStatus(wv.rain, site.thresholds.rainfall),
        },
        {
          label: '風速',
          value: wv.wind,
          unit: 'm/s',
          threshold: site.thresholds.windSpeed,
          status: getCheckStatus(wv.wind, site.thresholds.windSpeed),
        },
        {
          label: '気温（下限）',
          value: wv.temp,
          unit: '℃',
          threshold: site.thresholds.tempLow,
          status:
            wv.temp < site.thresholds.tempLow
              ? 'danger'
              : wv.temp < site.thresholds.tempLow + 2
              ? 'warn'
              : 'ok',
        },
        {
          label: '気温（上限）',
          value: wv.temp,
          unit: '℃',
          threshold: site.thresholds.tempHigh,
          status:
            wv.temp > site.thresholds.tempHigh
              ? 'danger'
              : wv.temp > site.thresholds.tempHigh - 3
              ? 'warn'
              : 'ok',
        },
        {
          label: '湿度',
          value: wv.hum,
          unit: '%',
          threshold: 85,
          thresholdUnit: '% 以下',
          status: wv.hum > 85 ? 'warn' : 'ok',
        },
      ];

  const overallStatus: CheckStatus = live
    ? decisionStatusToCheck(backendDecision.status)
    : concreteChecks.some((c) => c.status === 'danger')
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
            {liveSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortName}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm">📥 PDF出力</button>
          <select
            className="form-select"
            value={aiAudience}
            onChange={(e) => setAiAudience(e.target.value as 'field' | 'manager')}
            style={{ width: 150, padding: '4px 10px', fontSize: 12 }}
          >
            <option value="field">現場向け</option>
            <option value="manager">管理者向け</option>
          </select>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleAiAnalyze}
            disabled={aiLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {aiLoading ? '🤖 分析中...' : '🤖 AI分析'}
          </button>
          <button className="btn btn-sm" onClick={handleWorkWindowAi} disabled={windowAiLoading}>
            {windowAiLoading ? '提案中...' : 'AI時間帯提案'}
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => { void loadDecision(); }} disabled={decisionLoading}>
            {decisionLoading ? '判定中...' : '🔄 再判定'}
          </button>
        </div>
      </div>
      <AiAssistPanel title="作業計画 AI時間帯提案" result={windowAiResult} />

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
            <div className="decision-sub">
              {site.shortName} ／ {nowJSTLabel()}
              {live && <span className="badge badge-info" style={{ marginLeft: 8 }}>実データ判定</span>}
              {live && backendConnected() && (
                <span className="badge badge-warn" style={{ marginLeft: 4 }}>バックエンド接続</span>
              )}
            </div>
          </div>
        </div>
        <div className="decision-body">
          <div className={`reason-text ${overallStatus}`} style={{ whiteSpace: 'pre-wrap' }}>
            {live ? backendDecision.reason : recommendations[overallStatus]}
          </div>
        </div>
      </div>

      {aiResult && (
        <div className="card mb-16" style={{ border: '2px solid var(--blue-400)' }}>
          <div className="card-header" style={{ background: 'var(--blue-50)' }}>
            <span className="card-title" style={{ color: 'var(--blue-600)' }}>
              🤖 AI分析結果
              {aiResult.analysis_type === 'claude_ai' && (
                <span style={{ fontSize: 11, marginLeft: 8, background: 'var(--blue-500)', color: '#fff', padding: '2px 8px', borderRadius: 100 }}>
                  Claude AI
                </span>
              )}
            </span>
          </div>
          <div className="card-body">
            <div style={{
              padding: '10px 14px', borderRadius: 6, marginBottom: 12,
              background: aiResult.status === 'go' ? 'var(--status-ok-bg)' : aiResult.status === 'caution' ? 'var(--status-warn-bg)' : 'var(--status-danger-bg)',
              color: aiResult.status === 'go' ? 'var(--status-ok)' : aiResult.status === 'caution' ? 'var(--status-warn)' : 'var(--status-danger)',
              fontWeight: 600,
            }}>
              {aiResult.status === 'go' ? '✅' : aiResult.status === 'caution' ? '⚡' : '⛔'} {aiResult.summary}
            </div>

            {aiResult.issues.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--status-danger)', marginBottom: 4 }}>⚠️ 超過項目:</div>
                {aiResult.issues.map((issue: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {issue}</div>
                ))}
              </div>
            )}

            {aiResult.warnings.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--status-warn)', marginBottom: 4 }}>📋 注意事項:</div>
                {aiResult.warnings.map((w: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {w}</div>
                ))}
              </div>
            )}

            {aiResult.recommendations.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--blue-600)', marginBottom: 4 }}>💡 推奨事項:</div>
                {aiResult.recommendations.map((r: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {r}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                信頼度: <strong>{aiResult.confidence}</strong>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '70%', textAlign: 'right' }}>
                {aiResult.disclaimer}
              </span>
            </div>
          </div>
        </div>
      )}

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
                {wv.temp >= 15 ? '5日以上' : wv.temp >= 10 ? '7日以上' : '9日以上'}
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>暑中対策：</span>
                {wv.temp >= 30 ? '必要（散水養生・遮光シート推奨）' : '不要'}
              </div>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>寒中対策：</span>
                {wv.temp < 5 ? '必要（保温養生・給熱推奨）' : '不要'}
              </div>
              <div>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>練混ぜ水温度：</span>
                {wv.temp < 10 ? '40℃以下で加温推奨' : '常温で可'}
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
  backendKey: string;
  waveLimit: number;
  windLimit: number;
}

const WORK_TYPES: WorkType[] = [
  { type: 'クレーン船作業', backendKey: 'crane', waveLimit: 0.8, windLimit: 10 },
  { type: '潜水作業', backendKey: 'marine_dive', waveLimit: 0.5, windLimit: 8 },
  { type: '台船据付', backendKey: 'marine_lift', waveLimit: 1.0, windLimit: 12 },
  { type: '資材運搬船', backendKey: 'marine_transport', waveLimit: 1.5, windLimit: 15 },
  { type: '測量船作業', backendKey: 'marine_lift', waveLimit: 0.7, windLimit: 8 },
];

export const MarineWorkPage: FC<MarineWorkPageProps> = ({ selectedSite }) => {
  const liveSites = useLiveSites();
  const marineSites = liveSites.filter((s) => s.type !== 'land');
  const [siteId, setSiteId] = useState<string>(
    selectedSite && marineSites.find((s) => s.id === selectedSite)
      ? selectedSite
      : marineSites[0]?.id ?? '',
  );
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAudience, setAiAudience] = useState<'field' | 'manager'>('field');
  const [windowAiResult, setWindowAiResult] = useState<AiAssistResponse | null>(null);
  const [windowAiLoading, setWindowAiLoading] = useState(false);
  const [backendDecisions, setBackendDecisions] = useState<BackendDecision[] | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const site = marineSites.find((s) => s.id === siteId) || marineSites[0];

  const loadDecisions = useCallback(async () => {
    if (!site || !backendConnected()) return;
    setDecisionLoading(true);
    try {
      const results = await Promise.all(
        WORK_TYPES.map(async (wt) => {
          try {
            return (await requestDecisionFromBackend({
              siteId: site.id,
              workType: wt.backendKey,
            })) as BackendDecision;
          } catch {
            return null;
          }
        }),
      );
      setBackendDecisions(results.filter((r): r is BackendDecision => r != null));
    } catch {
      setBackendDecisions(null);
    } finally {
      setDecisionLoading(false);
    }
  }, [site?.id]);

  useEffect(() => {
    if (backendConnected()) {
      void loadDecisions();
    }
  }, [loadDecisions]);

  const live = backendDecisions != null && backendDecisions.length > 0;
  const worstDecision = live
    ? backendDecisions.reduce<BackendDecision | null>((acc, d) => {
        const rank: Record<string, number> = { go: 0, caution: 1, stop: 2 };
        if (!acc || rank[d.status] > rank[acc.status]) return d;
        return acc;
      }, null)
    : null;
  const w = live && worstDecision
    ? inputsToWeather(worstDecision.inputs)
    : site
      ? generateWeather(site.id)
      : null;
  const m = live && worstDecision
    ? inputsToMarine(worstDecision.inputs)
    : site
      ? (generateMarine(site.id) as unknown as {
          waveHeight: number; wavePeriod: number; waveDir: string; tide: string; tideLevel: number;
        } | null)
      : null;
  // チェック表・作業種別表用の非 null ビュー（欠測時は安全側の代替値）
  const mv = {
    waveHeight: m?.waveHeight ?? 0,
    wavePeriod: m?.wavePeriod ?? 0,
    waveDir: m?.waveDir ?? '—',
    tide: m?.tide ?? '—',
    tideLevel: m?.tideLevel ?? 0,
  };

  const hourlyWave = useMemo(() => generateHourlyWave(), [siteId]);

  const handleAiAnalyze = useCallback(async () => {
    if (!site || !w || !m) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const apiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE
        ?? '/api/v1';
      const resp = await fetch(`${apiBase}/ai/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: site.id,
          work_type: 'marine',
          audience: aiAudience,
          weather: { temp: w.temp, hum: w.hum, wind: w.wind, rain: w.rain },
          marine: {
            waveHeight: m.waveHeight,
            wavePeriod: m.wavePeriod,
            waveDir: m.waveDir,
            tide: m.tide,
            tideLevel: m.tideLevel,
          },
          thresholds: site.thresholds,
        }),
      });
      if (resp.ok) {
        setAiResult(await resp.json());
      }
    } catch {
      // ignore network errors — AI analysis is optional
    } finally {
      setAiLoading(false);
    }
  }, [aiAudience, site, w, m]);

  const handleWorkWindowAi = async () => {
    if (!site || !w || !m) return;
    setWindowAiLoading(true);
    try {
      setWindowAiResult(await postAiAssist('/ai/chat', {
        question: '海上作業に適した作業時間帯を提案してください。波高・風速・降雨を踏まえ、情報共有用海象データの扱いも明示してください。',
        context: {
          site: site.shortName,
          weather: { temp: w.temp, hum: w.hum, wind: w.wind, rain: w.rain },
          marine: m,
          thresholds: site.thresholds,
          wave_forecast: hourlyWave.slice(0, 8),
          note: 'Open-Meteo Marine APIの海象は情報共有用。最終判断は施工判定と現場責任者が行う。',
        },
      }));
    } catch {
      setWindowAiResult(null);
    } finally {
      setWindowAiLoading(false);
    }
  };

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

  const marineChecks: CheckItemProps[] = live && worstDecision
    ? snapshotChecks(worstDecision.thresholds_snapshot)
    : [
        {
          label: '有義波高',
          value: mv.waveHeight,
          unit: 'm',
          threshold: waveLimit,
          status: mv.waveHeight > waveLimit ? 'danger' : mv.waveHeight > waveLimit * 0.8 ? 'warn' : 'ok',
        },
        {
          label: '風速',
          value: w.wind ?? 0,
          unit: 'm/s',
          threshold: site.thresholds.windSpeed,
          status:
            (w.wind ?? 0) > site.thresholds.windSpeed
              ? 'danger'
              : (w.wind ?? 0) > site.thresholds.windSpeed * 0.8
              ? 'warn'
              : 'ok',
        },
        {
          label: '波周期',
          value: mv.wavePeriod,
          unit: '秒',
          threshold: 8,
          thresholdUnit: '秒 以下',
          status: mv.wavePeriod > 8 ? 'warn' : 'ok',
        },
        {
          label: '降水量',
          value: w.rain ?? 0,
          unit: 'mm/h',
          threshold: site.thresholds.rainfall,
          status: (w.rain ?? 0) > site.thresholds.rainfall ? 'danger' : 'ok',
        },
      ];

  const overallStatus: CheckStatus = live && worstDecision
    ? decisionStatusToCheck(worstDecision.status)
    : marineChecks.some((c) => c.status === 'danger')
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
          <select
            className="form-select"
            value={aiAudience}
            onChange={(e) => setAiAudience(e.target.value as 'field' | 'manager')}
            style={{ width: 150, padding: '4px 10px', fontSize: 12 }}
          >
            <option value="field">現場向け</option>
            <option value="manager">管理者向け</option>
          </select>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleAiAnalyze}
            disabled={aiLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {aiLoading ? '🤖 分析中...' : '🤖 AI分析'}
          </button>
          <button className="btn btn-sm" onClick={handleWorkWindowAi} disabled={windowAiLoading}>
            {windowAiLoading ? '提案中...' : 'AI時間帯提案'}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => { void loadDecisions(); }}
            disabled={decisionLoading}
          >
            {decisionLoading ? '判定中...' : '🔄 再判定'}
          </button>
        </div>
      </div>
      <AiAssistPanel title="作業計画 AI時間帯提案" result={windowAiResult} />

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
              {live && <span className="badge badge-info" style={{ marginLeft: 8 }}>実データ判定</span>}
            </div>
          </div>
        </div>
        <div className="decision-body">
          <div className={`reason-text ${overallStatus}`} style={{ whiteSpace: 'pre-wrap' }}>
            {live && worstDecision ? worstDecision.reason : recommendations[overallStatus]}
          </div>
        </div>
      </div>

      {aiResult && (
        <div className="card mb-16" style={{ border: '2px solid var(--blue-400)' }}>
          <div className="card-header" style={{ background: 'var(--blue-50)' }}>
            <span className="card-title" style={{ color: 'var(--blue-600)' }}>
              🤖 AI分析結果
              {aiResult.analysis_type === 'claude_ai' && (
                <span style={{ fontSize: 11, marginLeft: 8, background: 'var(--blue-500)', color: '#fff', padding: '2px 8px', borderRadius: 100 }}>
                  Claude AI
                </span>
              )}
            </span>
          </div>
          <div className="card-body">
            <div style={{
              padding: '10px 14px', borderRadius: 6, marginBottom: 12,
              background: aiResult.status === 'go' ? 'var(--status-ok-bg)' : aiResult.status === 'caution' ? 'var(--status-warn-bg)' : 'var(--status-danger-bg)',
              color: aiResult.status === 'go' ? 'var(--status-ok)' : aiResult.status === 'caution' ? 'var(--status-warn)' : 'var(--status-danger)',
              fontWeight: 600,
            }}>
              {aiResult.status === 'go' ? '✅' : aiResult.status === 'caution' ? '⚡' : '⛔'} {aiResult.summary}
            </div>

            {aiResult.issues.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--status-danger)', marginBottom: 4 }}>⚠️ 超過項目:</div>
                {aiResult.issues.map((issue: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {issue}</div>
                ))}
              </div>
            )}

            {aiResult.warnings.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--status-warn)', marginBottom: 4 }}>📋 注意事項:</div>
                {aiResult.warnings.map((warn: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {warn}</div>
                ))}
              </div>
            )}

            {aiResult.recommendations.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--blue-600)', marginBottom: 4 }}>💡 推奨事項:</div>
                {aiResult.recommendations.map((r: string, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 12 }}>• {r}</div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-light)', paddingTop: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                信頼度: <strong>{aiResult.confidence}</strong>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '70%', textAlign: 'right' }}>
                {aiResult.disclaimer}
              </span>
            </div>
          </div>
        </div>
      )}

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
                const waveH = mv.waveHeight;
                const windS = w.wind ?? 0;
                const wSt: CheckStatus =
                  waveH > work.waveLimit
                    ? 'danger'
                    : waveH > work.waveLimit * 0.8
                    ? 'warn'
                    : 'ok';
                const windSt: CheckStatus =
                  windS > work.windLimit
                    ? 'danger'
                    : windS > work.windLimit * 0.8
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
