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
