import { useEffect, useRef, useState, type FC } from 'react';
import {
  FORECAST_DAYS, SITES, STATUS_CLASS, STATUS_LABEL, TYPE_LABEL, WEATHER_ICONS,
  generateMarine, generateWeather, getDecision,
  type Site, type Status,
} from './data';

declare global {
  interface Window {
    L?: any;
    DashboardPage?: typeof DashboardPage;
    MapView?: typeof MapView;
    SiteStatusCard?: typeof SiteStatusCard;
    AlertBanner?: typeof AlertBanner;
  }
}
declare const L: any;

const AREA_VIEW: Record<string, [number, number, number]> = {
  '全国':   [36.0, 137.0, 5],
  '北海道': [43.2, 142.0, 7],
  '東北':   [39.0, 140.5, 7],
  '関東':   [35.6, 139.8, 8],
  '中部':   [35.2, 137.2, 7],
  '近畿':   [34.7, 135.4, 8],
  '中国':   [34.5, 132.5, 8],
  '四国':   [33.8, 133.5, 8],
  '九州':   [32.8, 130.5, 7],
  '沖縄':   [26.2, 127.7, 9],
};

export const AREAS = Object.keys(AREA_VIEW);

export interface MapViewProps {
  sites: Site[];
  onSiteClick?: (id: string) => void;
  selectedSite?: string | null;
  selectedArea?: string | null;
}

export const MapView: FC<MapViewProps> = ({ sites, onSiteClick, selectedArea }) => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInst = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;
    const [lat, lng, zoom] = AREA_VIEW['全国'];
    const map = L.map(mapRef.current, { zoomControl: false }).setView([lat, lng], zoom);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(map);
    mapInst.current = map;
    setTimeout(() => map.invalidateSize(), 100);
  }, []);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    const [lat, lng, zoom] = AREA_VIEW[selectedArea ?? '全国'] ?? AREA_VIEW['全国'];
    map.setView([lat, lng], zoom, { animate: true });
  }, [selectedArea]);

  useEffect(() => {
    const map = mapInst.current;
    if (!map) return;
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    const statusColor: Record<Status, string> = {
      ok: '#1a8a4a', warn: '#c27a0e', danger: '#c0392b',
    };

    sites.forEach((site) => {
      const color = statusColor[site.status] ?? '#2874a6';
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:32px;height:32px;border-radius:50% 50% 50% 0;
          background:${color};transform:rotate(-45deg);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2.5px solid #fff;
          cursor:pointer;
        "><span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:700;">
          ${site.type === 'land' ? '陸' : '海'}
        </span></div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });
      const marker = L.marker([site.lat, site.lng], { icon }).addTo(map);
      const w = generateWeather(site.id);
      const m = generateMarine(site.id);
      marker.bindPopup(`
        <div style="min-width:180px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${site.shortName}</div>
          <div style="font-size:12px;color:#4a5568;margin-bottom:4px;">${TYPE_LABEL[site.type]}</div>
          <div style="display:flex;gap:12px;font-size:12px;margin-bottom:6px;">
            <span>🌡${w.temp}℃</span><span>💨${w.wind}m/s</span>
            ${m ? `<span>🌊${m.waveHeight}m</span>` : ''}
          </div>
          <div style="
            display:inline-block;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600;
            background:${color}18;color:${color};border:1px solid ${color}40;
          ">${STATUS_LABEL[site.status]}</div>
        </div>
      `, { closeButton: false });
      marker.on('click', () => onSiteClick && onSiteClick(site.id));
      markersRef.current.push(marker);
    });
  }, [sites, onSiteClick]);

  return <div ref={mapRef} style={{ height: '100%', borderRadius: 'var(--radius-md)' }} />;
};

export interface SiteStatusCardProps {
  site: Site;
  onClick: (id: string) => void;
  density?: 'normal' | 'compact';
}

