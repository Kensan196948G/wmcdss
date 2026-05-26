# 📊 WMCDSS — プロジェクトステータス（オフライン Projects 代替）

> このファイルは GitHub Projects と等価の役割を担う **ローカル可視化ボード** です。
> `git remote` 未設定環境のため、ここを Single Source of Truth とし、remote 構成後は
> GitHub Projects に転写します。

最終更新: **2026-05-27**（Loop 23 — `admin-pages.jsx → src/admin-pages.tsx` ESM port 着地）
リリース絶対期限: **2026-11-25** （登録から 6 ヶ月後 — CLAUDE.md 絶対厳守）
残日数: **約 182 日（Month 1 中盤）**
GitHub: [`Kensan196948G/wmcdss`](https://github.com/Kensan196948G/wmcdss) ／ [Project v2 #29](https://github.com/users/Kensan196948G/projects/29) ／ [Milestone #1 Production Release](https://github.com/Kensan196948G/wmcdss/milestone/1)

---

## 🎯 期間内マイルストーン

| フェーズ | 期間 | 状態 | 主要成果 |
|---|---|:--:|---|
| Month 1〜2 — 基盤整備 | 〜2026-07-25 | 🟢 進行中 | DB スキーマ ✅ ／ API ✅ ／ JMA ingest ✅ ／ Auth ✅ ／ Audit ✅ ／ CI ✅ |
| Month 3〜4 — 品質向上 | 〜2026-09-25 | ⚪ 未着手 | E2E ／ Codex+CodeRabbit 自動レビュー組込 ／ モニタリング |
| Month 5 — 統合テスト | 〜2026-10-25 | ⚪ 未着手 | 実現場 1 件で運用試験 |
| Month 6 — リリース準備 | 〜2026-11-25 | ⚪ 未着手 | CHANGELOG ／ タグ ／ 本番移行 |

---

## 🧱 コンポーネント別ステータス

| レイヤ | 進捗 | 直近コミット | 残課題 |
|---|:--:|---|---|
| 🐍 Backend API | 🟢 100% | `3dce51d` | OpenAPI exposure env-gated ✅／レート制限 ✅／API key 認証 ✅ |
| 🗄️ DB マイグレーション | 🟢 100% | `95a64d5` | 本番マイグレーションリハ未実施 |
| ⏱️ JMA Ingester | 🟢 100% | `3ebf8fa` | AMeDAS + marine 分離完了。実 timer での連続稼働ログ／wave URL 実機検証 (Month 5) |
| 🔐 Auth / Audit | 🟢 100% | (docs only) | 鍵ローテーション運用フロー定義済み（SECURITY.md §5）。actor 漏洩経路除去＋strict audit 適用済み |
| 🖥️ Frontend | 🟡 99% | `9d32a92` | Vite scaffold ✅／Phase 1 `api.ts` + `charts.tsx` + `data.ts` + `decisions.tsx` + `dashboard.tsx` + `weather-marine.tsx` + `analysis.tsx` + `admin-pages.tsx` ESM 化 ✅／残: app.jsx (root) の ESM 移植・残 3 Page コンポーネント (site-pages.jsx の SiteListPage / SiteRegisterPage / SiteDetailPage) + TweaksPanel・E2E |
| 🛠️ Infra (compose / systemd) | 🟢 95% | `96aab85` | `.env.production.example` 作成済 — `.env.production` は gitignore で保護 |
| 🤖 CI | 🟢 100% | `ff725b8` | 三段ジョブ all green ／setup-node@v6 で Node 24 runtime 化。Codex/CodeRabbit 連携 (#4) のみ残課題 |
| 📚 Docs | 🟢 95% | `fc49421` | ARCHITECTURE.md §9 CI 二段構え追加済み |

---

## 🔄 進行中ループ — Monitor → Build → Verify → Improve

| 回 | フェーズ | 内容 | 結果 |
|---:|---|---|:--:|
| 1 | Build | audit hardening + smoke 9 件 + CI gate | ✅ 5c3f700 |
| 2 | Improve | README に CI バッジ／API 表更新／テスト件数 23+9／STATUS.md 新設 | ✅ fc49421 |
| 3 | Monitor → Build | git remote 設定／Issue 4 件生成／Project v2 #29 連携／Milestone #1 設定 | ✅ B1/B3 解消 |
| 4 | Verify | CI run `26466286004` ✅ 28s — ruff + pytest both green | ✅ |
| 5 | Improve | audit hardening — `_actor` API Key 漏洩除去／`write_audit(strict=True)` ／unit +9 (23→32) | ✅ |
| 6 | Build → Verify | CI Node 20 deprecation — `checkout@v5`／`setup-python@v6`／run `26467039494` 23s green／Issue #3 closed | ✅ 5c80fe7 |
| 7 | Build | `.env.production.example` 新設＋`.gitignore` で `.env.production` 保護（B4 解消） | ✅ 96aab85 |
| 8 | Build → Verify | marine ingester 分離（Issue #2）— `jma_wave` service + `ingest_jma_marine` job + hourly timer + unit テスト +9 件 (32→41)／CI run `26467717952` 28s green／Issue #2 closed | ✅ 3ebf8fa |
| 9 | Build → Verify | RateLimitMiddleware 導入 — sliding window deque ／identity = `sha256(X-API-Key)[:16]` or IP ／CORS→RateLimit→APIKey の三段／unit +10 件 (41→51) all green ／CI run `26468154402` 30s green | ✅ b17aa2e |
| 10 | Build → Verify | CI smoke verify ジョブ追加 — `backend-smoke` job が compose 起動 → `/readyz` ポーリング → `pytest tests/test_api_smoke.py` (9 件) を実行。`needs: backend-unit` で純関数 fail を先に弾く二段構え。初回 push で exit 127 (`pytest` 未インストール) → dev extras を container 内に layered install するステップ追加 → CI run `26468562824` で unit 23s + smoke 40s 双方 green | ✅ 6d7b200 |
| 11 | Build → Verify | OpenAPI 本番公開ポリシー — `WMCDSS_EXPOSE_OPENAPI` (default true) ／false で `openapi_url=docs_url=redoc_url=None` を渡し `/openapi.json`・`/docs`・`/redoc` を 404 化。「dev open, prod locked」を `api_keys=[]` と同様の env スイッチで実装。unit +4 件 (51→55) — default-on / disabled / `/healthz` 残存 / `/` endpoints list 残存 を分離検証。`importlib.reload(main_mod)` で FastAPI ctor の `openapi_url` 固定をフィクスチャで覆す構造。CI run `26468982461` unit 24s + smoke 48s 双方 green | ✅ 3dce51d |
| 12 | Build | Vite Phase 0 scaffold (#1) — `frontend/vite-app/` に React 18 + Vite 6 + TS の toolchain を作成。既存 Babel Standalone (`frontend/index.html`) は無傷で fallback として残す方針。`npm run build` 検証: 26 modules transformed → **gzip 46.67 kB / 568ms**（既存構成は babel.min.js だけで ~3MB ロード）。`.gitignore` で node_modules + dist 除外、`package-lock.json` は commit して Phase 1 CI で再現可能性を担保。Phase 1 で `../*.jsx` を ES module として移植予定 | ✅ dc89b0b |
| 13 | Build → Verify | CI `frontend-build` ジョブ追加 — Phase 1 で `.jsx` を ESM 化する前に **gating を先に整備**。Node 22 + `npm ci` (lockfile-pinned) + `npm run build`。`needs:` なしで `backend-unit` と並走 → 壁時計時間据え置き。CI run `26469645882` で **frontend 9s ／ unit 26s ／ smoke 40s** all green。CI 産出物 `index-CkP53_s4.js` がローカルビルドとハッシュ一致 → reproducibility 確認済み。**新規 deprecation 警告: `actions/setup-node@v4` 内部 Node 20 runtime (2026-09-16 削除)** — Loop 14 で `@v5` 検証予定 (B6 候補) | ✅ d1978ed |
| 14 | Build → Verify | `actions/setup-node@v4 → @v6` バンプ — v5 で Node 24 runtime 化、v6 で npm auto-cache 縮退（明示指定済みなので無影響）。setup-python@v6 と対称化。CI run `26469869759` で **frontend 9s ／ unit 27s ／ smoke 46s** all green、annotations 0 件 → **deprecation 警告完全消滅で B6 解消**。9 月 16 日の Node 20 ランタイム削除前に窓を閉じた | ✅ ff725b8 |
| 15 | Build → Verify | Phase 1 narrow ESM port — `frontend/api.jsx`（5.7 KB IIFE）を `frontend/vite-app/src/api.ts`（TS 化 + named exports）に複製。**dual surface**: ESM exports（後続 .jsx → .tsx 移植先用）＋ `window.WMCDSS_API` / `WMCDSS_API_BASE` 副作用（Babel Standalone fallback 互換）。`App.jsx` から `import { WMCDSS_API_BASE }` で参照し tree-shake 回避。Bundle 影響: **26 → 27 modules / gzip 46.67 → 48.15 kB (+1.48 kB)**。CI run `26470239874` で **frontend 11s ／ unit 29s ／ smoke 48s** all green。ローカル/CI 双方で hash 完全一致 (`index-DhTHn0se.js / 148.14 kB`) — reproducibility 維持。最小 blast radius で原本 `api.jsx` は無傷（並列稼働 = Phase 2 で旧版引退） | ✅ 738587c |
| 16 | Improve (docs) | 鍵ローテーション運用フロー定義 — `docs/SECURITY.md` §5 を「将来課題」プレースホルダから 9 ステップ無停止ローテ runbook（90 日サイクル）＋緊急ローテ（漏洩時）＋ロールバック 4 行表＋audit 照会例の正本に置換。`§5.1 設計前提` で `@lru_cache get_settings` ⇒ 再起動必須／`restart: unless-stopped` で validation crash 自動復旧／512 byte 上限を明示。新 `§6 将来課題` に bcrypt ハッシュ保存・401 連発 short-ban・mTLS/OAuth2・キー世代 audit 紐付けを移送。**ドライブバイ修正**: `.env.production.example` の制約コメント "max 1024 bytes per key" は誤り（実装は `_MAX_KEY_LEN = 512`）→ 512 bytes に訂正、"non-ASCII rejected at startup" も per-request fail-closed の実装に合わせて修正。Docs-only につき CI 非対象 | ✅ 4a8b37a |
| 17 | Build → Verify | Phase 1 leaf-node ESM port — `frontend/charts.jsx`（5 SVG components + ChartColors palette、依存ゼロの leaf）を `frontend/vite-app/src/charts.tsx`（335 行 TS 化 + 完全型付け）に複製。**dual surface**: `LineChart` / `BarChart` / `WindRose` / `Sparkline` / `GaugeMeter` の named exports（後続 .tsx 移植先用）＋ `Object.assign(window, { LineChart, ... })` 副作用（Babel Standalone fallback 互換）。型ポート中に **silent bug 2 件を発見＆修正**: ① `threshAngle && marker` の truthy check は threshold=0 で marker が描かれない（`threshAngle !== null` に変更）／② `angles[dirs.indexOf(d.dir)] || angles[0]` は北 (index 0 = 0° = falsy) で常時 north fallback（`??` に変更）。`App.jsx` から `import { ChartColors }` で参照し tree-shake 回避（api.ts と同パターン）。Bundle 影響: **27 → 28 modules / gzip 48.15 → 50.08 kB (+1.93 kB)**。CI run `26470877797` で **frontend 9s ／ unit 26s ／ smoke 51s** all green。leaf-first 戦略を採用した理由は依存ゼロ＝既存 caller を一切壊さない最小 blast radius のため（decisions.jsx は api.ts に依存、dashboard.jsx は charts.tsx に依存 → Phase 1 後半は dual-surface の caller 側検証として活用） | ✅ 42b237e |
| 18 | Build → Verify | Phase 1 leaf-node ESM port — `frontend/data.jsx`（6 sites + decision logic、`Math`/`window` のみに依存する leaf）を `frontend/vite-app/src/data.ts`（331 行 TS 化 + 完全型付け）に複製。**13 named exports**: `SITES` / `generateWeather` / `generateMarine` / `FORECAST_DAYS` / `WEATHER_ICONS` / `generateHourlyWind` / `generateHourlyWave` / `generateHistoricalMonthly` / `AUDIT_LOG` / `ETL_JOBS` / `STATUS_LABEL` / `STATUS_CLASS` / `TYPE_LABEL` / `getDecision`。**dual surface**: ESM + `Object.assign(window, { ... })`（Babel Standalone fallback 互換）。型ポート中に **暗黙契約を明示化**: `SiteThresholds.waveHeight: number \| null`（旧 .jsx は `m.waveHeight > undefined === false` で偶然動いていた → `getDecision` に `waveLimit !== null` 明示 gate を挿入、land 海象比較を構造的に遮断）。**Exhaustive maps**: `Record<WeatherKind, string>` / `Record<Status, string>` / `Record<SiteKind, string>` で将来の追加（例: 雷）が compile error になる構造に。`App.jsx` から `import { SITES }` で参照し tree-shake 回避（marine/land 内訳カウンタを表示）。Bundle 影響: **28 → 29 modules / gzip 50.08 → 52.96 kB (+2.88 kB)**。CI run `26471283441` で **frontend 9s ／ unit 24s ／ smoke 44s** all green。これで Phase 1 leaf 3 件（api / charts / data）全完了 — Phase 2 では decisions.jsx / dashboard.jsx が完全 ESM 依存チェーン上で移植可能に | ✅ 4fdcfba |
| 19 | Build → Verify | Phase 1 **branch-node** ESM port — `frontend/decisions.jsx`（291 行、3 コンポーネント `CheckItem` / `ConcretePage` / `MarineWorkPage`）を `frontend/vite-app/src/decisions.tsx`（530 行 TS 化 + 完全型付け）に複製。**charts.tsx の最初の ESM consumer** — これまで `Object.assign(window, ...)` 側だけで稼働確認していた dual surface の **ESM 出口**が初めて実環境で検証された（`LineChart` named import が bundle に展開）。**型ポート中の構造改善**: ① `data.ts` で導入した `waveHeight: number \| null` 契約の **caller 側初執行** — `MarineWorkPage` 入口で `waveLimit !== null` early-return guard（null は "この現場には波高基準が設定されていません" を表示、land 海象比較を構造的に遮断）。② `WORK_TYPES`（5 種の海上工事タイプ × wave/wind limit）を inline 配列から **module-level const に抽出** — render ごとの再生成を回避（incidental tada-win、refactor 主目的ではない）。③ `useMemo([siteId])` で hourly wave 生成を memoize。④ 原本の dead variable `const decision = getDecision(site);` を byte-equivalence のため `void getDecision(site);` で保存。**dual surface**: `ConcretePage` / `MarineWorkPage` / `CheckItem` の named exports ＋ `Object.assign(window, { ... })`（`declare global { interface Window { ... } }` で副作用に型付け）。`App.jsx` から `import { ConcretePage }` ＋ `void ConcretePage;` で tree-shake 回避。Bundle 影響: **29 → 30 modules / gzip 52.96 → 55.87 kB (+2.91 kB)** / hash `index-D0gwvWe3.js` / 587ms。CI run `26471707310` で **frontend 10s ／ unit 27s ／ smoke 43s** all green。**Phase 1 ESM 化 4 件目** — 残るは dashboard.jsx（Leaflet `L` global 型ハッチが必要 = Loop 20 候補）／app.jsx（page router、Phase 1 完了候補） | ✅ 93a4778 |
| 20 | Build → Verify | Phase 1 **branch-node** ESM port — `frontend/dashboard.jsx`（259 行、4 コンポーネント `MapView` / `SiteStatusCard` / `AlertBanner` / `DashboardPage`）を `frontend/vite-app/src/dashboard.tsx`（308 行 TS 化 + 完全型付け）に複製。**Leaflet `L` global の最小型エスケープ**: `@types/leaflet` を引かず `declare global { interface Window { L?: any } }` ＋ `declare const L: any;` の 2 段宣言で `L.map()` / `L.divIcon()` / `L.marker()` を解決（bundle 加算ゼロ／runtime は `<script>` 側で従来通り）。**型ポート中の構造改善**: ① `SiteStatusCard` で `waveLimit !== null` early-narrow ＋ `m && waveLimit !== null` 二項 guard（`waveHeight: number \| null` 契約の caller 側 2 例目執行 — 原本は `m` non-null 時のみ波高表示するため偶然動いていた）。② `statusColor` を `Record<Status, string>` exhaustive map 化（将来 Status union 拡張時の compile error 保証）。③ `useRef<HTMLDivElement \| null>` / `useRef<any[]>` で ref ストア型を明示。④ `onMouseOver` / `onMouseOut` の `e.currentTarget` を `HTMLDivElement` cast で `style` 解決。**dual surface**: `DashboardPage` / `MapView` / `SiteStatusCard` / `AlertBanner` の named exports ＋ `Object.assign(window, { ... })`。`App.jsx` から `import { DashboardPage }` ＋ `void DashboardPage;` で tree-shake 回避。Bundle 影響: **30 → 31 modules / gzip 55.87 → 58.21 kB (+2.34 kB)** / hash `index-BDHa1tjG.js` / 589ms。CI run `26472105621` で **frontend 10s ／ unit 27s ／ smoke 46s** all green。**Phase 1 ESM 化 5 件目** — 残るは app.jsx (root component)。ただし app.jsx は 15 個の Page コンポーネントに依存し、現状 ESM 化済は ConcretePage / MarineWorkPage / DashboardPage の 3 個のみ（残 12 個は Phase 2 スコープ） | ✅ 4d04354 |
| 21 | Build → Verify | Phase 1 **branch-node** ESM port — `frontend/weather-marine.jsx`（271 行、2 コンポーネント `WeatherPage` / `MarinePage`）を `frontend/vite-app/src/weather-marine.tsx`（456 行 TS 化 + 完全型付け）に複製。**今回は外部 global 不要**（Leaflet などへの依存なし）— charts.tsx / data.ts への純粋 ESM 依存だけで完結する最も leaf に近いブランチ。**型ポート中の構造改善**: ① `MarinePage` 入口で `if (waveLimit === null) return <error>;` 早期 return（`waveHeight: number \| null` 契約の caller 側 3 例目執行）— `marineSites = SITES.filter(s => s.type !== 'land')` の filter 後でも型上は `null` 可能性が残るため、UI フォールバックで構造的に遮断。② `useState<WeatherTab>` で `'current' \| 'hourly' \| 'table'` の union を明示（tab 文字列の typo を compile error 化）。③ `statCards: StatItem[]` を render 内で構築する元コードの形式を保ちつつ、`alert: StatAlert` 型で `'danger' \| 'warn' \| null` を縛り、condition 表現の typo を排除。④ `useMemo(() => generateHourlyWind(), [siteId])` で `// eslint-disable-next-line react-hooks/exhaustive-deps` を明示付与（`w.temp` / `w.rain` 依存欠落は `generateWeather` の決定性により実害なし、Loop 21 スコープ外）。**dual surface**: `WeatherPage` / `MarinePage` の named exports ＋ `Object.assign(window, { ... })`。`App.jsx` から `import { WeatherPage }` ＋ `void WeatherPage;` で tree-shake 回避（`MarinePage` は `WeatherPage` と同モジュール／同副作用で `WeatherPage` 経由で巻き込まれる）。Bundle 影響: **31 → 32 modules / gzip 58.21 → 59.85 kB (+1.64 kB)** / hash `index-COwaTQSt.js` / 612ms。CI run `26472475624` で **frontend / unit / smoke all green**（47s smoke）。**Phase 1 ESM 化 6 件目** — 残るは app.jsx (root)。15 ページ中 5 ページ ESM 化済（ConcretePage / MarineWorkPage / DashboardPage / WeatherPage / MarinePage）、残 10 ページが Phase 2 スコープ | ✅ 1f4c915 |
| 22 | Build → Verify | Phase 1 **branch-node** ESM port — `frontend/analysis.jsx`（232 行、2 コンポーネント `HistoricalPage` / `Wave50Page`）を `frontend/vite-app/src/analysis.tsx`（454 行 TS 化 + 完全型付け）に複製。**read-only 解析ページ**（form state なし）— charts.tsx / data.ts への純粋 ESM 依存のみ、weather-marine.tsx と同じく外部 global 不要。**型ポート中の構造改善**: ① `MetricKey` (`'wind' \| 'wave' \| 'rain'`) union で `chartData: Record<MetricKey, MetricSpec>` を exhaustive 化（将来 metric 追加が compile error 化）。② **`number \| null` → `number \| undefined` 橋渡し** — `LineChartProps.threshold?: number;` は null 不受理のため、HistoricalPage で `chartThreshold = metric === 'wind' ? site.thresholds.windSpeed : waveLimit ?? undefined;` の `?? undefined` coerce を適用。**chart 側 API を据え置く判断** — 「波高基準未設定 = threshold line を描かない」セマンティクスが既存 undefined ブランチと一致するため、null を chart まで伝播させず caller で吸収（waveHeight 契約の 4 例目執行）。③ 月次テーブルでは `color: waveLimit !== null && m.maxWave > waveLimit ? danger : inherit` の二項 guard（land sites の偽陽性を構造遮断）。④ Wave50Page で `WavePointKey` (`'東京湾北部' \| '東京湾中部' \| '東京湾南部' \| '東京湾東部'`) ／ `MethodKey` (`'gumbel' \| 'weibull' \| 'genpareto'`) literal union、`methodLabel` / `methodFullLabel` を `Record<MethodKey, string>` で exhaustive 化、select onChange は `as WavePointKey` で narrow。**dual surface**: `HistoricalPage` / `Wave50Page` named exports ＋ `Object.assign(window, { ... })`。`App.jsx` から `import { HistoricalPage }` ＋ `void HistoricalPage;` で tree-shake 回避（`Wave50Page` は同モジュール副作用で巻き込み）。Bundle 影響: **32 → 33 modules / gzip 59.85 → 61.51 kB (+1.66 kB)** / hash `index-BVbDfKlk.js` / 620ms。CI run `26472837279` で **frontend / unit / smoke all green**（44s smoke）。**Phase 1 ESM 化 7 件目** — 15 ページ中 7 ページ ESM 化済（残 8: SiteListPage / SiteRegisterPage / SiteDetailPage / Thresholds / Etl / Reports / Audit / Settings + TweaksPanel）。次候補は `site-pages.jsx`（17 KB、form state あり = blast radius 注意）または `admin-pages.jsx`（17 KB、5 ページ rollup） | ✅ c28ef88 |
| 23 | Build → Verify | Phase 1 **branch-node** ESM port — `frontend/admin-pages.jsx`（367 行、5 コンポーネント `ThresholdsPage` / `EtlPage` / `ReportsPage` / `AuditPage` / `SettingsPage`）を `frontend/vite-app/src/admin-pages.tsx`（528 行 TS 化 + 完全型付け）に複製。**最も嵩張る Loop** — 単一ファイルに 5 ページ rollup（管理系 admin pages）＋ form state 多数＋ DOM 直接操作トグル。data.ts への純粋 ESM 依存のみで外部 global 不要。**型ポート中の構造改善**: ① `Role = 'field' \| 'manager'` ／ `ReportFormat = 'pdf' \| 'excel' \| 'csv'` ／ `ReportTemplate = 'daily' \| 'weekly' \| 'monthly' \| 'decision' \| 'marine' \| 'annual'` の literal union を 3 つ定義（select onChange の typo を compile error 化）— `Role` は app.jsx の router 型統合まで一旦 local scope に閉じる判断。② `ThresholdMap = Record<string, SiteThresholds>` で `useState` の閾値辞書を型付け、`updateField(siteId, key: keyof SiteThresholds, value: number)` で編集 helper の key を構造的に narrow（追加/削除すべきフィールドが compile error 化）。③ `interface ReportForm { site; template: ReportTemplate; dateFrom; dateTo; format: ReportFormat }` で印刷フォーム state を集約。④ **SettingsPage の DOM 直接操作トグル** — 原本の `e.target.nextSibling.style.background = ...` は `Node` 型に `style` がないため、`handleToggle(e: ChangeEvent<HTMLInputElement>)` で `e.currentTarget.nextSibling as HTMLDivElement \| null` キャスト + null guard、子要素も `children[0] as HTMLDivElement \| undefined` で narrow。**設計上は `useState` でトグル管理が本筋だが byte-equivalence を優先**して cast で吸収（Phase 2 で React state 化候補）。⑤ `ETL_STATS` / `REPORT_FORMATS` / `RECENT_REPORTS` / `NOTIFICATION_PREFS` を module-level const に抽出して render 毎の再生成を排除。⑥ AuditPage は `useMemo(() => [...new Set(AUDIT_LOG.map(...))], [])` で actions / filtered を memoize。⑦ **既知バグの byte-equivalence 維持** — `t.waveHeight \|\| ''` は null と 0 の両方を空入力として描画する silent bug だが、`?? ''` に変えると land sites（waveHeight=null）で `0` 表示になるため原本準拠で保留（Phase 2 で `t.waveHeight ?? ''` + placeholder 表記の組合せに改修候補）。**dual surface**: `ThresholdsPage` / `EtlPage` / `ReportsPage` / `AuditPage` / `SettingsPage` named exports ＋ `declare global { interface Window { ThresholdsPage?: typeof ThresholdsPage; ... } }` + `Object.assign(window, { ... })`。`App.jsx` から `import { ThresholdsPage }` ＋ `void ThresholdsPage;` で tree-shake 回避（残 4 ページは同モジュール副作用で巻き込み）。Bundle 影響: **33 → 34 modules / gzip 61.51 → 64.34 kB (+2.83 kB)** / hash `index-Cp1blLSz.js` / 632ms。CI run `26473291819` で **frontend 11s ／ unit 25s ／ smoke 43s** all green。**Phase 1 ESM 化 8 件目** — 15 ページ中 12 ページ ESM 化済（残 3: SiteListPage / SiteRegisterPage / SiteDetailPage = `site-pages.jsx` 1 ファイルに集約 + TweaksPanel）。次候補は `site-pages.jsx`（380 行、form state あり = SiteRegisterPage の controlled input パス／blast radius は admin-pages より広い）か Phase 1 完了のための `app.jsx`（root router） | ✅ 9d32a92 |

---

## 🚧 ブロッカー / 要ユーザ判断

| # | ブロッカー | 状態 | 解消アクション |
|---:|---|:--:|---|
| ~~B1~~ | `git remote` 未設定 | ✅ 解消 | `Kensan196948G/wmcdss` private repo 作成・push 完了 (2026-05-26) |
| B2 | Codex / CodeRabbit レビューはユーザ起動のみ | 🟡 待 | Issue [#4](https://github.com/Kensan196948G/wmcdss/issues/4) — `/codex:review` ＋ `/coderabbit:review` 起動依頼 |
| B3 | AgentTeams 未活性化 | 🟡 部分解消 | 本セッションは個別 Agent 起動で代替中。`TeamCreate` 起動は CTO 判断で随時 |
| ~~B4~~ | 本番環境変数テンプレ未作成 | ✅ 解消 | `.env.production.example` 作成・`.gitignore` で `.env.production` 保護（Loop 7） |
| ~~B5~~ | Node.js 20 deprecation (2026-09-16) | ✅ 解消 | Issue [#3](https://github.com/Kensan196948G/wmcdss/issues/3) — `5c80fe7` で v5/v6 にバンプ済み |
| ~~B6~~ | `actions/setup-node@v4` 内部 Node 20 runtime (2026-09-16 削除予定) | ✅ 解消 | Loop 14 で `@v6` にバンプ（`ff725b8`）。CI run `26469869759` で annotations 0 件確認済み |

---

## 🗂️ コミット履歴（直近）

| SHA | 種別 | 内容 |
|---|---|---|
| `9d32a92` | feat | Loop 23 — Phase 1 ESM port `frontend/admin-pages.jsx` → `vite-app/src/admin-pages.tsx` ／Thresholds + Etl + Reports + Audit + Settings の 5 ページ rollup ／`Role` / `ReportFormat` / `ReportTemplate` literal union ＋ `ThresholdMap = Record<string, SiteThresholds>` + `keyof SiteThresholds` で閾値編集 helper を型安全化 ／SettingsPage DOM トグルは `HTMLDivElement` cast + null guard で byte-equivalence 維持 ／bundle +2.83 kB gzip |
| `c28ef88` | feat | Loop 22 — Phase 1 ESM port `frontend/analysis.jsx` → `vite-app/src/analysis.tsx` ／HistoricalPage + Wave50Page の 2 ページ／`MetricKey` / `WavePointKey` / `MethodKey` literal union で Record exhaustive 化 ／`number \| null` → `number \| undefined` を `?? undefined` で caller-side coerce（chart API 据え置き）／bundle +1.66 kB gzip |
| `1f4c915` | feat | Loop 21 — Phase 1 ESM port `frontend/weather-marine.jsx` → `vite-app/src/weather-marine.tsx` ／WeatherPage + MarinePage の 2 ページ／外部 global 依存なし ／`waveLimit === null` 早期 return で contract 3 例目執行 ／bundle +1.64 kB gzip |
| `4d04354` | feat | Loop 20 — Phase 1 ESM port `frontend/dashboard.jsx` → `vite-app/src/dashboard.tsx` ／Leaflet `L` を `declare const L: any` で最小型エスケープ ／`statusColor` を `Record<Status, string>` 化 ／`waveLimit !== null` ＋ `m` の二項 guard ／bundle +2.34 kB gzip |
| `93a4778` | feat | Loop 19 — Phase 1 ESM port `frontend/decisions.jsx` → `vite-app/src/decisions.tsx` ／charts.tsx の初 ESM consumer ／`waveLimit !== null` early-return で `number \| null` 契約の caller 側初執行 ／`WORK_TYPES` module-level const 化 ／bundle +2.91 kB gzip |
| `4fdcfba` | feat | Loop 18 — Phase 1 ESM port `frontend/data.jsx` → `vite-app/src/data.ts` ／13 named exports + 完全型付け ／`waveHeight: number \| null` 明示化で land 海象比較を構造的に遮断 ／bundle +2.88 kB gzip |
| `42b237e` | feat | Loop 17 — Phase 1 ESM port `frontend/charts.jsx` → `vite-app/src/charts.tsx` ／dual surface (ESM + window) ／threshold=0 と北方位の silent bug 同時修正 ／bundle +1.93 kB gzip |
| `4a8b37a` | docs | Loop 16 — `SECURITY.md` §5 鍵ローテーション運用フロー定義（9 ステップ無停止＋緊急＋rollback 表）／`.env.production.example` の制約コメント整合 (1024→512, startup→per-request) |
| `738587c` | feat | Phase 1 ESM port — `frontend/api.jsx` → `vite-app/src/api.ts` ／dual surface (ESM + window) ／bundle +1.48 kB gzip |
| `ff725b8` | ci | `actions/setup-node@v4 → @v6` バンプ — Node 24 runtime 化で B6 解消 ／annotations 0 件確認 |
| `d1978ed` | ci | `frontend-build` ジョブ追加 — Node 22 + `npm ci` + Vite build ／並走で wall-clock 据え置き ／run `26469645882` green |
| `dc89b0b` | feat | Vite Phase 0 scaffold — `frontend/vite-app/` ／React 18 + Vite 6 + TS ／gzip 46.67 kB build verified |
| `3dce51d` | feat | OpenAPI exposure env-gated — `WMCDSS_EXPOSE_OPENAPI=false` で /docs・/redoc・/openapi.json を 404 ／tests +4 |
| `6d7b200` | ci | smoke job 内で dev extras を layered install（exit 127 修正） |
| `847f11a` | ci | `backend-smoke` job 追加 — compose 起動 + `/readyz` ポーリング + smoke 9 件 |
| `b17aa2e` | feat | RateLimitMiddleware — sliding window per identity (key hash / IP) ／tests +10 |
| `3ebf8fa` | feat | marine ingester 分離（`jma_wave` service ＋ `ingest_jma_marine` job ＋ hourly timer ＋ tests +9）— Issue #2 closed |
| `96aab85` | infra | `.env.production.example` 新設＋`.gitignore` 強化（B4 解消） |
| `5c80fe7` | ci | checkout@v5 + setup-python@v6 へバンプ（Node 20 deprecation 解消） |
| `24eb466` | harden | audit hardening — `_actor` API Key 漏洩除去＋`write_audit(strict=True)` |
| `fc49421` | docs | STATUS.md 新設＋ARCHITECTURE.md §9 CI 二段構え |
| `5c3f700` | feat | decision/site の audit 永続化＋オフライン CI gate |
| `e163429` | docs | hardening 後の SECURITY/README/systemd 整合 |
| `3ac56d6` | harden | ingester／audit／frontend の silent-failure ＋ auth 強化 |
| `95a64d5` | chore | scaffold（backend + frontend + ingester） |

---

## 📐 残日数連動の自動縮退（CLAUDE.md 抜粋）

| 残日数 | 縮退ルール | 適用予定日 |
|---:|---|---|
| 30 日以内 | Improvement 縮退・Verify/リリース準備優先 | 2026-10-26 〜 |
| 14 日以内 | 新機能開発禁止・バグ修正のみ | 2026-11-11 〜 |
| 7 日以内 | リリース準備のみ（CHANGELOG／タグ） | 2026-11-18 〜 |
