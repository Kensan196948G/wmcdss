/* ============================================
   App Shell — Sidebar, Header, Router
   ============================================ */

const NAV_ITEMS = [
  { group: 'メイン', items: [
    { id: 'dashboard', label: 'ダッシュボード', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
  ]},
  { group: '現場管理', items: [
    { id: 'sites', label: '現場一覧', icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z' },
    { id: 'site-register', label: '現場登録', icon: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z' },
  ]},
  { group: '気象・海象', items: [
    { id: 'weather', label: '気象データ', icon: 'M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z' },
    { id: 'marine', label: '海象データ', icon: 'M17 16.99c-1.35 0-2.2.42-2.95.8-.65.33-1.18.6-2.05.6-.9 0-1.4-.25-2.05-.6-.75-.38-1.57-.8-2.95-.8s-2.2.42-2.95.8c-.65.33-1.18.6-2.05.6v1.95c1.35 0 2.2-.42 2.95-.8.65-.33 1.18-.6 2.05-.6.9 0 1.4.25 2.05.6.75.38 1.57.8 2.95.8s2.2-.42 2.95-.8c.65-.33 1.18-.6 2.05-.6v-1.95c-.9 0-1.4.25-2.05.6-.75.38-1.6.8-2.95.8zM17 12.54c-1.35 0-2.2.43-2.95.8-.65.32-1.18.6-2.05.6-.9 0-1.4-.25-2.05-.6-.75-.38-1.57-.8-2.95-.8s-2.2.43-2.95.8c-.65.32-1.18.6-2.05.6V16c1.35 0 2.2-.43 2.95-.8.65-.33 1.18-.6 2.05-.6.9 0 1.4.25 2.05.6.75.38 1.57.8 2.95.8s2.2-.43 2.95-.8c.65-.32 1.18-.6 2.05-.6v-2.07c-.9 0-1.4.25-2.05.6-.75.38-1.6.81-2.95.81zM17 8.09c-1.35 0-2.2.43-2.95.8-.65.35-1.18.6-2.05.6-.9 0-1.4-.25-2.05-.6-.75-.38-1.57-.8-2.95-.8s-2.2.43-2.95.8C3.4 9.22 2.87 9.49 2 9.49v2.07c1.35 0 2.2-.43 2.95-.8.65-.33 1.18-.6 2.05-.6.9 0 1.4.25 2.05.6.75.38 1.57.8 2.95.8s2.2-.43 2.95-.8c.65-.32 1.18-.6 2.05-.6v-2.07c-.9 0-1.4.25-2.05.6-.75.38-1.6.8-2.95.8z' },
  ]},
  { group: '施工判定', items: [
    { id: 'concrete', label: 'コンクリート打設', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z' },
    { id: 'marine-work', label: '海上作業', icon: 'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99a8.752 8.752 0 008 0c1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42a1.007 1.007 0 00-.66 1.28L3.95 19z' },
  ]},
  { group: '分析', items: [
    { id: 'historical', label: '過去データ分析', icon: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z' },
    { id: 'wave50', label: '50年確率波', icon: 'M7 15l4.65-4.65c.2-.2.51-.2.71 0L16 14l5-5M22 3v7h-7' },
  ]},
  { group: '管理', items: [
    { id: 'thresholds', label: '閾値管理', icon: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z' },
    { id: 'etl', label: 'データ取得状況', icon: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z' },
    { id: 'reports', label: 'レポート出力', icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2z' },
    { id: 'audit', label: '監査ログ', icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11zm-2-4H8v-2h8v2zm0-3H8v-2h8v2z' },
    { id: 'settings', label: '設定', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' },
  ]},
];

const PAGE_TITLES = {
  dashboard: 'ダッシュボード',
  sites: '現場一覧',
  'site-register': '現場登録',
  'site-detail': '現場詳細',
  weather: '気象データ',
  marine: '海象データ',
  concrete: 'コンクリート打設判定',
  'marine-work': '海上作業判定',
  historical: '過去データ分析',
  wave50: '50年確率波分析',
  thresholds: '閾値管理',
  etl: 'データ取得状況',
  reports: 'レポート出力',
  audit: '監査ログ',
  settings: '設定',
};

const SvgIcon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d={d} /></svg>
);

const App = () => {
  const [page, setPage] = React.useState('dashboard');
  const [selectedSite, setSelectedSite] = React.useState(null);
  const [role, setRole] = React.useState('field');
  const [density, setDensity] = React.useState('normal');
  const [now, setNow] = React.useState(new Date());

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const navigate = (pg, site) => {
    setPage(pg);
    if (site !== undefined) setSelectedSite(site);
  };

  const formatTime = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const okCount = SITES.filter(s => s.status === 'ok').length;
  const warnCount = SITES.filter(s => s.status === 'warn').length;
  const dangerCount = SITES.filter(s => s.status === 'danger').length;

  const renderPage = () => {
    const props = { navigate, selectedSite, setSelectedSite, role, density };
    switch (page) {
      case 'dashboard': return <DashboardPage {...props} />;
      case 'sites': return <SiteListPage {...props} />;
      case 'site-register': return <SiteRegisterPage {...props} />;
      case 'site-detail': return <SiteDetailPage {...props} />;
      case 'weather': return <WeatherPage {...props} />;
      case 'marine': return <MarinePage {...props} />;
      case 'concrete': return <ConcretePage {...props} />;
      case 'marine-work': return <MarineWorkPage {...props} />;
      case 'historical': return <HistoricalPage {...props} />;
      case 'wave50': return <Wave50Page {...props} />;
      case 'thresholds': return <ThresholdsPage {...props} />;
      case 'etl': return <EtlPage {...props} />;
      case 'reports': return <ReportsPage {...props} />;
      case 'audit': return <AuditPage {...props} />;
      case 'settings': return <SettingsPage {...props} />;
      default: return <DashboardPage {...props} />;
    }
  };

  return (
    <div className={`app-layout ${density === 'compact' ? 'density-compact' : ''}`}>
      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">WM</div>
          <div>
            <div className="sidebar-logo-text">気象海象判断支援</div>
            <div className="sidebar-logo-sub">Decision Support System</div>
          </div>
        </div>

        {NAV_ITEMS.map(g => (
          <div className="sidebar-group" key={g.group}>
            <div className="sidebar-group-label">{g.group}</div>
            {g.items.map(item => (
              <div key={item.id}
                className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}>
                <SvgIcon d={item.icon} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="sidebar-role">
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6, fontWeight: 600 }}>表示モード</div>
          <div className="role-switch">
            <button className={`role-btn ${role === 'field' ? 'active' : ''}`} onClick={() => setRole('field')}>現場</button>
            <button className={`role-btn ${role === 'hq' ? 'active' : ''}`} onClick={() => setRole('hq')}>本社</button>
          </div>
        </div>
      </nav>

      {/* Main */}
      <div className="main-area">
        <header className="header">
          <div className="header-left">
            <div className="header-title">{PAGE_TITLES[page] || 'ダッシュボード'}</div>
            {selectedSite && (page === 'site-detail' || page === 'weather' || page === 'marine') && (
              <div className="header-breadcrumb">
                ▸ {SITES.find(s => s.id === selectedSite)?.shortName}
              </div>
            )}
          </div>
          <div className="header-right">
            <span className={`header-badge ${STATUS_CLASS.ok}`}><span className="badge-dot"></span> 施工可 {okCount}</span>
            <span className={`header-badge ${STATUS_CLASS.warn}`}><span className="badge-dot"></span> 注意 {warnCount}</span>
            <span className={`header-badge ${STATUS_CLASS.danger}`}><span className="badge-dot"></span> 中止 {dangerCount}</span>
            <span className="header-time">{formatTime(now)}</span>
          </div>
        </header>
        <div className="content fade-in" key={page + (selectedSite || '')}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { App, SvgIcon, NAV_ITEMS, PAGE_TITLES });
