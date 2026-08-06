import json

from app.services.decision import (
    REASON_ALL_CLEAR,
    UNEVALUATED_MISSING_VALUE,
    UNEVALUATED_UNKNOWN_OP,
    ThresholdRule,
    evaluate,
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
    r = evaluate(work_type="concrete", inputs={}, rules=_rules())
    payload = {
        "rules": r.matched_rules,
        "unevaluated": r.unevaluated_rules,
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
