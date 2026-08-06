from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import actor_from
from app.db.session import get_db
from app.models.observations import WeatherObservation, MarineObservation
from app.models.threshold import Threshold
from app.models.decision import Decision
from app.schemas.decision import DecisionRequest, DecisionOut
from app.services.audit import write_audit
from app.services.decision import ThresholdRule, as_utc, evaluate, is_rule_in_effect

router = APIRouter(prefix="/decisions", tags=["decisions"])


async def _load_thresholds(
    db: AsyncSession,
    site_id,
    work_type: str,
    window_start,
    window_end,
) -> tuple[list[ThresholdRule], list[dict]]:
    """`(判定に使う有効なルール, 有効期間外として除外したルールのスナップショット)`。

    有効期間を **判定対象の施工時間帯** と突き合わせる（`datetime.now()` では
    ない）。本 API は任意の時間帯を受け取り将来の施工可否も判定するため、
    「いま有効なルール」ではなく「その施工時間帯に有効なルール」で判定しないと、
    来月の施工計画を今月の基準で判定してしまう。

    有効期間の絞り込みを SQL の WHERE ではなく Python 側で行っている理由は 2 つ。

    1. **除外したルールを監査へ残すため。** SQL で落とすと「設定はあるが期間外」
       という事実が消え、事後に「なぜ発火しなかったのか」を再構成できない。
       `evaluated_count` を持たせているのと同じ理由。
    2. **意味論を 1 箇所に閉じるため。** SQL の WHERE と Python の述語へ同じ
       境界条件（inclusive / NULL の扱い / JST 変換）を二重に書くと、片方だけ
       修正される事故が起きる。加えて本リポジトリのテストは `_FakeDB` が SQL 文を
       無視して事前設定行を返す方式のため、WHERE に書いた条件は**検証されない
       まま緑になる**。

    しきい値は `(site_id, work_type)` で既に絞られており（`idx_thresholds_lookup`）
    件数が小さいため、全件取得してから絞っても実質的なコストは無い。
    """
    stmt = select(Threshold).where(
        and_(
            Threshold.work_type == work_type,
            (Threshold.site_id == site_id) | (Threshold.site_id.is_(None)),
        )
    )
    rows = (await db.execute(stmt)).scalars().all()

    active: list[ThresholdRule] = []
    out_of_effect: list[dict] = []
    for r in rows:
        if is_rule_in_effect(
            active_from=r.active_from, active_to=r.active_to,
            window_start=window_start, window_end=window_end,
        ):
            active.append(ThresholdRule(
                work_type=r.work_type, metric=r.metric, op=r.op,
                value=r.value, severity=r.severity, note=r.note,
            ))
        else:
            out_of_effect.append({
                "work_type": r.work_type, "metric": r.metric, "op": r.op,
                "value": r.value, "severity": r.severity, "note": r.note,
                # thresholds_snapshot は JSONB 列で、`date` はそのままでは
                # 直列化できない。ISO 文字列へ落としてから載せる。
                "active_from": r.active_from.isoformat() if r.active_from else None,
                "active_to":   r.active_to.isoformat()   if r.active_to   else None,
            })
    return active, out_of_effect


async def _latest_inputs(db: AsyncSession, site_id, t0, t1) -> dict[str, float | None]:
    wq = (
        select(WeatherObservation)
        .where(WeatherObservation.site_id == site_id)
        .where(WeatherObservation.observed_at.between(t0 - timedelta(hours=3), t1))
        .order_by(WeatherObservation.observed_at.desc())
    )
    mq = (
        select(MarineObservation)
        .where(MarineObservation.site_id == site_id)
        .where(MarineObservation.observed_at.between(t0 - timedelta(hours=3), t1))
        .where(or_(
            MarineObservation.source.is_(None),
            MarineObservation.source != "open_meteo_marine_info",
        ))
        .order_by(MarineObservation.observed_at.desc())
    )
    w = (await db.execute(wq)).scalars().first()
    m = (await db.execute(mq)).scalars().first()

    return {
        "temperature_c":  w.temperature_c  if w else None,
        "humidity_pct":   w.humidity_pct   if w else None,
        "precip_mm_1h":   w.precip_mm      if w else None,
        "wind_speed_ms":  w.wind_speed_ms  if w else None,
        "wind_gust_ms":   w.wind_gust_ms   if w else None,
        "sig_wave_h_m":   m.sig_wave_h_m   if m else None,
        "wave_period_s":  m.wave_period_s  if m else None,
    }


