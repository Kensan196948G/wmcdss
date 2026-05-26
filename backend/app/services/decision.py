"""Pure decision engine — no DB, no HTTP, no clock.

Given observations / forecast values and a threshold ruleset, return a
worst-case status with human-readable Japanese reasoning.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable

_OP = {
    "<":  lambda a, b: a <  b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a >  b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}

# Severity ordering (worse on the right)
_SEVERITY_ORDER = {"go": 0, "caution": 1, "stop": 2}
_SEV_FROM_THRESHOLD = {"warn": "caution", "stop": "stop"}


@dataclass(frozen=True)
class ThresholdRule:
    work_type: str
    metric: str
    op: str
    value: float
    severity: str   # 'warn' | 'stop'
    note: str | None = None


@dataclass(frozen=True)
class DecisionResult:
    status: str                # 'go' | 'caution' | 'stop'
    reason: str                # multi-line Japanese explanation
    matched_rules: list[dict]  # for thresholds_snapshot persistence


def evaluate(
    *,
    work_type: str,
    inputs: dict[str, float | None],
    rules: Iterable[ThresholdRule],
) -> DecisionResult:
    """Return the worst-case status for `work_type` given numeric `inputs`."""
    status = "go"
    reasons: list[str] = []
    matched: list[dict] = []

    for rule in rules:
        if rule.work_type != work_type:
            continue
        v = inputs.get(rule.metric)
        if v is None:
            continue
        if rule.op not in _OP:
            continue
        if _OP[rule.op](v, rule.value):
            mapped = _SEV_FROM_THRESHOLD.get(rule.severity, "caution")
            if _SEVERITY_ORDER[mapped] > _SEVERITY_ORDER[status]:
                status = mapped
            line = (
                f"{rule.metric}={v} が基準 ({rule.op}{rule.value}) に該当 "
                f"[{rule.severity}]"
            )
            if rule.note:
                line += f"  ({rule.note})"
            reasons.append(line)
            matched.append({
                "work_type": rule.work_type, "metric": rule.metric,
                "op": rule.op, "value": rule.value, "severity": rule.severity,
                "observed": v, "note": rule.note,
            })

    if status == "go":
        reasons.append("全しきい値を満たしています。施工可。")
    return DecisionResult(status=status, reason="\n".join(reasons), matched_rules=matched)
