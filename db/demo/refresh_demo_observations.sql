-- =====================================================================
-- refresh_demo_observations.sql — デモ観測値の「再実行可能な」リフレッシュ
-- =====================================================================
-- 目的
--   db/migrations/0004_demo_observations.sql と 0005_demo_timeseries.sql は
--   投入時刻を now() 相対で決める設計だが、**migration は一度しか走らない**。
--   そのため実行から時間が経つと観測値が必ず stale 化し、判定 API
--   (backend/app/api/dashboard.py の _latest_inputs) は
--       observed_at >= now() - interval '24 hours'   … 取得窓
--       _WEATHER_FRESH = 30 分 / _MARINE_FRESH = 3 時間 … 鮮度ガード
--   の両方を満たす行が無いため全メトリクスを None とし、
--   services/decision.py の fail-closed 仕様で **全現場・全作業種別が
--   「観測値欠測 → caution」に固定**される（＝ go も stop も出ない）。
--   本ファイルは migration を書き換えずに鮮度を回復させるための、
--   何度でも実行できる投入 SQL である。
--
-- 実行方法（推奨はラッパースクリプト経由）
--   scripts/wmcdss-demo-refresh.sh
--   docker exec -i wmcdss-db psql -v ON_ERROR_STOP=1 -U wmcdss -d wmcdss \
--     < db/demo/refresh_demo_observations.sql
--
-- 再実行可能性（idempotency）の設計
--   1. 冒頭で **デモ由来の行だけ** を削除する:
--        source IN ('demo', 'demo_series')
--      0004/0005 が入れた source='demo' と、本スクリプトが入れる
--      source='demo_series' は、どちらも「デモ表示専用の架空値」であり、
--      削除対象をこの 2 つのマーカーに限定することで、JMA 実測
--      (source='jma') / 海象実測 (source='jma_wave' / 'nowphas') /
--      Open-Meteo (source='open_meteo_marine_info') / テスト fixture
--      (source='pytest') の行には一切触れない。
--      マーカーを分けている理由は、0005 が入れた「過去の時系列」と
--      本スクリプトが入れた「現在の時系列」を事後に区別できるようにするため。
--      DROP / TRUNCATE は使わない（DELETE のみ、対象は上記マーカー限定）。
--   2. その後、常に「同じ時刻グリッド」へ再投入する:
--        時系列  : date_trunc('hour', now()) を基準に 48 時間前〜現在の 49 点
--        現在値  : now() - 10 分（気象）/ now() - 30 分（海象）
--      時刻グリッドが now() 相対の決定的な値なので、何度実行しても
--      行数は一定（無限増加しない）で、値も毎回同じ設計に戻る。
--   3. UNIQUE (site_id, observed_at, data_version) への ON CONFLICT DO NOTHING を
--      重ねて付けている。同一グリッド内で再実行された場合の二重投入を防ぐ
--      最後の砦（1. の DELETE と併せて二重に守る）。
--
-- 値設計の意図（0004 / 0005 を踏襲。勝手に変えない）
--   現場ごとに「気象・海象のどこが基準を超えるか」を変え、6 現場の
--   ダッシュボードに go / caution / stop の 3 状態が同時に現れるようにする。
--   しきい値の正本は db/migrations/0002_seed_demo.sql（グローバル既定 11 件）。
--
--     TYO-01 東京港臨海現場   (marine): 全項目基準内              → go
--     TYO-02 羽田D滑走路工事  (marine): 風速 11m/s                → crane caution
--     TYO-03 横浜本牧埠頭改修 (marine): 有義波高 1.8m             → marine_lift/dive stop
--     TYO-04 千葉袖ケ浦海上工事(marine): 降水 12mm/h              → concrete stop
--     TYO-05 木更津陸上ヤード (land)  : 気温 33℃                  → concrete caution
--     TYO-06 川崎港岸壁築造   (both)  : 風速 16m/s + 波高 0.7m    → crane stop
--   ※ ここは「設計意図」であり、実行時の実測は
--      backend/tests/test_demo_refresh_values.py が decision.evaluate を
--      通して検証する（このファイルのコメントを根拠に成功を主張しない）。
--
-- 鮮度ガードとの整合（必須条件）
--   気象は **直近 30 分以内**、海象は **直近 3 時間以内** の行を必ず含める。
--   現在値アンカーを now() - 10 分 / now() - 30 分 に置くことで満たす。
--   時系列の先頭（now() - 48h）は取得窓 24 時間の外なので判定には使われない。
--
-- 注意
--   * 本ファイルは db/migrations/ 配下ではないため migration runner は実行しない。
--     既存 migration 0001〜0005 の checksum を変えないこと（`migrate up` が停止する）。
--   * 本データは全て架空値であり、実在する観測・会社・人物とは無関係。
--   * 実データ（source='jma' 等）が同じ時刻に入っている場合、DELETE は
--     source マーカーで限定しているため実データには影響しない。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. デモ由来の行のみを削除（DROP / TRUNCATE は使わない）
-- ---------------------------------------------------------------------------
-- 削除対象は source='demo'（0004/0005 が投入）と source='demo_series'
-- （本スクリプトが投入）の 2 マーカーだけ。実測・fixture は対象外。
DELETE FROM weather_observations
 WHERE source IN ('demo', 'demo_series');