@router.post("", response_model=DecisionOut)
async def create_decision(
    req: DecisionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # 施工時間帯を API 境界で 1 回だけ UTC-aware へ正規化し、以降は正規化後の値
    # だけを使う。`DecisionRequest.target_window_*` は素の `datetime` 型のため
    # timezone 無しの日時も受理され、片側だけ naive だと直後の比較が `TypeError`
    # になって 500 を返す。加えて naive のまま素通しすると、監査ログへ
    # オフセットの無い "2026-05-27T06:00:00" が残り判定を再構成できない。
    window_start = as_utc(req.target_window_start)
    window_end = as_utc(req.target_window_end)

    if window_end <= window_start:
        raise HTTPException(400, "target_window_end must be after target_window_start")

    rules, out_of_effect = await _load_thresholds(
        db, req.site_id, req.work_type, window_start, window_end,
    )
    inputs = await _latest_inputs(db, req.site_id, window_start, window_end)
    res = evaluate(
        work_type=req.work_type, inputs=inputs, rules=rules,
        out_of_effect=out_of_effect,
    )

    decision = Decision(
        site_id=req.site_id,
        work_type=req.work_type,
        target_window_start=window_start,
        target_window_end=window_end,
        status=res.status,
        reason=res.reason,
        inputs=inputs,
        # `rules` は発火したルール、`unevaluated` は欠測や設定不正で評価できな
        # かったルール、`evaluated` は実際に評価できた件数。3 つ揃って初めて、
        # 「なぜこの判定になったか」を事後に再構成できる。
        thresholds_snapshot={
            "rules": res.matched_rules,
            "unevaluated": res.unevaluated_rules,
            # 有効期間外として判定対象から外したルール。これが無いと
            # 「しきい値が未設定」と「設定はあるが期間外」が監査上区別できない。
            "out_of_effect": res.out_of_effect_rules,
            "evaluated": res.evaluated_count,
        },
    )
    db.add(decision)
    await db.flush()

    # Audit: README promises actor + inputs + judgement are persisted on every
    # decision. The detail payload mirrors what a human would need to reconstruct
    # the decision after the fact (inputs snapshot, status, matched rules).
    await write_audit(
        db, actor=actor_from(request), action="decision.create",
        target_type="decision", target_id=str(decision.id),
        detail={
            "site_id": str(req.site_id),
            "work_type": req.work_type,
            "window": {
                # 正規化後の値を使う。naive のままだとオフセットの無い文字列が
                # 残り、監査記録から判定時刻が一意に決まらなくなる。
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
            "status": res.status,
            "reason": res.reason,
            "inputs": inputs,
            "matched_rules": res.matched_rules,
            # 欠測を理由に caution へ落ちた判定を、監査ログだけで追跡できるように
            # する。判定の根拠が「該当した」ではなく「評価できなかった」場合、
            # 事後の説明責任はこちらの側にある。
            "unevaluated_rules": res.unevaluated_rules,
            # 有効期間の設定ミスで安全側のしきい値が外れていた、という事故を
            # 事後に追跡できるようにする。判定時点でどのルールが期間外と
            # みなされたかは、後から DB を見ても再現できない（設定は変わりうる）。
            "out_of_effect_rules": res.out_of_effect_rules,
            "evaluated_rule_count": res.evaluated_count,
        },
        strict=True,
    )
    await db.commit()
    await db.refresh(decision)
    return decision
