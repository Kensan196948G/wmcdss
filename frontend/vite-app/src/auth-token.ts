/**
 * JWT トークンの保管場所（単一の情報源）。
 *
 * このモジュールは **何も import しない**。理由は循環依存の回避である。
 *
 *   auth.tsx  --import WMCDSS_API_BASE-->  api.ts
 *
 * という依存が既にあるため、api.ts から auth.tsx の AuthStore を
 * import すると環になる。さらに auth.tsx は React コンポーネント
 * (LoginPage) を export しているので、環にしなくても api.ts へ React を
 * 引きずり込むことになる。トークンの読み書きだけを葉のモジュールへ
 * 切り出せば、api.ts と auth.tsx の両方から安全に使える。
 *
 * 切り出しのもう一つの動機は重複の解消である。この変更の前、
 * キー文字列 'wmcdss_access_token' は 3 箇所に散らばっていた
 * (auth.tsx の TOKEN_KEY と、admin-pages.tsx の authHeaders() 2 箇所)。
 * 文字列リテラルの重複は型検査に引っかからないため、改名すると
 * 一部の画面だけ静かに認証が壊れる。
 */

export const TOKEN_KEY = 'wmcdss_access_token';
export const USER_KEY = 'wmcdss_user';

/**
 * 401 を受けた時に window へ流すイベント名。
 *
 * main.tsx がこれを購読して LoginPage へ戻す。fetchJSON から直接
 * React の状態を触れないので、疎結合な通知経路を 1 本だけ用意する。
 */
export const UNAUTHORIZED_EVENT = 'wmcdss:unauthorized';

/**
 * localStorage を安全に取得する。
 *
 * jsdom・SSR・プライベートブラウジングの各環境で localStorage は
 * 「無い」「あるが throw する」のどちらにもなりうる。触る前に握り潰す。
 */
function safeStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage;
    }
  } catch {
    // localStorage unavailable (test env, SSR, private mode)
  }
  return null;
}

export function getToken(): string | null {
  return safeStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function clearToken(): void {
  const s = safeStorage();
  s?.removeItem(TOKEN_KEY);
  s?.removeItem(USER_KEY);
}

/**
 * Authorization ヘッダーを組み立てる。未ログイン時は空オブジェクト。
 *
 * `Bearer ` を付けずに空を返すのは意図的である。空文字の
 * `Authorization: Bearer ` を送ると、サーバー側では「壊れた資格情報」と
 * 「資格情報なし」の区別が付かなくなり、ログが読みにくくなる。
 */
export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 認証切れを検知した時の共通処理。トークンを捨ててから通知する。
 *
 * 順序が重要で、先に捨てておかないと、購読側が再描画した瞬間に
 * 期限切れトークンで再ログイン済みと判定してループする。
 */
export function notifyUnauthorized(): void {
  clearToken();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
}
