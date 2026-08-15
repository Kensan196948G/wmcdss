-- =====================================================================
-- Demo observations (fictional data for MVP evaluation)
-- =====================================================================
-- 目的: 0002_seed_demo.sql は sites / thresholds しか投入しないため、
--       判定API は常に「観測値欠測 → caution（fail-closed）」になる。
--       本 migration はデモ現場に「直近かつ物理的に妥当な範囲内」の
--       架空観測値を投入し、go / caution / stop の3状態が実際に
--       判定・表示できる状態を作る（検証後も保持するダミーデータ）。
--
-- 鮮度ガードとの整合: decisions.py は weather 60分 / marine 3時間より
--       古い観測値を欠測扱いする。ここでは now() - interval '10 minutes'
--       （weather）と now() - interval '1 hour'（marine）で投入するため、
--       migration 実行直後から判定に使える。
--
-- 注意: 本データは全て架空値であり、実在する観測・会社・人物とは無関係。
--       現場名・座標は 0002_seed_demo.sql のデモ用現場を使う。
--       再生成可能: db/migrations として版管理済み（migration runner 適用）。
-- =====================================================================

-- TYO-01 東京港臨海現場 (marine): 全項目基準内 → concrete = go
--   気温 22℃ / 湿度 60% / 風速 4.0 m/s / 降雨 0.0 mm / 有義波高 0.4 m
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 22.0, 60.0, 1013.0,
       0.0, 4.0, 6.5, 180.0, 3.2, 'demo'
FROM sites WHERE code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '1 hour', 0.4, 5.2, 200.0,
       1.1, 0.3, 200.0, 'demo'
FROM sites WHERE code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-02 羽田D滑走路工事 (marine): 風速 11 m/s（クレーン10m/sを超過 → warn 相当）
--   コンクリートは風速基準が無いため go 寄り、クレーンは caution
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 20.5, 65.0, 1011.0,
       0.5, 11.0, 16.0, 210.0, 2.0, 'demo'
FROM sites WHERE code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '1 hour', 1.2, 6.0, 210.0,
       1.2, 0.5, 210.0, 'demo'
FROM sites WHERE code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03 横浜本牧埠頭改修 (marine): 有義波高 1.8m（marine_lift 1.5m 超過 → stop）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 18.0, 75.0, 1008.0,
       2.5, 9.0, 13.0, 160.0, 0.0, 'demo'
FROM sites WHERE code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '1 hour', 1.8, 7.5, 170.0,
       1.0, 0.8, 170.0, 'demo'
FROM sites WHERE code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-04 千葉袖ケ浦海上工事 (marine): 降雨 12mm（コンクリート10mm 超過 → stop）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 17.0, 88.0, 1005.0,
       12.0, 7.0, 10.0, 120.0, 0.0, 'demo'
FROM sites WHERE code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '1 hour', 0.9, 5.8, 130.0,
       0.9, 0.4, 130.0, 'demo'
FROM sites WHERE code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-05 木更津陸上ヤード (land): 気温 33℃（コンクリート暑中 30℃ 超過 → warn 相当）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 33.0, 45.0, 1010.0,
       0.0, 3.0, 5.0, 90.0, 8.0, 'demo'
FROM sites WHERE code = 'TYO-05'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-06 川崎港岸壁築造 (both): 風速 16m/s（クレーン15m/s 超過 → stop）・波高 0.7m
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 19.0, 70.0, 1009.0,
       1.0, 16.0, 22.0, 250.0, 1.0, 'demo'
FROM sites WHERE code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '1 hour', 0.7, 5.5, 250.0,
       1.3, 0.6, 250.0, 'demo'
FROM sites WHERE code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;
