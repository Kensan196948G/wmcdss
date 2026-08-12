-- =====================================================================
-- 0003_nowphas_station.sql — NOWPHAS 観測局コードの記録
-- =====================================================================

ALTER TABLE marine_observations ADD COLUMN IF NOT EXISTS station_code text;
CREATE INDEX IF NOT EXISTS idx_marine_station_code ON marine_observations(station_code);
