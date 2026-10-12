import { apiUrl, isDemo } from './mode';
import { useState } from 'react';
import { useLightback, useLightbackWidget } from '@lightback/react';

interface Invoice {
  id: string;
  customer: string;
  total: number;
  status: 'paid' | 'due' | 'overdue';
}

const INVOICES: Invoice[] = [
  { id: 'INV-1042', customer: 'Acme Corp', total: 1280, status: 'paid' },
  { id: 'INV-1043', customer: 'Globex', total: 90, status: 'due' },
  { id: 'INV-1044', customer: 'Initech', total: 4210.5, status: 'overdue' },
  { id: 'INV-1045', customer: 'Umbrella', total: 760, status: 'due' },
];

export function Dashboard() {
  return (
    <>
      <Header />
      <div className="grid">
        <StatCard label="Outstanding" value="$5,060.50" trend="+12%" />
        <StatCard label="Paid this month" value="$1,280.00" trend="-3%" />
        <StatCard label="Overdue" value="1 invoice" trend="" />
      </div>
      <InvoiceTable invoices={INVOICES} />
      <ChaosPanel />
    </>
  );
}

function Header() {
  const widget = useLightbackWidget();
  const [exporting, setExporting] = useState(false);
  return (
    <header className="page-header">
      <h1>Invoices</h1>
      <div className="row">
        <button className="btn" onClick={() => setExporting(true)}>
          Export…
        </button>
        {exporting && <ExportDialog onClose={() => setExporting(false)} />}
        <button className="btn" onClick={() => widget?.startPicking()}>
          Report an issue with an element
        </button>
        <button className="btn primary" onClick={() => widget?.open()}>
          Give feedback
        </button>
      </div>
    </header>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const [format, setFormat] = useState('csv');
  const [range, setRange] = useState('month');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Export invoices" onClick={(e) => e.stopPropagation()}>
        <h2>Export invoices</h2>
        <p className="muted">Everything behind this dialog is covered by the backdrop. Drag a rectangle over it to see region selection pick the dialog, not the table.</p>
        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="csv">CSV</option>
            <option value="xlsx">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label className="field">
          <span>Date range</span>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label className="field checkbox">
          <input type="checkbox" defaultChecked /> <span>Include paid invoices</span>
        </label>
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { console.warn('export not implemented', { format, range }); onClose(); }}>Export</button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, trend }: { label: string; value: string; trend: string }) {
  return (
    <div className="card stat" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {trend && <div className={trend.startsWith('-') ? 'trend down' : 'trend up'}>{trend}</div>}
    </div>
  );
}

function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  return (
    <div className="card table-scroll">
      <table className="invoices">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} invoice={inv} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [state, setState] = useState<'idle' | 'paying' | 'failed' | 'paid'>(invoice.status === 'paid' ? 'paid' : 'idle');
  const lb = useLightback();

  const pay = async () => {
    setState('paying');
    lb.addBreadcrumb('pay clicked', { invoice: invoice.id });
    try {
      // Overdue invoices hit the failing endpoint on purpose.
      const res = await fetch(invoice.status === 'overdue' ? apiUrl('fail') : apiUrl('echo'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1XzEyMyJ9.c2VjcmV0c2lnbmF0dXJlX3h4eHh4eHh4' },
        body: JSON.stringify({ invoice: invoice.id, amount: invoice.total }),
      });
      if (!res.ok) throw new Error(`Payment failed for ${invoice.id}: ${res.status}`);
      setState('paid');
    } catch (err) {
      console.error('payment error', err);
      setState('failed');
    }
  };

  return (
    <tr className={`invoice-row status-${invoice.status}`} data-invoice-id={invoice.id}>
      <td>
        <code>{invoice.id}</code>
      </td>
      <td>{invoice.customer}</td>
      <td>${invoice.total.toFixed(2)}</td>
      <td>
        <StatusPill status={state === 'paid' ? 'paid' : invoice.status} />
      </td>
      <td className="actions">
        {state !== 'paid' && (
          <button data-action="pay" className="btn small" onClick={pay} disabled={state === 'paying'}>
            {state === 'paying' ? 'Paying…' : state === 'failed' ? 'Retry' : 'Pay'}
          </button>
        )}
        {state === 'failed' && <span className="error-text">Payment failed</span>}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: Invoice['status'] }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

function ChaosPanel() {
  const lb = useLightback();
  const [name, setName] = useState('');
  const xhr = (url: string) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.send();
  };
  return (
    <div className="card chaos">
      <h2>Generate noise</h2>
      <p className="muted">Each button leaves something in the buffers. Then open the widget and expand “Review what will be sent”.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => console.log('user viewed invoices', { count: INVOICES.length })}>console.log</button>
        <button className="btn" onClick={() => console.warn('cache miss for /invoices', { ttl: 30 })}>console.warn</button>
        <button className="btn" onClick={() => console.error('render budget exceeded', new Error('slow frame'))}>console.error</button>
        <button
          className="btn danger"
          onClick={() => {
            setTimeout(() => {
              throw new TypeError("Cannot read properties of undefined (reading 'total')");
            });
          }}
        >
          Throw error
        </button>
        <button className="btn danger" onClick={() => void Promise.reject(new Error('token refresh failed'))}>
          Reject promise
        </button>
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => void fetch(apiUrl('invoices'))}>fetch 200</button>
        <button data-action="fetch-failure" className="btn" onClick={() => void fetch(apiUrl('fail'))}>fetch 500</button>
        <button className="btn" onClick={() => void fetch(apiUrl('notfound?token=supersecret&q=x'))}>fetch 404 (redacted param)</button>
        <button className="btn" onClick={() => void fetch(apiUrl('slow'))}>fetch slow</button>
        <button data-action="xhr-success" className="btn" onClick={() => xhr(apiUrl('invoices'))}>XHR 200</button>
        {!isDemo && <button className="btn" onClick={() => void fetch('https://httpstat.us/503').catch(() => {})}>cross-origin</button>}
      </div>
      <div className="row wrap">
        <button className="btn" onClick={() => lb.addBreadcrumb('custom: opened export dialog', { format: 'csv' })}>custom breadcrumb</button>
        <button className="btn" onClick={() => lb.setContext({ featureFlags: { newCheckout: true, betaCharts: false } })}>set context (flags)</button>
        <label className="inline">
          <span>Type here (values are never captured)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="customer name" />
        </label>
      </div>
    </div>
  );
}
