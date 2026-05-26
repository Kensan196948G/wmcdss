-- Seed: Tokyo Bay demo sites + default thresholds
INSERT INTO sites (code, name, kind, lat, lon, jma_station_id, address) VALUES
  ('TYO-01', '東京港臨海現場',     'marine', 35.6450, 139.7700, '44132', '東京都港区'),
  ('TYO-02', '羽田D滑走路工事',     'marine', 35.5494, 139.7798, '44132', '東京都大田区'),
  ('TYO-03', '横浜本牧埠頭改修',     'marine', 35.4225, 139.6810, '46106', '神奈川県横浜市中区'),
  ('TYO-04', '千葉袖ケ浦海上工事',   'marine', 35.4150, 139.9520, '45148', '千葉県袖ケ浦市'),
  ('TYO-05', '木更津陸上ヤード',     'land',   35.3792, 139.9200, '45148', '千葉県木更津市'),
  ('TYO-06', '川崎港岸壁築造',       'both',   35.5180, 139.7160, '44132', '神奈川県川崎市')
ON CONFLICT (code) DO NOTHING;

-- Global default thresholds (NULL site_id == applies to all sites unless overridden)
INSERT INTO thresholds (site_id, work_type, metric, op, value, severity, note) VALUES
  (NULL, 'concrete',        'precip_mm_1h',   '>=', 3.0,  'warn', 'コンクリート打設: 1時間降雨 3mm 以上で注意'),
  (NULL, 'concrete',        'precip_mm_1h',   '>=', 10.0, 'stop', 'コンクリート打設: 1時間降雨 10mm 以上で中止推奨'),
  (NULL, 'concrete',        'temperature_c',  '<',  4.0,  'warn', 'コンクリート打設: 4℃未満で養生条件注意'),
  (NULL, 'concrete',        'temperature_c',  '>=', 30.0, 'warn', 'コンクリート打設: 30℃以上で暑中コンクリート対応'),
  (NULL, 'crane',           'wind_speed_ms',  '>=', 10.0, 'warn', 'クレーン作業: 平均風速 10m/s 以上で注意'),
  (NULL, 'crane',           'wind_speed_ms',  '>=', 15.0, 'stop', 'クレーン作業: 平均風速 15m/s 以上で中止'),
  (NULL, 'marine_lift',     'sig_wave_h_m',   '>=', 1.0,  'warn', '海上揚重: 有義波高 1.0m 以上で注意'),
  (NULL, 'marine_lift',     'sig_wave_h_m',   '>=', 1.5,  'stop', '海上揚重: 有義波高 1.5m 以上で中止'),
  (NULL, 'marine_lift',     'wind_speed_ms',  '>=', 12.0, 'stop', '海上揚重: 風速 12m/s 以上で中止'),
  (NULL, 'marine_dive',     'sig_wave_h_m',   '>=', 0.5,  'stop', '潜水作業: 有義波高 0.5m 以上で中止'),
  (NULL, 'marine_transport','sig_wave_h_m',   '>=', 2.0,  'stop', '海上輸送: 有義波高 2.0m 以上で中止');
