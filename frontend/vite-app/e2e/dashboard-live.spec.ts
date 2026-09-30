/**
 * task-10 回帰テスト（E2E）— ダッシュボードが実判定を表示する
 *
 * ローカルの `vite preview` には backend が無いため、公開MVPと同じ応答形を
 * page.route でスタブして検証する。検証したいのは描画結果とリクエスト順序で、
 * backend の有無ではない。
 *
 *   (A) 初回ロード（遷移なし）で GET /api/v1/dashboard が 1 回だけ発生する
 *   (B) ヘッダーの件数と現場カードの判定が一致する（go 1 / caution 1 / stop 1）
 *   (C) 現場名は API の name（モックの shortName ではない）
 *   (D) /dashboard が取得できない接続状態では、モック件数を実判定として出さない
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const API_SITES = [
  {
    id: '00b05d5b-612a-4548-bd89-eb335b0214b1',
    code: 'TYO-01',
    name: '東京港臨海現場',
    kind: 'marine',
    lat: 35.645,
    lon: 139.77,
    jma_station_id: '44132',
    address: '東京都港区',
    note: null,
  },
  {
    id: '7cc60be6-eeb2-4c82-8503-e5620e8294ed',
    code: 'TYO-02',
    name: '羽田D滑走路工事',
    kind: 'marine',
    lat: 35.55,
    lon: 139.78,
    jma_station_id: '44132',
    address: '東京都大田区',
    note: null,
  },
  {
    id: '1f7b1c2d-3a4b-4c5d-8e9f-0a1b2c3d4e5f',
    code: 'TYO-03',
    name: '横浜本牧埠頭改修',
    kind: 'marine',
    lat: 35.44,
    lon: 139.66,
    jma_station_id: '47670',
    address: '神奈川県横浜市',
    note: null,
  },
];

function summarySite(
  site: (typeof API_SITES)[number],
  status: 'go' | 'caution' | 'stop',
  reason: string,
) {
  return {
    site_id: site.id,
    code: site.code,
    name: site.name,
    kind: site.kind,
    status,
    reason,
    work_types: [],
    weather_observed_at: '2026-09-29T14:23:47+00:00',
    marine_observed_at: '2026-09-29T14:03:47+00:00',
    weather_fresh: true,
    marine_fresh: true,
    data_complete: true,
    latest_weather: {
      temperature_c: 22,
      humidity_pct: 60,
      precip_mm: 0,
      wind_speed_ms: 4,
      wind_gust_ms: 6.5,
    },
    latest_marine: { sig_wave_h_m: 0.4, wave_period_s: 5.2 },
  };
}

/** 住所が空（地域不明）の現場。地域フィルタで消えてはいけない。 */
const UNKNOWN_ADDRESS_SITE = {
  id: '22222222-3333-4444-8555-666677778888',
  code: 'TYO-04',
  name: '住所未登録現場',
  kind: 'land' as const,
  lat: 35.0,
  lon: 139.0,
  jma_station_id: null,
  address: null,
  note: null,
};

/** 関東以外の現場。地域フィルタが実際に絞り込むことの確認に使う。 */
const KYUSHU_SITE = {
  id: '33333333-4444-4555-8666-777788889999',
  code: 'FUK-01',
  name: '博多港岸壁改良',
  kind: 'marine' as const,
  lat: 33.6,
  lon: 130.4,
  jma_station_id: '47807',
  address: '福岡県福岡市博多区',
  note: null,
};

const AREA_TEST_SITES = [...API_SITES, UNKNOWN_ADDRESS_SITE, KYUSHU_SITE];

const DASHBOARD_SUMMARY = {
  generated_at: '2026-09-29T14:40:03+00:00',
  count: 3,
  sites: [
    summarySite(API_SITES[0], 'go', '全しきい値を満たしています。施工可。'),
    summarySite(API_SITES[1], 'stop', 'sig_wave_h_m=1.2 が基準 (>=0.5) に該当 [stop]'),
    summarySite(API_SITES[2], 'caution', '風速が基準の 80% に接近 [caution]'),
  ],
};

const AREA_TEST_SUMMARY = {
  ...DASHBOARD_SUMMARY,
  count: 5,
  sites: [
    ...DASHBOARD_SUMMARY.sites,
    summarySite(UNKNOWN_ADDRESS_SITE, 'go', '全しきい値を満たしています。施工可。'),
    summarySite(KYUSHU_SITE, 'caution', '風速が基準の 80% に接近 [caution]'),
  ],
};

interface RecordedRequest {
  method: string;
  path: string;
}

function recordApiRequests(page: Page): RecordedRequest[] {
  const seen: RecordedRequest[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.includes('/api/v1/')) return;
    seen.push({ method: request.method(), path: new URL(url).pathname });
  });
  return seen;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/**
 * 既定は全 API を遮断し、/sites と /dashboard と demo-login だけ実応答を返す。
 * Playwright は後から登録した route を優先するため、catch-all を最初に置く。
 */
