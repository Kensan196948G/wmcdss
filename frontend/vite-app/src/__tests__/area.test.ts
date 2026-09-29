// area.ts — 住所から地方を導出する純関数のテスト（task-12）
import { describe, it, expect } from 'vitest';

import {
  AREA_NAMES,
  PREFECTURE_NAMES,
  PREFECTURE_TO_AREA,
  UNKNOWN_AREA,
  areaFromAddress,
  matchesArea,
} from '../area';

type Region = (typeof AREA_NAMES)[number];

/** 47 都道府県と、その代表的な住所表記（実際の API の address 形式に合わせる）。 */
const PREFECTURE_CASES: Array<[string, Region]> = [
  ['北海道札幌市中央区', '北海道'],
  ['青森県青森市', '東北'],
  ['岩手県盛岡市', '東北'],
  ['宮城県仙台市宮城野区', '東北'],
  ['秋田県秋田市', '東北'],
  ['山形県山形市', '東北'],
  ['福島県いわき市', '東北'],
  ['茨城県ひたちなか市', '関東'],
  ['栃木県宇都宮市', '関東'],
  ['群馬県前橋市', '関東'],
  ['埼玉県さいたま市', '関東'],
  ['千葉県袖ケ浦市', '関東'],
  ['東京都港区', '関東'],
  ['神奈川県横浜市中区', '関東'],
  ['新潟県新潟市', '中部'],
  ['富山県富山市', '中部'],
  ['石川県金沢市', '中部'],
  ['福井県敦賀市', '中部'],
  ['山梨県甲府市', '中部'],
  ['長野県長野市', '中部'],
  ['岐阜県岐阜市', '中部'],
  ['静岡県静岡市', '中部'],
  ['愛知県名古屋市港区', '中部'],
  ['三重県四日市市', '近畿'],
  ['滋賀県大津市', '近畿'],
  ['京都府京都市', '近畿'],
  ['大阪府大阪市北区', '近畿'],
  ['兵庫県神戸市中央区', '近畿'],
  ['奈良県奈良市', '近畿'],
  ['和歌山県和歌山市', '近畿'],
  ['鳥取県鳥取市', '中国'],
  ['島根県松江市', '中国'],
  ['岡山県岡山市', '中国'],
  ['広島県広島市', '中国'],
  ['山口県下関市', '中国'],
  ['徳島県徳島市', '四国'],
  ['香川県高松市', '四国'],
  ['愛媛県松山市', '四国'],
  ['高知県高知市', '四国'],
  ['福岡県福岡市博多区', '九州'],
  ['佐賀県佐賀市', '九州'],
  ['長崎県長崎市', '九州'],
  ['熊本県熊本市', '九州'],
  ['大分県大分市', '九州'],
  ['宮崎県宮崎市', '九州'],
  ['鹿児島県鹿児島市', '九州'],
  ['沖縄県那覇市', '沖縄'],
];

describe('areaFromAddress — 47 都道府県 → 地方', () => {
  it('都道府県の写像は 47 件を漏れなく網羅する', () => {
    expect(PREFECTURE_NAMES).toHaveLength(47);
    expect(new Set(PREFECTURE_NAMES).size).toBe(47);
    // 期待値も 47 件で、47 都道府県を重複なく覆っていること
    // （テスト側の表と実装の表が同じ母集合であることの確認）
    expect(PREFECTURE_CASES).toHaveLength(47);
    const covered = PREFECTURE_CASES.map(
      ([address]) => PREFECTURE_NAMES.find((name) => address.startsWith(name)) ?? '',
    );
    expect(new Set(covered).size).toBe(47);
    expect(covered).not.toContain('');
  });

  it.each(PREFECTURE_CASES)('%s → %s', (address, expected) => {
    expect(areaFromAddress(address)).toBe(expected);
  });

  it('テスト表の都道府県が実装の表にすべて存在する', () => {
    for (const [address] of PREFECTURE_CASES) {
      const prefecture = PREFECTURE_NAMES.find((name) => address.startsWith(name));
      expect(prefecture, `${address} に対応する都道府県名が見つからない`).toBeDefined();
    }
  });

  it('地方の区分は 9 種類（北海道〜沖縄）で、すべて表に使われている', () => {
    const regions = new Set(Object.values(PREFECTURE_TO_AREA));
    expect(regions.size).toBe(9);
    for (const region of AREA_NAMES) {
      // '全国' は AREA_NAMES に含まれない（地域の選択肢のみ）
      expect(regions.has(region)).toBe(true);
    }
    expect(AREA_NAMES).not.toContain(UNKNOWN_AREA);
  });
});

describe('areaFromAddress — 判別できない住所', () => {
  it.each([
    ['', 'NONE'],
    ['   ', 'SPACES'],
    [null, 'NULL'],
    [undefined, 'UNDEFINED'],
    ['Tokyo Bay', 'ENGLISH'],
    ['第3工区', 'NO_PREFECTURE'],
  ])('%s (%s) は UNKNOWN_AREA を返す', (address) => {
    expect(areaFromAddress(address as string | null | undefined)).toBe(UNKNOWN_AREA);
  });

  it('未知の住所でも空文字を返さない（フィルタで消える値を作らない）', () => {
    for (const address of ['', '不明', 'Tokyo Bay', '太平洋上']) {
      const area = areaFromAddress(address);
      expect(area).not.toBe('');
      expect(area).toBe(UNKNOWN_AREA);
    }
  });
});

describe('areaFromAddress — 表記ゆれ', () => {
  it('接尾辞（都/府/県）が無くても判定する', () => {
    expect(areaFromAddress('東京港区')).toBe('関東');
    expect(areaFromAddress('大阪市北区')).toBe('近畿');
    expect(areaFromAddress('神奈川横浜市')).toBe('関東');
  });

  it('前後の空白や全角/半角の揺れを吸収する', () => {
    expect(areaFromAddress(' 東京都 港区 ')).toBe('関東');
    expect(areaFromAddress('Ｏｓａｋａ')).toBe(UNKNOWN_AREA);
  });

  it('北海道は接尾辞を外した別名を作らない（「北海」で誤マッチしない）', () => {
    expect(areaFromAddress('北海道')).toBe('北海道');
    expect(areaFromAddress('北海道上川郡')).toBe('北海道');
    expect(areaFromAddress('北海油田')).toBe(UNKNOWN_AREA);
  });

  it('東京都を京都府と取り違えない', () => {
    expect(areaFromAddress('東京都港区')).toBe('関東');
    expect(areaFromAddress('京都府京都市')).toBe('近畿');
    expect(areaFromAddress('東京都')).toBe('関東');
    expect(areaFromAddress('京都')).toBe('近畿');
  });
});

describe('matchesArea — 地域フィルタの不変条件', () => {
  it('未選択（全国）は常に表示する', () => {
    expect(matchesArea('関東', null)).toBe(true);
    expect(matchesArea(UNKNOWN_AREA, null)).toBe(true);
    expect(matchesArea(undefined, null)).toBe(true);
  });

  it('地域が一致する現場だけを表示する', () => {
    expect(matchesArea('関東', '関東')).toBe(true);
    expect(matchesArea('関東', '九州')).toBe(false);
  });

  it('地域が不明な現場はどの地域を選んでも表示する（0 件を作らない）', () => {
    for (const region of AREA_NAMES) {
      expect(matchesArea(UNKNOWN_AREA, region)).toBe(true);
      expect(matchesArea('', region)).toBe(true);
      expect(matchesArea(undefined, region)).toBe(true);
    }
  });
});
