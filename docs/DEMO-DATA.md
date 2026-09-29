# DEMO-DATA — デモ観測値の鮮度維持とリフレッシュ

最終更新: 2026-09-29（task-7 / F5 対応）
対象: 公開 MVP（https://wmcdss-mvp.mirai-dx-platform.com）の 3 段階判定デモ

---

## 1. なぜ migration だけでは stale 化するのか

`db/migrations/0004_demo_observations.sql` と
`db/migrations/0005_demo_timeseries.sql` は、実観測が無いデモ環境でも
3 段階判定（go / caution / stop）が成立するよう、**架空の観測値**を投入します。
投入時刻は `now() - interval '10 minutes'`（気象）や
`now() - (48 - h) * interval '1 hour'`（時系列）のように **`now()` 相対**で
決まります。

ところが migration は **一度しか走りません**（`schema_migrations` に適用済みとして
記録され、以降は再実行されない）。したがって時間が経つと観測値は必ず過去へ
取り残されます。これが 2026-09-29 時点の障害の根本原因です。

判定 API（`backend/app/api/dashboard.py` の `_latest_inputs`）は 2 段の関門を
持ちます。

| 関門 | 条件 | 実装 |
| --- | --- | --- |
| 取得窓 | `observed_at >= now() - interval '24 hours'` | SQL の WHERE 句 |
| 鮮度ガード | 気象: `now() - observed_at <= 30 分` / 海象: `<= 3 時間` | `_WEATHER_FRESH` / `_MARINE_FRESH` |

45 日前のデータは取得窓の外にあり、全メトリクスが `None` になります。
`backend/app/services/decision.py` は fail-closed 設計で、
**評価できないルールが 1 件でもあれば `go` にしない**ため、結果は
「観測値が取得できないため評価できない → caution」に固定されます。

### 実際に起きた症状（2026-09-29 実測・修正前）

```
GET /api/v1/dashboard （demo JWT）
  count: 6
  status distribution: {caution: 6}
  weather_observed_at: null / marine_observed_at: null（全 6 現場）
  work_types[].evaluated: 0（全作業種別）
  reason: 観測値が取得できないため評価できないしきい値があります:
          precip_mm_1h, temperature_c。欠測のため施工可とは判定できません。
```

DB 実測:

| テーブル | source='demo' | 最新 observed_at |
| --- | --- | --- |
| `weather_observations` | 300 | 2026-08-15 20:08 |
| `marine_observations` | 250 | 2026-08-15 20:08 |

**「観測値欠測 → caution」は判定エンジンの正しい挙動です。** 壊れていたのは
判定ロジックではなく、**デモ観測値を鮮度内に保つ仕組みが存在しなかったこと**です。
0005 のコメント自身が「migration 実行直後から判定にも使える」と書いており、
時間経過で成立しなくなる設計欠陥でした。

---

## 2. リフレッシュ機構

| 成果物 | 役割 |
| --- | --- |
| `db/demo/refresh_demo_observations.sql` | 観測値を `now()` 相対で再投入する本体（冪等） |
| `scripts/wmcdss-demo-refresh.sh` | 実行ラッパー（前後の行数表示・dry-run・失敗時の非ゼロ終了） |
| `deploy/systemd/wmcdss-demo-refresh.{service,timer}` | 10 分ごとの定時実行 |
| `backend/tests/test_demo_refresh_values.py` | 値設計が 3 状態を生むことの自動検証 |

### 2.1 実行方法

```bash
# 稼働中の DB を更新（既定: docker exec wmcdss-db psql）
scripts/wmcdss-demo-refresh.sh

# 何をするかだけ確認（DB は変更しない）
scripts/wmcdss-demo-refresh.sh --dry-run

# docker compose exec 経由で実行したい場合
scripts/wmcdss-demo-refresh.sh --compose production

# SQL を直接流す場合
docker exec -i wmcdss-db psql -v ON_ERROR_STOP=1 -U wmcdss -d wmcdss \
  < db/demo/refresh_demo_observations.sql
```

