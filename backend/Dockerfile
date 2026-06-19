# syntax=docker/dockerfile:1.7
# WMCDSS backend image.
#
# Targets:
#   production: runtime dependencies only, no reload watcher.
#   dev:        dev/test dependencies plus uvicorn --reload.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Tokyo

WORKDIR /app

COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --upgrade pip \
    && pip install -e "."

FROM base AS production
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD python -c "import http.client,sys; c=http.client.HTTPConnection('localhost',8000,timeout=2); c.request('GET','/readyz'); sys.exit(0 if c.getresponse().status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

FROM base AS dev
RUN pip install -e ".[dev]"
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD python -c "import http.client,sys; c=http.client.HTTPConnection('localhost',8000,timeout=2); c.request('GET','/readyz'); sys.exit(0 if c.getresponse().status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
