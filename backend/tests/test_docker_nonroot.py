from __future__ import annotations

from pathlib import Path

_DOCKERFILE = Path(__file__).parents[1] / "Dockerfile"


def test_production_target_runs_as_nonroot():
    """production ターゲットは非root (appuser) で実行する。

    dev ターゲットは bind mount (./backend:/app) 前提のため非root化しない。
    権限最小化は本番イメージの責務である。
    """
    lines = _DOCKERFILE.read_text().splitlines()
    prod_user_line = None
    for i, ln in enumerate(lines):
        if ln.strip().startswith("FROM base AS production"):
            # production ターゲット内の最初の USER を探す
            for j in range(i + 1, len(lines)):
                if lines[j].strip().startswith("USER "):
                    prod_user_line = lines[j].strip()
                    break
                if lines[j].strip().startswith("FROM "):
                    break
            break
    assert prod_user_line is not None, "expected USER in production target"
    assert "appuser" in prod_user_line, f"expected USER appuser, got: {prod_user_line}"
    # dev ターゲット内に USER があると bind mount 環境で書き込み不能になる
    dev_has_user = False
    for i, ln in enumerate(lines):
        if ln.strip().startswith("FROM base AS dev"):
            for j in range(i + 1, len(lines)):
                if lines[j].strip().startswith("USER "):
                    dev_has_user = True
                    break
                if lines[j].strip().startswith("FROM "):
                    break
            break
    assert not dev_has_user, "dev target must not switch to non-root (bind mount)"


def test_dockerfile_expose_and_healthcheck_preserved():
    text = _DOCKERFILE.read_text()
    assert "EXPOSE 8000" in text
    assert "HEALTHCHECK" in text
    assert "--proxy-headers" in text or "--reload" in text