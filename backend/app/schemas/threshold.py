import uuid
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field


class ThresholdBase(BaseModel):
    site_id:     uuid.UUID | None = None
    work_type:   str = Field(..., max_length=32)
    metric:      str = Field(..., max_length=64)
    op:          Literal["<", "<=", ">", ">=", "==", "!="]
    value:       float
    severity:    Literal["warn", "stop"]
    active_from: date | None = None
    active_to:   date | None = None
    note:        str | None = None


class ThresholdCreate(ThresholdBase):
    pass


class ThresholdUpdate(BaseModel):
    work_type:   str | None = None
    metric:      str | None = None
    op:          Literal["<", "<=", ">", ">=", "==", "!="] | None = None
    value:       float | None = None
    severity:    Literal["warn", "stop"] | None = None
    active_from: date | None = None
    active_to:   date | None = None
    note:        str | None = None


class ThresholdOut(ThresholdBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
