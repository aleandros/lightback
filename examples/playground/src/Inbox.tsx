import { useEffect, useState } from 'react';
import { toPromptContext } from '@lightback/core';
import { clearSubmissions, listSubmissions, type Submission } from './submissions';

export function Inbox() {
  const [items, setItems] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'summary' | 'screenshot' | 'prompt' | 'json'>('summary');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await listSubmissions();
      setItems(data);
      setSelectedId((cur) => data.some((item) => item.id === cur) ? cur : data[0]?.id ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox.');
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    const hot = import.meta.hot;
    const onSubmission = () => void load();
    hot?.on('lightback:submission', onSubmission);
    window.addEventListener('lightback:submission', onSubmission);
    return () => {
      clearInterval(timer);
      hot?.off('lightback:submission', onSubmission);
      window.removeEventListener('lightback:submission', onSubmission);
    };
  }, []);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <>
      <header className="page-header">
        <h1>Feedback inbox</h1>
        <div className="row">
          <span className="muted">{items.length} submission{items.length === 1 ? '' : 's'}</span>
          <button
            className="btn"
            data-action="clear-inbox"
            onClick={async () => {
              try {
                await clearSubmissions();
                setSelectedId(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not clear the inbox.');
              }
            }}
          >
            Clear
          </button>
        </div>
      </header>
      {error && <p role="alert" data-ref="inbox-error">{error}</p>}
      <div className="inbox">
        <ul className="inbox-list">
          {items.length === 0 && <li className="muted empty">Nothing yet. Send feedback from the dashboard.</li>}
          {items.map((s) => (
            <li key={s.id} data-ref="submission" className={s.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(s.id)}>
              <div className="when">{new Date(s.receivedAt).toLocaleTimeString()}</div>
              <div className="note">{s.payload.note.text || <em>(no text)</em>}</div>
              <div className="meta">
                {s.payload.selections.length} el · {s.payload.errors.length} err · {s.payload.network.length} req
                {s.files['screenshot.png'] ? ' · 📷' : ''}
              </div>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="inbox-detail card">
            <div className="tabs">
              {(['summary', 'screenshot', 'prompt', 'json'] as const).map((t) => (
                <button key={t} data-action={`tab-${t}`} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            {tab === 'summary' && <Summary s={selected} />}
            {tab === 'screenshot' && <Screenshot s={selected} />}
            {tab === 'prompt' && <Prompt s={selected} />}
            {tab === 'json' && <pre className="code" data-ref="payload-json">{JSON.stringify(selected.payload, null, 2)}</pre>}
          </div>
        )}
      </div>
    </>
  );
}

function Summary({ s }: { s: Submission }) {
  const p = s.payload;
  return (
    <div className="summary">
      <section>
        <h3>Note</h3>
        <p>{p.note.text || <em className="muted">(none)</em>}</p>
        <p className="muted small">
          {p.page.url} · viewport {p.env.viewport.width}×{p.env.viewport.height} · {p.env.language}
        </p>
      </section>
      <section>
        <h3>Selected elements ({p.selections.length})</h3>
        {p.selections.map((sel, i) => (
          <div key={sel.id} className="sel">
            <div>
              <span className="badge">{i + 1}</span>
              <strong>{sel.components.length ? sel.components.join(' ‹ ') : `<${sel.tag}>`}</strong>
              {sel.kind === 'region' && <span className="pill">area · {sel.region?.children.length ?? 0} elements</span>}
              {sel.framework && <span className="pill">{sel.framework}</span>}
            </div>
            <code className="small">{sel.selector}</code>
            {sel.source && <span className="src">{sel.source.file.replace(/^.*?\/src\//, 'src/')}:{sel.source.line}:{sel.source.column}</span>}
            {sel.kind === 'element' && sel.text && <div className="muted small">“{sel.text}”</div>}
            {sel.region && (
              <div className="children">
                {sel.region.children.map((c, j) => (
                  <span key={j} className="chip" title={c.selector}>
                    {c.components[0] ?? c.tag}{c.text ? ` “${c.text.slice(0, 24)}”` : ''}
                  </span>
                ))}
              </div>
            )}
            {sel.crop && s.files[sel.crop] && <img className="crop" src={s.files[sel.crop]} alt={`Crop of selection ${i + 1}`} />}
            {sel.props && Object.keys(sel.props).length > 0 && <pre className="code">{JSON.stringify(sel.props, null, 1)}</pre>}
            {sel.note && <div className="note-box">💬 {sel.note}</div>}
          </div>
        ))}
      </section>
      <section>
        <h3>Errors ({p.errors.length})</h3>
        {p.errors.map((e, i) => (
          <pre key={i} className="code err">
            {e.kind}: {e.message}
            {e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : ''}
          </pre>
        ))}
      </section>
      <section>
        <h3>Network ({p.network.length})</h3>
        <table className="mini">
          <tbody>
            {p.network.slice(-15).map((n, i) => (
              <tr key={i} className={n.ok === false || n.error ? 'bad' : ''}>
                <td>{n.method}</td>
                <td className="url">{n.url}</td>
                <td>{n.error ?? n.status}</td>
                <td>{n.duration}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Breadcrumbs ({p.breadcrumbs.length})</h3>
        <ul className="crumbs">
          {p.breadcrumbs.slice(-15).map((b, i) => (
            <li key={i}>
              <span className="pill">{b.type}</span> {b.message}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Context</h3>
        <pre className="code">{JSON.stringify(p.context, null, 2)}</pre>
      </section>
    </div>
  );
}

function Screenshot({ s }: { s: Submission }) {
  const src = s.files['screenshot.png'];
  if (!src) return <p className="muted">No screenshot attached.</p>;
  const { width, height } = s.payload.page.size;
  return (
    <div className="shot-wrap">
      <img src={src} alt="screenshot" />
      {s.payload.selections.map((sel, i) => {
        const r = sel.region ? sel.region.docRect : sel.docRect;
        return (
          <div key={sel.id}>
            <div
              className={`shot-box${sel.kind === 'region' ? ' region' : ''}`}
              title={sel.components.join(' < ') || sel.selector}
              style={{ left: `${(r.x / width) * 100}%`, top: `${(r.y / height) * 100}%`, width: `${(r.width / width) * 100}%`, height: `${(r.height / height) * 100}%` }}
            >
              <span>{i + 1}</span>
            </div>
            {sel.region?.children.map((c, j) => (
              <div
                key={j}
                className="shot-box child"
                title={c.selector}
                style={{ left: `${(c.docRect.x / width) * 100}%`, top: `${(c.docRect.y / height) * 100}%`, width: `${(c.docRect.width / width) * 100}%`, height: `${(c.docRect.height / height) * 100}%` }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Prompt({ s }: { s: Submission }) {
  const md = toPromptContext(s.payload);
  return (
    <div>
      <div className="row">
        <p className="muted small">This is what you would hand to a model, alongside the screenshot for vision.</p>
        <button className="btn small" onClick={() => void navigator.clipboard.writeText(md)}>
          Copy
        </button>
      </div>
      <pre className="code">{md}</pre>
    </div>
  );
}
