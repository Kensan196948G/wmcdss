"""Pure decision engine — no DB, no HTTP, no clock.

Given observations / forecast values and a threshold ruleset, return a
worst-case status with human-readable Japanese reasoning.

判定できなかったルールが 1 件でもあれば、結果は `go` にしない。
評価対象のルールが存在しない場合も同じ扱いにする。理由は「評価していない」
ことと「評価して問題が無かった」ことが、施工現場では全く別の意味を持つため
（詳細は `_finalize` の docstring）。

「no clock」は現在時刻を**読まない**という意味であり、時刻を扱わないという
意味ではない。`is_rule_in_effect` はしきい値の有効期間と施工時間帯の重なりを
判定するが、比較対象の日時はすべて引数で受け取る。呼び出し側が
`datetime.now()` を渡すか判定対象の施工時間帯を渡すかは呼び出し側の責任で、
本モジュールはその決定に関与しない（実際の選択は `api/decisions.py` を参照）。
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

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

# しきい値の有効期間 (active_from / active_to) は date 型で、現場担当者が
# 「日本の暦日」として入力する。一方、判定対象の施工時間帯は timestamptz なので
# 比較の前に JST の暦日へ落とす。UTC のまま比較すると JST 00:00〜09:00 の
# 施工時間帯が前日扱いになり、有効期間の初日・最終日で 1 日ずれる。
# 既存の JMA 取り込み (services/jma.py:25, services/jma_wave.py:34) と同じ規約。
JST = ZoneInfo("Asia/Tokyo")


def as_utc(dt: datetime) -> datetime:
    """naive な datetime を UTC とみなして aware にする。aware ならそのまま返す。

    `DecisionRequest.target_window_*` は素の `datetime` 型で、timezone 指定の
    無い日時 (`"2026-05-27T06:00:00"`) も受理される。この「naive は UTC」規則を
    ここ 1 箇所に置き、API 境界で 1 回だけ適用する。

    規則を分散させてはならない理由は 2 つある。

    1. **片側だけ naive だと比較が `TypeError` になる。** 呼び出し側が正規化を
       忘れた経路で 500 になる。
    2. **同一リクエスト内で同じ値が 2 つの時刻を指す。** 判定に使う日時だけを
       正規化して永続化・監査ログを素通しにすると、監査記録の
       `"2026-05-27T06:00:00"` にオフセットが無く、後から判定を再構成できない。
       監査ログは判定の再構成が目的なので、これは記録として成立しない。

    aware な値は offset を変換せずそのまま返す（最小変更）。JST 暦日への変換は
    `is_rule_in_effect` が `.astimezone(JST)` で行うため、offset が UTC 以外でも
    結果は変わらない。
    """
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def is_rule_in_effect(
    *,
    active_from: date | None,
    active_to: date | None,
    window_start: datetime,
    window_end: datetime,
) -> bool:
    """しきい値の有効期間が判定対象の施工時間帯と重なるなら True。

    意味論は以下のとおり。

    - **NULL は「無期限」**。`active_from` が NULL なら過去方向に無制限、
      `active_to` が NULL なら未来方向に無制限。`db/migrations/0002_seed_demo.sql`
      の INSERT は両列を指定しないため既定データは全行 NULL であり、
      本関数を通しても既存の判定結果は変わらない。
    - **両端 inclusive**。`active_to` は date 型かつ "to"（"until" / "before"
      ではない）命名で「その日まで有効」を意味する。3/31 までの冬季基準は
      3/31 当日に発火しなければならない。
    - **期間どうしの「重なり」**で判定する。施工時間帯が有効期間の境界を跨ぐ
      場合、一部でも重なればルールを適用する。跨ぎを除外すると境界日の判定から
      しきい値が消えるため、安全側に倒れない。

    naive な datetime は UTC とみなす（`as_utc`）。本関数は純粋関数として単体でも
    呼べる必要があるため、呼び出し側が正規化済みでも重ねて適用する（冪等）。
    正規化の規則そのものは `as_utc` に一本化しており、ここには複製しない。
    """
    window_start = as_utc(window_start)
    window_end = as_utc(window_end)

    start_jst = window_start.astimezone(JST).date()
    end_jst = window_end.astimezone(JST).date()

    if active_from is not None and active_from > end_jst:
        return False    # 施工時間帯が終わった後に有効化されるルール
    if active_to is not None and active_to < start_jst:
        return False    # 施工時間帯が始まる前に失効しているルール
    return True


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
    # 有効期間外として判定対象から外したルール。`unevaluated_rules` が
    # 「評価しようとして失敗した」ものであるのに対し、こちらは「そもそも
    # 評価対象ではなかった」もので、意味が異なるため別に持つ。除外の事実を
    # 残さないと「しきい値は設定されているのに発火しなかった」理由が監査から
    # 消え、有効期間の設定ミスと未設定を事後に区別できなくなる。
    out_of_effect_rules: list[dict] = field(default_factory=list)


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
    out_of_effect: Iterable[dict] = (),
) -> DecisionResult:
    """Return the worst-case status for `work_type` given numeric `inputs`.

    `out_of_effect` は呼び出し側が有効期間外として既に除外したルールの
    スナップショット。判定そのものには使わず、「しきい値は存在するが期間外」
    と「しきい値が未設定」を理由文で区別するためだけに参照する（`_finalize`）。
    """
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

    out_of_effect_list = list(out_of_effect)
    status, reasons = _finalize(
        work_type=work_type, status=status, reasons=reasons,
        unevaluated=unevaluated, applicable=applicable,
        out_of_effect=out_of_effect_list,
    )
    return DecisionResult(
        status=status,
        reason="\n".join(reasons),
        matched_rules=matched,
        unevaluated_rules=unevaluated,
        evaluated_count=applicable - len(unevaluated),
        out_of_effect_rules=out_of_effect_list,
    )


def _finalize(
    *,
    work_type: str,
    status: str,
    reasons: list[str],
    unevaluated: list[dict],
    applicable: int,
    out_of_effect: list[dict],
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
        # 「未設定」と「設定はあるが有効期間外」を混同しない。前者への案内は
        # 「しきい値を設定してください」だが、後者で同じ文を出すと、既にある
        # 設定に気づかず重複登録され、有効期間の意図がさらに崩れる。
        if out_of_effect:
            reasons.append(
                f"作業種別「{work_type}」のしきい値は {len(out_of_effect)} 件設定されて"
                "いますが、いずれも判定対象期間には有効ではありません（有効期間外）。"
                "判定根拠が無いため施工可とは判定できません。"
                "しきい値の有効期間 (active_from / active_to) を確認してください。"
            )
        else:
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
