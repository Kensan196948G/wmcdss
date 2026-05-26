-- =====================================================================
-- Weather-Marine Construction DSS  initial schema
-- =====================================================================
-- Conventions
--   * snake_case, plural table names
--   * surrogate uuid PK + business unique constraints
--   * timestamptz for all temporal columns (UTC stored)
--   * fetched_at / data_version on every JMA-sourced row (data is mutable upstream)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- sites --------------------------------------------------------
CREATE TABLE sites (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    kind            text NOT NULL CHECK (kind IN ('land','marine','both')),
    lat             double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lon             double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
    jma_station_id  text,
    wave_grid_lat   double precision,
    wave_grid_lon   double precision,
    address         text,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sites_kind ON sites(kind);

-- ---------- weather observations (hourly JMA) ----------------------------
CREATE TABLE weather_observations (
    id               bigserial PRIMARY KEY,
    site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    observed_at      timestamptz NOT NULL,
    temperature_c    double precision,
    humidity_pct     double precision,
    pressure_hpa     double precision,
    precip_mm        double precision,
    wind_speed_ms    double precision,
    wind_gust_ms     double precision,
    wind_dir_deg     double precision,
    sunshine_h       double precision,
    fetched_at       timestamptz NOT NULL DEFAULT now(),
    data_version     int NOT NULL DEFAULT 1,
    source           text NOT NULL DEFAULT 'jma',
    UNIQUE (site_id, observed_at, data_version)
);
CREATE INDEX idx_weather_site_time ON weather_observations(site_id, observed_at DESC);

-- ---------- marine observations (wave model 5km grid) --------------------
CREATE TABLE marine_observations (
    id               bigserial PRIMARY KEY,
    site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    observed_at      timestamptz NOT NULL,
    sig_wave_h_m     double precision,
    wave_period_s    double precision,
    wave_dir_deg     double precision,
    tide_level_m     double precision,
    current_speed_ms double precision,
    current_dir_deg  double precision,
    fetched_at       timestamptz NOT NULL DEFAULT now(),
    data_version     int NOT NULL DEFAULT 1,
    source           text NOT NULL DEFAULT 'jma_wave',
    UNIQUE (site_id, observed_at, data_version)
);
CREATE INDEX idx_marine_site_time ON marine_observations(site_id, observed_at DESC);

-- ---------- forecast snapshot (12-72h ahead) -----------------------------
CREATE TABLE forecasts (
    id               bigserial PRIMARY KEY,
    site_id          uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    forecast_for     timestamptz NOT NULL,
    issued_at        timestamptz NOT NULL,
    domain           text NOT NULL CHECK (domain IN ('weather','marine')),
    payload          jsonb NOT NULL,
    UNIQUE (site_id, forecast_for, issued_at, domain)
);
CREATE INDEX idx_forecasts_lookup ON forecasts(site_id, domain, forecast_for);

-- ---------- thresholds (per-site work-stop criteria) ---------------------
CREATE TABLE thresholds (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          uuid REFERENCES sites(id) ON DELETE CASCADE,    -- NULL = global default
    work_type        text NOT NULL,         -- 'concrete','crane','marine_lift','marine_dive','marine_transport',...
    metric           text NOT NULL,         -- 'wind_speed_ms','precip_mm_1h','sig_wave_h_m','temperature_c',...
    op               text NOT NULL CHECK (op IN ('<','<=','>','>=','==','!=')),
    value            double precision NOT NULL,
    severity         text NOT NULL CHECK (severity IN ('warn','stop')),
    active_from      date,
    active_to        date,
    note             text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_thresholds_lookup ON thresholds(site_id, work_type, metric);

-- ---------- decisions (audit-grade judgement log) ------------------------
CREATE TABLE decisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    work_type           text NOT NULL,
    target_window_start timestamptz NOT NULL,
    target_window_end   timestamptz NOT NULL,
    status              text NOT NULL CHECK (status IN ('go','caution','stop')),
    reason              text NOT NULL,
    inputs              jsonb NOT NULL,         -- observations / forecast snapshot used
    thresholds_snapshot jsonb NOT NULL,         -- rules at the time of judgement
    generated_by        text NOT NULL DEFAULT 'system',
    generated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_decisions_site_time ON decisions(site_id, target_window_start DESC);

-- ---------- users & roles ------------------------------------------------
CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text NOT NULL UNIQUE,
    display_name text NOT NULL,
    role         text NOT NULL CHECK (role IN ('field','hq','admin')),
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- audit log ----------------------------------------------------
CREATE TABLE audit_log (
    id          bigserial PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor       text,
    action      text NOT NULL,
    target_type text,
    target_id   text,
    detail      jsonb
);
CREATE INDEX idx_audit_time ON audit_log(occurred_at DESC);

-- ---------- ETL job state ------------------------------------------------
CREATE TABLE etl_runs (
    id           bigserial PRIMARY KEY,
    job          text NOT NULL,           -- 'jma_hourly','jma_daily','wave_3h',...
    status       text NOT NULL CHECK (status IN ('running','succeeded','failed')),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    rows_in      int,
    rows_out     int,
    error        text,
    detail       jsonb
);
CREATE INDEX idx_etl_runs_job_time ON etl_runs(job, started_at DESC);

-- ---------- updated_at trigger -------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sites_updated      BEFORE UPDATE ON sites
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_thresholds_updated BEFORE UPDATE ON thresholds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
