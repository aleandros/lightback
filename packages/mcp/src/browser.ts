import type { Attachment, FeedbackPayload, LightbackClient } from '@lightback/core';
import { scopePath, type BrowserConnection, type Report, type ReportList } from './types';
export type { BrowserConnection, Report, ReportList, ReportSummary, ReportStatus, ThreadMessage } from './types';

/** Dev-only transport. Connect to the core client before sending follow-ups (for custom redaction). */
export function createFeedbackBridge(connection: BrowserConnection) {
  const url = new URL(connection.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Lightback bridge must use a loopback HTTP URL');
  const base = url.origin + scopePath(connection);
  // Capture fetch before installing this client's collectors. connect() also mutes synchronous request dispatch.
  const fetcher = globalThis.fetch.bind(globalThis);
  let client: LightbackClient | undefined;
  const request = async <T>(path: string, body?: BodyInit, json = false): Promise<T> => {
    let pending!: Promise<Response>;
    const dispatch = () => {
      pending = fetcher(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-lightback-token': connection.token, ...(json ? { 'content-type': 'application/json' } : {}) }, body, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      // Only dispatch is muted: a slow receiver must not mute unrelated app activity while it waits.
      return Promise.resolve();
    };
    if (client) await client.mute(dispatch); else await dispatch();
    const response = await pending;
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Lightback bridge ${response.status}: ${error.error ?? 'request failed'}`);
    }
    return response.json() as Promise<T>;
  };
  return {
    connect(value: LightbackClient) { client = value; },
    async send(payload: FeedbackPayload, attachments: Attachment[]): Promise<void> {
      if (!attachments.length) { await request('/reports', JSON.stringify(payload), true); return; }
      const form = new FormData(); form.append('payload', JSON.stringify(payload));
      for (const attachment of attachments) form.append(attachment.name, attachment.blob, attachment.name);
      await request('/reports', form);
    },
    list: () => request<ReportList>('/reports'),
    get: (id: string) => request<Report>(`/reports/${encodeURIComponent(id)}`),
    async followUp(id: string, expectedRevision: number, text: string, options: { selectionId?: string; messageId?: string } = {}) {
      if (!client) throw new Error('Call bridge.connect(client) before sending follow-ups so host redaction is applied');
      const clean = client.buildPayload({ text }).note.text;
      return request<Report>(`/reports/${encodeURIComponent(id)}/messages`, JSON.stringify({ messageId: options.messageId ?? crypto.randomUUID(), expectedRevision, text: clean, ...(options.selectionId ? { selectionId: options.selectionId } : {}) }), true);
    },
  };
}
export type FeedbackBridge = ReturnType<typeof createFeedbackBridge>;

/** Optional compact report thread, independent of the widget. Nothing mounts until explicitly called. */
export function mountFeedbackThread(options: { bridge: FeedbackBridge; container?: HTMLElement; pollInterval?: number }) {
  const host = document.createElement('lightback-thread');
  host.setAttribute('data-lightback-ignore', '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{position:fixed;bottom:16px;left:16px;z-index:2147483000;font:14px/1.45 system-ui;color:#20242b}
    details{width:300px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;background:#fff;border:1px solid #cad0da;border-radius:12px;box-shadow:0 4px 24px #0002}
    summary{padding:12px;cursor:pointer;font-weight:600}section{padding:0 12px 12px}select,textarea,button{font:inherit;box-sizing:border-box;max-width:100%}
    select,textarea{width:100%;padding:8px;border:1px solid #cad0da;border-radius:6px}textarea{min-height:70px;resize:vertical}
    ol{list-style:none;padding:0;margin:8px 0;max-height:230px;overflow:auto}li{white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;background:#f2f4f8;margin:6px 0;border-radius:6px}
    button{padding:7px 12px;margin-top:6px;cursor:pointer}p{margin:8px 0}small{display:block;color:#586273}[data-ref=error]{color:#a12424}
  </style><details data-ref="thread"><summary data-action="toggle">Agent feedback</summary><section>
    <label>Report<select data-ref="reports" aria-label="Report"></select></label>
    <p data-ref="status" role="status">No reports yet</p><ol data-ref="messages" aria-label="Conversation"></ol>
    <form data-ref="form"><label>Follow-up<textarea data-ref="note" maxlength="8000" placeholder="Review the change or ask for an adjustment"></textarea></label><button data-action="follow-up" type="submit">Send follow-up</button></form>
    <small>Ask your agent to watch Lightback to receive feedback.</small><p data-ref="error" role="alert"></p>
  </section></details>`;
  (options.container ?? document.body).append(host);
  const q = <T extends HTMLElement>(ref: string) => root.querySelector<T>(`[data-ref=${ref}]`)!;
  const select = q<HTMLSelectElement>('reports');
  const note = q<HTMLTextAreaElement>('note');
  const button = root.querySelector<HTMLButtonElement>('[data-action=follow-up]')!;
  button.disabled = true;
  let current: Report | undefined;
  let destroyed = false, busy = false, sending = false;
  let generation = 0;
  let retry: { id: string; revision: number; text: string; messageId: string } | undefined;
  const refresh = async () => {
    if (destroyed || busy || sending) return;
    busy = true;
    const version = generation;
    try {
      const list = await options.bridge.list();
      if (destroyed || version !== generation) return;
      const selected = select.value;
      select.replaceChildren(...list.reports.map(report => {
        const option = document.createElement('option'); option.value = report.id;
        option.textContent = `${report.status.replace('_', ' ')} · ${report.note || report.id}`; return option;
      }));
      const unavailable = !!selected && !list.reports.some(r => r.id === selected);
      if (unavailable) {
        // A retained draft belongs to its original report, even after expiry/restart.
        const option = document.createElement('option'); option.value = selected;
        option.textContent = 'Report unavailable · choose another report'; select.prepend(option);
      }
      if (selected) select.value = selected;
      else if (list.reports.length) select.value = list.reports[list.reports.length - 1]!.id;
      if (unavailable || current?.id !== select.value) { current = undefined; button.disabled = true; }
      const report = !unavailable && select.value ? await options.bridge.get(select.value) : undefined;
      if (destroyed || version !== generation) return;
      current = report;
      button.disabled = !report;
      q('status').textContent = report ? `${report.status.replace('_', ' ')} · revision ${report.revision}` : unavailable ? 'Report expired or unavailable. Copy your draft before choosing another report.' : 'No reports yet';
      const messages = report ? [
        ...(report.payload.note.text ? [{ role: 'reporter', text: report.payload.note.text }] : []),
        ...report.payload.selections.filter(selection => selection.note).map(selection => ({ role: 'reporter', text: `${selection.selector}: ${selection.note}` })),
        ...report.messages,
      ] : [];
      q('messages').replaceChildren(...messages.map(message => {
        const li = document.createElement('li'); li.textContent = `${message.role === 'agent' ? 'Agent' : 'You'}: ${message.text}`; return li;
      }));
      q('error').textContent = '';
    } catch (error) { if (!destroyed) q('error').textContent = error instanceof Error ? error.message : 'Bridge unavailable'; }
    finally { busy = false; }
  };
  select.addEventListener('change', () => { generation++; current = undefined; retry = undefined; note.value = ''; button.disabled = true; void refresh(); });
  q('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!current || sending || !note.value.trim()) return;
    sending = true; generation++; button.disabled = true; select.disabled = true;
    const text = note.value;
    if (!retry || retry.id !== current.id || retry.text !== text) retry = { id: current.id, revision: current.revision, text, messageId: crypto.randomUUID() };
    try {
      await options.bridge.followUp(retry.id, retry.revision, retry.text, { messageId: retry.messageId });
      if (!destroyed) { if (note.value === text) note.value = ''; retry = undefined; }
    } catch (error) {
      if (!destroyed) q('error').textContent = error instanceof Error ? error.message : 'Send failed';
      // Conflicts require a fresh read/review. A lost response retains the original idempotency key.
      if (error instanceof Error && error.message.includes('409:')) retry = undefined;
      sending = false; button.disabled = false; select.disabled = false; return;
    }
    sending = false; button.disabled = false; select.disabled = false; void refresh();
  });
  const timer = setInterval(() => { void refresh(); }, Math.max(1000, options.pollInterval ?? 2000));
  void refresh();
  return { element: host, refresh, destroy() { destroyed = true; generation++; clearInterval(timer); host.remove(); } };
}
