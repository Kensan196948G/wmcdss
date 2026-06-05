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
  area: string;
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
  // ── 関東 ──────────────────────────────────────────────────────────
  {
    id: 'site-01', name: '東京港臨海大橋建設工事', shortName: '東京港大橋',
    type: 'marine', area: '関東', lat: 35.6195, lng: 139.7745,
    station: '東京（気象台）', marinePoint: '東京湾北部', status: 'ok',
    manager: '田中 太郎', contractor: '大成・鹿島JV',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-02', name: '横浜港防波堤改修工事', shortName: '横浜港防波堤',
    type: 'marine', area: '関東', lat: 35.4428, lng: 139.6520,
    station: '横浜（気象台）', marinePoint: '東京湾中部', status: 'warn',
    manager: '鈴木 一郎', contractor: '清水建設',
    period: '2025/06/01 〜 2027/09/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-03', name: '川崎港護岸補強工事', shortName: '川崎港護岸',
    type: 'both', area: '関東', lat: 35.4860, lng: 139.7520,
    station: '川崎', marinePoint: '東京湾中部', status: 'ok',
    manager: '佐藤 健二', contractor: '大林組',
    period: '2025/02/01 〜 2026/12/31',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  {
    id: 'site-04', name: '千葉港浚渫・埋立工事', shortName: '千葉港浚渫',
    type: 'marine', area: '関東', lat: 35.5720, lng: 140.0880,
    station: '千葉（気象台）', marinePoint: '東京湾東部', status: 'danger',
    manager: '高橋 洋子', contractor: '五洋建設',
    period: '2025/01/15 〜 2027/06/30',
    thresholds: { windSpeed: 8, waveHeight: 1.0, rainfall: 3, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-05', name: '木更津沖海上風力基礎工事', shortName: '木更津風力',
    type: 'marine', area: '関東', lat: 35.3800, lng: 139.9100,
    station: '木更津', marinePoint: '東京湾南部', status: 'warn',
    manager: '渡辺 修', contractor: '東亜建設工業',
    period: '2025/03/01 〜 2028/03/31',
    thresholds: { windSpeed: 8, waveHeight: 1.0, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-06', name: '品川駅前再開発工事', shortName: '品川駅前',
    type: 'land', area: '関東', lat: 35.6284, lng: 139.7387,
    station: '東京（気象台）', marinePoint: null, status: 'ok',
    manager: '伊藤 美咲', contractor: '竹中工務店',
    period: '2024/10/01 〜 2027/12/31',
    thresholds: { windSpeed: 15, waveHeight: null, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  {
    id: 'site-07', name: '茨城沖洋上風力基礎工事', shortName: '茨城沖風力',
    type: 'marine', area: '関東', lat: 36.0680, lng: 140.8930,
    station: '銚子（気象台）', marinePoint: '鹿島灘', status: 'warn',
    manager: '小川 浩二', contractor: '日本海洋掘削',
    period: '2025/07/01 〜 2028/06/30',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 5, tempHigh: 35 },
  },
  {
    id: 'site-08', name: '相模湾護岸補強工事', shortName: '相模湾護岸',
    type: 'marine', area: '関東', lat: 35.3290, lng: 139.3510,
    station: '平塚', marinePoint: '相模湾', status: 'ok',
    manager: '吉田 義一', contractor: '若築建設',
    period: '2025/09/01 〜 2027/03/31',
    thresholds: { windSpeed: 12, waveHeight: 1.8, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  // ── 北海道 ────────────────────────────────────────────────────────
  {
    id: 'site-09', name: '苫小牧港防波堤改修工事', shortName: '苫小牧港防波堤',
    type: 'marine', area: '北海道', lat: 42.6300, lng: 141.6050,
    station: '苫小牧', marinePoint: '苫小牧沖', status: 'ok',
    manager: '山田 啓介', contractor: '清水建設',
    period: '2025/05/01 〜 2027/10/31',
    thresholds: { windSpeed: 12, waveHeight: 2.0, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-10', name: '函館港フェリー埠頭整備工事', shortName: '函館港埠頭',
    type: 'marine', area: '北海道', lat: 41.7740, lng: 140.7260,
    station: '函館（気象台）', marinePoint: '津軽海峡西部', status: 'warn',
    manager: '木村 洋介', contractor: '五洋建設',
    period: '2025/06/01 〜 2027/05/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-11', name: '室蘭港工業港岸壁工事', shortName: '室蘭港岸壁',
    type: 'marine', area: '北海道', lat: 42.3350, lng: 140.9710,
    station: '室蘭', marinePoint: '室蘭沖', status: 'ok',
    manager: '松本 賢一', contractor: '大成建設',
    period: '2025/04/15 〜 2026/11/30',
    thresholds: { windSpeed: 12, waveHeight: 2.0, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-12', name: '釧路港外港地区護岸工事', shortName: '釧路港護岸',
    type: 'marine', area: '北海道', lat: 42.9800, lng: 144.3780,
    station: '釧路（気象台）', marinePoint: '釧路沖', status: 'ok',
    manager: '中島 正雄', contractor: '東洋建設',
    period: '2025/05/01 〜 2027/09/30',
    thresholds: { windSpeed: 12, waveHeight: 2.0, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-13', name: '札幌市北区都市再開発工事', shortName: '札幌北区再開発',
    type: 'land', area: '北海道', lat: 43.0640, lng: 141.3470,
    station: '札幌（気象台）', marinePoint: null, status: 'ok',
    manager: '藤田 恵子', contractor: '竹中工務店',
    period: '2025/03/01 〜 2028/02/28',
    thresholds: { windSpeed: 15, waveHeight: null, rainfall: 15, tempLow: -5, tempHigh: 35 },
  },
  // ── 東北 ──────────────────────────────────────────────────────────
  {
    id: 'site-14', name: '仙台港埠頭整備工事', shortName: '仙台港埠頭',
    type: 'marine', area: '東北', lat: 38.2630, lng: 141.0220,
    station: '仙台（気象台）', marinePoint: '仙台湾', status: 'warn',
    manager: '阿部 浩二', contractor: '鹿島建設',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-15', name: '石巻港漁港復旧工事', shortName: '石巻港漁港',
    type: 'marine', area: '東北', lat: 38.4380, lng: 141.3030,
    station: '石巻', marinePoint: '仙台湾北部', status: 'ok',
    manager: '菊池 裕介', contractor: '大林組',
    period: '2025/02/01 〜 2026/10/31',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-16', name: '青森港物流埠頭工事', shortName: '青森港埠頭',
    type: 'marine', area: '東北', lat: 40.8280, lng: 140.7030,
    station: '青森（気象台）', marinePoint: '陸奥湾', status: 'ok',
    manager: '工藤 義彦', contractor: '東亜建設工業',
    period: '2025/05/01 〜 2027/04/30',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-17', name: '秋田港洋上風力基礎工事', shortName: '秋田沖風力',
    type: 'marine', area: '東北', lat: 39.7170, lng: 140.0200,
    station: '秋田（気象台）', marinePoint: '日本海秋田沖', status: 'danger',
    manager: '伊藤 博之', contractor: '五洋建設',
    period: '2025/06/01 〜 2028/12/31',
    thresholds: { windSpeed: 12, waveHeight: 2.0, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  {
    id: 'site-18', name: 'いわき広野火力護岸工事', shortName: 'いわき護岸',
    type: 'both', area: '東北', lat: 37.0620, lng: 141.0280,
    station: '小名浜', marinePoint: '福島沿岸', status: 'ok',
    manager: '渡辺 浩', contractor: '清水建設',
    period: '2025/03/01 〜 2027/02/28',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 0, tempHigh: 35 },
  },
  // ── 中部 ──────────────────────────────────────────────────────────
  {
    id: 'site-19', name: '名古屋港コンテナ埠頭拡張工事', shortName: '名古屋港埠頭',
    type: 'marine', area: '中部', lat: 35.0800, lng: 136.8540,
    station: '名古屋（気象台）', marinePoint: '伊勢湾北部', status: 'ok',
    manager: '加藤 健一', contractor: '大成建設',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-20', name: '静岡港防波堤整備工事', shortName: '静岡港防波堤',
    type: 'marine', area: '中部', lat: 34.9650, lng: 138.5010,
    station: '静岡（気象台）', marinePoint: '駿河湾', status: 'warn',
    manager: '鈴木 孝之', contractor: '五洋建設',
    period: '2025/07/01 〜 2027/06/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-21', name: '清水港クルーズ埠頭整備工事', shortName: '清水港埠頭',
    type: 'marine', area: '中部', lat: 35.0140, lng: 138.5250,
    station: '静岡（気象台）', marinePoint: '駿河湾', status: 'ok',
    manager: '望月 真一', contractor: '東洋建設',
    period: '2025/09/01 〜 2027/08/31',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 10, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-22', name: '四日市港護岸補強工事', shortName: '四日市港護岸',
    type: 'marine', area: '中部', lat: 34.9700, lng: 136.6300,
    station: '四日市', marinePoint: '伊勢湾', status: 'ok',
    manager: '山本 幸雄', contractor: '若築建設',
    period: '2025/04/01 〜 2026/09/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-23', name: '富山港外港防波堤工事', shortName: '富山港防波堤',
    type: 'marine', area: '中部', lat: 36.7620, lng: 137.2200,
    station: '富山（気象台）', marinePoint: '富山湾', status: 'danger',
    manager: '高木 信二', contractor: '東亜建設工業',
    period: '2025/05/01 〜 2027/04/30',
    thresholds: { windSpeed: 10, waveHeight: 2.0, rainfall: 10, tempLow: 0, tempHigh: 38 },
  },
  // ── 近畿 ──────────────────────────────────────────────────────────
  {
    id: 'site-24', name: '大阪港夢洲護岸工事', shortName: '大阪港夢洲',
    type: 'marine', area: '近畿', lat: 34.6500, lng: 135.4300,
    station: '大阪（気象台）', marinePoint: '大阪湾', status: 'ok',
    manager: '田村 誠一', contractor: '大林組',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-25', name: '神戸港六甲アイランド拡張工事', shortName: '神戸港六甲',
    type: 'marine', area: '近畿', lat: 34.6810, lng: 135.2560,
    station: '神戸（気象台）', marinePoint: '大阪湾西部', status: 'warn',
    manager: '西田 博司', contractor: '清水建設',
    period: '2025/06/01 〜 2027/05/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-26', name: '和歌山下津港護岸工事', shortName: '和歌山港護岸',
    type: 'marine', area: '近畿', lat: 34.2270, lng: 135.2110,
    station: '和歌山（気象台）', marinePoint: '紀伊水道', status: 'ok',
    manager: '橋本 裕子', contractor: '鹿島建設',
    period: '2025/03/01 〜 2027/02/28',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-27', name: '堺浜臨海再開発工事', shortName: '堺浜再開発',
    type: 'land', area: '近畿', lat: 34.5590, lng: 135.4700,
    station: '大阪（気象台）', marinePoint: null, status: 'ok',
    manager: '村田 義雄', contractor: '竹中工務店',
    period: '2025/10/01 〜 2028/09/30',
    thresholds: { windSpeed: 15, waveHeight: null, rainfall: 10, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-28', name: '舞鶴港防衛省岸壁整備工事', shortName: '舞鶴港岸壁',
    type: 'marine', area: '近畿', lat: 35.4710, lng: 135.4000,
    station: '舞鶴（気象台）', marinePoint: '若狭湾', status: 'ok',
    manager: '中村 正志', contractor: '五洋建設',
    period: '2025/05/01 〜 2027/04/30',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  // ── 中国 ──────────────────────────────────────────────────────────
  {
    id: 'site-29', name: '広島港宇品地区護岸工事', shortName: '広島港護岸',
    type: 'marine', area: '中国', lat: 34.3660, lng: 132.4480,
    station: '広島（気象台）', marinePoint: '広島湾', status: 'ok',
    manager: '浜田 稔', contractor: '大成建設',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-30', name: '岡山港新埠頭建設工事', shortName: '岡山港埠頭',
    type: 'marine', area: '中国', lat: 34.6590, lng: 133.9230,
    station: '岡山（気象台）', marinePoint: '播磨灘', status: 'warn',
    manager: '井上 真司', contractor: '東洋建設',
    period: '2025/06/01 〜 2027/05/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-31', name: '下関港関門航路浚渫工事', shortName: '下関関門航路',
    type: 'marine', area: '中国', lat: 33.9540, lng: 130.9490,
    station: '下関（気象台）', marinePoint: '関門海峡', status: 'danger',
    manager: '沖田 一郎', contractor: '東亜建設工業',
    period: '2025/03/01 〜 2026/12/31',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-32', name: '境港水産市場護岸工事', shortName: '境港護岸',
    type: 'marine', area: '中国', lat: 35.5410, lng: 133.2240,
    station: '境（気象台）', marinePoint: '日本海中部', status: 'ok',
    manager: '足立 勇一', contractor: '若築建設',
    period: '2025/05/01 〜 2026/11/30',
    thresholds: { windSpeed: 12, waveHeight: 2.0, rainfall: 10, tempLow: 3, tempHigh: 35 },
  },
  // ── 四国 ──────────────────────────────────────────────────────────
  {
    id: 'site-33', name: '高松港整備工事', shortName: '高松港',
    type: 'marine', area: '四国', lat: 34.3540, lng: 134.0470,
    station: '高松（気象台）', marinePoint: '備讃瀬戸', status: 'ok',
    manager: '大野 哲也', contractor: '清水建設',
    period: '2025/04/01 〜 2026/09/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-34', name: '高知港南国岸壁工事', shortName: '高知港岸壁',
    type: 'marine', area: '四国', lat: 33.5570, lng: 133.5480,
    station: '高知（気象台）', marinePoint: '土佐湾', status: 'warn',
    manager: '竹内 武', contractor: '大林組',
    period: '2025/05/01 〜 2027/04/30',
    thresholds: { windSpeed: 10, waveHeight: 1.5, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-35', name: '新居浜港産業港湾護岸工事', shortName: '新居浜港護岸',
    type: 'marine', area: '四国', lat: 33.9480, lng: 133.3080,
    station: '新居浜', marinePoint: '燧灘', status: 'ok',
    manager: '松岡 義一', contractor: '鹿島建設',
    period: '2025/06/01 〜 2027/05/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  // ── 九州 ──────────────────────────────────────────────────────────
  {
    id: 'site-36', name: '博多港箱崎埠頭拡張工事', shortName: '博多港埠頭',
    type: 'marine', area: '九州', lat: 33.5950, lng: 130.4080,
    station: '福岡（気象台）', marinePoint: '博多湾', status: 'ok',
    manager: '原田 健二', contractor: '五洋建設',
    period: '2025/04/01 〜 2027/03/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-37', name: '長崎港松が枝国際埠頭工事', shortName: '長崎港埠頭',
    type: 'marine', area: '九州', lat: 32.7480, lng: 129.8760,
    station: '長崎（気象台）', marinePoint: '長崎港外', status: 'warn',
    manager: '坂本 義久', contractor: '東洋建設',
    period: '2025/06/01 〜 2027/05/31',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 5, tempHigh: 38 },
  },
  {
    id: 'site-38', name: '大分港護岸整備工事', shortName: '大分港護岸',
    type: 'marine', area: '九州', lat: 33.2300, lng: 131.6000,
    station: '大分（気象台）', marinePoint: '別府湾', status: 'ok',
    manager: '吉松 博志', contractor: '東亜建設工業',
    period: '2025/05/01 〜 2027/04/30',
    thresholds: { windSpeed: 10, waveHeight: 1.2, rainfall: 5, tempLow: 3, tempHigh: 38 },
  },
  {
    id: 'site-39', name: '鹿児島港谷山地区護岸工事', shortName: '鹿児島港護岸',
    type: 'marine', area: '九州', lat: 31.5830, lng: 130.5520,
    station: '鹿児島（気象台）', marinePoint: '鹿児島湾', status: 'ok',
    manager: '有村 尚之', contractor: '大成建設',
    period: '2025/07/01 〜 2027/06/30',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 5, tempHigh: 38 },
  },
  // ── 沖縄 ──────────────────────────────────────────────────────────
  {
    id: 'site-40', name: '那覇港軍港移転沖縄港整備工事', shortName: '那覇港整備',
    type: 'marine', area: '沖縄', lat: 26.2180, lng: 127.6680,
    station: '那覇（気象台）', marinePoint: '東シナ海沖縄沿岸', status: 'warn',
    manager: '仲村渠 勉', contractor: '若築建設',
    period: '2025/04/01 〜 2029/03/31',
    thresholds: { windSpeed: 12, waveHeight: 1.5, rainfall: 10, tempLow: 10, tempHigh: 38 },
  },
];

const WEATHER_TABLE: Record<string, WeatherSample> = {
  // 関東
  'site-01': { temp: 22.4, hum: 68, wind: 4.2,  windDir: 'SSW', rain: 0,    pressure: 1013.2 },
  'site-02': { temp: 21.8, hum: 72, wind: 7.8,  windDir: 'SW',  rain: 0.5,  pressure: 1011.8 },
  'site-03': { temp: 22.1, hum: 65, wind: 3.5,  windDir: 'S',   rain: 0,    pressure: 1013.0 },
  'site-04': { temp: 21.5, hum: 78, wind: 12.4, windDir: 'SSW', rain: 8.5,  pressure: 1008.4 },
  'site-05': { temp: 20.8, hum: 75, wind: 9.6,  windDir: 'SW',  rain: 0,    pressure: 1010.2 },
  'site-06': { temp: 23.0, hum: 62, wind: 2.8,  windDir: 'SE',  rain: 0,    pressure: 1013.5 },
  'site-07': { temp: 19.8, hum: 78, wind: 9.2,  windDir: 'SSW', rain: 2.5,  pressure: 1010.8 },
  'site-08': { temp: 21.4, hum: 70, wind: 5.6,  windDir: 'SW',  rain: 0,    pressure: 1012.5 },
  // 北海道
  'site-09': { temp: 12.5, hum: 70, wind: 8.2,  windDir: 'N',   rain: 0,    pressure: 1018.5 },
  'site-10': { temp: 13.8, hum: 68, wind: 6.5,  windDir: 'NNE', rain: 0,    pressure: 1017.2 },
  'site-11': { temp: 11.2, hum: 75, wind: 9.4,  windDir: 'NW',  rain: 2.0,  pressure: 1016.8 },
  'site-12': { temp: 10.5, hum: 80, wind: 7.6,  windDir: 'NNE', rain: 0,    pressure: 1015.4 },
  'site-13': { temp: 14.2, hum: 65, wind: 3.8,  windDir: 'SE',  rain: 0,    pressure: 1017.5 },
  // 東北
  'site-14': { temp: 18.5, hum: 72, wind: 6.8,  windDir: 'SE',  rain: 3.5,  pressure: 1012.3 },
  'site-15': { temp: 17.2, hum: 74, wind: 5.4,  windDir: 'SE',  rain: 0,    pressure: 1013.1 },
  'site-16': { temp: 15.6, hum: 76, wind: 7.2,  windDir: 'N',   rain: 1.0,  pressure: 1014.8 },
  'site-17': { temp: 16.8, hum: 82, wind: 13.8, windDir: 'NW',  rain: 12.5, pressure: 1007.2 },
  'site-18': { temp: 19.4, hum: 68, wind: 4.6,  windDir: 'SE',  rain: 0,    pressure: 1013.8 },
  // 中部
  'site-19': { temp: 24.5, hum: 66, wind: 4.2,  windDir: 'S',   rain: 0,    pressure: 1013.8 },
  'site-20': { temp: 23.2, hum: 74, wind: 7.5,  windDir: 'SSW', rain: 1.5,  pressure: 1011.5 },
  'site-21': { temp: 23.5, hum: 72, wind: 6.8,  windDir: 'SW',  rain: 0,    pressure: 1011.8 },
  'site-22': { temp: 24.8, hum: 64, wind: 3.5,  windDir: 'S',   rain: 0,    pressure: 1014.2 },
  'site-23': { temp: 20.5, hum: 85, wind: 11.5, windDir: 'NW',  rain: 18.5, pressure: 1006.8 },
  // 近畿
  'site-24': { temp: 26.2, hum: 68, wind: 3.8,  windDir: 'SSW', rain: 0,    pressure: 1014.5 },
  'site-25': { temp: 25.8, hum: 70, wind: 6.8,  windDir: 'SW',  rain: 0.5,  pressure: 1013.2 },
  'site-26': { temp: 25.5, hum: 72, wind: 4.2,  windDir: 'SSW', rain: 0,    pressure: 1013.8 },
  'site-27': { temp: 26.5, hum: 65, wind: 2.8,  windDir: 'SE',  rain: 0,    pressure: 1014.8 },
  'site-28': { temp: 22.5, hum: 74, wind: 5.2,  windDir: 'N',   rain: 0,    pressure: 1015.2 },
  // 中国
  'site-29': { temp: 25.8, hum: 70, wind: 3.8,  windDir: 'SSW', rain: 0,    pressure: 1015.2 },
  'site-30': { temp: 26.5, hum: 66, wind: 6.5,  windDir: 'SW',  rain: 2.5,  pressure: 1012.8 },
  'site-31': { temp: 24.2, hum: 76, wind: 14.5, windDir: 'SSW', rain: 5.5,  pressure: 1008.2 },
  'site-32': { temp: 22.8, hum: 72, wind: 4.5,  windDir: 'NW',  rain: 0,    pressure: 1016.5 },
  // 四国
  'site-33': { temp: 26.8, hum: 68, wind: 4.2,  windDir: 'SSW', rain: 0,    pressure: 1015.5 },
  'site-34': { temp: 27.5, hum: 78, wind: 8.5,  windDir: 'S',   rain: 5.5,  pressure: 1010.2 },
  'site-35': { temp: 26.5, hum: 70, wind: 5.2,  windDir: 'SW',  rain: 0,    pressure: 1014.8 },
  // 九州
  'site-36': { temp: 27.8, hum: 72, wind: 4.8,  windDir: 'SSW', rain: 0,    pressure: 1015.8 },
  'site-37': { temp: 27.2, hum: 78, wind: 7.5,  windDir: 'SW',  rain: 2.5,  pressure: 1012.5 },
  'site-38': { temp: 28.2, hum: 70, wind: 5.2,  windDir: 'SW',  rain: 0,    pressure: 1014.8 },
  'site-39': { temp: 29.5, hum: 74, wind: 6.5,  windDir: 'SSW', rain: 0,    pressure: 1013.8 },
  // 沖縄
  'site-40': { temp: 30.2, hum: 82, wind: 9.5,  windDir: 'SW',  rain: 4.5,  pressure: 1010.5 },
};

export function generateWeather(siteId: string): WeatherSample {
  return WEATHER_TABLE[siteId] ?? WEATHER_TABLE['site-01'];
}

const MARINE_TABLE: Record<string, MarineSample> = {
  // 関東
  'site-01': { waveHeight: 0.8, wavePeriod: 5.2, waveDir: 'S',   tide: '中潮', tideLevel: 1.42 },
  'site-02': { waveHeight: 1.3, wavePeriod: 6.1, waveDir: 'SSW', tide: '中潮', tideLevel: 1.38 },
  'site-03': { waveHeight: 0.6, wavePeriod: 4.8, waveDir: 'S',   tide: '中潮', tideLevel: 1.40 },
  'site-04': { waveHeight: 2.1, wavePeriod: 7.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.35 },
  'site-05': { waveHeight: 1.5, wavePeriod: 6.8, waveDir: 'SSW', tide: '中潮', tideLevel: 1.32 },
  'site-07': { waveHeight: 1.2, wavePeriod: 6.5, waveDir: 'SSW', tide: '小潮', tideLevel: 1.25 },
  'site-08': { waveHeight: 0.8, wavePeriod: 5.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.38 },
  // 北海道
  'site-09': { waveHeight: 1.2, wavePeriod: 6.5, waveDir: 'N',   tide: '小潮', tideLevel: 0.85 },
  'site-10': { waveHeight: 1.5, wavePeriod: 7.2, waveDir: 'NNE', tide: '小潮', tideLevel: 0.92 },
  'site-11': { waveHeight: 1.8, wavePeriod: 7.8, waveDir: 'NW',  tide: '中潮', tideLevel: 0.78 },
  'site-12': { waveHeight: 1.4, wavePeriod: 6.8, waveDir: 'NE',  tide: '中潮', tideLevel: 0.95 },
  // 東北
  'site-14': { waveHeight: 1.1, wavePeriod: 6.2, waveDir: 'SE',  tide: '中潮', tideLevel: 1.12 },
  'site-15': { waveHeight: 0.9, wavePeriod: 5.8, waveDir: 'SE',  tide: '中潮', tideLevel: 1.18 },
  'site-16': { waveHeight: 1.3, wavePeriod: 7.0, waveDir: 'N',   tide: '大潮', tideLevel: 1.05 },
  'site-17': { waveHeight: 2.8, wavePeriod: 9.5, waveDir: 'NW',  tide: '大潮', tideLevel: 0.88 },
  'site-18': { waveHeight: 0.7, wavePeriod: 5.2, waveDir: 'SE',  tide: '中潮', tideLevel: 1.35 },
  // 中部
  'site-19': { waveHeight: 0.6, wavePeriod: 5.0, waveDir: 'S',   tide: '中潮', tideLevel: 1.45 },
  'site-20': { waveHeight: 1.1, wavePeriod: 6.2, waveDir: 'SSW', tide: '中潮', tideLevel: 1.28 },
  'site-21': { waveHeight: 0.9, wavePeriod: 5.8, waveDir: 'SW',  tide: '中潮', tideLevel: 1.32 },
  'site-22': { waveHeight: 0.5, wavePeriod: 4.5, waveDir: 'S',   tide: '中潮', tideLevel: 1.52 },
  'site-23': { waveHeight: 2.4, wavePeriod: 8.5, waveDir: 'NW',  tide: '大潮', tideLevel: 0.95 },
  // 近畿
  'site-24': { waveHeight: 0.5, wavePeriod: 4.8, waveDir: 'SSW', tide: '中潮', tideLevel: 1.48 },
  'site-25': { waveHeight: 0.8, wavePeriod: 5.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.42 },
  'site-26': { waveHeight: 0.7, wavePeriod: 5.2, waveDir: 'SSW', tide: '中潮', tideLevel: 1.38 },
  'site-28': { waveHeight: 1.0, wavePeriod: 6.0, waveDir: 'N',   tide: '中潮', tideLevel: 0.92 },
  // 中国
  'site-29': { waveHeight: 0.6, wavePeriod: 4.8, waveDir: 'SSW', tide: '中潮', tideLevel: 1.35 },
  'site-30': { waveHeight: 0.8, wavePeriod: 5.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.28 },
  'site-31': { waveHeight: 2.2, wavePeriod: 8.0, waveDir: 'SSW', tide: '中潮', tideLevel: 1.15 },
  'site-32': { waveHeight: 0.9, wavePeriod: 5.8, waveDir: 'NW',  tide: '中潮', tideLevel: 0.88 },
  // 四国
  'site-33': { waveHeight: 0.6, wavePeriod: 4.8, waveDir: 'SSW', tide: '中潮', tideLevel: 1.42 },
  'site-34': { waveHeight: 1.3, wavePeriod: 6.8, waveDir: 'S',   tide: '中潮', tideLevel: 1.35 },
  'site-35': { waveHeight: 0.8, wavePeriod: 5.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.38 },
  // 九州
  'site-36': { waveHeight: 0.5, wavePeriod: 4.5, waveDir: 'SSW', tide: '中潮', tideLevel: 1.55 },
  'site-37': { waveHeight: 1.0, wavePeriod: 6.0, waveDir: 'SW',  tide: '中潮', tideLevel: 1.48 },
  'site-38': { waveHeight: 0.6, wavePeriod: 4.8, waveDir: 'SW',  tide: '中潮', tideLevel: 1.42 },
  'site-39': { waveHeight: 0.8, wavePeriod: 5.5, waveDir: 'SSW', tide: '中潮', tideLevel: 1.35 },
  // 沖縄
  'site-40': { waveHeight: 1.5, wavePeriod: 7.5, waveDir: 'SW',  tide: '中潮', tideLevel: 1.25 },
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
