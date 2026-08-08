import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  build: {
    outDir: 'dist',
    // 本番ビルドでは sourcemap を無効化。ソースコードをクライアントに
    // 公開しないようにする。開発時 (`npm run dev`) は mode='development'、
    // 本番ビルド (`npm run build`) は mode='production' となる。
    // vitest (`npm test`) は mode='test' だが build は走らないので影響なし。
    sourcemap: mode !== 'production' ? true : false,
  },
  test: {
    environment: 'node',
    // @testing-library/react は import 時にグローバル afterEach の有無を見て、
    // 自動 cleanup（描画ツリーの unmount）を仕込むかどうかを決める。globals が
    // 無効だと登録されず、テスト終了後もコンポーネントがマウントされたまま残る。
    //
    // React 18 では無害だったが、React 19 はスケジューラの保留タスクを
    // setImmediate で実行するため、vitest がファイル単位で jsdom 環境を破棄した
    // *後* にタスクが発火し `window is not defined` で落ちる（テスト自体は全件
    // 成功するのに unhandled error でプロセスが exit 1 になる）。
    //
    // 各テストファイルは今も 'vitest' から明示 import しており、globals を有効に
    // してもその書き方は変わらない。ここで有効化するのは RTL に後始末を
    // 登録させるためだけ。
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
}));
