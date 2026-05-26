// Mock data — Tokyo Bay Area construction sites.
//
// Phase 1 ESM port of frontend/data.jsx. Mirrors the original `window.*`
// surface (Babel Standalone fallback compatibility) while exposing typed
// named exports so the downstream .tsx ports (decisions, dashboard) can
// consume the data as real ES modules.

export type SiteKind = 'land' | 'marine' | 'both';
export type Status = 'ok' | 'warn' | 'danger';
export type WeatherKind = '晴れ' | '曇り' | '雨' | '雪';
export type CompassDir =
  | 'N' | 'NNE' | 'NE' | 'ENE'
  | 'E' | 'ESE' | 'SE' | 'SSE'
  | 'S' | 'SSW' | 'SW' | 'WSW'
  | 'W' | 'WNW' | 'NW' | 'NNW';

export interface SiteThresholds {
  windSpeed: number;
  // null on land-only sites — the original .jsx leaned on `undefined > undefined === false`
  // for the comparison to be false. The explicit `null` makes that contract enforceable.
  waveHeight: number | null;
  rainfall: number;
  tempLow: number;
  tempHigh: number;
}

export interface Site {
  id: string;
  name: string;
  shortName: string;
  type: SiteKind;
  lat: number;
  lng: number;
  station: string;
  marinePoint: string | null;
  status: Status;
  manager: string;
  contractor: string;
  period: string;
  thresholds: SiteThresholds;
}

export interface WeatherSample {
  temp: number;
  hum: number;
  wind: number;
  windDir: CompassDir;
  rain: number;
  pressure: number;
}

export interface MarineSample {
  waveHeight: number;
  wavePeriod: number;
  waveDir: CompassDir;
  tide: string;
  tideLevel: number;
}

export interface ForecastDay {
  date: string;
  weather: WeatherKind;
  tempH: number;
  tempL: number;
  rain: number;
  wind: number;
}

export interface HourlyWindPoint {
  hour: number;
  speed: number;
}

export interface HourlyWavePoint {
  hour: number;
  height: number;
}

export interface HistoricalMonth {
  month: string;
  avgWind: number;
  maxWind: number;
  avgWave: number;
  maxWave: number;
  rainDays: number;
  totalRain: number;
}

export interface AuditEntry {
  id: number;
  time: string;
  user: string;
  action: string;
  target: string;
  detail: string;
}

export interface ETLJob {
  id: number;
  name: string;
  schedule: string;
  lastRun: string;
  status: Status;
  records: number;
}

export interface DecisionResult {
  status: Status;
  reasons: string[];
}

