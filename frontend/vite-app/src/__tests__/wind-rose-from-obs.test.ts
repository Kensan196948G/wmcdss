// buildWindRoseFromObs — 風配図データ生成の純関数テスト（jsdom 不要）
//
// 観測データ（hourlyObs）から8方位の平均風速を集計する関数の契約を固定する。
//  - 風向・風速が揃った観測点のみ集計に使う
//  - データが1点も無ければ null（表示側でプレースホルダー）
//  - 方位は16方位 → 8方位へ丸める（degTo8Compass）

import { describe, it, expect } from 'vitest';
import { buildWindRoseFromObs } from '../weather-marine';

function obs(wind_dir_deg: number | null, wind_speed_ms: number | null) {
  return {
    id: 1,
    site_id: 's1',
    observed_at: '2026-08-15T00:00:00Z',
    temperature_c: null,
    humidity_pct: null,
    pressure_hpa: null,
    precip_mm: null,
    wind_speed_ms,
    wind_gust_ms: null,
    wind_dir_deg,
    sunshine_h: null,
  };
}

describe('buildWindRoseFromObs', () => {
  it('returns null for empty / null input', () => {
    expect(buildWindRoseFromObs(null)).toBeNull();
    expect(buildWindRoseFromObs([])).toBeNull();
  });

  it('returns null when no observation has both wind dir and speed', () => {
    const rows = [obs(null, 5.0), obs(180, null)];
    expect(buildWindRoseFromObs(rows)).toBeNull();
  });

  it('aggregates average wind speed per 8-direction bucket', () => {
    // 90°=E, 90°=E (two samples), 180°=S (one sample)
    const rows = [obs(90, 4.0), obs(90, 6.0), obs(180, 8.0)];
    const result = buildWindRoseFromObs(rows);
    expect(result).not.toBeNull();
    const e = result!.find((d) => d.dir === 'E');
    const s = result!.find((d) => d.dir === 'S');
    expect(e!.value).toBe(5.0); // (4+6)/2
    expect(s!.value).toBe(8.0);
    // 他方位は value 0（データ無し）
    const n = result!.find((d) => d.dir === 'N');
    expect(n!.value).toBe(0);
  });

  it('rounds 16-direction degrees into 8-direction buckets', () => {
    // 22° → N（0-45° の範囲）, 350° → N（315-360° の範囲）
    const rows = [obs(22, 3.0), obs(350, 5.0)];
    const result = buildWindRoseFromObs(rows);
    const n = result!.find((d) => d.dir === 'N');
    expect(n!.value).toBe(4.0); // (3+5)/2
  });
});
