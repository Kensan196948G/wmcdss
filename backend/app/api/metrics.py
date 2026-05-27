from fastapi import APIRouter
from fastapi.responses import Response
from prometheus_client import REGISTRY, generate_latest, CONTENT_TYPE_LATEST

router = APIRouter(tags=["observability"])


@router.get("/metrics", include_in_schema=False)
async def metrics():
    """Expose Prometheus-format metrics for scraping.

    Excluded from OpenAPI schema — this endpoint is for Prometheus, not API clients.
    Exempt from API key auth (see config.auth_exempt_paths) so the Prometheus
    scraper does not need credentials.
    """
    return Response(
        content=generate_latest(REGISTRY),
        media_type=CONTENT_TYPE_LATEST,
    )
