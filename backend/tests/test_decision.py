import json
import time
from datetime import date, datetime, timedelta, timezone

from app.services.decision import (
    REASON_ALL_CLEAR,
    UNEVALUATED_MISSING_VALUE,
    UNEVALUATED_UNKNOWN_OP,
    ThresholdRule,
    as_utc,
    evaluate,
    is_rule_in_effect,
)


def _rules():
    return [
        ThresholdRule("concrete", "precip_mm_1h",  ">=", 3.0,  "warn"),
        ThresholdRule("concrete", "precip_mm_1h",  ">=", 10.0, "stop"),
        ThresholdRule("concrete", "temperature_c", "<",  4.0,  "warn"),
        ThresholdRule("marine_lift", "sig_wave_h_m", ">=", 1.5, "stop"),
    ]


def test_concrete_go():
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": 0.0, "temperature_c": 18.0}, rules=_rules())
    assert r.status == "go"


def test_concrete_caution_light_rain():
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": 5.0, "temperature_c": 15.0}, rules=_rules())
    assert r.status == "caution"


def test_concrete_stop_heavy_rain():
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": 12.0, "temperature_c": 15.0}, rules=_rules())
    assert r.status == "stop"


def test_concrete_caution_low_temp():
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": 0.0, "temperature_c": 2.0}, rules=_rules())
    assert r.status == "caution"


def test_marine_lift_stop_when_waves_too_high():
    r = evaluate(work_type="marine_lift",
                 inputs={"sig_wave_h_m": 1.8}, rules=_rules())
    assert r.status == "stop"


def test_no_relevant_inputs_degrades_to_caution():
    """必要な観測値が 1 つも揃わないとき「施工可」と断言してはならない。

    以前はこの入力で status="go" ／ 理由「全しきい値を満たしています。施工可。」
    を返していた。concrete の 3 ルールは 1 件も評価されていないのに「全て
    満たした」と断言する状態で、ETL 停止中や観測行がまだ無い site でそのまま
    発生する。
    """
    r = evaluate(work_type="concrete",
                 inputs={"weird_metric": 999}, rules=_rules())
    assert r.status == "caution"
    assert r.evaluated_count == 0
    assert len(r.unevaluated_rules) == 3
    assert all(u["unevaluated_reason"] == UNEVALUATED_MISSING_VALUE
               for u in r.unevaluated_rules)
    # 素の "施工可" では検査にならない。否定文「施工可とは判定できません」が
    # 部分文字列として含むため。断言文そのものが出ていないことを見る。
    assert REASON_ALL_CLEAR not in r.reason


def test_partially_missing_value_degrades_to_caution():
    """一部だけ欠測した場合も go にはしない。評価できた分の評価は残す。"""
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": None, "temperature_c": 18.0}, rules=_rules())
    assert r.status == "caution"
    assert r.evaluated_count == 1                     # temperature_c の 1 件のみ
    assert {u["metric"] for u in r.unevaluated_rules} == {"precip_mm_1h"}
    assert "precip_mm_1h" in r.reason
    assert REASON_ALL_CLEAR not in r.reason


def test_worst_case_when_warn_and_stop_both_match():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 12.0, "temperature_c": 2.0},
        rules=_rules(),
    )
    assert r.status == "stop"
    assert len(r.matched_rules) == 3


def test_boundary_equal_triggers_ge():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 3.0, "temperature_c": 18.0},
        rules=_rules(),
    )
    assert r.status == "caution"


def test_boundary_below_does_not_trigger_ge():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 2.9999, "temperature_c": 18.0},
        rules=_rules(),
    )
    assert r.status == "go"


def test_other_work_type_rules_are_ignored():
    r = evaluate(
        work_type="concrete",
        inputs={"sig_wave_h_m": 3.0, "precip_mm_1h": 0.0, "temperature_c": 18.0},
        rules=_rules(),
    )
    assert r.status == "go"
    assert r.matched_rules == []


