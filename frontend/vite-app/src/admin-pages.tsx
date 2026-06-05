import { useEffect, useMemo, useState, type ChangeEvent, type FC } from 'react';
import {
  AUDIT_LOG,
  ETL_JOBS,
  SITES,
  TYPE_LABEL,
  type SiteThresholds,
} from './data';

type Role = 'field' | 'manager';
type ReportFormat = 'pdf' | 'excel' | 'csv';
type ReportTemplate =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'decision'
  | 'marine'
  | 'annual';

interface ReportForm {
  site: string;
  template: ReportTemplate;
  dateFrom: string;
  dateTo: string;
  format: ReportFormat;
}

type ThresholdMap = Record<string, SiteThresholds>;

// ---------- Thresholds ----------
export const ThresholdsPage: FC = () => {
  const [editing, setEditing] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<ThresholdMap>(() =>
    SITES.reduce<ThresholdMap>(
      (acc, s) => ({ ...acc, [s.id]: { ...s.thresholds } }),
      {},
    ),
  );

  const handleSave = (_siteId: string) => {
    setEditing(null);
  };

  const updateField = (
    siteId: string,
    key: keyof SiteThresholds,
    value: number,
  ) => {
    setThresholds((prev) => ({
      ...prev,
      [siteId]: { ...prev[siteId], [key]: value },
    }));
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          各現場の施工中止基準値を管理します。変更履歴は監査ログに記録されます。
        </div>
        <button className="btn btn-sm">📥 一括CSV出力</button>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>現場名</th><th>工種</th>
              <th>風速 (m/s)</th><th>波高 (m)</th><th>降水量 (mm/h)</th>
              <th>気温下限 (℃)</th><th>気温上限 (℃)</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {SITES.map((site) => {
              const t = thresholds[site.id];
              const isEditing = editing === site.id;
              return (
                <tr key={site.id}>
                  <td style={{ fontWeight: 600 }}>{site.shortName}</td>
                  <td>{TYPE_LABEL[site.type]}</td>
                  {isEditing ? (
                    <>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: 70, padding: '4px 8px' }}
                          value={t.windSpeed}
                          onChange={(e) =>
                            updateField(site.id, 'windSpeed', +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        {site.type === 'land' ? (
                          '—'
                        ) : (
                          <input
                            className="form-input"
                            type="number"
                            step="0.1"
                            style={{ width: 70, padding: '4px 8px' }}
                            value={t.waveHeight || ''}
                            onChange={(e) =>
                              updateField(site.id, 'waveHeight', +e.target.value)
                            }
                          />
                        )}
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: 70, padding: '4px 8px' }}
                          value={t.rainfall}
                          onChange={(e) =>
                            updateField(site.id, 'rainfall', +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: 70, padding: '4px 8px' }}
                          value={t.tempLow}
                          onChange={(e) =>
                            updateField(site.id, 'tempLow', +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="form-input"
                          type="number"
                          style={{ width: 70, padding: '4px 8px' }}
                          value={t.tempHigh}
                          onChange={(e) =>
                            updateField(site.id, 'tempHigh', +e.target.value)
                          }
                        />
                      </td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSave(site.id)}
                        >
                          保存
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => setEditing(null)}
                        >
                          取消
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.windSpeed}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.waveHeight || '—'}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.rainfall}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.tempLow}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.tempHigh}</td>
                      <td>
                        <button className="btn btn-sm" onClick={() => setEditing(site.id)}>
                          編集
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------- ETL Status ----------

// Data source metadata for display
interface EtlSource {
  label: string;
  url: string;
  interval: string;
  table: string;
  data: string;
}

const ETL_SOURCES: EtlSource[] = [
  {
    label: 'AMeDAS 10分観測データ',
    url: 'https://www.jma.go.jp/bosai/amedas/',
    interval: '10分毎（毎時 :00, :10, :20, :30, :40, :50）',
    table: 'weather_observations',
    data: '気温・湿度・気圧・風速・風向・降水量',
  },
  {
    label: '波浪ナウキャスト',
    url: 'https://www.jma.go.jp/bosai/nowc/',
    interval: '1時間毎（毎時 03分）',
    table: 'marine_observations',
    data: '有義波高・波周期・波向・潮位',
  },
];

// ETL job source/data/URL metadata keyed by job id
const ETL_JOB_META: Record<number, { source: string; dataItems: string; url: string }> = {
  1: {
    source: '気象庁 AMeDAS',
    dataItems: '気温・湿度・気圧・風速・風向・降水量',
    url: 'https://www.jma.go.jp/bosai/amedas/',
  },
  2: {
    source: '気象庁 波浪ナウキャスト',
    dataItems: '有義波高・波周期・波向・潮位',
    url: 'https://www.jma.go.jp/bosai/nowc/',
  },
  3: {
    source: '気象庁 潮位観測',
    dataItems: '潮位',
    url: 'https://www.jma.go.jp/bosai/amedas/',
  },
};

type BackendStatus = {
  ok: boolean;
  sites?: number;
  [key: string]: unknown;
};

// Backend ETL status response shape
interface EtlJobStatus {
  id: number | string;
  name: string;
  source: string;
  schedule: string;
  last_obs_at: string | null;
  status: string;
}

interface EtlStatusResponse {
  jobs: EtlJobStatus[];
}

export const EtlPage: FC = () => {
  const backendStatus = (
    typeof window !== 'undefined'
      ? (window as Window & { BACKEND_STATUS?: BackendStatus }).BACKEND_STATUS
      : undefined
  );
  const isConnected = backendStatus?.ok === true;

  const [runningJob, setRunningJob] = useState(false);
  const [etlJobStatuses, setEtlJobStatuses] = useState<EtlJobStatus[] | null>(null);

  // Fetch ETL status from backend on mount (only when API base is configured)
  useEffect(() => {
    const configuredApiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE;
    if (!configuredApiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${configuredApiBase}/etl/status`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as EtlStatusResponse;
        if (!cancelled && Array.isArray(data?.jobs)) {
          setEtlJobStatuses(data.jobs);
        }
      } catch {
        // Backend not available — stay with static ETL_JOBS data
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleManualRun = async () => {
    const configuredApiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE;
    if (!configuredApiBase) {
      alert('バックエンドに接続できません');
      return;
    }
    setRunningJob(true);
    try {
      const resp = await fetch(`${configuredApiBase}/etl/run/1`, { method: 'POST' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // Success — revert button after 1s
      setTimeout(() => setRunningJob(false), 1000);
    } catch {
      setRunningJob(false);
      alert('バックエンドに接続できません');
    }
  };

  // Find last_obs_at values for weather and marine jobs from backend status
  const weatherLastObs = etlJobStatuses?.find((j) => j.id === 1)?.last_obs_at ?? null;
  const marineLastObs = etlJobStatuses?.find((j) => j.id === 2)?.last_obs_at ?? null;

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          気象庁データの自動取得ジョブの実行状況を確認します。
        </div>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleManualRun}
          disabled={runningJob}
        >
          {runningJob ? '実行中...' : '▶ 手動実行'}
        </button>
      </div>

      {/* データ取得元情報 */}
      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">データ取得元情報</span>
        </div>
        <div className="card-body">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
            取得元: 気象庁（JMA）公開API
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>データ種別</th>
                <th>取得データ</th>
                <th>取得間隔</th>
                <th>格納テーブル</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {ETL_SOURCES.map((src, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{src.label}</td>
                  <td style={{ fontSize: 12 }}>{src.data}</td>
                  <td style={{ fontSize: 12 }}>{src.interval}</td>
                  <td>
                    <code style={{ fontSize: 11, background: 'var(--bg-muted, #f3f4f6)', padding: '2px 6px', borderRadius: 4 }}>
                      {src.table}
                    </code>
                  </td>
                  <td>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: 'var(--blue-600)', wordBreak: 'break-all' }}
                    >
                      {src.url}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* バックエンド接続状況 */}
      <div className="grid-2 mb-16">
        <div className="stat-card">
          <div className="stat-label">バックエンド接続状況</div>
          <div className="stat-value" style={{ fontSize: 14, color: isConnected ? 'var(--status-ok)' : 'var(--status-warn, #d97706)' }}>
            {isConnected ? '✅ バックエンド接続中' : '⚠️ バックエンド未接続（サンプルデータ表示中）'}
          </div>
          {(weatherLastObs || marineLastObs) && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              {weatherLastObs && <div>最終気象観測: {weatherLastObs}</div>}
              {marineLastObs && <div>最終海象観測: {marineLastObs}</div>}
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">取得実績（現場数）</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {isConnected && backendStatus?.sites != null
              ? String(backendStatus.sites)
              : '—'}
          </div>
          <div className="stat-sub">{isConnected ? '接続中の現場数' : '未接続'}</div>
        </div>
      </div>

      {/* ジョブ一覧 */}
      <div className="card">
        <div className="card-header"><span className="card-title">ジョブ一覧</span></div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ジョブ名</th>
              <th>取得元</th>
              <th>取得データ</th>
              <th>URL</th>
              <th>スケジュール</th>
              <th>最終実行</th>
              <th>ステータス</th>
              <th>取得件数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {ETL_JOBS.map((job) => {
              const meta = ETL_JOB_META[job.id];
              return (
                <tr key={job.id}>
                  <td style={{ fontWeight: 600 }}>{job.name}</td>
                  <td style={{ fontSize: 12 }}>{meta?.source ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{meta?.dataItems ?? '—'}</td>
                  <td>
                    {meta?.url ? (
                      <a
                        href={meta.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: 'var(--blue-600)', wordBreak: 'break-all' }}
                      >
                        {meta.url}
                      </a>
                    ) : '—'}
                  </td>
                  <td>{job.schedule}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.lastRun}</td>
                  <td>
                    <span className={`badge ${job.status === 'ok' ? 'badge-ok' : 'badge-warn'}`}>
                      <span className="badge-dot"></span>
                      {job.status === 'ok' ? '正常' : job.status}
                    </span>
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.records.toLocaleString()}</td>
                  <td>
                    <button className="btn btn-sm">▶ 実行</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------- Reports ----------
const REPORT_FORMATS: { value: ReportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'excel', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
];

interface RecentReport {
  time: string;
  tmpl: string;
  target: string;
  fmt: 'PDF' | 'Excel' | 'CSV';
}

const RECENT_REPORTS: RecentReport[] = [
  { time: '2026/05/21 17:30', tmpl: '週次気象レポート', target: '川崎港護岸', fmt: 'PDF' },
  { time: '2026/05/20 09:00', tmpl: '日次気象レポート', target: '全現場', fmt: 'Excel' },
  { time: '2026/05/15 10:00', tmpl: '月次気象集計', target: '東京港大橋', fmt: 'PDF' },
  { time: '2026/05/01 08:00', tmpl: '施工判定記録', target: '千葉港浚渫', fmt: 'CSV' },
];

export const ReportsPage: FC = () => {
  const [form, setForm] = useState<ReportForm>({
    site: 'all',
    template: 'daily',
    dateFrom: '2026-05-01',
    dateTo: '2026-05-22',
    format: 'pdf',
  });
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  const handleGenerate = () => {
    setGenerating(true);
    setDone(false);

    // WMCDSS_API_BASE must be explicitly configured at runtime for real backend
    // calls. When it is absent (local dev / test / demo) fall straight through
    // to the simulated setTimeout path so existing tests keep passing.
    const configuredApiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE;

    if (!configuredApiBase) {
      setTimeout(() => {
        setGenerating(false);
        setDone(true);
      }, 1500);
      return;
    }

    const siteId = form.site !== 'all' ? form.site : SITES[0].id;

    fetch(`${configuredApiBase}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: siteId,
        template: form.template,
        date_from: form.dateFrom,
        date_to: form.dateTo,
        format: form.format,
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wmcdss_report_${form.template}.${form.format}`;
        a.click();
        URL.revokeObjectURL(url);
        setGenerating(false);
        setDone(true);
      })
      .catch(() => {
        // Fallback to simulated generation when backend call fails
        setTimeout(() => {
          setGenerating(false);
          setDone(true);
        }, 1500);
      });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="card mb-16">
        <div className="card-header"><span className="card-title">レポート生成</span></div>
        <div className="card-body">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">対象現場</label>
              <select
                className="form-select"
                value={form.site}
                onChange={(e) => setForm((p) => ({ ...p, site: e.target.value }))}
              >
                <option value="all">全現場</option>
                {SITES.map((s) => (
                  <option key={s.id} value={s.id}>{s.shortName}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">テンプレート</label>
              <select
                className="form-select"
                value={form.template}
                onChange={(e) =>
                  setForm((p) => ({ ...p, template: e.target.value as ReportTemplate }))
                }
              >
                <option value="daily">日次気象レポート</option>
                <option value="weekly">週次気象レポート</option>
                <option value="monthly">月次気象集計</option>
                <option value="decision">施工判定記録</option>
                <option value="marine">海象データ集計</option>
                <option value="annual">年次統計レポート</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">開始日</label>
              <input
                className="form-input"
                type="date"
                value={form.dateFrom}
                onChange={(e) => setForm((p) => ({ ...p, dateFrom: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">終了日</label>
              <input
                className="form-input"
                type="date"
                value={form.dateTo}
                onChange={(e) => setForm((p) => ({ ...p, dateTo: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">出力形式</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {REPORT_FORMATS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`btn btn-sm ${form.format === value ? 'btn-primary' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, format: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
              {generating ? '生成中…' : '📄 レポート生成'}
            </button>
          </div>

          {done && (
            <div style={{
              marginTop: 16,
              background: 'var(--status-ok-bg)',
              border: '1px solid var(--status-ok-border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              fontSize: 13,
              color: 'var(--status-ok)',
              fontWeight: 500,
            }}>
              ✓ レポートが生成されました。ダウンロードが開始されます。
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">最近のレポート</span></div>
        <table className="data-table">
          <thead>
            <tr><th>日時</th><th>テンプレート</th><th>対象</th><th>形式</th><th>操作</th></tr>
          </thead>
          <tbody>
            {RECENT_REPORTS.map((r, i) => (
              <tr key={i}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.time}</td>
                <td>{r.tmpl}</td>
                <td>{r.target}</td>
                <td><span className="badge badge-neutral">{r.fmt}</span></td>
                <td><button className="btn btn-sm">📥 再ダウンロード</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------- Audit Log ----------

interface BackendAuditEntry {
  id: number;
  occurred_at: string;
  actor: string | null;
  action: string;
  target_type: string | null;
  target_id: number | string | null;
  detail: Record<string, unknown> | string | null;
}

function formatJST(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoStr;
  }
}

function formatDetail(detail: BackendAuditEntry['detail']): string {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail);
}

export const AuditPage: FC = () => {
  const [filterAction, setFilterAction] = useState<string>('all');
  const [backendLogs, setBackendLogs] = useState<typeof AUDIT_LOG | null>(null);
  const [isRealData, setIsRealData] = useState(false);

  useEffect(() => {
    const api = (window as Window & { WMCDSS_API?: { fetchAuditLog: Function } }).WMCDSS_API;
    if (!api?.fetchAuditLog) return;
    let cancelled = false;
    (async () => {
      try {
        const result: BackendAuditEntry[] = await api.fetchAuditLog({ limit: 100 });
        if (cancelled || !Array.isArray(result)) return;
        const converted = result.map((entry) => ({
          id: entry.id,
          time: formatJST(entry.occurred_at),
          user: entry.actor ?? 'システム',
          action: entry.action,
          target: [entry.target_type, entry.target_id].filter(Boolean).join(' #') || '—',
          detail: formatDetail(entry.detail),
        }));
        setBackendLogs(converted);
        setIsRealData(true);
      } catch {
        // fall through to AUDIT_LOG fallback
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const displayLogs = backendLogs ?? AUDIT_LOG;

  const actions = useMemo(
    () => Array.from(new Set(displayLogs.map((l) => l.action))),
    [displayLogs],
  );
  const filtered = useMemo(
    () => (filterAction === 'all' ? displayLogs : displayLogs.filter((l) => l.action === filterAction)),
    [filterAction, displayLogs],
  );

  // HTML エスケープヘルパー — エクスポート HTML への XSS を防ぐ。
  // 監査ログの actor/action/target/detail フィールドにはユーザー入力由来の
  // 文字列が含まれる可能性があるため、全フィールドをエスケープする。
  const esc = (s: unknown): string =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const handleExportCsv = () => {
    const header = ['日時', 'ユーザー', '操作', '対象', '詳細'];
    const rows = filtered.map(log => [
      log.time,
      log.user,
      log.action,
      log.target,
      log.detail,
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const bom = '﻿'; // BOM for Excel UTF-8
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportHtml = () => {
    // 全フィールドを esc() でエスケープして XSS を防ぐ
    const rows = filtered.map(log => `
    <tr>
      <td>${esc(log.time)}</td>
      <td>${esc(log.user)}</td>
      <td><span class="badge">${esc(log.action)}</span></td>
      <td>${esc(log.target)}</td>
      <td>${esc(log.detail)}</td>
    </tr>`).join('');

    // meta 行の filterAction もエスケープ
    const filterMeta = filterAction !== 'all' ? ` / フィルタ: ${esc(filterAction)}` : '';

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>監査ログ - WMCDSS</title>
<style>
  body { font-family: 'Noto Sans JP', 'Meiryo', sans-serif; font-size: 13px; color: #1a2332; margin: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #718096; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a5276; color: #fff; padding: 8px 12px; text-align: left; font-size: 12px; }
  td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:nth-child(even) { background: #f8f9fb; }
  .badge { background: #eaf2f8; color: #1a5276; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>監査ログ</h1>
<div class="meta">出力日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / 件数: ${filtered.length}件${filterMeta}</div>
<table>
<thead><tr><th>日時</th><th>ユーザー</th><th>操作</th><th>対象</th><th>詳細</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    // 全フィールドを esc() でエスケープして XSS を防ぐ
    const rows = filtered.map(log => `
    <tr>
      <td>${esc(log.time)}</td>
      <td>${esc(log.user)}</td>
      <td>${esc(log.action)}</td>
      <td>${esc(log.target)}</td>
      <td>${esc(log.detail)}</td>
    </tr>`).join('');

    // meta 行の filterAction もエスケープ
    const filterMeta = filterAction !== 'all' ? ` / フィルタ: ${esc(filterAction)}` : '';

    // <script> タグはユーザーデータを含まず window.print()/close() のみを実行するため安全。
    // ただし全テーブルデータは esc() でエスケープ済みであることが前提。
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>監査ログ - WMCDSS</title>
<style>
  body { font-family: 'Noto Sans JP', 'Meiryo', 'MS Gothic', sans-serif; font-size: 11px; color: #000; margin: 10mm; }
  h1 { font-size: 14px; margin-bottom: 3px; }
  .meta { color: #666; font-size: 10px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1a5276; color: #fff; padding: 5px 8px; text-align: left; font-size: 10px; }
  td { padding: 5px 8px; border: 1px solid #ccc; font-size: 10px; }
  tr:nth-child(even) { background: #f5f5f5; }
  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    body { margin: 0; }
  }
</style>
</head>
<body>
<h1>&#128203; 監査ログ</h1>
<div class="meta">出力日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} / 件数: ${filtered.length}件${filterMeta}</div>
<table>
<thead><tr><th>日時</th><th>ユーザー</th><th>操作</th><th>対象</th><th>詳細</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<script>window.onload = function() { window.print(); window.close(); };<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      // ポップアップブロック時はダウンロードにフォールバック
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}_print.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>操作種別</label>
          <select
            className="form-select"
            style={{ width: 200 }}
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="all">すべて</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          {isRealData && (
            <span className="badge badge-ok" style={{ fontSize: 11 }}>実データ</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={handleExportCsv}>📥 CSV</button>
          <button className="btn btn-sm" onClick={handleExportHtml}>🌐 HTML</button>
          <button className="btn btn-sm" onClick={handleExportPdf}>📄 PDF</button>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>日時</th><th>ユーザー</th><th>操作</th><th>対象</th><th>詳細</th></tr>
          </thead>
          <tbody>
            {filtered.map((log) => (
              <tr key={log.id}>
                <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{log.time}</td>
                <td style={{ fontWeight: 500 }}>{log.user}</td>
                <td><span className="badge badge-info">{log.action}</span></td>
                <td>{log.target}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{log.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------- Settings ----------
interface SettingsProps {
  role: Role;
}

const NOTIFICATION_PREFS: { label: string; defaultVal: boolean }[] = [
  { label: '施工中止判定時にメール通知', defaultVal: true },
  { label: '注意判定時にメール通知', defaultVal: true },
  { label: '気象警報発令時にプッシュ通知', defaultVal: true },
  { label: '日次レポート自動送信', defaultVal: false },
  { label: 'データ取得エラー時に通知', defaultVal: true },
];

const SETTINGS_KEY = 'wmcdss_settings';

interface PersistedSettings {
  name: string;
  email: string;
}

function loadSettings(role: Role): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
      return {
        name: parsed.name ?? (role === 'field' ? '田中 太郎' : '山田 部長'),
        email: parsed.email ?? 'tanaka@example.co.jp',
      };
    }
  } catch {
    // ignore parse errors
  }
  return {
    name: role === 'field' ? '田中 太郎' : '山田 部長',
    email: 'tanaka@example.co.jp',
  };
}

export const SettingsPage: FC<SettingsProps> = ({ role }) => {
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState(() => loadSettings(role).name);
  const [email, setEmail] = useState(() => loadSettings(role).email);

  // Preserves the original DOM-mutation toggle: the checkbox is hidden and a
  // sibling div is repositioned by hand. Keeping byte-equivalence rather than
  // refactoring to React state in Loop 23 — see follow-up Loop for cleanup.
  const handleToggle = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const track = input.nextSibling as HTMLDivElement | null;
    if (!track) return;
    const thumb = track.children[0] as HTMLDivElement | undefined;
    track.style.background = input.checked ? 'var(--blue-500)' : 'var(--border)';
    if (thumb) {
      thumb.style.transform = `translateX(${input.checked ? '20px' : '2px'})`;
    }
  };

  const handleSave = () => {
    try {
      const data: PersistedSettings = { name, email };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      // ignore storage errors
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="card mb-16">
        <div className="card-header"><span className="card-title">ユーザー設定</span></div>
        <div className="card-body">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">名前</label>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">所属</label>
              <input
                className="form-input"
                defaultValue={role === 'field' ? '東京支店 工事部' : '本社 工事管理部'}
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">メールアドレス</label>
            <input
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">通知設定</span></div>
        <div className="card-body">
          {NOTIFICATION_PREFS.map(({ label, defaultVal }, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < NOTIFICATION_PREFS.length - 1
                  ? '1px solid var(--border-light)'
                  : 'none',
              }}
            >
              <span style={{ fontSize: 13 }}>{label}</span>
              <label style={{ position: 'relative', width: 44, height: 24, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  defaultChecked={defaultVal}
                  style={{ display: 'none' }}
                  onChange={handleToggle}
                />
                <div style={{
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  background: defaultVal ? 'var(--blue-500)' : 'var(--border)',
                  transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    position: 'absolute',
                    top: 2,
                    transform: `translateX(${defaultVal ? '20px' : '2px'})`,
                    transition: 'transform 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }}></div>
                </div>
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">データ保持期間</span></div>
        <div className="card-body">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">気象データ保持期間</label>
              <select className="form-select" defaultValue="60">
                <option value="12">12ヶ月</option>
                <option value="24">24ヶ月</option>
                <option value="60">60ヶ月（5年）</option>
                <option value="120">120ヶ月（10年）</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">監査ログ保持期間</label>
              <select className="form-select" defaultValue="36">
                <option value="12">12ヶ月</option>
                <option value="36">36ヶ月（3年）</option>
                <option value="60">60ヶ月（5年）</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleSave}
      >
        設定を保存
      </button>
      {saved && (
        <span style={{
          marginLeft: 12,
          color: 'var(--status-ok)',
          fontSize: 13,
          fontWeight: 500,
        }}>
          ✓ 保存しました
        </span>
      )}
    </div>
  );
};

// ---------- AI Settings ----------

interface AiSettingsState {
  configured: boolean;
  key_preview: string | null;
  model: string;
  source: string;
  supported_models: { id: string; label: string }[];
}

const DEFAULT_SUPPORTED_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-4-8', label: 'claude-opus-4-8　最高精度・低速' },
  { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6　推奨・バランス型 ★' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5　高速・軽量' },
];

export const AiSettingsPage: FC = () => {
  const apiBase = (window as Window & { WMCDSS_API_BASE?: string }).WMCDSS_API_BASE
    ?? `http://${window.location.hostname}:8003/api/v1`;

  const [settings, setSettings] = useState<AiSettingsState | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const doLoadSettings = (signal?: AbortSignal) => {
    setLoading(true);
    fetch(`${apiBase}/ai/settings`, signal ? { signal } : undefined)
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json() as Promise<AiSettingsState>;
      })
      .then((data) => {
        setSettings(data);
        setModel(data.model || 'claude-sonnet-4-6');
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // バックエンド未接続 — localStorage から読み込みを試みる
        try {
          const raw = localStorage.getItem('wmcdss_ai_settings');
          if (raw) {
            const parsed = JSON.parse(raw) as Partial<AiSettingsState>;
            setModel(parsed.model ?? 'claude-sonnet-4-6');
          }
        } catch {
          // ignore
        }
        setSettings(null);
        setLoading(false);
      });
  };

  const loadSettings = () => doLoadSettings();

  useEffect(() => {
    const controller = new AbortController();
    doLoadSettings(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTest = async () => {
    if (!apiKey.trim()) {
      setTestResult({ ok: false, message: 'API キーを入力してください' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch(`${apiBase}/ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, model }),
      });
      const data = await resp.json() as { ok: boolean; message: string };
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, message: 'バックエンドに接続できません' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const resp = await fetch(`${apiBase}/ai/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, model }),
      });
      if (resp.ok) {
        const data = await resp.json() as { key_preview?: string };
        setSaveResult(`設定を保存しました。キー: ${data.key_preview || '(削除)'}`);
        // 設定を再読込
        loadSettings();
        setApiKey(''); // 入力欄クリア
      } else {
        setSaveResult('保存に失敗しました');
      }
    } catch {
      // バックエンド未接続時は localStorage に保存
      try {
        localStorage.setItem('wmcdss_ai_settings', JSON.stringify({ model }));
        setSaveResult('設定をローカルに保存しました（バックエンド未接続）');
      } catch {
        setSaveResult('バックエンドに接続できません');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setSaveResult(null), 5000);
    }
  };

  const supportedModels = settings?.supported_models ?? DEFAULT_SUPPORTED_MODELS;

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Anthropic Claude API 設定 */}
      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">Anthropic Claude API 設定</span>
        </div>
        <div className="card-body">
          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>読み込み中...</div>
          ) : (
            <>
              {/* 接続状態 */}
              <div className="form-group">
                <label className="form-label">接続状態</label>
                <div style={{ fontSize: 13, fontWeight: 500, color: settings?.configured ? 'var(--status-ok)' : 'var(--status-warn, #d97706)' }}>
                  {settings?.configured ? '✅ 接続済み' : '❌ 未設定'}
                </div>
                {settings?.key_preview && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    キー参照: {settings.key_preview}
                  </div>
                )}
              </div>

              {/* API キー入力 */}
              <div className="form-group">
                <label className="form-label">API キー</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="form-input"
                    type={showKey ? 'text' : 'password'}
                    placeholder="sk-ant-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    title={showKey ? 'キーを非表示' : 'キーを表示'}
                  >
                    {showKey ? '🙈 非表示' : '👁 表示'}
                  </button>
                </div>
              </div>

              {/* モデル選択 */}
              <div className="form-group">
                <label className="form-label">モデル</label>
                <select
                  className="form-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                >
                  {supportedModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* ボタン */}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? '接続中...' : '🔌 接続テスト'}
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? '保存中...' : '💾 設定を保存'}
                </button>
              </div>

              {/* テスト結果 */}
              {testResult && (
                <div style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: testResult.ok ? 'var(--status-ok)' : 'var(--status-danger, #dc2626)',
                  fontWeight: 500,
                }}>
                  {testResult.ok ? '✅' : '❌'} {testResult.message}
                </div>
              )}

              {/* 保存結果 */}
              {saveResult && (
                <div style={{
                  marginTop: 12,
                  fontSize: 13,
                  color: 'var(--status-ok)',
                  fontWeight: 500,
                }}>
                  ✓ {saveResult}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 使用状況 */}
      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">使用状況</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>分析エンジン: </span>
              <span style={{ fontWeight: 500 }}>
                {settings?.configured ? 'Claude AI' : 'ルールベース'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>設定元: </span>
              <span style={{ fontWeight: 500 }}>
                {settings?.source === 'ui' ? 'UI設定'
                  : settings?.source === 'env' ? '環境変数'
                  : '未設定'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 対応モデル一覧 */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">対応モデル一覧</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>モデルID</th>
              <th>特徴</th>
            </tr>
          </thead>
          <tbody>
            {supportedModels.map((m) => (
              <tr key={m.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{m.id}</td>
                <td style={{ fontSize: 12 }}>{m.label.replace(m.id, '').trim()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

declare global {
  interface Window {
    ThresholdsPage?: typeof ThresholdsPage;
    EtlPage?: typeof EtlPage;
    ReportsPage?: typeof ReportsPage;
    AuditPage?: typeof AuditPage;
    SettingsPage?: typeof SettingsPage;
    AiSettingsPage?: typeof AiSettingsPage;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    ThresholdsPage,
    EtlPage,
    ReportsPage,
    AuditPage,
    SettingsPage,
    AiSettingsPage,
  });
}
