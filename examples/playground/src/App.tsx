import { navigate, usePath } from './router';
import { Dashboard } from './Dashboard';
import { Inbox } from './Inbox';

export function App() {
  const path = usePath();
  return (
    <div className="shell">
      <Sidebar path={path} />
      <main className="main">{path === '/inbox' ? <Inbox /> : <Dashboard />}</main>
    </div>
  );
}

function Sidebar({ path }: { path: string }) {
  const Item = ({ to, label }: { to: string; label: string }) => (
    <a
      href={to}
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
      </nav>
      <p className="hint">
        Use the <strong>Feedback</strong> button bottom-right. Try selecting rows, buttons or the chart, then open
        the inbox to see what arrived.
      </p>
    </aside>
  );
}
