import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel


class DecisionRequest(BaseModel):
    site_id: uuid.UUID
    work_type: str
    target_window_start: datetime
    target_window_end:   datetime


class DecisionOut(BaseModel):
    id: uuid.UUID
    site_id: uuid.UUID
    work_type: str
    target_window_start: datetime
    target_window_end: datetime
    status: Literal["go", "caution", "stop"]
    reason: str
    inputs: dict[str, Any]
    thresholds_snapshot: dict[str, Any]
    generated_at: datetime

    class Config:
        from_attributes = True