def test_all_operators_supported():
    rules = [
        ThresholdRule("op_test", "v",  "<",  10.0, "warn"),
        ThresholdRule("op_test", "v",  "<=", 20.0, "warn"),
        ThresholdRule("op_test", "v",  ">",  30.0, "warn"),
        ThresholdRule("op_test", "v",  ">=", 40.0, "warn"),
        ThresholdRule("op_test", "v",  "==", 50.0, "warn"),
        ThresholdRule("op_test", "v",  "!=", 60.0, "warn"),
    ]
    assert evaluate(work_type="op_test", inputs={"v": 5.0},  rules=rules).status == "caution"
    assert evaluate(work_type="op_test", inputs={"v": 20.0}, rules=rules).status == "caution"
    assert evaluate(work_type="op_test", inputs={"v": 35.0}, rules=rules).status == "caution"
    assert evaluate(work_type="op_test", inputs={"v": 45.0}, rules=rules).status == "caution"
    assert evaluate(work_type="op_test", inputs={"v": 50.0}, rules=rules).status == "caution"
    assert evaluate(work_type="op_test", inputs={"v": 99.0}, rules=rules).status == "caution"


def test_invalid_operator_is_recorded_not_silently_skipped():
    """演算子が不正なルールは無かったことにせず、記録して理由文にも出す。

    op は API schema の Literal と DB の CHECK 制約で守られているため、
    ここへ到達するのは直接 SQL や seed で書き込まれた場合に限られる。
    そのとき当該ルールは永久に無効化されるが、以前は誰にも気づかれなかった。
    """
    rules = [
        ThresholdRule("x", "v", "~~", 1.0, "stop"),
        ThresholdRule("x", "v", ">=", 5.0, "warn"),
    ]
    r = evaluate(work_type="x", inputs={"v": 10.0}, rules=rules)
    assert r.status == "caution"
    assert len(r.matched_rules) == 1
    assert r.matched_rules[0]["op"] == ">="
    assert len(r.unevaluated_rules) == 1
    assert r.unevaluated_rules[0]["unevaluated_reason"] == UNEVALUATED_UNKNOWN_OP
    assert "演算子" in r.reason


def test_unknown_severity_falls_back_to_caution():
    rules = [ThresholdRule("x", "v", ">=", 1.0, "mystery")]
    r = evaluate(work_type="x", inputs={"v": 2.0}, rules=rules)
    assert r.status == "caution"


def test_matched_rules_include_observed_value():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 7.5, "temperature_c": 18.0},
        rules=_rules(),
    )
    assert r.status == "caution"
    assert r.matched_rules[0]["observed"] == 7.5
    assert r.matched_rules[0]["metric"] == "precip_mm_1h"
    assert r.matched_rules[0]["severity"] == "warn"


def test_reason_contains_note_when_present():
    rules = [
        ThresholdRule("x", "v", ">=", 1.0, "warn", note="冬期は要注意"),
    ]
    r = evaluate(work_type="x", inputs={"v": 2.0}, rules=rules)
    assert "冬期は要注意" in r.reason
    assert "v=2.0" in r.reason


def test_reason_for_all_go_states_施工可():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 0.0, "temperature_c": 18.0},
        rules=_rules(),
    )
    assert REASON_ALL_CLEAR in r.reason
    # 「施工可」と言えるのは、適用対象の 3 件を実際に全部評価できたときだけ。
    assert r.evaluated_count == 3
    assert r.unevaluated_rules == []


# ---------------------------------------------------------------------------
# fail-open の封じ込め（PR-D）
#
# 元の実装は、評価できないルールを黙って読み飛ばして status を初期値 "go" の
# まま返していた。倒れる先が go（＝施工可）である以上これは fail-safe ではなく
# fail-open であり、施工判断支援システムとしては最も危険な壊れ方になる。
# 以下は「評価していないなら go とは言わない」という不変条件を固定する。
# ---------------------------------------------------------------------------

def test_no_rules_for_work_type_degrades_to_caution():
    """しきい値が未設定なのは「安全」ではなく「未判定」である。"""
    r = evaluate(work_type="unconfigured_work",
                 inputs={"precip_mm_1h": 0.0}, rules=_rules())
    assert r.status == "caution"
    assert r.evaluated_count == 0
    assert r.unevaluated_rules == []      # 適用対象が無いので「評価失敗」でもない
    assert "1 件も設定されていません" in r.reason
    # 「未設定」と「有効期間外」は別の案内文でなければならない（R-1）。
    assert "有効期間外" not in r.reason


