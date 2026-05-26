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
      <p style={{ color: '#6b7280', marginTop: 0 }}>Phase 0 (build pipeline only).</p>
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
          Phase 1 で <code>../*.jsx</code> をこの <code>src/</code> ツリーに ES module として移植します。
        </p>
      </section>
    </main>
  );
}
