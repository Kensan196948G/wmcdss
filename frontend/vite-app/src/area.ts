/**
 * 現場の地域（地方）を住所から導出する。
 *
 * 背景（task-12）:
 *   API の `SiteOut` は `area` を持たない（code/name/kind/lat/lon/address/note のみ）。
 *   task-10 で「モック SITES を index で引き当てる」フォールバックを廃止した結果、
 *   接続モードでは `area` が空になり、ダッシュボードの地域フィルタが 0 件になる
 *   劣化が生じていた。README が謳う「エリアごとにボタン 1 つで絞り込み」を
 *   実データで成立させるため、`address`（例: "東京都港区"）から地方を導出する。
 *
 * 設計上の約束:
 *   - 47 都道府県を漏れなく写像する（`PREFECTURE_TO_AREA`）。
 *   - 判別できない住所は `UNKNOWN_AREA`（= '全国'）を返す。呼び出し側はこれを
 *     「どの地域で絞り込んでも表示される側」として扱い、**現場が黙って消える
 *     （= 0 件表示）ことを防ぐ**。施工判断の画面で現場が無言で消えるのが最悪の
 *     挙動であり、判定できないことは「除外」ではなく「常に表示」に倒す。
 */
/** 地域名（地方）。'全国' は「地域を判別できなかった」ことを表す予約値。 */
export type AreaName =
  | '北海道'
  | '東北'
  | '関東'
  | '中部'
  | '近畿'
  | '中国'
  | '四国'
  | '九州'
  | '沖縄'
  | '全国';

/** 地域を判別できなかった現場に付ける値。地域フィルタでは常に表示される。 */
export const UNKNOWN_AREA: AreaName = '全国';

/** 地域フィルタの選択肢（北から南）。`data.ts` の AREA と一致させる。 */
export const AREA_NAMES: readonly AreaName[] = [
  '北海道',
  '東北',
  '関東',
  '中部',
  '近畿',
  '中国',
  '四国',
  '九州',
  '沖縄',
];

/** 47 都道府県 → 地方。漏れなく網羅する（テストで 47 件を固定）。 */
export const PREFECTURE_TO_AREA: Readonly<Record<string, AreaName>> = {
  北海道: '北海道',

  青森県: '東北',
  岩手県: '東北',
  宮城県: '東北',
  秋田県: '東北',
  山形県: '東北',
  福島県: '東北',

  茨城県: '関東',
  栃木県: '関東',
  群馬県: '関東',
  埼玉県: '関東',
  千葉県: '関東',
  東京都: '関東',
  神奈川県: '関東',

  新潟県: '中部',
  富山県: '中部',
  石川県: '中部',
  福井県: '中部',
  山梨県: '中部',
  長野県: '中部',
  岐阜県: '中部',
  静岡県: '中部',
  愛知県: '中部',

  三重県: '近畿',
  滋賀県: '近畿',
  京都府: '近畿',
  大阪府: '近畿',
  兵庫県: '近畿',
  奈良県: '近畿',
  和歌山県: '近畿',

  鳥取県: '中国',
  島根県: '中国',
  岡山県: '中国',
  広島県: '中国',
  山口県: '中国',

  徳島県: '四国',
  香川県: '四国',
  愛媛県: '四国',
  高知県: '四国',

  福岡県: '九州',
  佐賀県: '九州',
  長崎県: '九州',
  熊本県: '九州',
  大分県: '九州',
  宮崎県: '九州',
  鹿児島県: '九州',

  沖縄県: '沖縄',
};

/** 47 都道府県名（テストでの網羅確認に使う）。 */
export const PREFECTURE_NAMES: readonly string[] = Object.keys(PREFECTURE_TO_AREA);

/**
 * 接尾辞（都/府/県）を外した検索用の別名。
 * 「東京都」→「東京」のように住所側が接尾辞を省略していても拾えるようにする。
 * 北海道は接尾辞を外すと「北海」になり誤マッチの恐れがあるため別名を作らない。
 */
const PREFECTURE_ALIASES: ReadonlyArray<[string, AreaName]> = PREFECTURE_NAMES.filter(
  (name) => name !== '北海道',
)
  .map((name): [string, AreaName] => [name.replace(/[都府県]$/, ''), PREFECTURE_TO_AREA[name]])
  // 長い別名から先に照合する（「京都」より「東京」等の取り違えを避ける）
  .sort((a, b) => b[0].length - a[0].length);

/**
 * 住所から地方を導出する。判別できない場合は `UNKNOWN_AREA`（= '全国'）。
 *
 * 完全一致ではなく「含む」で判定するのは、住所が "東京都港区" のように
 * 都道府県 + 市区町村で構成されるため。まず正式名称（47 件）、次に接尾辞を
 * 省いた別名の順に照合する。
 */
export function areaFromAddress(address?: string | null): AreaName {
  if (typeof address !== 'string') return UNKNOWN_AREA;
  const text = address.normalize('NFKC');
  if (text.trim() === '') return UNKNOWN_AREA;

  for (const prefecture of PREFECTURE_NAMES) {
    if (text.includes(prefecture)) return PREFECTURE_TO_AREA[prefecture];
  }
  for (const [alias, area] of PREFECTURE_ALIASES) {
    if (text.includes(alias)) return area;
  }
  return UNKNOWN_AREA;
}

/**
 * 地域フィルタの判定。`selected` が null（全国）なら常に true。
 * 地域を判別できなかった現場（UNKNOWN_AREA）は、どの地域を選んでも表示する
 * （現場が無言で消える 0 件表示を作らないため）。
 */
export function matchesArea(area: string | undefined, selected: string | null): boolean {
  if (!selected) return true;
  if (!area || area === UNKNOWN_AREA) return true;
  return area === selected;
}
