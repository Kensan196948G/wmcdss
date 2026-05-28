// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CheckItem,
  ConcretePage,
  MarineWorkPage,
  type CheckItemProps,
} from '../decisions';

// ---------------------------------------------------------------------------
// CheckItem
// ---------------------------------------------------------------------------

const baseItem: CheckItemProps = {
  label: '風速',
  value: 5.2,
  unit: 'm/s',
  threshold: 10,
  status: 'ok',
};

describe('CheckItem', () => {
  it('renders label text', () => {
    const { container } = render(<CheckItem {...baseItem} />);
    expect(container.textContent).toContain('風速');
  });

  it('renders value and unit', () => {
    const { container } = render(<CheckItem {...baseItem} />);
    expect(container.textContent).toContain('5.2');
    expect(container.textContent).toContain('m/s');
  });

  it('renders threshold text', () => {
    const { container } = render(<CheckItem {...baseItem} />);
    expect(container.textContent).toContain('基準値');
    expect(container.textContent).toContain('10');
  });

  it('uses thresholdUnit when provided', () => {
    const { container } = render(
      <CheckItem {...baseItem} threshold={85} thresholdUnit="% 以下" />
    );
    expect(container.textContent).toContain('% 以下');
  });

  it('status ok → icon ✓, badge text 適合, badge-ok class', () => {
    const { container } = render(<CheckItem {...baseItem} status="ok" />);
    expect(container.textContent).toContain('✓');
    expect(container.textContent).toContain('適合');
    const badge = container.querySelector('.badge-ok');
    expect(badge).not.toBeNull();
  });

  it('status warn → icon △, badge text 注意, badge-warn class', () => {
    const { container } = render(<CheckItem {...baseItem} status="warn" />);
    expect(container.textContent).toContain('△');
    expect(container.textContent).toContain('注意');
    const badge = container.querySelector('.badge-warn');
    expect(badge).not.toBeNull();
  });

  it('status danger → icon ✕, badge text 超過, badge-danger class', () => {
    const { container } = render(<CheckItem {...baseItem} status="danger" />);
    expect(container.textContent).toContain('✕');
    expect(container.textContent).toContain('超過');
    const badge = container.querySelector('.badge-danger');
    expect(badge).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ConcretePage
// ---------------------------------------------------------------------------

describe('ConcretePage', () => {
  it('renders site selector with SITES options', () => {
    const { container } = render(<ConcretePage />);
    const select = container.querySelector('select.form-select');
    expect(select).not.toBeNull();
    expect((select as HTMLSelectElement).options.length).toBeGreaterThan(0);
  });

  it('renders 5 check items (降水量, 風速, 気温x2, 湿度)', () => {
    const { container } = render(<ConcretePage />);
    for (const label of ['降水量', '風速', '気温（下限）', '気温（上限）', '湿度']) {
      expect(container.textContent).toContain(label);
    }
  });

  it('renders 判定項目 card title', () => {
    const { container } = render(<ConcretePage />);
    expect(container.textContent).toContain('判定項目');
  });

  it('renders コンクリート打設判定 title text', () => {
    const { container } = render(<ConcretePage />);
    expect(container.textContent).toContain('コンクリート打設判定');
  });

  it('renders 明日以降の打設見通し section', () => {
    const { container } = render(<ConcretePage />);
    expect(container.textContent).toContain('明日以降の打設見通し');
  });

  it('uses selectedSite prop to pre-select a site', () => {
    const { container } = render(<ConcretePage selectedSite="site-02" />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe('site-02');
  });

  it('falls back to SITES[0] for unknown selectedSite', () => {
    const { container } = render(<ConcretePage selectedSite="no-such-site" />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe('site-01');
  });
});

// ---------------------------------------------------------------------------
// MarineWorkPage
// ---------------------------------------------------------------------------

describe('MarineWorkPage', () => {
  it('renders a site selector for marine sites', () => {
    const { container } = render(<MarineWorkPage />);
    const select = container.querySelector('select.form-select');
    expect(select).not.toBeNull();
  });

  it('renders all 5 WORK_TYPES in the table', () => {
    const { container } = render(<MarineWorkPage />);
    for (const workType of [
      'クレーン船作業',
      '潜水作業',
      '台船据付',
      '資材運搬船',
      '測量船作業',
    ]) {
      expect(container.textContent).toContain(workType);
    }
  });

  it('renders 海上作業判定 title', () => {
    const { container } = render(<MarineWorkPage />);
    expect(container.textContent).toContain('海上作業判定');
  });

  it('renders the 4 marine check items', () => {
    const { container } = render(<MarineWorkPage />);
    for (const label of ['有義波高', '風速', '波周期', '降水量']) {
      expect(container.textContent).toContain(label);
    }
  });

  it('renders 波高 chart card', () => {
    const { container } = render(<MarineWorkPage />);
    expect(container.textContent).toContain('波高推移');
  });

  it('renders 作業種別 table header', () => {
    const { container } = render(<MarineWorkPage />);
    expect(container.textContent).toContain('作業種別');
    expect(container.textContent).toContain('波高基準');
    expect(container.textContent).toContain('風速基準');
  });

  it('uses selectedSite prop when it is a marine site', () => {
    const { container } = render(<MarineWorkPage selectedSite="site-02" />);
    const select = container.querySelector('select.form-select') as HTMLSelectElement;
    expect(select.value).toBe('site-02');
  });
});
