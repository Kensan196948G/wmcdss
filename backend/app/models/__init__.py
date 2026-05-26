from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


from app.models.site import Site  # noqa: E402,F401
from app.models.observations import WeatherObservation, MarineObservation  # noqa: E402,F401
from app.models.threshold import Threshold  # noqa: E402,F401
from app.models.decision import Decision  # noqa: E402,F401
from app.models.audit import AuditLog  # noqa: E402,F401
