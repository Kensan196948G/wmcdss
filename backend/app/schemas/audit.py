from datetime import datetime
from typing import Any
from pydantic import BaseModel


class AuditOut(BaseModel):
    id: int
    occurred_at: datetime
    actor: str | None
    action: str
    target_type: str | None
    target_id: str | None
    detail: dict[str, Any] | None

    class Config:
        from_attributes = True