環境変数で接続先を上書きできます。
`WMCDSS_DB_CONTAINER`（既定 `wmcdss-db`）/ `WMCDSS_DB_USER`（既定 `wmcdss`）/
`WMCDSS_DB_NAME`（既定 `wmcdss`）。

### 2.2 冪等性（何度実行しても行数が増えない）の設計

1. **削除対象を `source` マーカーに限定する。**
   `DELETE FROM weather_observations WHERE source IN ('demo', 'demo_series')`
   （`marine_observations` も同様）。`DROP` / `TRUNCATE` / テーブル全削除は
   一切使いません。
   - `'demo'` … 0004 / 0005 が投入した行
   - `'demo_series'` … 本リフレッシュが投入した行
   - 実測（`jma` / `jma_wave` / `nowphas` / `open_meteo_marine_info`）と
     テスト fixture（`pytest`）は **対象外**。
2. **常に同じ時刻グリッドへ再投入する。**
   時系列は `date_trunc('hour', now())` を基準に 48 時間前〜現在の 49 点、
   現在値アンカーは `now() - 10 分`（気象）/ `now() - 30 分`（海象）。
3. **UNIQUE 制約 + `ON CONFLICT DO NOTHING` を重ねる。**
   `UNIQUE (site_id, observed_at, data_version)` により、同一グリッド内での
   再実行は二重投入になりません（1. と併せて二重に守っています）。

結果として、1 現場あたり気象 50 行（時系列 49 + アンカー 1）、
海象 50 行（marine/both の 5 現場）で**一定**になります。

### 2.3 過去の `source='demo'` 行をどう扱うか（判断と理由）

**削除する（毎回入れ替える）。** 理由は 3 つあります。

1. 0004 / 0005 の行は **時刻が実行時に固定された架空値**であり、そのまま残すと
   「45 日前のデモ値」が DB に残り続け、次に誰かが鮮度切れを調査するときに
   同じ混乱を再生産する。
2. デモ表示用のデータは本リフレッシュが**同一の値設計で完全に再生成できる**
   （0005 の時系列式と 0004 のアンカー値を 1 対 1 で踏襲している）。
   つまり削除しても情報は失われない。
3. 削除対象を `source` マーカーで限定しているため、実測データを誤って消す
   リスクが構造的に無い。

`source='demo'` の既存行を「履歴として残す」案も検討しましたが、
48 時間より古い点はどの画面・どの判定からも参照されない（判定は最新 1 点、
時系列グラフも直近 48 時間）ため、残す価値がありません。

---

## 3. 値設計の意図

`db/migrations/0002_seed_demo.sql` のグローバル既定しきい値（11 件）に対し、
6 現場それぞれで「どこが基準を超えるか」を変えています。
**値は 0004 / 0005 から一切変更していません。**

| 現場 | 種別 | 現在値（アンカー） | 判定 | 発火する主なしきい値 |
| --- | --- | --- | --- | --- |
| TYO-01 東京港臨海現場 | marine | 気温22.0 / 風速4.0 / 波高0.4m | **go** | なし（全ルール評価済みでクリア） |
| TYO-02 羽田D滑走路工事 | marine | 風速11.0 / 波高1.2m | **stop** | crane warn(10) / marine_lift warn(1.0) / marine_dive stop(0.5) |
| TYO-03 横浜本牧埠頭改修 | marine | 波高1.8m | **stop** | marine_lift stop(1.5) / marine_dive stop(0.5) |
| TYO-04 千葉袖ケ浦海上工事 | marine | 降水12.0mm/h | **stop** | concrete warn(3) + stop(10) |
| TYO-05 木更津陸上ヤード | land | 気温33.0℃ | **caution** | concrete warn(30) |
| TYO-06 川崎港岸壁築造 | both | 風速16.0 / 波高0.7m | **stop** | crane warn(10)+stop(15) / marine_lift stop(12) / marine_dive stop |