def test_marine_lift_missing_wave_height_is_not_go():
    """海上揚重で波高が欠測したら施工可にしない — 本 PR の中心的な不変条件。"""
    r = evaluate(work_type="marine_lift",
                 inputs={"sig_wave_h_m": None}, rules=_rules())
    assert r.status == "caution"
    assert "sig_wave_h_m" in r.reason
    assert REASON_ALL_CLEAR not in r.reason


def test_stop_is_not_downgraded_by_unevaluated_rules():
    """欠測があっても、既に stop が確定しているなら stop のまま。

    未評価による格下げは go → caution の一方向だけ。欠測を理由に stop を
    緩めると、本来止めるべき判定が緩む。
    """
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": 12.0, "temperature_c": None}, rules=_rules())
    assert r.status == "stop"
    assert {u["metric"] for u in r.unevaluated_rules} == {"temperature_c"}
    assert r.evaluated_count == 2


def test_missing_data_does_not_escalate_to_stop():
    """逆に、欠測だけで stop まで上げることもしない。

    ETL の一時停止で全作業が停止扱いになると、現場は本システムを無視するか
    無効化する。そうなれば本当に止めるべき時にも止まらない。
    """
    r = evaluate(work_type="marine_lift", inputs={}, rules=_rules())
    assert r.status == "caution"


def test_snapshot_payload_is_json_serialisable():
    """thresholds_snapshot は jsonb 列へそのまま入る。永続化できる形を保つ。"""
    r = evaluate(
        work_type="concrete", inputs={}, rules=_rules(),
        # 有効期間は date 型だが、JSONB へ入る時点では ISO 文字列でなければ
        # ならない（`date` は json.dumps できない）。呼び出し側で変換する規約に
        # なっているため、その形のまま通ることをここで固定する。
        out_of_effect=[{
            "work_type": "concrete", "metric": "wind_speed_ms", "op": ">=",
            "value": 10.0, "severity": "warn", "note": None,
            "active_from": "2025-12-01", "active_to": "2026-03-31",
        }],
    )
    payload = {
        "rules": r.matched_rules,
        "unevaluated": r.unevaluated_rules,
        "out_of_effect": r.out_of_effect_rules,
        "evaluated": r.evaluated_count,
    }
    assert json.loads(json.dumps(payload)) == payload


def test_multiple_matches_listed_in_reason():
    r = evaluate(
        work_type="concrete",
        inputs={"precip_mm_1h": 12.0, "temperature_c": 2.0},
        rules=_rules(),
    )
    lines = r.reason.splitlines()
    assert len(lines) == 3
    assert any("precip_mm_1h=12" in ln for ln in lines)
    assert any("temperature_c=2" in ln for ln in lines)


# ---------------------------------------------------------------------------
# しきい値の有効期間（R-1）
#
# `active_from` / `active_to` は DDL・schema・TECHNICAL.md には存在したが、
# 判定経路では一切参照されていなかった。結果として季節別しきい値を登録すると
# 冬季基準と夏季基準が年間を通じて同時に適用され、`evaluate` は最悪値を採るため
# 常に厳しい方だけが効く。倒れる先は安全側だが、設定した意図どおりには一度も
# 動かない。以下は有効期間の意味論を固定する。
# ---------------------------------------------------------------------------

# 判定対象の施工時間帯。JST 2026-05-27 09:00〜17:00（= UTC 00:00〜08:00）。
# JST へ換算しても同一暦日に収まる、境界条件の影響を受けない基準ケース。
_WIN_START = datetime(2026, 5, 27, 0, 0, tzinfo=timezone.utc)
_WIN_END = datetime(2026, 5, 27, 8, 0, tzinfo=timezone.utc)
_DAY = date(2026, 5, 27)


def _in_effect(active_from=None, active_to=None, start=_WIN_START, end=_WIN_END):
    return is_rule_in_effect(
        active_from=active_from, active_to=active_to,
        window_start=start, window_end=end,
    )


def test_both_bounds_null_is_always_in_effect():
    """NULL は「無期限」。既存データの振る舞いを変えないことの担保。

    `db/migrations/0002_seed_demo.sql` の INSERT は両列を指定しないため、
    既定のしきい値は全行 NULL である。ここが False になる実装は、有効期間を
    設定していない全現場のしきい値を一斉に無効化する。
    """
    assert _in_effect() is True


