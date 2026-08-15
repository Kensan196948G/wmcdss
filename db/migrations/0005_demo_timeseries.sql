-- =====================================================================
-- Demo time-series observations (fictional data for MVP evaluation)
-- =====================================================================
-- 目的: 気象データ / 海象データ / 過去データ分析 / グラフの各画面が
--       実データで埋まるよう、デモ6現場それぞれに **48時間分** の
--       時系列観測値を投入する（1時間毎 × 49点）。
--
-- 背景: 0004_demo_observations.sql は各現場1点しか投入しないため、
--       frontend の fetchWeatherObservations(site.id, 48) 等が 1〜2件しか
--       返さず、時系列グラフ・一覧表がほぼ空になっていた。
--       本 migration で 48 時間分を生成し、画面の詳細表示を埋める。
--
-- 鮮度ガードとの整合: decisions.py は weather 60分 / marine 3時間より
--       古い観測値を欠測扱いする。直近1時間以内の点を必ず含むため、
--       migration 実行直後から判定（go/caution/stop）にも使える。
--
-- 値の設計（全て架空）:
--   - generate_series で now() - 48h 〜 now() を 1 時間刻みで生成
--   - 現場ごとに基準値を変え、go/caution/stop の各状態が時系列で
--     現れるようにする（TYO-01: 穏やか / TYO-02: やや強風 /
--     TYO-03: 高波 / TYO-04: 降雨 / TYO-05: 高温 / TYO-06: 強風+高波）
--   - 気象: 気温・湿度・気圧・降水・風速・風向・日照
--   - 海象: 有義波高・周期・波向・潮位・流速・流向
--
-- 注意: 本データは全て架空値であり、実在する観測・会社・人物とは無関係。
--       再生成可能: db/migrations として版管理済み（migration runner 適用）。
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. 気象時系列（全6現場 × 49点）
-- ---------------------------------------------------------------------------

-- TYO-01 東京港臨海現場 (marine): 穏やか（気温18〜24℃・風2〜6m/s・降水0）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((20 + 3 * sin(g.h / 6.0))::numeric, 1),            -- 気温 ℃
       round((58 + 8 * sin(g.h / 8.0))::numeric, 1),            -- 湿度 %
       round((1012 + 2 * sin(g.h / 12.0))::numeric, 1),         -- 気圧 hPa
       0.0,                                                      -- 降水 mm
       round((3.5 + 2 * abs(sin(g.h / 5.0)))::numeric, 1),      -- 風速 m/s
       round((5.5 + 3 * abs(sin(g.h / 5.0)))::numeric, 1),      -- 最大瞬間風速
       (g.h * 15) % 360,                                        -- 風向 deg
       round(greatest(0.0, 8.0 - abs(g.h - 12) * 0.5)::numeric, 1), -- 日照 h
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-02 羽田D滑走路工事 (marine): やや強風（風速8〜14m/s → クレーン caution）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((19 + 2.5 * sin(g.h / 6.0))::numeric, 1),
       round((62 + 7 * sin(g.h / 8.0))::numeric, 1),
       round((1010 + 2 * sin(g.h / 12.0))::numeric, 1),
       greatest(0.0, round((0.5 + 0.3 * sin(g.h / 9.0))::numeric, 1)), -- 降水 mm
       round((11 + 3 * sin(g.h / 7.0))::numeric, 1),             -- 風速 8〜14
       round((15 + 4 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 30) % 360,
       round(greatest(0.0, 7.0 - abs(g.h - 12) * 0.4)::numeric, 1),
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03 横浜本牧埠頭改修 (marine): 高波（波高は marine 側、気象は中程度）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((17 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((70 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1008 + 3 * sin(g.h / 12.0))::numeric, 1),
       round(greatest(0.0, 2.0 + 1.5 * sin(g.h / 10.0))::numeric, 1), -- 降水 mm
       round((8 + 2.5 * sin(g.h / 7.0))::numeric, 1),
       round((11 + 3 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 160) % 360,
       round(greatest(0.0, 5.0 - abs(g.h - 12) * 0.3)::numeric, 1),
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-04 千葉袖ケ浦海上工事 (marine): 降雨（降水5〜15mm → コンクリート stop）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((16 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((84 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1005 + 3 * sin(g.h / 12.0))::numeric, 1),
       round((8 + 6 * sin(g.h / 11.0))::numeric, 1),            -- 降水 2〜14mm
       round((6 + 2 * sin(g.h / 7.0))::numeric, 1),
       round((9 + 3 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 120) % 360,
       round(greatest(0.0, 3.0 - abs(g.h - 12) * 0.2)::numeric, 1),
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-05 木更津陸上ヤード (land): 高温（気温28〜35℃ → コンクリート caution）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((31 + 3 * sin(g.h / 6.0))::numeric, 1),            -- 気温 28〜34℃
       round((48 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1010 + 2 * sin(g.h / 12.0))::numeric, 1),
       0.0,
       round((3 + 1.5 * sin(g.h / 7.0))::numeric, 1),
       round((4.5 + 2 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 90) % 360,
       round(greatest(0.0, 10.0 - abs(g.h - 12) * 0.6)::numeric, 1),
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-05'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-06 川崎港岸壁築造 (both): 強風+降雨（風速12〜18m/s → クレーン stop）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((18 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((68 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1007 + 3 * sin(g.h / 12.0))::numeric, 1),
       round(greatest(0.0, 1.5 + 1 * sin(g.h / 10.0))::numeric, 1),
       round((15 + 3 * sin(g.h / 7.0))::numeric, 1),            -- 風速 12〜18
       round((20 + 4 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 250) % 360,
       round(greatest(0.0, 4.0 - abs(g.h - 12) * 0.25)::numeric, 1),
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. 海象時系列（marine/both の 5 現場 × 49点）
-- ---------------------------------------------------------------------------

-- TYO-01: 穏やか（波高 0.3〜0.6m）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((0.45 + 0.15 * sin(g.h / 6.0))::numeric, 2),       -- 有義波高 m
       round((5.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),         -- 周期 s
       (g.h * 15 + 200) % 360,
       round((1.1 + 0.4 * sin(g.h / 6.28))::numeric, 2),        -- 潮位 m
       round((0.3 + 0.2 * sin(g.h / 5.0))::numeric, 2),         -- 流速 m/s
       (g.h * 15 + 200) % 360,
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-02: 中程度（波高 1.0〜1.5m）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((1.2 + 0.25 * sin(g.h / 6.0))::numeric, 2),
       round((6.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 210) % 360,
       round((1.2 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.5 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 210) % 360,
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03: 高波（波高 1.5〜2.1m → marine_lift stop）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((1.8 + 0.3 * sin(g.h / 6.0))::numeric, 2),
       round((7.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 170) % 360,
       round((1.0 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.8 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 170) % 360,
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-04: 中程度（波高 0.8〜1.2m）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((1.0 + 0.2 * sin(g.h / 6.0))::numeric, 2),
       round((5.8 + 0.8 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 130) % 360,
       round((0.9 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.4 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 130) % 360,
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-06: 高波+強風（波高 0.6〜1.0m・強風は気象側）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       now() - (48 - g.h) * interval '1 hour',
       round((0.8 + 0.2 * sin(g.h / 6.0))::numeric, 2),
       round((5.5 + 0.8 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 250) % 360,
       round((1.3 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.6 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 250) % 360,
       'demo'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;
