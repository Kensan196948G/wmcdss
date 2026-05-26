/* ============================================
   Analysis Pages — Historical & 50-Year Wave
   ============================================ */

/* ---------- Historical Analysis ---------- */
const HistoricalPage = ({ selectedSite }) => {
  const [siteId, setSiteId] = React.useState(selectedSite || SITES[0].id);
  const [year, setYear] = React.useState('2025');
  const [metric, setMetric] = React.useState('wind');
  const site = SITES.find(s => s.id === siteId) || SITES[0];
  const monthly = React.useMemo(() => generateHistoricalMonthly(), [siteId, year]);

  const chartData = {
    wind: { data: monthly.map(m => ({ label: m.month, value: m.maxWind })), label: '最大風速 (m/s)', color: ChartColors.blue },
    wave: { data: monthly.map(m => ({ label: m.month, value: m.maxWave })), label: '最大波高 (m)', color: ChartColors.lightBlue },
    rain: { data: monthly.map(m => ({ label: m.month, value: m.totalRain })), label: '月間降水量 (mm)', color: ChartColors.lightBlue },
  };

  const current = chartData[metric];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>現場</label>
          <select className="form-select" style={{ width: 220 }} value={siteId}
            onChange={e => setSiteId(e.target.value)}>
            {SITES.map(s => <option key={s.id} value={s.id}>{s.shortName}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>年度</label>
          <select className="form-select" style={{ width: 120 }} value={year}
            onChange={e => setYear(e.target.value)}>
            {['2025','2024','2023','2022','2021'].map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['wind','風速'],['wave','波高'],['rain','降水量']].map(([k,l]) => (
            <button key={k} className={`btn btn-sm ${metric === k ? 'btn-primary' : ''}`}
              onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <span className="card-title">{current.label} — {year}年 月別推移</span>
          <button className="btn btn-sm">📥 CSV出力</button>
        </div>
        <div className="card-body">
          {metric === 'rain' ? (
            <BarChart data={current.data} width={800} height={220} color={current.color} yLabel={current.label} />
          ) : (
            <LineChart data={current.data} width={800} height={220} color={current.color} yLabel={current.label}
              threshold={metric === 'wind' ? site.thresholds.windSpeed : site.thresholds.waveHeight}
              thresholdLabel={`基準値`} />
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">月別集計データ</span></div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>月</th><th>平均風速</th><th>最大風速</th><th>平均波高</th><th>最大波高</th>
                <th>降雨日数</th><th>月間降水量</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{m.month}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.avgWind} m/s</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                    color: m.maxWind > site.thresholds.windSpeed ? 'var(--status-danger)' : 'inherit'
                  }}>{m.maxWind} m/s</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{m.avgWave} m</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                    color: site.thresholds.waveHeight && m.maxWave > site.thresholds.waveHeight ? 'var(--status-danger)' : 'inherit'
                  }}>{m.maxWave} m</td>
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

/* ---------- 50-Year Wave Analysis ---------- */
const Wave50Page = () => {
  const [point, setPoint] = React.useState('東京湾北部');
  const [method, setMethod] = React.useState('gumbel');

  const returnPeriods = React.useMemo(() => {
    const base = point === '東京湾北部' ? 2.8 : point === '東京湾中部' ? 3.2 : point === '東京湾南部' ? 3.8 : 3.0;
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

  const annualMax = React.useMemo(() => {
    const base = point === '東京湾北部' ? 1.8 : 2.1;
    return Array.from({ length: 20 }, (_, i) => ({
      label: `${2006 + i}`,
      value: +(base + Math.random() * 1.2 + Math.sin(i * 0.5) * 0.3).toFixed(2),
    }));
  }, [point]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>観測点</label>
          <select className="form-select" style={{ width: 200 }} value={point}
            onChange={e => setPoint(e.target.value)}>
            {['東京湾北部','東京湾中部','東京湾南部','東京湾東部'].map(p =>
              <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="form-label" style={{ margin: 0 }}>推定手法</label>
          <select className="form-select" style={{ width: 180 }} value={method}
            onChange={e => setMethod(e.target.value)}>
            <option value="gumbel">Gumbel分布</option>
            <option value="weibull">Weibull分布</option>
            <option value="genpareto">一般化パレート分布</option>
          </select>
        </div>
        <button className="btn btn-sm">📥 Excel出力</button>
      </div>

      <div className="grid-3 mb-16">
        <div className="stat-card" style={{ borderLeft: '4px solid var(--blue-400)' }}>
          <div className="stat-label">50年確率波高</div>
          <div className="stat-value" style={{ color: 'var(--blue-600)' }}>
            {returnPeriods.find(r => r.period === 50)?.wave}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">{point} ／ {method === 'gumbel' ? 'Gumbel' : method === 'weibull' ? 'Weibull' : 'GenPareto'}分布</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--status-warn)' }}>
          <div className="stat-label">年最大波高（平均）</div>
          <div className="stat-value" style={{ color: 'var(--status-warn)' }}>
            {(annualMax.reduce((a, b) => a + b.value, 0) / annualMax.length).toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">過去20年間</div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid var(--status-danger)' }}>
          <div className="stat-label">観測最大波高</div>
          <div className="stat-value" style={{ color: 'var(--status-danger)' }}>
            {Math.max(...annualMax.map(a => a.value)).toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>m</span>
          </div>
          <div className="stat-sub">過去20年間</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">年最大有義波高推移（過去20年）</span></div>
        <div className="card-body">
          <LineChart data={annualMax} width={800} height={220} color={ChartColors.blue}
            yLabel="有義波高 (m)" />
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">再現期間別推定値</span></div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>再現期間</th><th>確率波高 (m)</th><th>確率風速 (m/s)</th><th>信頼区間（95%）</th></tr>
            </thead>
            <tbody>
              {returnPeriods.map((r, i) => (
                <tr key={i} style={{ background: r.period === 50 ? 'var(--blue-50)' : 'transparent' }}>
                  <td style={{ fontWeight: r.period === 50 ? 700 : 500 }}>
                    {r.period}年
                    {r.period === 50 && <span className="badge badge-info" style={{ marginLeft: 8 }}>設計基準</span>}
                  </td>
                  <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: r.period === 50 ? 'var(--blue-600)' : 'inherit' }}>{r.wave} m</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.wind} m/s</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    ±{(+r.wave * 0.12).toFixed(2)} m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">分析条件</span></div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
            {[
              ['データ期間', '2006年〜2025年（20年間）'],
              ['観測点', point],
              ['データソース', '気象庁 沿岸波浪モデル（5km格子）'],
              ['推定手法', method === 'gumbel' ? 'Gumbel極値分布' : method === 'weibull' ? 'Weibull分布' : '一般化パレート分布'],
              ['サンプル数', '20（年最大値）'],
              ['最終算出日', '2026/05/01'],
            ].map(([k, v], i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
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

Object.assign(window, { HistoricalPage, Wave50Page });
