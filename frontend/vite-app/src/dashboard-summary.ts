/**
 * ダッシュボード集約判定（GET /api/v1/dashboard）の単一情報源。
 *
 * 背景（task-10）:
 *   - ヘッダー（app-shell）とダッシュボード（dashboard）が別々に判定を数えていたため、
 *     「カードは実判定・ヘッダーはモック件数」という自己矛盾した画面になっていた。
 *   - DashboardPage は `useEffect(..., [])` の中で `backendConnected()` を評価して
 *     いたため、接続確立前にマウントすると二度と取得されず、現場カードがモック判定
 *     のまま表示されていた。
 *
 * そこで「取得」も「状態」も 1 箇所（このモジュール）に集約し、
 *   1. 接続が確立したら必ず 1 回は取得する（同時呼び出しは 1 リクエストへ集約）
 *   2. 実判定を表示してよいかどうか（ready）を共通の判断にする
 * を保証する。モック表示（未接続のデモ）はこの情報源を使わず、従来どおりとする。
 */
import { useEffect, useState } from 'react';

import {
  backendConnected,
  fetchDashboardSummary,
  type DashboardSiteSummary,
} from './api';
import type { Site, Status } from './data';

export type DashboardSummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DashboardSummaryState {
  /** 実判定（/dashboard の sites）。未取得・失敗時は null。 */
  summaries: DashboardSiteSummary[] | null;
  status: DashboardSummaryStatus;
}

export interface DashboardSummaryView extends DashboardSummaryState {
  /** バックエンドへ接続できているか。false のときはモック（デモ）表示。 */
  connected: boolean;
  /**
   * 実判定を「確定した値」として表示してよいか。
   * 未接続（デモ）はモック値を表示してよいので true。接続中は取得完了のみ true。
   */
  ready: boolean;
}

const INITIAL: DashboardSummaryState = { summaries: null, status: 'idle' };

let current: DashboardSummaryState = INITIAL;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(state: DashboardSummaryState) => void>();

function publish(next: DashboardSummaryState): void {
  current = next;
  listeners.forEach((listener) => listener(next));
}

export function getDashboardSummaryState(): DashboardSummaryState {
  return current;
}

export function subscribeDashboardSummary(
  listener: (state: DashboardSummaryState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 集約判定を取得する。同時に複数箇所から呼ばれても実リクエストは 1 本に集約する。
 * 未接続（デモ）のときは何もしない（モック表示のまま）。
 */
export function loadDashboardSummary(): Promise<void> {
  if (inFlight) return inFlight;
  if (!backendConnected()) return Promise.resolve();
  publish({ summaries: current.summaries, status: 'loading' });
  inFlight = fetchDashboardSummary()
    .then((data) => {
      publish({ summaries: Array.isArray(data.sites) ? data.sites : [], status: 'ready' });
    })
    .catch(() => {
      // 失敗時は「判定なし」を明示する。モック値で埋めて実判定のように見せない。
      publish({ summaries: null, status: 'error' });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** テスト用: モジュール状態を初期化する（プロダクションコードでは呼ばない）。 */
export function resetDashboardSummary(): void {
  current = INITIAL;
  inFlight = null;
  listeners.clear();
}

/**
 * バックエンド接続状態。`initFromBackend()` は成功時に
 * `window.BACKEND_STATUS` を更新してから `wmcdss:sites-updated` を発火するので、
 * そのイベントで再評価する（＝マウント後に接続が確立しても追従できる）。
 */
export function useBackendConnected(): boolean {
  const [connected, setConnected] = useState<boolean>(() => backendConnected());
  useEffect(() => {
    const onUpdated = () => setConnected(backendConnected());
    window.addEventListener('wmcdss:sites-updated', onUpdated);
    return () => window.removeEventListener('wmcdss:sites-updated', onUpdated);
  }, []);
  return connected;
}

/**
 * ヘッダーとダッシュボードが共有する集約判定フック。
 * 接続中のマウント時・接続確立時に取得を試みる（多重取得は集約される）。
 */
export function useDashboardSummary(): DashboardSummaryView {
  const connected = useBackendConnected();
  const [state, setState] = useState<DashboardSummaryState>(() => current);

  useEffect(() => subscribeDashboardSummary(setState), []);

  useEffect(() => {
    if (!connected) return;
    void loadDashboardSummary();
  }, [connected]);

  return {
    ...state,
    connected,
    ready: !connected || state.status === 'ready',
  };
}

// ---------------------------------------------------------------------------
// 判定の突き合わせ（ヘッダー / ダッシュボードで同じ関数を使う）
// ---------------------------------------------------------------------------

/** 集約判定の status を画面側の Status（ok/warn/danger）へ写す。 */
export function statusOf(status: string | undefined): Status {
  if (status === 'caution') return 'warn';
  if (status === 'stop') return 'danger';
  return 'ok';
}

export function indexSummaries(
  summaries: DashboardSiteSummary[] | null,
): Map<string, DashboardSiteSummary> {
  const map = new Map<string, DashboardSiteSummary>();
  (summaries ?? []).forEach((summary) => map.set(summary.site_id, summary));
  return map;
}

/**
 * 実判定が取れている現場だけ status を上書きする。取れていない現場は
 * 元の status のまま（未接続時はモック、接続中は呼び出し側が ready で判断する）。
 */
export function applySummaries(
  sites: Site[],
  summaryById: Map<string, DashboardSiteSummary>,
): Array<Site & { summary?: DashboardSiteSummary }> {
  return sites.map((site) => {
    const summary = summaryById.get(site.id);
    return summary ? { ...site, status: statusOf(summary.status), summary } : site;
  });
}

export function countStatuses(
  sites: Array<Site & { summary?: DashboardSiteSummary }>,
): { ok: number; warn: number; danger: number } {
  return {
    ok: sites.filter((s) => s.status === 'ok').length,
    warn: sites.filter((s) => s.status === 'warn').length,
    danger: sites.filter((s) => s.status === 'danger').length,
  };
}
