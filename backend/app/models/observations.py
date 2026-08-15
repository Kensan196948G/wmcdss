import uuid
from datetime import datetime
from sqlalchemy import BigInteger, String, Float, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models import Base


class WeatherObservation(Base):
    __tablename__ = "weather_observations"

    id:            Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id:       Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    observed_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    humidity_pct:  Mapped[float | None] = mapped_column(Float)
    pressure_hpa:  Mapped[float | None] = mapped_column(Float)
    precip_mm:     Mapped[float | None] = mapped_column(Float)
    wind_speed_ms: Mapped[float | None] = mapped_column(Float)
    wind_gust_ms:  Mapped[float | None] = mapped_column(Float)
    wind_dir_deg:  Mapped[float | None] = mapped_column(Float)
    sunshine_h:    Mapped[float | None] = mapped_column(Float)
    fetched_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    data_version:  Mapped[int] = mapped_column(Integer, default=1)
    source:        Mapped[str] = mapped_column(String, default="jma")


class MarineObservation(Base):
    __tablename__ = "marine_observations"

    id:               Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    observed_at:      Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sig_wave_h_m:     Mapped[float | None] = mapped_column(Float)
    wave_period_s:    Mapped[float | None] = mapped_column(Float)
    wave_dir_deg:     Mapped[float | None] = mapped_column(Float)
    tide_level_m:     Mapped[float | None] = mapped_column(Float)
    current_speed_ms: Mapped[float | None] = mapped_column(Float)
    current_dir_deg:  Mapped[float | None] = mapped_column(Float)
    station_code:     Mapped[str | None] = mapped_column(String)
    fetched_at:       Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    data_version:     Mapped[int] = mapped_column(Integer, default=1)
    source:           Mapped[str] = mapped_column(String, default="jma_wave")