export const SiteStatusCard: FC<SiteStatusCardProps> = ({ site, onClick, density }) => {
  const w = generateWeather(site.id);
  const m = generateMarine(site.id);
  const decision = getDecision(site);
  const waveLimit = site.thresholds.waveHeight;

  return (
    <div className="card" style={{ cursor: 'pointer', transition: 'box-shadow 0.15s' }}
      onClick={() => onClick(site.id)}
      onMouseOver={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-md)'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)'; }}>
      <div className="card-body" style={{ padding: density === 'compact' ? '10px 14px' : '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{site.shortName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{TYPE_LABEL[site.type]}・{site.station}</div>
          </div>
          <span className={`badge ${STATUS_CLASS[decision.status]}`}>
            <span className="badge-dot"></span>
            {STATUS_LABEL[decision.status]}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>気温</div>
            <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{w.temp}℃</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>風速</div>
            <div style={{
              fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: w.wind > site.thresholds.windSpeed ? 'var(--status-danger)'
                : w.wind > site.thresholds.windSpeed * 0.8 ? 'var(--status-warn)' : 'inherit',
            }}>{w.wind}m/s</div>
          </div>
          {m && waveLimit !== null ? (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>波高</div>
              <div style={{
                fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                color: m.waveHeight > waveLimit ? 'var(--status-danger)'
                  : m.waveHeight > waveLimit * 0.8 ? 'var(--status-warn)' : 'inherit',
              }}>{m.waveHeight}m</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>降水</div>
              <div style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{w.rain}mm</div>
            </div>
          )}
        </div>

        <div className={`reason-text ${decision.status}`} style={{ marginTop: 0 }}>
          {decision.reasons[0]}
        </div>
      </div>
    </div>
  );
};

export interface AlertBannerProps {
  sites: Site[];
}

const MAX_CHIPS = 5;