現場代表ステータスは `dashboard.py` の仕様どおり **work_type ごとの最悪ケース**です。

> **TYO-02 が caution ではなく stop になる理由（設計の帰結でありバグではない）**
> 0004 は TYO-02 を「crane だけ見れば caution（風速 11 m/s、warn 10 / stop 15）」
> として設計しています。しかし種別が `marine` のため `marine_lift` と
> `marine_dive` も判定対象で、`marine_dive` は波高 0.5 m 以上で stop、
> 0004 の波高は 1.2 m です。したがって現場代表は stop になります。
> **crane 単独では caution** であることを
> `backend/tests/test_demo_refresh_values.py::test_crane_caution_design_is_intact`
> が固定しています。この挙動を変えたい場合は値ではなく
> しきい値設計（marine_dive の基準）を見直す話であり、本ドキュメントの範囲外です。

### 3.1 自動検証

```bash
cd backend && python3 -m pytest tests/test_demo_refresh_values.py -q
```

DB を使わずに、`0002` のサイト・しきい値、リフレッシュ SQL のアンカー値、
そして**本番と同一の判定エンジン** `app.services.decision.evaluate` を組み合わせて
「6 現場に go / caution / stop が現れる」ことを検証します。
コメントの主張ではなく実装で確かめている点が重要です（今回の障害は
「コメントには判定に使えると書いてあるが実際は欠測」だったため）。

---

## 4. 定時実行の導入手順（user timer）

unit ファイルは `deploy/systemd/` に追加済みですが、**このリポジトリでは
install（`enable`）していません。** 導入手順の詳細は
`deploy/systemd/README.md` の「🧪 デモ観測リフレッシュ」節を参照してください。

要点だけ:

```bash
set -a; . ~/.config/wmcdss/deploy.env; set +a   # WMCDSS_HOME が唯一のパス源
mkdir -p ~/.config/systemd/user
cp "$WMCDSS_HOME"/deploy/systemd/wmcdss-demo-refresh.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now wmcdss-demo-refresh.timer
systemctl --user list-timers 'wmcdss-demo-refresh*'
```

### 頻度を 10 分にした理由

鮮度ガードは気象 30 分 / 海象 3 時間です。10 分間隔なら **1 回失敗しても
次の実行までに 30 分を超えません**（2 回連続失敗で初めて caution 固定に戻る）。
5 分間隔は鮮度ガードに対して余裕が過剰で、DELETE + 49 点再投入の無駄が増える
だけです。発火分を `:05` にずらしているのは、AMeDAS（`:00/:10/:20`）と
NOWPHAS（`:20`）の取り込みと重ねないためです。

---

## 5. 復旧の確認手順

```bash
# 1. 事前バックアップ（必須）
docker exec wmcdss-db pg_dump -U wmcdss -d wmcdss | gzip > backups/wmcdss_pre_demo_refresh_$(date +%Y%m%d_%H%M%S).sql.gz
gzip -t backups/wmcdss_pre_demo_refresh_*.sql.gz

# 2. リフレッシュ
scripts/wmcdss-demo-refresh.sh

# 3. demo JWT を取得（WMCDSS_AUTH_BYPASS=true の環境でのみ 200）
TOK=$(curl -fsS -X POST http://127.0.0.1:18003/api/v1/auth/demo-login \
        -H 'Content-Type: application/json' -d '{}' \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 4. 判定分布を確認（go / caution / stop が揃っていること）
curl -fsS http://127.0.0.1:18003/api/v1/dashboard -H "Authorization: Bearer $TOK" \
| python3 -c '
import sys,json,collections
d=json.load(sys.stdin)
print(dict(collections.Counter(s["status"] for s in d["sites"])))
for s in d["sites"]:
    print(s["code"], s["status"], s["weather_fresh"], s["marine_fresh"])
'
```

