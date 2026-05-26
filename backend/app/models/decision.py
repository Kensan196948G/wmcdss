import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models import Base


class Decision(Base):
    __tablename__ = "decisions"

    id:                  Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    work_type:           Mapped[str] = mapped_column(String, nullable=False)
    target_window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    target_window_end:   Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status:              Mapped[str] = mapped_column(String, nullable=False)   # go | caution | stop
    reason:              Mapped[str] = mapped_column(String, nullable=False)
    inputs:              Mapped[dict] = mapped_column(JSONB, nullable=False)
    thresholds_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    generated_by:        Mapped[str] = mapped_column(String, default="system")
    generated_at:        Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
