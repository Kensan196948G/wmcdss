import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class SiteCreate(BaseModel):
    code: str = Field(..., max_length=32)
    name: str
    kind: Literal["land", "marine", "both"]
    lat:  float = Field(..., ge=-90, le=90)
    lon:  float = Field(..., ge=-180, le=180)
    jma_station_id: str | None = None
    address: str | None = None
    note:    str | None = None


class SiteOut(SiteCreate):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