export const SITES: Site[] = [
  {
    id: 'site-01',
    name: '東京港臨海大橋建設工事',
    shortName: '東京港大橋',
    type: 'marine',
    lat: 35.6195,
    lng: 139.7745,
    station: '東京（気象台）',
    marinePoint: '東京湾北部',
    status: 'ok',
    manager: '田中 太郎',
    contractor: '大成・鹿島JV',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-02',
    name: '横浜港防波堤改修工事',
    shortName: '横浜港防波堤',
    type: 'marine',
    lat: 35.4428,
    lng: 139.6520,
    station: '横浜（気象台）',
    marinePoint: '東京湾中部',
    status: 'warn',
    manager: '鈴木 一郎',
    contractor: '清水建設',
    period: '2025/06/01 〜 2027/09/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-03',
    name: '川崎港護岸補強工事',
    shortName: '川崎港護岸',
    type: 'both',
    lat: 35.4860,
    lng: 139.7520,
    station: '川崎',
    marinePoint: '東京湾中部',
    status: 'ok',
    manager: '佐藤 健二',
    contractor: '大林組',
    period: '2025/02/01 〜 2026/12/31',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  {
    id: 'site-04',
    name: '千葉港浚渫・埋立工事',
    shortName: '千葉港浚渫',
    type: 'marine',
    lat: 35.5720,
    lng: 140.0880,
    station: '千葉（気象台）',
    marinePoint: '東京湾東部',
    status: 'danger',
    manager: '高橋 洋子',
    contractor: '五洋建設',
    period: '2025/01/15 〜 2027/06/30',
    thresholds: { windSpeed: 8, waveHeight: 1.0, rainfall: 3, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-05',
    name: '木更津沖海上風力基礎工事',
    shortName: '木更津風力',
    type: 'marine',
    lat: 35.3800,
    lng: 139.9100,
    station: '木更津',
    marinePoint: '東京湾南部',
    status: 'warn',
    manager: '渡辺 修',
    contractor: '東亜建設工業',
    period: '2025/03/01 〜 2028/03/31',
    thresholds: { windSpeed: 8, waveHeight: 1.0, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-06',
    name: '品川駅前再開発工事',
    shortName: '品川駅前',
    type: 'land',
    lat: 35.6284,
    lng: 139.7387,
    station: '東京（気象台）',
    marinePoint: null,
    status: 'ok',
    manager: '伊藤 美咲',
    contractor: '竹中工務店',
    period: '2024/10/01 〜 2027/12/31',
    thresholds: { windSpeed: 15, waveHeight: null, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
];

const WEATHER_TABLE: Record<string, WeatherSample> = {
  'site-01': { temp: 22.4, hum: 68, wind: 4.2, windDir: 'SSW', rain: 0, pressure: 1013.2 },
  'site-02': { temp: 21.8, hum: 72, wind: 7.8, windDir: 'SW', rain: 0.5, pressure: 1011.8 },
  'site-03': { temp: 22.1, hum: 65, wind: 3.5, windDir: 'S', rain: 0, pressure: 1013.0 },
  'site-04': { temp: 21.5, hum: 78, wind: 12.4, windDir: 'SSW', rain: 8.5, pressure: 1008.4 },
  'site-05': { temp: 20.8, hum: 75, wind: 9.6, windDir: 'SW', rain: 0, pressure: 1010.2 },
  'site-06': { temp: 23.0, hum: 62, wind: 2.8, windDir: 'SE', rain: 0, pressure: 1013.5 },
};

export function generateWeather(siteId: string): WeatherSample {
  return WEATHER_TABLE[siteId] ?? WEATHER_TABLE['site-01'];
}

const MARINE_TABLE: Record<string, MarineSample> = {
  'site-01': { waveHeight: 0.8, wavePeriod: 5.2, waveDir: 'S', tide: '中潮', tideLevel: 1.42 },
  'site-02': { waveHeight: 1.3, wavePeriod: 6.1, waveDir: 'SSW', tide: '中潮', tideLevel: 1.38 },
  'site-03': { waveHeight: 0.6, wavePeriod: 4.8, waveDir: 'S', tide: '中潮', tideLevel: 1.40 },
  'site-04': { waveHeight: 2.1, wavePeriod: 7.5, waveDir: 'SW', tide: '中潮', tideLevel: 1.35 },
  'site-05': { waveHeight: 1.5, wavePeriod: 6.8, waveDir: 'SSW', tide: '中潮', tideLevel: 1.32 },
};

export function generateMarine(siteId: string): MarineSample | null {
  return MARINE_TABLE[siteId] ?? null;
}

export const FORECAST_DAYS: ForecastDay[] = [
  { date: '5/22(木)', weather: '晴れ', tempH: 26, tempL: 18, rain: 10, wind: 4 },
  { date: '5/23(金)', weather: '曇り', tempH: 24, tempL: 17, rain: 30, wind: 6 },
  { date: '5/24(土)', weather: '雨', tempH: 21, tempL: 16, rain: 80, wind: 9 },
  { date: '5/25(日)', weather: '雨', tempH: 20, tempL: 15, rain: 70, wind: 11 },
  { date: '5/26(月)', weather: '曇り', tempH: 23, tempL: 16, rain: 40, wind: 7 },
  { date: '5/27(火)', weather: '晴れ', tempH: 25, tempL: 17, rain: 10, wind: 3 },
  { date: '5/28(水)', weather: '晴れ', tempH: 27, tempL: 19, rain: 5, wind: 3 },
];

export const WEATHER_ICONS: Record<WeatherKind, string> = {
  '晴れ': '☀️',
  '曇り': '☁️',
  '雨': '🌧️',
  '雪': '❄️',
};

export function generateHourlyWind(): HourlyWindPoint[] {
  const hours: HourlyWindPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const base = 4 + Math.sin((h / 24) * Math.PI * 2 - 1) * 3;
    hours.push({ hour: h, speed: +(base + (Math.random() - 0.5) * 2).toFixed(1) });
  }
  return hours;
}

export function generateHourlyWave(): HourlyWavePoint[] {
  const hours: HourlyWavePoint[] = [];
  for (let h = 0; h < 24; h++) {
    const base = 0.8 + Math.sin((h / 24) * Math.PI * 2) * 0.4;
    hours.push({ hour: h, height: +(base + (Math.random() - 0.3) * 0.3).toFixed(2) });
  }
  return hours;
}

export function generateHistoricalMonthly(): HistoricalMonth[] {
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  return months.map((m, i) => ({
    month: m,
    avgWind: +(3 + Math.sin((i / 12) * Math.PI * 2) * 2 + Math.random()).toFixed(1),
    maxWind: +(8 + Math.sin((i / 12) * Math.PI * 2) * 4 + Math.random() * 3).toFixed(1),
    avgWave: +(0.7 + Math.sin((i / 12) * Math.PI * 2) * 0.3 + Math.random() * 0.2).toFixed(2),
    maxWave: +(1.2 + Math.sin((i / 12) * Math.PI * 2) * 0.8 + Math.random() * 0.5).toFixed(2),
    rainDays: Math.round(5 + Math.sin(((i + 3) / 12) * Math.PI * 2) * 4 + Math.random() * 2),
    totalRain: Math.round(50 + Math.sin(((i + 3) / 12) * Math.PI * 2) * 80 + Math.random() * 30),
  }));
}

export const AUDIT_LOG: AuditEntry[] = [
  { id: 1, time: '2026/05/22 09:15', user: '田中 太郎', action: '施工判定実行', target: '東京港臨海大橋建設工事', detail: 'コンクリート打設判定：施工可' },
  { id: 2, time: '2026/05/22 09:10', user: 'システム', action: '気象データ取得', target: '全現場', detail: '定時取得完了（6現場）' },
  { id: 3, time: '2026/05/22 08:45', user: '高橋 洋子', action: '閾値変更', target: '千葉港浚渫・埋立工事', detail: '波高閾値: 1.2m → 1.0m' },
  { id: 4, time: '2026/05/22 08:30', user: '鈴木 一郎', action: '施工判定実行', target: '横浜港防波堤改修工事', detail: '海上作業判定：注意' },
  { id: 5, time: '2026/05/22 08:00', user: 'システム', action: '海象データ取得', target: '全現場', detail: '定時取得完了（5海上現場）' },
  { id: 6, time: '2026/05/21 17:30', user: '佐藤 健二', action: 'レポート出力', target: '川崎港護岸補強工事', detail: '週次気象レポート（PDF）' },
  { id: 7, time: '2026/05/21 17:00', user: 'システム', action: '気象警報検知', target: '千葉港浚渫・埋立工事', detail: '強風注意報 発令' },
  { id: 8, time: '2026/05/21 15:20', user: '渡辺 修', action: '現場情報更新', target: '木更津沖海上風力基礎工事', detail: '工期延長（2028/03/31まで）' },
  { id: 9, time: '2026/05/21 14:00', user: '伊藤 美咲', action: '施工判定実行', target: '品川駅前再開発工事', detail: 'コンクリート打設判定：施工可' },
  { id: 10, time: '2026/05/21 09:00', user: 'システム', action: '日次集計', target: '全現場', detail: '5/20分 気象データ集計完了' },
];

export const ETL_JOBS: ETLJob[] = [
  { id: 1, name: '気象庁アメダスデータ取得', schedule: '毎時00分', lastRun: '2026/05/22 09:00', status: 'ok', records: 156 },
  { id: 2, name: '気象庁波浪データ取得', schedule: '3時間毎', lastRun: '2026/05/22 09:00', status: 'ok', records: 48 },
  { id: 3, name: '潮位データ取得', schedule: '毎時00分', lastRun: '2026/05/22 09:00', status: 'ok', records: 24 },
  { id: 4, name: '天気予報取得', schedule: '6時間毎', lastRun: '2026/05/22 06:00', status: 'ok', records: 42 },
  { id: 5, name: '過去データ日次集計', schedule: '毎日 02:00', lastRun: '2026/05/22 02:00', status: 'ok', records: 2340 },
  { id: 6, name: '50年確率波算出', schedule: '月次', lastRun: '2026/05/01 03:00', status: 'ok', records: 12 },
];

export const STATUS_LABEL: Record<Status, string> = {
  ok: '施工可',
  warn: '注意',
  danger: '中止推奨',
};

export const STATUS_CLASS: Record<Status, string> = {
  ok: 'badge-ok',
  warn: 'badge-warn',
  danger: 'badge-danger',
};

export const TYPE_LABEL: Record<SiteKind, string> = {
  land: '陸上',
  marine: '海上',
  both: '陸上＋海上',
};

export function getDecision(site: Site): DecisionResult {
  const w = generateWeather(site.id);
  const m = generateMarine(site.id);
  const reasons: string[] = [];
  let status: Status = 'ok';

  if (w.wind > site.thresholds.windSpeed) {
    status = 'danger';
    reasons.push(`風速 ${w.wind}m/s が基準値 ${site.thresholds.windSpeed}m/s を超過`);
  } else if (w.wind > site.thresholds.windSpeed * 0.8) {
    if (status === 'ok') status = 'warn';
    reasons.push(`風速 ${w.wind}m/s が基準値に接近中`);
  }
  if (w.rain > site.thresholds.rainfall) {
    status = 'danger';
    reasons.push(`降水量 ${w.rain}mm が基準値 ${site.thresholds.rainfall}mm を超過`);
  }
  if (w.temp < site.thresholds.tempLow) {
    if (status === 'ok') status = 'warn';
    reasons.push(`気温 ${w.temp}℃ が下限 ${site.thresholds.tempLow}℃ を下回る`);
  }
  // Wave checks only apply when site has a marine threshold AND has marine data.
  // The original .jsx relied on `undefined > undefined === false`; here we gate explicitly.
  const waveLimit = site.thresholds.waveHeight;
  if (m && waveLimit !== null) {
    if (m.waveHeight > waveLimit) {
      status = 'danger';
      reasons.push(`有義波高 ${m.waveHeight}m が基準値 ${waveLimit}m を超過`);
    } else if (m.waveHeight > waveLimit * 0.8) {
      if (status === 'ok') status = 'warn';
      reasons.push(`有義波高 ${m.waveHeight}m が基準値に接近中`);
    }
  }
  if (reasons.length === 0) reasons.push('全項目が基準値内です。施工に支障はありません。');
  return { status, reasons };
}

declare global {
  interface Window {
    SITES?: typeof SITES;
    generateWeather?: typeof generateWeather;
    generateMarine?: typeof generateMarine;
    FORECAST_DAYS?: typeof FORECAST_DAYS;
    WEATHER_ICONS?: typeof WEATHER_ICONS;
    generateHourlyWind?: typeof generateHourlyWind;
    generateHourlyWave?: typeof generateHourlyWave;
    generateHistoricalMonthly?: typeof generateHistoricalMonthly;
    AUDIT_LOG?: typeof AUDIT_LOG;
    ETL_JOBS?: typeof ETL_JOBS;
    STATUS_LABEL?: typeof STATUS_LABEL;
    STATUS_CLASS?: typeof STATUS_CLASS;
    TYPE_LABEL?: typeof TYPE_LABEL;
    getDecision?: typeof getDecision;
  }
}

if (typeof window !== 'undefined') {
  Object.assign(window, {
    SITES,
    generateWeather,
    generateMarine,
    FORECAST_DAYS,
    WEATHER_ICONS,
    generateHourlyWind,
    generateHourlyWave,
    generateHistoricalMonthly,
    AUDIT_LOG,
    ETL_JOBS,
    STATUS_LABEL,
    STATUS_CLASS,
    TYPE_LABEL,
    getDecision,
  });
}
