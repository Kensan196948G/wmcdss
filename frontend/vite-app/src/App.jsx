import { WMCDSS_API_BASE } from './api';

// Side-effect import: api.ts assigns window.WMCDSS_API and window.WMCDSS_API_BASE
// on load. The named import above pins WMCDSS_API_BASE into the bundle so Rollup
// keeps the module instead of tree-shaking it away.

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
      <p style={{ color: '#6b7280', marginTop: 0 }}>Phase 1 (api.ts ESM port).</p>
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
          Phase 1 で <code>../api.jsx</code> を <code>./api.ts</code> として ESM 化しました。
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
        <div style={{ color: '#6b7280', marginTop: 4 }}>
          (resolved at module load; mirrored to <code>window.WMCDSS_API_BASE</code>)
        </div>
      </section>
    </main>
  );
}