const AlertRow: FC<{
  icon: string;
  label: string;
  color: string;
  bg: string;
  border: string;
  sites: Site[];
}> = ({ icon, label, color, bg, border, sites }) => {
  if (sites.length === 0) return null;
  const visible = sites.slice(0, MAX_CHIPS);
  const rest = sites.length - MAX_CHIPS;
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`,
      borderRadius: 'var(--radius-md)', padding: '8px 14px',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 12, color, flexShrink: 0, minWidth: 60 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
        {visible.map((s) => (
          <span key={s.id} title={getDecision(s).reasons[0]} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600,
            background: `${color}18`, color, border: `1px solid ${color}40`,
            cursor: 'default', whiteSpace: 'nowrap',
          }}>
            {s.shortName}
          </span>
        ))}
        {rest > 0 && (
          <span style={{
            padding: '2px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600,
            background: 'var(--bg-muted)', color: 'var(--text-muted)',
            border: '1px solid var(--border)', whiteSpace: 'nowrap',
          }}>
            +{rest}件
          </span>
        )}
      </div>
    </div>
  );
};

export const AlertBanner: FC<AlertBannerProps> = ({ sites }) => {
  const dangerSites = sites.filter((s) => s.status === 'danger');
  const warnSites = sites.filter((s) => s.status === 'warn');
  if (dangerSites.length === 0 && warnSites.length === 0) return null;

  return (
    <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <AlertRow
        icon="⚠" label="中止推奨"
        color="var(--status-danger)" bg="var(--status-danger-bg)" border="var(--status-danger-border)"
        sites={dangerSites}
      />
      <AlertRow
        icon="⚡" label="注意"
        color="var(--status-warn)" bg="var(--status-warn-bg)" border="var(--status-warn-border)"
        sites={warnSites}
      />
    </div>
  );
};

export interface DashboardPageProps {
  navigate: (page: string, site?: string) => void;
  density?: 'normal' | 'compact';
}

export const DashboardPage: FC<DashboardPageProps> = ({ navigate, density }) => {
  const [selectedArea, setSelectedArea] = useState<string | null>(null);

  const visibleSites = selectedArea ? SITES.filter((s) => s.area === selectedArea) : SITES;
  const okCount = visibleSites.filter((s) => s.status === 'ok').length;
  const warnCount = visibleSites.filter((s) => s.status === 'warn').length;
  const dangerCount = visibleSites.filter((s) => s.status === 'danger').length;
  const today = FORECAST_DAYS[0];

  return (
    <div>
      <AlertBanner sites={SITES} />

      <div className="grid-4 mb-16">
        <div className="stat-card">
          <div className="stat-label">管理現場数</div>
          <div className="stat-value" style={{ color: 'var(--blue-500)' }}>{visibleSites.length}</div>
          <div className="stat-sub">
            陸上 {visibleSites.filter((s) => s.type === 'land').length} / 海上 {visibleSites.filter((s) => s.type === 'marine' || s.type === 'both').length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">施工可</div>
          <div className="stat-value" style={{ color: 'var(--status-ok)' }}>{okCount}</div>
          <div className="stat-sub">全項目基準値内</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">注意</div>
          <div className="stat-value" style={{ color: 'var(--status-warn)' }}>{warnCount}</div>
          <div className="stat-sub">基準値に接近中</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">中止推奨</div>
          <div className="stat-value" style={{ color: 'var(--status-danger)' }}>{dangerCount}</div>
          <div className="stat-sub">基準値超過</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <span className="card-title">現場マップ — {selectedArea ?? '全国'}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {today.weather} {WEATHER_ICONS[today.weather]} {today.tempL}〜{today.tempH}℃
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {AREAS.map((area) => (
                <button
                  key={area}
                  onClick={() => setSelectedArea(area === '全国' ? null : area === selectedArea ? null : area)}
                  style={{
                    padding: '2px 10px', fontSize: 11, fontWeight: 600,
                    borderRadius: 100, cursor: 'pointer', border: '1px solid',
                    borderColor: (area === '全国' ? !selectedArea : area === selectedArea)
                      ? 'var(--blue-500)' : 'var(--border)',
                    background: (area === '全国' ? !selectedArea : area === selectedArea)
                      ? 'var(--blue-500)' : 'transparent',
                    color: (area === '全国' ? !selectedArea : area === selectedArea)
                      ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {area}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 420 }}>
            <MapView
              sites={visibleSites}
              selectedArea={selectedArea}
              onSiteClick={(id) => { navigate('site-detail', id); }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 480, overflowY: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', padding: '0 2px' }}>
            現場ステータス（{visibleSites.length}件{selectedArea ? ` / ${selectedArea}` : ''}）
          </div>
          {visibleSites.map((site) => (
            <SiteStatusCard key={site.id} site={site} density={density}
              onClick={(id) => navigate('site-detail', id)} />
          ))}
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-header">
          <span className="card-title">週間天気予報（東京）</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${FORECAST_DAYS.length}, 1fr)`, gap: 8, textAlign: 'center' }}>
            {FORECAST_DAYS.map((d, i) => (
              <div key={i} style={{
                padding: '10px 4px', borderRadius: 'var(--radius-md)',
                background: i === 0 ? 'var(--blue-50)' : 'transparent',
                border: i === 0 ? '1px solid var(--blue-200)' : '1px solid transparent',
              }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, marginBottom: 4,
                  color: i === 0 ? 'var(--blue-500)' : 'var(--text)',
                }}>
                  {d.date}
                </div>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{WEATHER_ICONS[d.weather]}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{d.weather}</div>
                <div style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--status-danger)' }}>{d.tempH}°</span>
                  <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>/</span>
                  <span style={{ color: 'var(--blue-500)' }}>{d.tempL}°</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  ☔{d.rain}% 💨{d.wind}m/s
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

if (typeof window !== 'undefined') {
  Object.assign(window, { DashboardPage, MapView, SiteStatusCard, AlertBanner });
}