def test_active_to_on_the_window_day_is_inclusive():
    """`active_to` 当日は有効。「3/31 まで」の冬季基準は 3/31 に発火する。

    列名が "to"（"until" / "before" ではない）かつ date 型であることから
    両端 inclusive を採る。exclusive にすると最終日だけ基準が消える。
    """
    assert _in_effect(active_to=_DAY) is True


def test_active_to_before_the_window_is_expired():
    assert _in_effect(active_to=_DAY - timedelta(days=1)) is False


def test_active_from_on_the_window_day_is_inclusive():
    assert _in_effect(active_from=_DAY) is True


def test_active_from_after_the_window_is_not_yet_effective():
    assert _in_effect(active_from=_DAY + timedelta(days=1)) is False


def test_window_straddling_a_boundary_keeps_the_rule():
    """施工時間帯が有効期間の境界を跨ぐ場合、一部でも重なればルールを適用する。

    JST 2026-05-27 20:00 〜 2026-05-28 04:00（夜間作業）を想定。跨ぎを
    除外すると、境界日の判定からしきい値が消えて安全側に倒れない。
    """
    night_start = datetime(2026, 5, 27, 11, 0, tzinfo=timezone.utc)  # JST 27日 20:00
    night_end = datetime(2026, 5, 27, 19, 0, tzinfo=timezone.utc)    # JST 28日 04:00

    # 27 日で失効するルール — 施工時間帯の前半と重なる
    assert _in_effect(active_to=_DAY, start=night_start, end=night_end) is True
    # 28 日から有効になるルール — 施工時間帯の後半と重なる
    assert _in_effect(
        active_from=_DAY + timedelta(days=1), start=night_start, end=night_end
    ) is True


def test_window_is_compared_on_the_jst_calendar_date():
    """有効期間は JST の暦日で突き合わせる。UTC のまま比べると 1 日ずれる。

    JST 2026-05-28 00:30〜06:00 の早朝作業は UTC では 05-27 の 15:30〜21:00
    であり、**UTC 日付は前日**になる。有効期間は現場担当者が日本の暦日として
    入力するため、UTC で比較すると初日・最終日の判定が 1 日分ずれる。
    """
    early_start = datetime(2026, 5, 27, 15, 30, tzinfo=timezone.utc)  # JST 28日 00:30
    early_end = datetime(2026, 5, 27, 21, 0, tzinfo=timezone.utc)     # JST 28日 06:00
    may_28 = date(2026, 5, 28)

    # 28 日から有効 — JST では初日なので有効。UTC 比較なら誤って除外される
    assert _in_effect(active_from=may_28, start=early_start, end=early_end) is True
    # 27 日で失効 — JST では既に翌日なので無効。UTC 比較なら誤って残る
    assert _in_effect(active_to=_DAY, start=early_start, end=early_end) is False


def test_naive_datetime_is_interpreted_as_utc(monkeypatch):
    """naive な datetime は「実行ホストのローカル時刻」ではなく UTC とみなす。

    `DecisionRequest.target_window_*` は素の `datetime` 型で、Z サフィックスの
    無い入力を naive のまま受理する。`datetime.astimezone()` は naive な値に
    対してシステムのローカルタイムゾーンを仮定するため、正規化を省くと判定
    結果が**サーバの TZ 設定に依存**する。同一入力・同一データで判定が変わる
    のは、監査上、判定の再構成が不可能になることを意味する。

    ホストの TZ に依存せず検証するため、TZ を UTC でも JST でもない値へ固定
    して実行する。naive 14:00 を UTC とみなせば JST 5/27 23:00（27 日）、
    ローカル (EDT = UTC-4) とみなせば JST 5/28 03:00（28 日）となり、
    下の 2 つの assert は解釈を誤ると両方とも反転する。
    """
    naive_start = datetime(2026, 5, 27, 14, 0)   # tzinfo なし
    naive_end = datetime(2026, 5, 27, 14, 30)

    try:
        monkeypatch.setenv("TZ", "America/New_York")
        time.tzset()
        assert _in_effect(active_to=_DAY, start=naive_start, end=naive_end) is True
        assert _in_effect(
            active_from=_DAY + timedelta(days=1), start=naive_start, end=naive_end
        ) is False
    finally:
        monkeypatch.undo()
        time.tzset()


