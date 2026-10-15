import { useLightbackWidget } from '@lightback/react';
import { hrefFor, navigate, usePath } from './router';
import { isDemo } from './mode';
import { Dashboard } from './Dashboard';
import { Inbox } from './Inbox';
import { ResponsiveTable } from './ResponsiveTable';

export function App() {
  const path = usePath();
  const widget = useLightbackWidget();
  return (
    <div className="shell">
      <Sidebar path={path} />
      <main className="main">
        {isDemo && <section className="demo-intro" data-lightback-ignore data-ref="demo-intro">
          <span className="demo-eyebrow">INTERACTIVE DEMO</span>
          <h1>Try a report from both sides.</h1>
          <p>Pick an element or drag an area, add a note, then send. Open the inbox to inspect the screenshot and context.</p>
          <div className="row wrap">
            <button className="btn primary" data-action="demo-pick" onClick={() => widget?.startPicking()}>Point at something</button>
            <a className="btn" data-action="demo-inbox" href={hrefFor('/inbox')} onClick={(e) => { e.preventDefault(); navigate('/inbox'); }}>Open inbox</a>
            <a className="demo-guide" href="https://aleandros.github.io/lightback/guide/getting-started">Read the guide →</a>
          </div>
          <p className="small muted">Reports and screenshots stay in this browser. The inbox keeps your latest 20 reports; Clear removes them. Payments and errors are simulated.</p>
        </section>}
        {path === '/inbox' ? <Inbox /> : path === '/responsive-table' ? <ResponsiveTable /> : <Dashboard />}
      </main>
    </div>
  );
}

function Sidebar({ path }: { path: string }) {
  const Item = ({ to, label }: { to: string; label: string }) => (
    <a
      href={hrefFor(to)}
      data-action={to === '/' ? 'nav-dashboard' : to === '/inbox' ? 'nav-inbox' : 'nav-responsive-table'}
      className={path === to ? 'nav-item active' : 'nav-item'}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo">⚡</span> Lightback
      </div>
      <nav>
        <Item to="/" label="Dashboard" />
        <Item to="/inbox" label="Feedback inbox" />
        <Item to="/responsive-table" label="Responsive table" />
      </nav>
      {/* Sensitive: reports keep the selector but never this text, and screenshots show an opaque box. */}
      <div className="account" data-lightback-sensitive data-testid="account">
        <span className="account-name">Dana Whitfield</span>
        <span className="muted small">dana@initech.example · •••• 4242</span>
      </div>
      <p className="hint">
        Use the <strong>Feedback</strong> button bottom-right. Try selecting rows, buttons or the totals, then open
        the inbox to see what arrived.
      </p>
    </aside>
  );
}
