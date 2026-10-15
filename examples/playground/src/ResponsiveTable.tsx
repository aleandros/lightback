const rows = Array.from({ length: 250 }, (_, i) => i + 1);
const columns = Array.from({ length: 10 }, (_, i) => i + 1);

/** Both responsive layouts stay mounted, as in apps that switch tables to mobile cards with CSS. */
export function ResponsiveTable() {
  return <section data-ref="responsive-table">
    <h1>Responsive invoices</h1>
    <p>250 invoices, shown as a table on desktop and cards on mobile. Point at a cell and send a report to inspect its screenshot and crop in the inbox.</p>
    <div data-testid="capture-pixel" style={{ width: 120, height: 48, background: 'rgb(20, 180, 90)' }} />
    <table className="responsive-desktop" data-ref="desktop-table">
      <thead><tr>{columns.map((c) => <th key={c}>Field {c}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r}>{columns.map((c) => <td key={c}><span>Invoice {r} / {c}</span></td>)}</tr>)}</tbody>
    </table>
    <ul className="responsive-mobile" data-ref="mobile-cards">
      {rows.map((r) => <li key={r}><dl>{columns.map((c) => <div key={c}><dt><span>Field {c}</span></dt><dd><span>Invoice {r} / {c}</span></dd></div>)}</dl></li>)}
    </ul>
  </section>;
}