# --- evaluate() 側: 「未設定」と「期間外」を取り違えない ---------------------

def _out_of_effect_snapshot():
    """API 層が有効期間外として除外したルールのスナップショット相当。"""
    return [{
        "work_type": "winter_marine_lift", "metric": "sig_wave_h_m", "op": ">=",
        "value": 1.0, "severity": "stop", "note": "冬季: 有義波高 1.0m 以上で中止",
        "active_from": "2025-12-01", "active_to": "2026-03-31",
    }]


def test_all_rules_out_of_effect_degrades_to_caution_with_a_distinct_reason():
    """しきい値はあるが全て期間外 — 「未設定」とは別の案内文で caution にする。

    ここで「しきい値を設定してください」と案内すると、担当者は既にある設定に
    気づかず重複登録する。有効期間の設定ミスが、しきい値の二重登録という
    別の障害へ発展する経路を塞ぐ。
    """
    r = evaluate(
        work_type="winter_marine_lift", inputs={"sig_wave_h_m": 0.2},
        rules=_rules(), out_of_effect=_out_of_effect_snapshot(),
    )
    assert r.status == "caution"
    assert r.evaluated_count == 0
    assert "有効期間外" in r.reason
    assert "1 件も設定されていません" not in r.reason
    assert REASON_ALL_CLEAR not in r.reason
    assert r.out_of_effect_rules == _out_of_effect_snapshot()


def test_out_of_effect_rules_do_not_affect_a_normal_judgement():
    """期間外ルールは監査へ残すだけで、判定そのものには関与しない。

    `evaluate` は最悪値を採るため、除外したはずのルールが判定へ混ざると
    R-1 の症状（季節別しきい値が年間適用される）がそのまま再発する。
    """
    r = evaluate(
        work_type="concrete", inputs={"precip_mm_1h": 0.0, "temperature_c": 18.0},
        rules=_rules(), out_of_effect=_out_of_effect_snapshot(),
    )
    assert r.status == "go"
    assert r.evaluated_count == 3            # concrete のルール 3 件のみを評価
    assert REASON_ALL_CLEAR in r.reason
    assert "有効期間外" not in r.reason      # 評価対象があるので案内は出さない
    assert r.out_of_effect_rules == _out_of_effect_snapshot()   # 監査へは残る


# ---------------------------------------------------------------------------
# as_utc — naive datetime の解釈規則
# ---------------------------------------------------------------------------

def test_as_utc_attaches_utc_to_naive():
    got = as_utc(datetime(2026, 5, 27, 6, 0))
    assert got == datetime(2026, 5, 27, 6, 0, tzinfo=timezone.utc)
    assert got.tzinfo is not None


def test_as_utc_leaves_aware_untouched():
    """aware な値は offset を変換しない（最小変更）。

    UTC へ寄せてしまうと API のレスポンスに載る値が入力と別物になる。JST 暦日
    への変換は `is_rule_in_effect` が `.astimezone(JST)` で行うため、offset が
    UTC 以外のままでも判定結果は変わらない。
    """
    jst = timezone(timedelta(hours=9))
    aware = datetime(2026, 5, 27, 15, 0, tzinfo=jst)
    assert as_utc(aware) is aware


def test_as_utc_is_idempotent():
    """境界と `is_rule_in_effect` の両方で適用されるため冪等でなければならない。"""
    once = as_utc(datetime(2026, 5, 27, 6, 0))
    assert as_utc(once) == once


def test_is_rule_in_effect_treats_naive_as_utc_at_the_jst_boundary():
    """naive `2026-03-31T16:00` は UTC 解釈 → JST 4/1 なので 3/31 までの規則は失効。

    JST 解釈だと 3/31 のままで結果が反転する。この 1 件が naive の解釈規則を
    固定している。
    """
    assert is_rule_in_effect(
        active_from=None, active_to=date(2026, 3, 31),
        window_start=datetime(2026, 3, 31, 16, 0),
        window_end=datetime(2026, 3, 31, 21, 0),
    ) is False
    # 1 分前（JST 3/31 23:59）ならまだ有効。
    assert is_rule_in_effect(
        active_from=None, active_to=date(2026, 3, 31),
        window_start=datetime(2026, 3, 31, 14, 0),
        window_end=datetime(2026, 3, 31, 14, 59),
    ) is True