期待値（2026-09-29 実測）:

```
{'go': 1, 'caution': 1, 'stop': 4}
TYO-01 go       w_fresh=True m_fresh=True
TYO-02 stop     w_fresh=True m_fresh=True
TYO-03 stop     w_fresh=True m_fresh=True
TYO-04 stop     w_fresh=True m_fresh=True
TYO-05 caution  w_fresh=True m_fresh=False   # land のため海象なし
TYO-06 stop     w_fresh=True m_fresh=True
```

### 「caution 固定」に戻ったときの切り分け

1. `weather_observed_at` / `marine_observed_at` が `null` か?
   → 鮮度切れ。タイマーが動いているか確認する。
   `systemctl --user list-timers 'wmcdss-demo-refresh*'` /
   `journalctl --user -u wmcdss-demo-refresh.service -n 50`
2. `latest_weather` は出ているが `work_types[].evaluated` が 0 か?
   → しきい値側の問題（`thresholds` の有効期間 `active_from` / `active_to`）。
3. 一部の現場だけ caution か?
   → その現場の `demo_series` 行が欠けている可能性。
   `select count(*) from weather_observations where source='demo_series'`
   が 300 前後であることを確認する。

---

## 6. 注意（やってはいけないこと）

- **`db/migrations/0001`〜`0005` を書き換えない。**
  変更すると `schema_migrations` に記録された checksum と食い違い、
  migration runner が `migrate up` を停止します。鮮度維持は
  `db/demo/refresh_demo_observations.sql`（migration ではない）で行います。
- **`DROP` / `TRUNCATE` / テーブル全削除をしない。**
  削除は `source IN ('demo','demo_series')` の行だけに限定します。
- **docker コンテナの再起動・削除・再作成をしない**（他の利用者・検証と衝突する）。
- `source='pytest'` の行はテスト fixture です。リフレッシュは触れません。
- 本デモデータは**全て架空値**であり、実在する観測・会社・人物とは無関係です。

---

## 7. 残存リスク・既知の制約

| 項目 | 内容 |
| --- | --- |
| タイマー未導入 | `deploy/systemd/` の unit は追加済みだが未 `enable`。**導入するまで手動実行か、誰かが別途導入するまで再び stale 化しうる。** |
| デモ専用 | 実測 ETL（JMA / NOWPHAS）が動き出した場合、`demo_series` を削除して実測へ切り替える判断が必要。現状 DB に実測行は 0 件。 |
| 45 日前の履歴は消える | 0004/0005 が入れた 2026-08-13〜15 の時系列はリフレッシュ時に削除される（意図した動作、§2.3 参照）。 |
| `reason` の既定文 | ~~`backend/app/api/dashboard.py` は `worst` が `go` のまま変わらない場合、`worst_reason` が初期値「しきい値が設定されていません」のまま残る。~~ **2026-09-29 修正済み**: `worst_reason` を `None` で初期化し、最初に評価できた作業種別の reason を採用、より悪い status が出たら上書き。評価済み作業種別が 0 件のときだけ既定文へフォールバックする。回帰は `backend/tests/test_dashboard_summary.py`（7 tests）が固定。 |
| 公開 URL の目視 | API は公開 URL（`https://wmcdss-mvp.mirai-dx-platform.com/api/v1/dashboard`）経由でも go/caution/stop が揃うことを実測済み。**ブラウザ画面の確認も 2026-09-29 に実施**（Playwright Firefox を headless 実行。デモ自動ログインでログイン画面を経由せずダッシュボードへ到達、1.48 秒）。ただしこの確認で**フロント側の別問題**（初回ロードで `/api/v1/dashboard` を取得しない・ヘッダーの件数がモック由来・現場名がモック由来）を検出した。画面表示の最終確定はその修正の反映後に行うこと。 |