async function stubLiveBackend(
  page: Page,
  options: {
    dashboard?: 'ok' | 'fail';
    sites?: unknown;
    summary?: unknown;
  } = {},
): Promise<void> {
  const dashboardMode = options.dashboard ?? 'ok';
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.route('**/api/v1/sites', (route) => fulfillJson(route, options.sites ?? API_SITES));
  await page.route('**/api/v1/dashboard', (route) =>
    dashboardMode === 'ok'
      ? fulfillJson(route, options.summary ?? DASHBOARD_SUMMARY)
      : route.abort(),
  );
  await page.route('**/api/v1/auth/demo-login', (route) =>
    fulfillJson(route, {
      access_token: 'e2e-demo-jwt',
      username: 'demo',
      display_name: 'Demo User',
      role: 'admin',
    }),
  );
}

const headerBadge = (page: Page, label: string) =>
  page.locator('.header-right .header-badge').filter({ hasText: label });

const statCard = (page: Page, label: string) =>
  page.locator('.stat-card').filter({ has: page.locator('.stat-label', { hasText: label }) });

test.describe('task-10 dashboard live judgments', () => {
  test('初回ロード（遷移なし）で /dashboard を 1 回取得し、ヘッダー件数とカード判定が一致する', async ({
    page,
  }) => {
    const requests = recordApiRequests(page);
    await stubLiveBackend(page);

    await page.goto('/');

    // (A) 遷移せずに /dashboard が取得される
    await expect(statCard(page, '管理現場数').locator('.stat-value')).toHaveText('3');
    await expect(statCard(page, '施工可').locator('.stat-value')).toHaveText('1');
    await expect(statCard(page, '注意').locator('.stat-value')).toHaveText('1');
    await expect(statCard(page, '中止推奨').locator('.stat-value')).toHaveText('1');

    // (B) ヘッダーも同じ数字（同一情報源）
    await expect(headerBadge(page, '施工可')).toContainText('1');
    await expect(headerBadge(page, '注意')).toContainText('1');
    await expect(headerBadge(page, '中止')).toContainText('1');

    // (C) 現場名は API の name（モック SITES の shortName ではない）
    const body = page.locator('body');
    await expect(body).toContainText('東京港臨海現場');
    await expect(body).toContainText('羽田D滑走路工事');
    await expect(body).toContainText('横浜本牧埠頭改修');
    await expect(body).not.toContainText('横浜港防波堤');
    await expect(body).not.toContainText('東京港大橋');

    // 実判定の根拠文がカードに出る（モックの生成理由ではない）
    await expect(
      page.locator('.reason-text').filter({ hasText: '全しきい値を満たしています。施工可。' }),
    ).toHaveCount(1);
    await expect(
      page.locator('.reason-text').filter({ hasText: 'sig_wave_h_m=1.2 が基準 (>=0.5) に該当 [stop]' }),
    ).toHaveCount(1);

    const dashboardRequests = requests.filter((r) => r.path.endsWith('/api/v1/dashboard'));
    console.log('API requests on first load:', JSON.stringify(requests));
    expect(dashboardRequests).toHaveLength(1);
    expect(dashboardRequests[0].method).toBe('GET');
  });

  test('/dashboard が取得できない接続状態ではモック件数を実判定として出さない', async ({
    page,
  }) => {
    await stubLiveBackend(page, { dashboard: 'fail' });

    await page.goto('/');

    // 接続はできている（sites は取得済み）が判定は未取得 → 「—」でありモック分布ではない
    await expect(page.locator('body')).toContainText('東京港臨海現場');
    await expect(headerBadge(page, '施工可')).toContainText('—');
    await expect(headerBadge(page, '注意')).toContainText('—');
    await expect(headerBadge(page, '中止')).toContainText('—');
    await expect(statCard(page, '施工可').locator('.stat-value')).toHaveText('—');
    await expect(page.locator('.badge', { hasText: '判定取得中' }).first()).toBeVisible();
  });

  test('地域フィルタが接続モードで機能し、該当現場が無い地域でも 0 件にしない', async ({ page }) => {
    await stubLiveBackend(page, { sites: AREA_TEST_SITES, summary: AREA_TEST_SUMMARY });

    await page.goto('/');
    await expect(page.locator('.reason-text')).toHaveCount(5);

    const areaChip = (name: string) => page.getByRole('button', { name, exact: true });

    // 関東: 東京 2 + 神奈川 1 + 住所不明 1（常に表示）= 4、福岡の 1 件は除外
    await areaChip('関東').click();
    await expect(page.locator('.reason-text')).toHaveCount(4);
    await expect(page.locator('.card-body', { hasText: '博多港岸壁改良' })).toHaveCount(0);
    await expect(page.locator('.card-body', { hasText: '東京港臨海現場' })).toHaveCount(1);

    // 九州: 福岡 1 + 住所不明 1 = 2
    await areaChip('九州').click();
    await expect(page.locator('.reason-text')).toHaveCount(2);
    await expect(page.locator('.card-body', { hasText: '博多港岸壁改良' })).toHaveCount(1);

    // 該当現場が無い地域でも、住所不明の現場が表示されるので 0 件にはならない
    await areaChip('沖縄').click();
    await expect(page.locator('.reason-text')).toHaveCount(1);
    await expect(page.locator('.card-body', { hasText: '住所未登録現場' })).toHaveCount(1);
  });
});
