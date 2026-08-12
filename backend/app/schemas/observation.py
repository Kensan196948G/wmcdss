import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class WeatherObservationIn(BaseModel):
    site_id:       uuid.UUID
    observed_at:   datetime
    # 物理的にあり得る範囲を API 境界で検証する。観測装置の故障値や誤投入が
    # 判定エンジンへ混入すると誤判定につながるため、ここで弾く。
    temperature_c: float | None = Field(default=None, ge=-60, le=60)
    humidity_pct:  float | None = Field(default=None, ge=0, le=100)
    pressure_hpa:  float | None = Field(default=None, ge=800, le=1100)
    precip_mm:     float | None = Field(default=None, ge=0, le=2000)
    wind_speed_ms: float | None = Field(default=None, ge=0, le=120)
    wind_gust_ms:  float | None = Field(default=None, ge=0, le=150)
    wind_dir_deg:  float | None = Field(default=None, ge=0, le=360)
    sunshine_h:    float | None = Field(default=None, ge=0, le=24)
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
    sig_wave_h_m:     float | None = Field(default=None, ge=0, le=50)
    wave_period_s:    float | None = Field(default=None, ge=0, le=60)
    wave_dir_deg:     float | None = Field(default=None, ge=0, le=360)
    tide_level_m:     float | None = Field(default=None, ge=-10, le=10)
    current_speed_ms: float | None = Field(default=None, ge=0, le=20)
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
