"""デモ観測リフレッシュ SQL の「値設計」を判定エンジンに通して検証する。

`db/demo/refresh_demo_observations.sql` は、0004/0005 と同じ現場別の基準値を
`now()` 相対で再投入する。このファイルが実際に go / caution / stop の 3 状態を
生むかどうかは、**コメントの主張ではなく判定エンジンに通して**確かめなければ
ならない（過去に「観測値欠測 → 全件 caution 固定」で中核機能が壊れたまま
見逃された経緯がある）。

本テストは DB を使わない。判定に必要なのは
  - 現場コードと種別      … db/migrations/0002_seed_demo.sql
  - グローバルしきい値    … 同
  - 現場別の現在値        … db/demo/refresh_demo_observations.sql（現在値アンカー）
  - 判定ロジック          … app.services.decision（本番と同一の純関数）
の 4 つだけであり、いずれもファイルから読める。

実際の DB を使った確認（リフレッシュ 2 回連続実行・行数不変・
GET /api/v1/dashboard の応答）は運用側の手順で行う。詳細は docs/DEMO-DATA.md。
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.decision import (
    REASON_ALL_CLEAR,
    UNEVALUATED_MISSING_VALUE,
    ThresholdRule,
    evaluate,
    is_rule_in_effect,
)

# 0002 の既定しきい値は active_from / active_to が NULL（＝無期限）なので
# 有効期間の判定は常に True になる。それでも判定 API と同じ手順を通すのは、
# 「有効期間で除外されたルール」を判定対象に混ぜていないことをテストでも
# 明示するため。
_RULE_WINDOW = timedelta(hours=3)

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_SQL = REPO_ROOT / "db" / "migrations" / "0002_seed_demo.sql"
REFRESH_SQL = REPO_ROOT / "db" / "demo" / "refresh_demo_observations.sql"

# dashboard.py が現場種別ごとに判定する作業種別。dashboard.py 自体は他担当の
# ファイルなので import せず、ここに同じ対応表を写して期待値を固定する。
# （この対応表が変わったら判定対象が変わるため、テストが気付けるようにする。）
WORK_TYPES_BY_KIND = {
    "land": ("concrete", "crane"),
    "marine": ("concrete", "crane", "marine_lift", "marine_dive", "marine_transport"),
    "both": ("concrete", "crane", "marine_lift", "marine_dive", "marine_transport"),
}

# 現場ごとに「ダッシュボード代表ステータス（最悪ケース）」として期待する値。
# これが go だけ / caution だけに偏ると、デモの中核機能が成立しない。
#
# TYO-02 が caution ではなく stop なのは設計の帰結であり、バグではない:
#   0004 の TYO-02 は気象を風速 11 m/s（crane warn 10m/s → caution 狙い）で
#   設計しているが、同じ現場は marine/both として marine_lift も判定され、
#   marine_lift には「風速 12m/s 以上で中止」より手前の
#   「有義波高 1.0m 以上で注意」がある。0004 の海象値は波高 1.2m なので、
#   marine_lift が stop（波高 1.5m 以上）に到達しないまでも
#   marine_dive（波高 0.5m 以上で stop）が発火する。dashboard は
#   work_type ごとの最悪ケースを現場代表とするため、TYO-02 は stop になる。
#   （0005 の時系列でも TYO-02 の基準波高は 1.2m で同じ。）
#   「crane だけを見れば caution」であることは
#   test_crane_caution_design_is_intact で別途固定する。
EXPECTED_SITE_STATUS = {
    "TYO-01": "go",
    "TYO-02": "stop",
    "TYO-03": "stop",
    "TYO-04": "stop",
    "TYO-05": "caution",
    "TYO-06": "stop",
}

# dashboard.py と同じ severity 順序。現場の代表ステータスは最悪ケース。
_SEVERITY = {"go": 0, "caution": 1, "stop": 2}

INSERT_RE = re.compile(r"INSERT INTO\s+(weather|marine)_observations\b", re.IGNORECASE)
SELECT_RE = re.compile(r"SELECT\s+id\s*,(.*?)FROM\s+sites\s+WHERE\s+code\s*=\s*'([^']+)'", re.IGNORECASE | re.DOTALL)
SITES_RE = re.compile(
    r"INSERT INTO sites\s*\([^)]*\)\s*VALUES(.*?)ON CONFLICT",
    re.IGNORECASE | re.DOTALL,
)
SITE_ROW_RE = re.compile(
    r"\(\s*'([A-Z0-9\-]+)'\s*,\s*'[^']*'\s*,\s*'(land|marine|both)'",
)
THRESHOLD_ROW_RE = re.compile(
    r"\(\s*(NULL|'[^']*')\s*,\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'(<=|>=|<|>|==|!=)'\s*,\s*"
    r"([0-9.]+)\s*,\s*'(warn|stop)'\s*,",
)

# 現在値アンカー（SELECT id, now() - interval ...）の値並び。
WEATHER_ANCHOR_METRICS = (
    "temperature_c",
    "humidity_pct",
    "pressure_hpa",
    "precip_mm",
    "wind_speed_ms",
    "wind_gust_ms",
    "wind_dir_deg",
    "sunshine_h",
)
MARINE_ANCHOR_METRICS = (
    "sig_wave_h_m",
    "wave_period_s",
    "wave_dir_deg",
    "tide_level_m",
    "current_speed_ms",
    "current_dir_deg",
)


def _split_top_level_values(text: str) -> list[str]:
    """`(a, b, c), (d, e, f)` のような VALUES 本体を括弧単位で分割する。"""
    rows: list[str] = []
    depth = 0
    start: int | None = None
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
            if depth == 1:
                start = i + 1
        elif ch == ")":
            depth -= 1
            if depth == 0 and start is not None:
                rows.append(text[start:i])
                start = None
    return rows


def parse_sites(sql: str) -> dict[str, str]:
    """0002 の sites INSERT から code -> kind を取り出す。"""
    m = SITES_RE.search(sql)
    assert m, "0002_seed_demo.sql の sites INSERT を解析できませんでした"
    return {code: kind for code, kind in SITE_ROW_RE.findall(m.group(1))}


def parse_global_thresholds(sql: str) -> list[ThresholdRule]:
    """0002 のグローバル既定しきい値（site_id IS NULL）を取り出す。"""
    rules: list[ThresholdRule] = []
    for site_id, work_type, metric, op, value, severity in THRESHOLD_ROW_RE.findall(sql):
        if site_id.upper() != "NULL":
            continue    # 現場別上書きは 0002 には存在しない
        rules.append(ThresholdRule(
            work_type=work_type, metric=metric, op=op,
            value=float(value), severity=severity, note=None,
        ))
    return rules


def _parse_offset(token: str) -> float:
    """`now() - interval '10 minutes'` から分数を取り出す。"""
    m = re.search(r"interval\s+'(\d+)\s*(minutes?|hours?)'", token, re.IGNORECASE)
    assert m, f"interval を解析できませんでした: {token!r}"
    amount = float(m.group(1))
    return amount * 60 if m.group(2).lower().startswith("hour") else amount


def _parse_anchor_select(body: str, n_values: int) -> tuple[str, list[float]]:
    """`now() - interval '10 minutes', 22.0, 60.0, ...` の部分を値リストにする。

    先頭要素は SQL の式（now() 相対）、残りは数値リテラル。
    """
    parts = [p.strip() for p in body.split(",")]
    assert len(parts) >= n_values, f"アンカー行の値が足りません: {body!r}"
    return parts[0], [float(p) for p in parts[1 : n_values + 1]]


def parse_weather_anchors(sql: str) -> dict[str, tuple[str, list[float]]]:
    out: dict[str, tuple[str, list[float]]] = {}
    for m in SELECT_RE.finditer(sql):
        # INSERT 種別は直前の INSERT 文から判断する
        prefix = sql[: m.start()]
        kind = INSERT_RE.findall(prefix)[-1].lower()
        if kind != "weather":
            continue
        expr, values = _parse_anchor_select(m.group(1), len(WEATHER_ANCHOR_METRICS))
        out[m.group(2)] = (expr, values)
    return out


def parse_marine_anchors(sql: str) -> dict[str, tuple[str, list[float]]]:
    out: dict[str, tuple[str, list[float]]] = {}
    for m in SELECT_RE.finditer(sql):
        prefix = sql[: m.start()]
        kind = INSERT_RE.findall(prefix)[-1].lower()
        if kind != "marine":
            continue
        expr, values = _parse_anchor_select(m.group(1), len(MARINE_ANCHOR_METRICS))
        out[m.group(2)] = (expr, values)
    return out


@pytest.fixture(scope="module")
def refresh_sql() -> str:
    return REFRESH_SQL.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def seed_sql() -> str:
    return SEED_SQL.read_text(encoding="utf-8")


def _site_inputs(
    code: str,
    weather: dict[str, tuple[str, list[float]]],
    marine: dict[str, tuple[str, list[float]]],
) -> dict[str, float | None]:
    """dashboard.py の _latest_inputs と同じキー名で入力 dict を組む。"""
    inputs: dict[str, float | None] = {
        "temperature_c": None, "humidity_pct": None, "precip_mm_1h": None,
        "wind_speed_ms": None, "wind_gust_ms": None,
        "sig_wave_h_m": None, "wave_period_s": None,
    }
    if code in weather:
        _, w = weather[code]
        mapped = dict(zip(WEATHER_ANCHOR_METRICS, w, strict=True))
        inputs.update({
            "temperature_c": mapped["temperature_c"],
            "humidity_pct": mapped["humidity_pct"],
            # SQL の precip_mm 列は判定入力では precip_mm_1h として扱われる
            "precip_mm_1h": mapped["precip_mm"],
            "wind_speed_ms": mapped["wind_speed_ms"],
            "wind_gust_ms": mapped["wind_gust_ms"],
        })
    if code in marine:
        _, m = marine[code]
        mapped = dict(zip(MARINE_ANCHOR_METRICS, m, strict=True))
        inputs.update({
            "sig_wave_h_m": mapped["sig_wave_h_m"],
            "wave_period_s": mapped["wave_period_s"],
        })
    return inputs


def test_refresh_sql_exists_and_is_not_a_migration():
    assert REFRESH_SQL.is_file(), f"リフレッシュ SQL が存在しません: {REFRESH_SQL}"
    # db/migrations/ に置くと migration runner が拾い、checksum 管理下に入る。
    # 「再実行可能な投入」は migration ではないので db/demo/ に置く。
    assert REFRESH_SQL.parent.name != "migrations"
    assert REFRESH_SQL.parent == REPO_ROOT / "db" / "demo"


def _strip_sql_comments(sql: str) -> str:
    """SQL 本文からコメントを除去する。

    「TRUNCATE は使わない」という説明文自身を禁止操作として検出しないため、
    検査は必ずコメント除去後に行う。
    """
    without_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return re.sub(r"--[^\n]*", " ", without_block)


def test_refresh_sql_is_rerunnable_by_design(refresh_sql: str):
    """再実行しても行が無限に増えない構造であることを SQL 本文で確認する。"""
    code = _strip_sql_comments(refresh_sql)
    upper = code.upper()
    # 自スクリプト由来のマーカーだけを削除する
    assert re.search(
        r"DELETE\s+FROM\s+weather_observations\s+WHERE\s+source\s+IN\s*\(\s*'demo'\s*,\s*'demo_series'\s*\)",
        code, re.IGNORECASE,
    ), "weather_observations の DELETE が source マーカー限定になっていません"
    assert re.search(
        r"DELETE\s+FROM\s+marine_observations\s+WHERE\s+source\s+IN\s*\(\s*'demo'\s*,\s*'demo_series'\s*\)",
        code, re.IGNORECASE,
    ), "marine_observations の DELETE が source マーカー限定になっていません"
    # 全削除・スキーマ破壊は禁止（コメント除去後の本文だけを見る）
    for forbidden in (
        "TRUNCATE", "DROP TABLE", "DROP DATABASE", "DROP SCHEMA",
        "DELETE FROM SITES", "DELETE FROM THRESHOLDS",
        "DELETE FROM USERS", "DELETE FROM DECISIONS",
    ):
        assert forbidden not in upper, f"禁止操作が含まれています: {forbidden}"
    # 削除対象は source マーカーの IN 句のみ（DELETE の個数も固定する）
    assert upper.count("DELETE FROM") == 2
    # 時系列は now() 相対の固定グリッドで、実行のたびに同じ時刻へ再投入される
    assert "date_trunc('hour', now())" in code
    # 二重投入を防ぐ最後の砦: 気象 6 + 海象 5 = 11 本の時系列 INSERT と、
    # 現在値アンカー 6 + 5 = 11 本の合計 22 本すべてに付いている。
    assert upper.count("ON CONFLICT (SITE_ID, OBSERVED_AT, DATA_VERSION) DO NOTHING") == 22, (
        "全 INSERT に ON CONFLICT DO NOTHING が付いていません"
    )
    assert upper.count("INSERT INTO WEATHER_OBSERVATIONS") == 12   # 時系列 6 + アンカー 6
    assert upper.count("INSERT INTO MARINE_OBSERVATIONS") == 10    # 時系列 5 + アンカー 5


def test_weather_and_marine_anchors_meet_freshness_guard(refresh_sql: str):
    """気象は 30 分以内・海象は 3 時間以内のアンカーを必ず持つ。"""
    weather = parse_weather_anchors(refresh_sql)
    marine = parse_marine_anchors(refresh_sql)

    assert set(weather) == {"TYO-01", "TYO-02", "TYO-03", "TYO-04", "TYO-05", "TYO-06"}
    # land の TYO-05 だけ海象アンカーを持たない（0004/0005 と同じ設計）
    assert set(marine) == {"TYO-01", "TYO-02", "TYO-03", "TYO-04", "TYO-06"}

    for code, (expr, _) in weather.items():
        offset = _parse_offset(expr)
        assert offset <= 30, f"{code}: 気象アンカーが鮮度ガード(30分)を超えています: {expr}"
    for code, (expr, _) in marine.items():
        offset = _parse_offset(expr)
        assert offset <= 180, f"{code}: 海象アンカーが鮮度ガード(3時間)を超えています: {expr}"


def test_series_covers_48_hours_for_charts(refresh_sql: str):
    """時系列は 49 点（0..48）で 48 時間分あり、グラフが空にならない。"""
    assert refresh_sql.count("generate_series(0, 48)") == 11, (
        "気象 6 + 海象 5 = 11 本の generate_series(0, 48) が必要です"
    )


def test_global_thresholds_unchanged(seed_sql: str):
    """0002 のグローバル既定しきい値が 11 件のままであること（他担当の前提）。"""
    rules = parse_global_thresholds(seed_sql)
    assert len(rules) == 11
    assert {r.work_type for r in rules} == {
        "concrete", "crane", "marine_lift", "marine_dive", "marine_transport",
    }


def test_anchor_values_produce_three_states(refresh_sql: str, seed_sql: str):
    """本番と同じ判定エンジンで、6 現場に go / caution / stop が現れる。"""
    sites = parse_sites(seed_sql)
    rules = parse_global_thresholds(seed_sql)
    weather = parse_weather_anchors(refresh_sql)
    marine = parse_marine_anchors(refresh_sql)

    assert set(sites) == set(EXPECTED_SITE_STATUS)

    statuses: dict[str, str] = {}
    now = datetime.now(timezone.utc)
    for code, kind in sites.items():
        inputs = _site_inputs(code, weather, marine)
        work_types = WORK_TYPES_BY_KIND[kind]
        worst = "go"
        for wt in work_types:
            active = [
                r for r in rules
                if r.work_type == wt
                and is_rule_in_effect(
                    active_from=None, active_to=None,
                    window_start=now - _RULE_WINDOW, window_end=now,
                )
            ]
            if not active:
                continue
            res = evaluate(work_type=wt, inputs=inputs, rules=active)
            # 欠測で caution に落ちていないこと（fail-closed は正しい挙動だが、
            # デモの現在値アンカーは全メトリクスを埋めているはず）
            assert not any(
                u["unevaluated_reason"] == UNEVALUATED_MISSING_VALUE
                for u in res.unevaluated_rules
            ), f"{code}/{wt}: 欠測メトリクスがあります: {res.unevaluated_rules}"
            assert res.evaluated_count > 0
            if _SEVERITY[res.status] > _SEVERITY[worst]:
                worst = res.status
        statuses[code] = worst

    assert statuses == EXPECTED_SITE_STATUS, (
        f"ダッシュボード代表ステータスが設計と一致しません: {statuses}"
    )
    # 3 状態すべてが現れる（1 状態しか出ないデモは中核機能が成立していない）
    assert set(statuses.values()) == {"go", "caution", "stop"}


def test_three_states_appear_across_sites(refresh_sql: str, seed_sql: str):
    """go / caution / stop が「別々の現場」に現れる（同一現場内の偏りではない）。

    判定 API が返すのは現場代表（最悪ケース）1 つなので、全現場が同じ
    ステータスだと 3 段階判定は画面上成立しない。現場横断で 3 状態が
    揃うことをここで固定する。
    """
    sites = parse_sites(seed_sql)
    rules = parse_global_thresholds(seed_sql)
    weather = parse_weather_anchors(refresh_sql)
    marine = parse_marine_anchors(refresh_sql)

    per_site: dict[str, str] = {}
    for code, kind in sites.items():
        inputs = _site_inputs(code, weather, marine)
        worst = "go"
        for wt in WORK_TYPES_BY_KIND[kind]:
            active = [r for r in rules if r.work_type == wt]
            if not active:
                continue
            res = evaluate(work_type=wt, inputs=inputs, rules=active)
            if _SEVERITY[res.status] > _SEVERITY[worst]:
                worst = res.status
        per_site[code] = worst

    for state in ("go", "caution", "stop"):
        codes = [c for c, s in per_site.items() if s == state]
        assert codes, f"状態 {state} を返す現場が 1 つもありません: {per_site}"


def test_crane_caution_design_is_intact(refresh_sql: str, seed_sql: str):
    """TYO-02 は crane 単独では caution（0004 の 11 m/s 設計が生きている）。

    現場代表が stop になるのは marine_dive の stop によるもので、
    crane の caution 設計そのものが壊れたわけではないことを固定する。
    """
    rules = parse_global_thresholds(seed_sql)
    inputs = _site_inputs(
        "TYO-02", parse_weather_anchors(refresh_sql), parse_marine_anchors(refresh_sql)
    )
    crane = [r for r in rules if r.work_type == "crane"]
    res = evaluate(work_type="crane", inputs=inputs, rules=crane)
    assert res.status == "caution", res.reason
    assert "wind_speed_ms=11.0" in res.reason


def test_go_site_reports_all_clear(refresh_sql: str, seed_sql: str):
    """TYO-01 は go であり、理由文が「施工可」の断定文であること。"""
    rules = parse_global_thresholds(seed_sql)
    weather = parse_weather_anchors(refresh_sql)
    marine = parse_marine_anchors(refresh_sql)
    inputs = _site_inputs("TYO-01", weather, marine)

    reasons = []
    for wt in ("concrete", "crane", "marine_lift", "marine_dive", "marine_transport"):
        active = [r for r in rules if r.work_type == wt]
        res = evaluate(work_type=wt, inputs=inputs, rules=active)
        assert res.status == "go", f"TYO-01/{wt} が go ではありません: {res.reason}"
        reasons.append(res.reason)
    assert all(REASON_ALL_CLEAR in r for r in reasons)
