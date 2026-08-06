"""Pure decision engine — no DB, no HTTP, no clock.

Given observations / forecast values and a threshold ruleset, return a
worst-case status with human-readable Japanese reasoning.

判定できなかったルールが 1 件でもあれば、結果は `go` にしない。
評価対象のルールが存在しない場合も同じ扱いにする。理由は「評価していない」
ことと「評価して問題が無かった」ことが、施工現場では全く別の意味を持つため
（詳細は `_finalize` の docstring）。
"""
from __future__ import annotations
from dataclasses import dataclass, field
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

# ルールを評価できなかった理由。監査で機械的に集計できるよう定数にしている。
UNEVALUATED_MISSING_VALUE = "missing_value"     # 観測値が無い（ETL 停止・欠測）
UNEVALUATED_UNKNOWN_OP = "unknown_operator"     # しきい値設定の演算子が不正

# 「施工して良い」と本システムが断言する唯一の文。定数にしているのは、
# 否定側の理由文（「施工可とは判定できません」）が部分文字列として "施工可" を
# 含むため、テストが素朴な substring 検査では両者を区別できないからである。
# この文が出ているかどうかが、そのまま fail-open が再発していないかの指標になる。
REASON_ALL_CLEAR = "全しきい値を満たしています。施工可。"


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
    # 評価できなかったルール。既定値付きで末尾に置いているのは、
    # DecisionResult(status, reason, matched) という位置指定の生成を壊さないため。
    unevaluated_rules: list[dict] = field(default_factory=list)
    # 実際に評価できたルール件数。`matched_rules` は発火したルールしか残さない
    # ため、これが無いと「しきい値が 0 件」と「N 件全部クリア」が監査上まったく
    # 同じ `{"rules": []}` になり、事後に判定を再構成できない。
    evaluated_count: int = 0


def _rule_snapshot(rule: ThresholdRule, **extra) -> dict:
    return {
        "work_type": rule.work_type, "metric": rule.metric,
        "op": rule.op, "value": rule.value, "severity": rule.severity,
        "note": rule.note, **extra,
    }


def _at_least_caution(status: str) -> str:
    """`go` だけを `caution` へ引き上げる。`stop` は下げない。

    欠測時に `stop` まで上げない理由は運用にある。ETL の一時停止で全作業が
    停止扱いになると、現場は本システムを無視するか無効化する。そうなれば
    本当に止めるべき時にも止まらない。「断定しない」ところまでで止める。
    """
    return "caution" if _SEVERITY_ORDER[status] < _SEVERITY_ORDER["caution"] else status


def _dedup(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


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
    unevaluated: list[dict] = []
    applicable = 0

    for rule in rules:
        if rule.work_type != work_type:
            continue
        applicable += 1

        v = inputs.get(rule.metric)
        if v is None:
            unevaluated.append(_rule_snapshot(rule, unevaluated_reason=UNEVALUATED_MISSING_VALUE))
            continue
        if rule.op not in _OP:
            unevaluated.append(_rule_snapshot(rule, unevaluated_reason=UNEVALUATED_UNKNOWN_OP))
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
            matched.append(_rule_snapshot(rule, observed=v))

    status, reasons = _finalize(
        work_type=work_type, status=status, reasons=reasons,
        unevaluated=unevaluated, applicable=applicable,
    )
    return DecisionResult(
        status=status,
        reason="\n".join(reasons),
        matched_rules=matched,
        unevaluated_rules=unevaluated,
        evaluated_count=applicable - len(unevaluated),
    )


def _finalize(
    *,
    work_type: str,
    status: str,
    reasons: list[str],
    unevaluated: list[dict],
    applicable: int,
) -> tuple[str, list[str]]:
    """未評価があれば `go` を封じ、理由文へ何が評価できなかったかを書く。

    元の実装は評価できないルールを黙って読み飛ばし、`status` を初期値 `"go"`
    のまま「全しきい値を満たしています。施工可。」と返していた。観測行が
    1 件も無い site や ETL 停止中は `_latest_inputs` が全メトリクスを None で
    返すため、**一件も評価していないのに「全て満たした」と断言する**状態に
    なる。海上揚重で波高が欠測したときに「施工可」と出るのは、施工判断支援
    システムとして最悪の壊れ方であるため、ここで打ち切る。
    """
    if applicable == 0:
        reasons.append(
            f"作業種別「{work_type}」に対するしきい値が 1 件も設定されていません。"
            "判定根拠が無いため施工可とは判定できません。しきい値を設定してください。"
        )
        return _at_least_caution(status), reasons

    if unevaluated:
        missing = _dedup(
            u["metric"] for u in unevaluated
            if u["unevaluated_reason"] == UNEVALUATED_MISSING_VALUE
        )
        bad_op = _dedup(
            f"{u['metric']}({u['op']})" for u in unevaluated
            if u["unevaluated_reason"] == UNEVALUATED_UNKNOWN_OP
        )
        if missing:
            reasons.append(
                f"観測値が取得できないため評価できないしきい値があります: {', '.join(missing)}。"
                "欠測のため施工可とは判定できません。現地確認のうえ判断してください。"
            )
        if bad_op:
            reasons.append(
                f"比較演算子が不正なしきい値があります: {', '.join(bad_op)}。"
                "設定を修正するまでこのルールは評価されません。"
            )
        return _at_least_caution(status), reasons

    if status == "go":
        reasons.append(REASON_ALL_CLEAR)
    return status, reasons