DELETE FROM marine_observations
 WHERE source IN ('demo', 'demo_series');

-- ---------------------------------------------------------------------------
-- 2. 気象時系列（6 現場 × 49 点 = 現在時グリッドの 48 時間分）
--    0005_demo_timeseries.sql と同じ生成式・同じ現場別パラメータ。
--    基準時刻だけを date_trunc('hour', now()) に置き換えている。
-- ---------------------------------------------------------------------------

-- TYO-01 東京港臨海現場 (marine): 穏やか（気温18〜24℃・風2〜6m/s・降水0）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((20 + 3 * sin(g.h / 6.0))::numeric, 1),
       round((58 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1012 + 2 * sin(g.h / 12.0))::numeric, 1),
       0.0,
       round((3.5 + 2 * abs(sin(g.h / 5.0)))::numeric, 1),
       round((5.5 + 3 * abs(sin(g.h / 5.0)))::numeric, 1),
       (g.h * 15) % 360,
       round(greatest(0.0, 8.0 - abs(g.h - 12) * 0.5)::numeric, 1),
       'demo_series'
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
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((19 + 2.5 * sin(g.h / 6.0))::numeric, 1),
       round((62 + 7 * sin(g.h / 8.0))::numeric, 1),
       round((1010 + 2 * sin(g.h / 12.0))::numeric, 1),
       greatest(0.0, round((0.5 + 0.3 * sin(g.h / 9.0))::numeric, 1)),
       round((11 + 3 * sin(g.h / 7.0))::numeric, 1),
       round((15 + 4 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 30) % 360,
       round(greatest(0.0, 7.0 - abs(g.h - 12) * 0.4)::numeric, 1),
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03 横浜本牧埠頭改修 (marine): 高波（波高は海象側）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((17 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((70 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1008 + 3 * sin(g.h / 12.0))::numeric, 1),
       round(greatest(0.0, 2.0 + 1.5 * sin(g.h / 10.0))::numeric, 1),
       round((8 + 2.5 * sin(g.h / 7.0))::numeric, 1),
       round((11 + 3 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 160) % 360,
       round(greatest(0.0, 5.0 - abs(g.h - 12) * 0.3)::numeric, 1),
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-04 千葉袖ケ浦海上工事 (marine): 降雨（降水2〜14mm → コンクリート stop）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((16 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((84 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1005 + 3 * sin(g.h / 12.0))::numeric, 1),
       round((8 + 6 * sin(g.h / 11.0))::numeric, 1),
       round((6 + 2 * sin(g.h / 7.0))::numeric, 1),
       round((9 + 3 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 120) % 360,
       round(greatest(0.0, 3.0 - abs(g.h - 12) * 0.2)::numeric, 1),
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-05 木更津陸上ヤード (land): 高温（気温28〜34℃ → コンクリート caution）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((31 + 3 * sin(g.h / 6.0))::numeric, 1),
       round((48 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1010 + 2 * sin(g.h / 12.0))::numeric, 1),
       0.0,
       round((3 + 1.5 * sin(g.h / 7.0))::numeric, 1),
       round((4.5 + 2 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 90) % 360,
       round(greatest(0.0, 10.0 - abs(g.h - 12) * 0.6)::numeric, 1),
       'demo_series'
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
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((18 + 2 * sin(g.h / 6.0))::numeric, 1),
       round((68 + 8 * sin(g.h / 8.0))::numeric, 1),
       round((1007 + 3 * sin(g.h / 12.0))::numeric, 1),
       round(greatest(0.0, 1.5 + 1 * sin(g.h / 10.0))::numeric, 1),
       round((15 + 3 * sin(g.h / 7.0))::numeric, 1),
       round((20 + 4 * sin(g.h / 7.0))::numeric, 1),
       (g.h * 15 + 250) % 360,
       round(greatest(0.0, 4.0 - abs(g.h - 12) * 0.25)::numeric, 1),
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. 海象時系列（marine/both の 5 現場 × 49 点。TYO-05 は land のため対象外）
-- ---------------------------------------------------------------------------

-- TYO-01: 穏やか（波高 0.3〜0.6m）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((0.45 + 0.15 * sin(g.h / 6.0))::numeric, 2),
       round((5.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 200) % 360,
       round((1.1 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.3 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 200) % 360,
       'demo_series'
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
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((1.2 + 0.25 * sin(g.h / 6.0))::numeric, 2),
       round((6.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 210) % 360,
       round((1.2 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.5 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 210) % 360,
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03: 高波（波高 1.5〜2.1m → marine_lift/dive stop）
INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT s.id,
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((1.8 + 0.3 * sin(g.h / 6.0))::numeric, 2),
       round((7.0 + 1.0 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 170) % 360,
       round((1.0 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.8 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 170) % 360,
       'demo_series'
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
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((1.0 + 0.2 * sin(g.h / 6.0))::numeric, 2),
       round((5.8 + 0.8 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 130) % 360,
       round((0.9 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.4 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 130) % 360,
       'demo_series'
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
       date_trunc('hour', now()) - (48 - g.h) * interval '1 hour',
       round((0.8 + 0.2 * sin(g.h / 6.0))::numeric, 2),
       round((5.5 + 0.8 * sin(g.h / 8.0))::numeric, 1),
       (g.h * 15 + 250) % 360,
       round((1.3 + 0.4 * sin(g.h / 6.28))::numeric, 2),
       round((0.6 + 0.2 * sin(g.h / 5.0))::numeric, 2),
       (g.h * 15 + 250) % 360,
       'demo_series'
FROM sites s
JOIN generate_series(0, 48) AS g(h)
  ON true
WHERE s.code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. 現在値アンカー（判定の入力になる「直近」の 1 点）
-- ---------------------------------------------------------------------------
-- 0004_demo_observations.sql と同じ現場別の基準値。判定 API は
-- observed_at が最新の 1 行だけを見るため、この 1 点が
-- dashboard の latest_weather / latest_marine と判定結果を決める。
--   気象: now() - 10 分（鮮度ガード 30 分以内）
--   海象: now() - 30 分（鮮度ガード 3 時間以内）

-- TYO-01: 全項目基準内 → concrete/crane/marine_* いずれも go
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 22.0, 60.0, 1013.0,
       0.0, 4.0, 6.5, 180.0, 3.2, 'demo_series'
FROM sites WHERE code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '30 minutes', 0.4, 5.2, 200.0,
       1.1, 0.3, 200.0, 'demo_series'
FROM sites WHERE code = 'TYO-01'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-02: 風速 11m/s（クレーン warn 10m/s 超過）→ crane caution
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 20.5, 65.0, 1011.0,
       0.5, 11.0, 16.0, 210.0, 2.0, 'demo_series'
FROM sites WHERE code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '30 minutes', 1.2, 6.0, 210.0,
       1.2, 0.5, 210.0, 'demo_series'
FROM sites WHERE code = 'TYO-02'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-03: 有義波高 1.8m（marine_lift stop 1.5m / dive stop 0.5m 超過）→ stop
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 18.0, 75.0, 1008.0,
       2.5, 9.0, 13.0, 160.0, 0.0, 'demo_series'
FROM sites WHERE code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '30 minutes', 1.8, 7.5, 170.0,
       1.0, 0.8, 170.0, 'demo_series'
FROM sites WHERE code = 'TYO-03'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-04: 降水 12mm/h（concrete stop 10mm 超過）→ stop
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 17.0, 88.0, 1005.0,
       12.0, 7.0, 10.0, 120.0, 0.0, 'demo_series'
FROM sites WHERE code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '30 minutes', 0.9, 5.8, 130.0,
       0.9, 0.4, 130.0, 'demo_series'
FROM sites WHERE code = 'TYO-04'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-05: 気温 33℃（concrete warn 30℃ 超過）→ caution（land のため海象なし）
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 33.0, 45.0, 1010.0,
       0.0, 3.0, 5.0, 90.0, 8.0, 'demo_series'
FROM sites WHERE code = 'TYO-05'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- TYO-06: 風速 16m/s（crane stop 15m/s 超過）+ 波高 0.7m → stop
INSERT INTO weather_observations
    (site_id, observed_at, temperature_c, humidity_pct, pressure_hpa,
     precip_mm, wind_speed_ms, wind_gust_ms, wind_dir_deg, sunshine_h, source)
SELECT id, now() - interval '10 minutes', 19.0, 70.0, 1009.0,
       1.0, 16.0, 22.0, 250.0, 1.0, 'demo_series'
FROM sites WHERE code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

INSERT INTO marine_observations
    (site_id, observed_at, sig_wave_h_m, wave_period_s, wave_dir_deg,
     tide_level_m, current_speed_ms, current_dir_deg, source)
SELECT id, now() - interval '30 minutes', 0.7, 5.5, 250.0,
       1.3, 0.6, 250.0, 'demo_series'
FROM sites WHERE code = 'TYO-06'
ON CONFLICT (site_id, observed_at, data_version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. 結果の自己申告（スクリプトが実行ログへ残す値）
-- ---------------------------------------------------------------------------
SELECT 'weather_observations' AS table_name,
       count(*) FILTER (WHERE source = 'demo_series') AS demo_series_rows,
       max(observed_at) FILTER (WHERE source = 'demo_series') AS latest,
       now() - max(observed_at) FILTER (WHERE source = 'demo_series') AS age
  FROM weather_observations
UNION ALL
SELECT 'marine_observations',
       count(*) FILTER (WHERE source = 'demo_series'),
       max(observed_at) FILTER (WHERE source = 'demo_series'),
       now() - max(observed_at) FILTER (WHERE source = 'demo_series')
  FROM marine_observations;

COMMIT;
