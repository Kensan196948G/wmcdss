import uuid
from datetime import date, datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, Date, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.models import Base


class Threshold(Base):
    __tablename__ = "thresholds"

    id:          Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id:     Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    work_type:   Mapped[str] = mapped_column(String, nullable=False)
    metric:      Mapped[str] = mapped_column(String, nullable=False)
    op:          Mapped[str] = mapped_column(String, nullable=False)
    value:       Mapped[float] = mapped_column(Float, nullable=False)
    severity:    Mapped[str] = mapped_column(String, nullable=False)  # warn | stop
    active_from: Mapped[date | None] = mapped_column(Date)
    active_to:   Mapped[date | None] = mapped_column(Date)
    note:        Mapped[str | None] = mapped_column(String)
    created_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at:  Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
