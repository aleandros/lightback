import { createHash, randomUUID } from 'node:crypto';
import type { FeedbackPayload } from '@lightback/core';
import type { MessageInput, Report, ReportList, ReportSummary, UpdateInput } from './types';

export class BridgeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface StoredReport { report: Report; files: Map<string, Buffer>; digest: string; bytes: number; operations: Map<string, string> }
export interface StoreOptions {
  project: string;
  session: string;
  maxReports?: number;
  maxBytes?: number;
  retentionMs?: number;
  now?: () => number;
}
export class ReportStore {
  readonly instance = randomUUID();
  private entries = new Map<string, StoredReport>();
  private sequence = 0;
  private bytes = 0;
  private listeners = new Set<() => void>();
  private now: () => number;
  constructor(private options: StoreOptions) { this.now = options.now ?? Date.now; }
  prune() {
    for (const [id, value] of this.entries) if (Date.parse(value.report.expiresAt) <= this.now()) {
      this.entries.delete(id); this.bytes -= value.bytes;
    }
  }
  private summary(report: Report): ReportSummary {
    const { payload, messages, ...summary } = report;
    return { ...summary, note: summary.note.slice(0, 300) };
  }
  private changed() { for (const listener of this.listeners) listener(); }
  list(after = 0): ReportList {
    this.prune();
    return { instance: this.instance, cursor: this.sequence, reports: [...this.entries.values()].filter(v => v.report.sequence > after).map(v => this.summary(v.report)) };
  }
  get(id: string): StoredReport {
    this.prune();
    const value = this.entries.get(id);
    if (!value) throw new BridgeError(404, 'Report not found or expired');
    return value;
  }
  submit(payload: FeedbackPayload, files: Map<string, Buffer>): Report {
    this.prune();
    const json = JSON.stringify(payload);
    const hash = createHash('sha256').update(json);
    for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(bytes);
    const digest = hash.digest('hex');
    const existing = this.entries.get(payload.id);
    if (existing) {
      if (existing.digest !== digest) throw new BridgeError(409, 'Report ID already used for different content');
      return existing.report;
    }
    const bytes = Buffer.byteLength(json) + [...files.values()].reduce((sum, b) => sum + b.length, 0);
    if (this.entries.size >= (this.options.maxReports ?? 100) || this.bytes + bytes > (this.options.maxBytes ?? 64 * 1024 * 1024)) throw new BridgeError(429, 'Feedback queue is full; wait for retention expiry or restart the bridge');
    const report: Report = {
      id: payload.id, project: this.options.project, session: this.options.session, status: 'pending', revision: 1,
      sequence: ++this.sequence, receivedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(this.now() + (this.options.retentionMs ?? 30 * 60_000)).toISOString(),
      note: payload.note.text || payload.selections.map(s => s.note).filter(Boolean).join(' · '), payload, messages: [],
    };
    this.entries.set(report.id, { report, files, digest, bytes, operations: new Map() });
    this.bytes += bytes; this.changed(); return report;
  }
  message(id: string, input: MessageInput | UpdateInput, role: 'reporter' | 'agent'): Report {
    const entry = this.get(id);
    const report = entry.report;
    const operation = JSON.stringify({ role, ...input });
    const prior = entry.operations.get(input.messageId);
    if (prior) {
      if (prior !== operation) throw new BridgeError(409, 'Message ID already used for different content');
      return report;
    }
    if (report.revision !== input.expectedRevision) throw new BridgeError(409, 'Revision changed; read the report again before updating');
    if (input.selectionId && !report.payload.selections.some(s => s.id === input.selectionId)) throw new BridgeError(400, 'Unknown selection ID');
    if (report.messages.length >= 100) throw new BridgeError(429, 'Thread is full; submit a new annotated report');
    const bytes = Buffer.byteLength(operation);
    if (this.bytes + bytes > (this.options.maxBytes ?? 64 * 1024 * 1024)) throw new BridgeError(429, 'Feedback queue is full');
    report.messages.push({ id: input.messageId, role, text: input.text, createdAt: new Date(this.now()).toISOString(), ...(input.selectionId ? { selectionId: input.selectionId } : {}) });
    report.status = role === 'reporter' ? 'pending' : (input as UpdateInput).status;
    report.revision++; report.sequence = ++this.sequence;
    entry.operations.set(input.messageId, operation); entry.bytes += bytes; this.bytes += bytes;
    this.changed(); return report;
  }
  async wait(after: number, timeoutMs: number, signal?: AbortSignal): Promise<ReportList> {
    if (this.sequence > after || signal?.aborted) return this.list(after);
    if (this.listeners.size >= 16) throw new BridgeError(429, 'Too many waiting clients');
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.listeners.delete(done); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      this.listeners.add(done); signal?.addEventListener('abort', done, { once: true });
    });
    return this.list(after);
  }
}
