# syntax=docker/dockerfile:1.7
# WMCDSS backend image — bake dependencies into image layer.
#
# Why: previously docker-compose ran `pip install -e .` on every container start.
# Adding a new dependency (e.g. prometheus_client) required a manual container
# restart, which was easy to forget and broke the API silently. By installing
# deps at image build time, restarting the container alone is enough to recover,
# and missing deps become a build-time error rather than a runtime ImportError.
#
# Volume mount note: docker-compose mounts ./backend over /app at runtime, so
# the editable install (`pip install -e .`) in the image stays valid because
# pyproject.toml structure remains identical — the package directory just
# becomes the live source tree.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Tokyo

WORKDIR /app

# Layer 1 (rarely changes): install Python deps.
# Provide a minimal package skeleton so setuptools can resolve the editable
# install at build time. The skeleton is overwritten by `COPY . .` below and
# by the compose volume mount at runtime.
COPY pyproject.toml ./
RUN mkdir -p app && touch app/__init__.py \
    && pip install --upgrade pip \
    && pip install -e ".[dev]"

# Layer 2 (changes per commit): source code.
COPY . .

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD python -c "import http.client,sys; c=http.client.HTTPConnection('localhost',8000,timeout=2); c.request('GET','/readyz'); sys.exit(0 if c.getresponse().status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
