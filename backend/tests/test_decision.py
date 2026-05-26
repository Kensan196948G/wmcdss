from app.services.decision import ThresholdRule, evaluate


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


def test_unknown_metric_is_ignored():
    r = evaluate(work_type="concrete",
                 inputs={"weird_metric": 999}, rules=_rules())
    assert r.status == "go"


def test_missing_value_is_ignored():
    r = evaluate(work_type="concrete",
                 inputs={"precip_mm_1h": None, "temperature_c": 18.0}, rules=_rules())
    assert r.status == "go"


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


def test_invalid_operator_is_silently_skipped():
    rules = [
        ThresholdRule("x", "v", "~~", 1.0, "stop"),
        ThresholdRule("x", "v", ">=", 5.0, "warn"),
    ]
    r = evaluate(work_type="x", inputs={"v": 10.0}, rules=rules)
    assert r.status == "caution"
    assert len(r.matched_rules) == 1
    assert r.matched_rules[0]["op"] == ">="


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
    assert "施工可" in r.reason


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
