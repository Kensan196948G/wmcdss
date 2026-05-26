import { WMCDSS_API_BASE } from './api';
import { ChartColors } from './charts';
import { SITES } from './data';
import { ConcretePage } from './decisions';
import { DashboardPage } from './dashboard';

// Side-effect imports: api.ts, charts.tsx, data.ts, decisions.tsx, and
// dashboard.tsx assign window.* globals on load. The named imports above pin
// each module into the bundle so Rollup keeps them instead of tree-shaking
// the side effects away.
void ConcretePage;
void DashboardPage;

export function App() {
  return (
    <main style={{
      fontFamily: 'system-ui, sans-serif',
      padding: '32px',
      maxWidth: 720,
      margin: '0 auto',
      color: '#1f2937',
    }}>
      <h1 style={{ marginBottom: 8 }}>WMCDSS — Vite scaffold</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>Phase 1 (api.ts + charts.tsx + data.ts + decisions.tsx + dashboard.tsx ESM port).</p>
      <section style={{
        background: '#fef3c7',
        border: '1px solid #fbbf24',
        borderRadius: 8,
        padding: 16,
        marginTop: 24,
      }}>
        <strong>このページはダミーです。</strong>
        <p style={{ marginBottom: 0 }}>
          本番ダッシュボードは <code>../index.html</code> (Babel Standalone) のまま動作しています。
          Phase 1 で <code>../api.jsx</code> → <code>./api.ts</code>、<code>../charts.jsx</code> → <code>./charts.tsx</code> を ESM 化しました。
        </p>
      </section>
      <section style={{
        background: '#ecfdf5',
        border: '1px solid #34d399',
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
      }}>
        <div><strong>WMCDSS_API_BASE:</strong> {WMCDSS_API_BASE}</div>
        <div><strong>ChartColors.blue:</strong> <span style={{ color: ChartColors.blue }}>{ChartColors.blue}</span></div>
        <div><strong>SITES count:</strong> {SITES.length}（{SITES.filter(s => s.type !== 'land').length} marine / {SITES.filter(s => s.type === 'land').length} land）</div>
        <div style={{ color: '#6b7280', marginTop: 4 }}>
          (resolved at module load; mirrored to <code>window.WMCDSS_API_BASE</code> /
          <code>window.LineChart</code> / <code>window.SITES</code> /
          <code>window.ConcretePage</code> / <code>window.DashboardPage</code> etc.)
        </div>
      </section>
    </main>
  );
}
