import { useMemo, useState, type ChangeEvent, type FC } from 'react';
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
interface EtlStat {
  label: string;
  value: string;
  sub: string;
}

const ETL_STATS: EtlStat[] = [
  { label: '本日の取得回数', value: '24', sub: '正常完了' },
  { label: '取得レコード数', value: '2,622', sub: '本日合計' },
  { label: '最終取得', value: '09:00', sub: '2026/05/22' },
  { label: 'エラー件数', value: '0', sub: '過去24時間' },
];

export const EtlPage: FC = () => {
  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          気象庁データの自動取得ジョブの実行状況を確認します。
        </div>
        <button className="btn btn-sm btn-primary">▶ 手動実行</button>
      </div>

      <div className="grid-4 mb-16">
        {ETL_STATS.map((s, i) => (
          <div className="stat-card" key={i}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: 'var(--blue-600)' }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">ジョブ一覧</span></div>
        <table className="data-table">
          <thead>
            <tr><th>ジョブ名</th><th>スケジュール</th><th>最終実行</th><th>ステータス</th><th>取得件数</th><th>操作</th></tr>
          </thead>
          <tbody>
            {ETL_JOBS.map((job) => (
              <tr key={job.id}>
                <td style={{ fontWeight: 600 }}>{job.name}</td>
                <td>{job.schedule}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.lastRun}</td>
                <td>
                  <span className="badge badge-ok">
                    <span className="badge-dot"></span>正常
                  </span>
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{job.records.toLocaleString()}</td>
                <td>
                  <button className="btn btn-sm">▶ 実行</button>
                </td>
              </tr>
            ))}
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
    setTimeout(() => {
      setGenerating(false);
      setDone(true);
    }, 1500);
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
export const AuditPage: FC = () => {
  const [filterAction, setFilterAction] = useState<string>('all');

  const actions = useMemo(
    () => Array.from(new Set(AUDIT_LOG.map((l) => l.action))),
    [],
  );
  const filtered = useMemo(
    () => (filterAction === 'all' ? AUDIT_LOG : AUDIT_LOG.filter((l) => l.action === filterAction)),
    [filterAction],
  );

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
        </div>
        <button className="btn btn-sm">📥 CSV出力</button>
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

export const SettingsPage: FC<SettingsProps> = ({ role }) => {
  const [saved, setSaved] = useState(false);

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
                defaultValue={role === 'field' ? '田中 太郎' : '山田 部長'}
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
            <input className="form-input" defaultValue="tanaka@example.co.jp" />
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
        onClick={() => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
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

declare global {
  interface Window {
    ThresholdsPage?: typeof ThresholdsPage;
    EtlPage?: typeof EtlPage;
    ReportsPage?: typeof ReportsPage;
    AuditPage?: typeof AuditPage;
    SettingsPage?: typeof SettingsPage;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    ThresholdsPage,
    EtlPage,
    ReportsPage,
    AuditPage,
    SettingsPage,
  });
}
