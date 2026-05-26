from datetime import datetime
from sqlalchemy import BigInteger, String, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.models import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id:          Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor:       Mapped[str | None] = mapped_column(String)
    action:      Mapped[str] = mapped_column(String, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String)
    target_id:   Mapped[str | None] = mapped_column(String)
    detail:      Mapped[dict | None] = mapped_column(JSONB)
