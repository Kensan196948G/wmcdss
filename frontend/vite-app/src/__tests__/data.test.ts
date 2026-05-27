import { describe, it, expect } from 'vitest';
import {
  STATUS_LABEL,
  STATUS_CLASS,
  TYPE_LABEL,
  SITES,
  getDecision,
} from '../data';

describe('STATUS_LABEL', () => {
  it('ok → 施工可', () => {
    expect(STATUS_LABEL.ok).toBe('施工可');
  });
  it('warn → 注意', () => {
    expect(STATUS_LABEL.warn).toBe('注意');
  });
  it('danger → 中止推奨', () => {
    expect(STATUS_LABEL.danger).toBe('中止推奨');
  });
});

describe('STATUS_CLASS', () => {
  it('maps each Status to the expected CSS class', () => {
    expect(STATUS_CLASS.ok).toBe('badge-ok');
    expect(STATUS_CLASS.warn).toBe('badge-warn');
    expect(STATUS_CLASS.danger).toBe('badge-danger');
  });
});

describe('TYPE_LABEL', () => {
  it('maps each SiteKind to the expected Japanese label', () => {
    expect(TYPE_LABEL.land).toBe('陸上');
    expect(TYPE_LABEL.marine).toBe('海上');
    expect(TYPE_LABEL.both).toBe('陸上＋海上');
  });
});

describe('getDecision', () => {
  // site-01: wind=4.2 (<10), rain=0 (<5), temp=22.4 (>5), wave=0.8 (<1.5) → all clear
  it('returns ok when all metrics are within thresholds (site-01)', () => {
    const site = SITES.find(s => s.id === 'site-01')!;
    const result = getDecision(site);
    expect(result.status).toBe('ok');
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain('全項目が基準値内');
  });

  // site-02: wave=1.3 > limit 1.2 → danger due to wave exceedance
  it('returns danger when wave height exceeds threshold (site-02)', () => {
    const site = SITES.find(s => s.id === 'site-02')!;
    const result = getDecision(site);
    expect(result.status).toBe('danger');
    expect(result.reasons.some(r => r.includes('有義波高'))).toBe(true);
    expect(result.reasons.some(r => r.includes('超過'))).toBe(true);
  });

  // site-04: wind=12.4 > 8, rain=8.5 > 3, wave=2.1 > 1.0 → danger with 3 reasons
  it('returns danger with multiple reasons when several thresholds are exceeded (site-04)', () => {
    const site = SITES.find(s => s.id === 'site-04')!;
    const result = getDecision(site);
    expect(result.status).toBe('danger');
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some(r => r.includes('風速'))).toBe(true);
    expect(result.reasons.some(r => r.includes('降水量'))).toBe(true);
    expect(result.reasons.some(r => r.includes('有義波高'))).toBe(true);
  });

  // site-06: land site (waveHeight: null), wind=2.8 (<15), rain=0, temp=23 → all clear, no wave check
  it('returns ok for a land site and skips wave check (site-06)', () => {
    const site = SITES.find(s => s.id === 'site-06')!;
    expect(site.thresholds.waveHeight).toBeNull();
    const result = getDecision(site);
    expect(result.status).toBe('ok');
    expect(result.reasons.every(r => !r.includes('有義波高'))).toBe(true);
  });

  // Ensure DecisionResult always has at least one reason string
  it('always returns at least one reason', () => {
    for (const site of SITES) {
      const result = getDecision(site);
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  // site-05: wind=9.6 > 8 (danger) and wave=1.5 > 1.0 (danger) — verify wind message
  it('includes wind speed in reasons when wind exceeds threshold (site-05)', () => {
    const site = SITES.find(s => s.id === 'site-05')!;
    const result = getDecision(site);
    expect(result.status).toBe('danger');
    expect(result.reasons.some(r => r.includes('風速') && r.includes('超過'))).toBe(true);
  });
});
