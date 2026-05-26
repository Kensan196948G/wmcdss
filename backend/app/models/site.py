import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models import Base


class Site(Base):
    __tablename__ = "sites"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code:           Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name:           Mapped[str] = mapped_column(String, nullable=False)
    kind:           Mapped[str] = mapped_column(String, nullable=False)   # land / marine / both
    lat:            Mapped[float] = mapped_column(Float, nullable=False)
    lon:            Mapped[float] = mapped_column(Float, nullable=False)
    jma_station_id: Mapped[str | None] = mapped_column(String)
    wave_grid_lat:  Mapped[float | None] = mapped_column(Float)
    wave_grid_lon:  Mapped[float | None] = mapped_column(Float)
    address:        Mapped[str | None] = mapped_column(String)
    note:           Mapped[str | None] = mapped_column(String)
    created_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:     Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
