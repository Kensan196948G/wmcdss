import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class WeatherObservationIn(BaseModel):
    site_id:       uuid.UUID
    observed_at:   datetime
    temperature_c: float | None = None
    humidity_pct:  float | None = Field(default=None, ge=0, le=100)
    pressure_hpa:  float | None = None
    precip_mm:     float | None = Field(default=None, ge=0)
    wind_speed_ms: float | None = Field(default=None, ge=0)
    wind_gust_ms:  float | None = Field(default=None, ge=0)
    wind_dir_deg:  float | None = Field(default=None, ge=0, le=360)
    sunshine_h:    float | None = Field(default=None, ge=0)
    data_version:  int   = 1
    source:        str   = "jma"


class WeatherObservationOut(WeatherObservationIn):
    id: int
    fetched_at: datetime

    class Config:
        from_attributes = True


class MarineObservationIn(BaseModel):
    site_id:          uuid.UUID
    observed_at:      datetime
    sig_wave_h_m:     float | None = Field(default=None, ge=0)
    wave_period_s:    float | None = Field(default=None, ge=0)
    wave_dir_deg:     float | None = Field(default=None, ge=0, le=360)
    tide_level_m:     float | None = None
    current_speed_ms: float | None = Field(default=None, ge=0)
    current_dir_deg:  float | None = Field(default=None, ge=0, le=360)
    data_version:     int   = 1
    source:           str   = "jma_wave"


class MarineObservationOut(MarineObservationIn):
    id: int
    fetched_at: datetime

    class Config:
        from_attributes = True


class IngestResult(BaseModel):
    inserted: int
    updated:  int
    skipped:  int
    total:    int
