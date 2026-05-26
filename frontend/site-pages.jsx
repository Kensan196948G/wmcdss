/* ============================================
   Site Pages — List, Register, Detail
   ============================================ */

/* ---------- Site List ---------- */
const SiteListPage = ({ navigate }) => {
  const [filter, setFilter] = React.useState('all');
  const [search, setSearch] = React.useState('');

  const filtered = SITES.filter(s => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (search && !s.name.includes(search) && !s.shortName.includes(search)) return false;
    return true;
  });

  return (
    <div>
      <div className="flex-between mb-16">
        <div style={{ display: 'flex', gap: 8 }}>
          {[['all','すべて'],['ok','施工可'],['warn','注意'],['danger','中止推奨']].map(([v,l]) => (
            <button key={v} className={`btn btn-sm ${filter === v ? 'btn-primary' : ''}`}
              onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="form-input" placeholder="現場名で検索…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220, padding: '6px 12px', fontSize: 13 }} />
          <button className="btn btn-primary" onClick={() => navigate('site-register')}>＋ 新規登録</button>
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
            {filtered.map(site => {
              const w = generateWeather(site.id);
              const m = generateMarine(site.id);
              return (
                <tr key={site.id} className="clickable" onClick={() => navigate('site-detail', site.id)}>
                  <td>
                    <span className={`badge ${STATUS_CLASS[site.status]}`}>
                      <span className="badge-dot"></span>{STATUS_LABEL[site.status]}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{site.name}</td>
                  <td>{TYPE_LABEL[site.type]}</td>
                  <td>{site.station}</td>
                  <td>{site.manager}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{site.contractor}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{w.temp}℃</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums',
                    color: w.wind > site.thresholds.windSpeed ? 'var(--status-danger)' :
                      w.wind > site.thresholds.windSpeed * 0.8 ? 'var(--status-warn)' : 'inherit'
                  }}>{w.wind} m/s</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums',
                    color: m && m.waveHeight > site.thresholds.waveHeight ? 'var(--status-danger)' :
                      m && m.waveHeight > site.thresholds.waveHeight * 0.8 ? 'var(--status-warn)' : 'inherit'
                  }}>{m ? `${m.waveHeight} m` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------- Site Register ---------- */
const SiteRegisterPage = ({ navigate }) => {
  const [form, setForm] = React.useState({
    name: '', type: 'marine', lat: '', lng: '', station: '', manager: '',
    contractor: '', periodStart: '', periodEnd: '',
    windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 5, tempHigh: 35,
  });
  const [saved, setSaved] = React.useState(false);

  const update = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => navigate('sites'), 1200);
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {saved && (
        <div style={{ background: 'var(--status-ok-bg)', border: '1px solid var(--status-ok-border)',
          borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: 16, fontSize: 13,
          color: 'var(--status-ok)', fontWeight: 600 }}>
          ✓ 現場を登録しました。現場一覧へ移動します…
        </div>
      )}

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">基本情報</span></div>
        <div className="card-body">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">現場名 *</label>
              <input className="form-input" value={form.name} onChange={e => update('name', e.target.value)}
                placeholder="例: 東京港臨海大橋建設工事" />
            </div>
            <div className="form-group">
              <label className="form-label">工種 *</label>
              <select className="form-select" value={form.type} onChange={e => update('type', e.target.value)}>
                <option value="land">陸上工事</option>
                <option value="marine">海上工事</option>
                <option value="both">陸上＋海上</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">緯度</label>
              <input className="form-input" type="number" step="0.0001" value={form.lat}
                onChange={e => update('lat', e.target.value)} placeholder="35.6195" />
            </div>
            <div className="form-group">
              <label className="form-label">経度</label>
              <input className="form-input" type="number" step="0.0001" value={form.lng}
                onChange={e => update('lng', e.target.value)} placeholder="139.7745" />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">最寄り気象観測所</label>
              <select className="form-select" value={form.station} onChange={e => update('station', e.target.value)}>
                <option value="">自動検出</option>
                <option value="東京（気象台）">東京（気象台）</option>
                <option value="横浜（気象台）">横浜（気象台）</option>
                <option value="千葉（気象台）">千葉（気象台）</option>
                <option value="川崎">川崎</option>
                <option value="木更津">木更津</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">海象観測点</label>
              <select className="form-select" value={form.marinePoint || ''} onChange={e => update('marinePoint', e.target.value)}>
                <option value="">なし</option>
                <option value="東京湾北部">東京湾北部</option>
                <option value="東京湾中部">東京湾中部</option>
                <option value="東京湾南部">東京湾南部</option>
                <option value="東京湾東部">東京湾東部</option>
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">現場担当者</label>
              <input className="form-input" value={form.manager} onChange={e => update('manager', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">施工者</label>
              <input className="form-input" value={form.contractor} onChange={e => update('contractor', e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">工期開始</label>
              <input className="form-input" type="date" value={form.periodStart}
                onChange={e => update('periodStart', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">工期終了</label>
              <input className="form-input" type="date" value={form.periodEnd}
                onChange={e => update('periodEnd', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><span className="card-title">施工中止基準</span></div>
        <div className="card-body">
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">最大風速 (m/s)</label>
              <input className="form-input" type="number" value={form.windSpeed}
                onChange={e => update('windSpeed', +e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">有義波高 (m)</label>
              <input className="form-input" type="number" step="0.1" value={form.waveHeight}
                onChange={e => update('waveHeight', +e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">降水量 (mm/h)</label>
              <input className="form-input" type="number" value={form.rainfall}
                onChange={e => update('rainfall', +e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">気温下限 (℃)</label>
              <input className="form-input" type="number" value={form.tempLow}
                onChange={e => update('tempLow', +e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">気温上限 (℃)</label>
              <input className="form-input" type="number" value={form.tempHigh}
                onChange={e => update('tempHigh', +e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" onClick={handleSave}>登録する</button>
        <button className="btn" onClick={() => navigate('sites')}>キャンセル</button>
      </div>
    </div>
  );
};

/* ---------- Site Detail ---------- */
const SiteDetailPage = ({ navigate, selectedSite }) => {
  const site = SITES.find(s => s.id === selectedSite) || SITES[0];
  const w = generateWeather(site.id);
  const m = generateMarine(site.id);
  const decision = getDecision(site);
  const [tab, setTab] = React.useState('overview');
  const hourlyWind = React.useMemo(() => generateHourlyWind(), []);

  return (
    <div>
      {/* Site header */}
      <div className="card mb-16">
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{site.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 16 }}>
              <span>{TYPE_LABEL[site.type]}</span>
              <span>📍 {site.station}</span>
              <span>👤 {site.manager}</span>
              <span>🏗 {site.contractor}</span>
              <span>📅 {site.period}</span>
            </div>
          </div>
          <span className={`badge ${STATUS_CLASS[decision.status]}`} style={{ fontSize: 14, padding: '6px 16px' }}>
            <span className="badge-dot"></span>
            {STATUS_LABEL[decision.status]}
          </span>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-sm" onClick={() => { navigate('weather', site.id); }}>📊 気象データ</button>
        {site.type !== 'land' && (
          <button className="btn btn-sm" onClick={() => { navigate('marine', site.id); }}>🌊 海象データ</button>
        )}
        <button className="btn btn-sm" onClick={() => { navigate('concrete', site.id); }}>🏗 打設判定</button>
        {site.type !== 'land' && (
          <button className="btn btn-sm" onClick={() => { navigate('marine-work', site.id); }}>🚢 海上作業判定</button>
        )}
      </div>

      {/* Decision summary */}
      <div className={`decision-panel mb-16`}>
        <div className={`decision-header ${decision.status}`}>
          <div className="decision-icon">
            {decision.status === 'ok' ? '✅' : decision.status === 'warn' ? '⚡' : '⛔'}
          </div>
          <div>
            <div className="decision-title">総合判定：{STATUS_LABEL[decision.status]}</div>
            <div className="decision-sub">2026年5月22日 09:00 時点</div>
          </div>
        </div>
        <div className="decision-body">
          {decision.reasons.map((r, i) => (
            <div key={i} className={`reason-text ${decision.status}`} style={{ marginTop: i > 0 ? 8 : 0 }}>
              {r}
            </div>
          ))}
        </div>
      </div>

      {/* Current conditions */}
      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><span className="card-title">現在の気象</span></div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {[
                ['気温', `${w.temp}℃`, null],
                ['湿度', `${w.hum}%`, null],
                ['気圧', `${w.pressure}hPa`, null],
                ['風速', `${w.wind}m/s`, w.wind > site.thresholds.windSpeed ? 'danger' : w.wind > site.thresholds.windSpeed * 0.8 ? 'warn' : null],
                ['風向', w.windDir, null],
                ['降水量', `${w.rain}mm/h`, w.rain > site.thresholds.rainfall ? 'danger' : null],
              ].map(([label, val, alert], i) => (
                <div key={i}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                    color: alert === 'danger' ? 'var(--status-danger)' : alert === 'warn' ? 'var(--status-warn)' : 'inherit'
                  }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {m ? (
          <div className="card">
            <div className="card-header"><span className="card-title">現在の海象</span></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {[
                  ['有義波高', `${m.waveHeight}m`, m.waveHeight > site.thresholds.waveHeight ? 'danger' : m.waveHeight > site.thresholds.waveHeight * 0.8 ? 'warn' : null],
                  ['周期', `${m.wavePeriod}s`, null],
                  ['波向', m.waveDir, null],
                  ['潮汐', m.tide, null],
                  ['潮位', `${m.tideLevel}m`, null],
                ].map(([label, val, alert], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      color: alert === 'danger' ? 'var(--status-danger)' : alert === 'warn' ? 'var(--status-warn)' : 'inherit'
                    }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-header"><span className="card-title">施工中止基準</span></div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['最大風速', `${site.thresholds.windSpeed} m/s`],
                  ['降水量', `${site.thresholds.rainfall} mm/h`],
                  ['気温下限', `${site.thresholds.tempLow}℃`],
                  ['気温上限', `${site.thresholds.tempHigh}℃`],
                ].map(([l,v], i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0',
                    borderBottom: '1px solid var(--border-light)', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                    <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Wind chart */}
      <div className="card">
        <div className="card-header"><span className="card-title">本日の風速推移</span></div>
        <div className="card-body">
          <LineChart
            data={hourlyWind.map(h => ({ label: `${h.hour}時`, value: h.speed }))}
            width={800} height={180} color={ChartColors.blue}
            threshold={site.thresholds.windSpeed}
            thresholdLabel={`基準値 ${site.thresholds.windSpeed}m/s`}
            yLabel="風速 (m/s)"
          />
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { SiteListPage, SiteRegisterPage, SiteDetailPage });
