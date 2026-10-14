import type { FeedbackPayload } from '@lightback/core';

export interface BrowserConnection {
  url: string;
  project: string;
  session: string;
  token: string;
}
export interface BridgeConfig extends BrowserConnection {
  version: 1;
  origin: string;
  agentToken: string;
}
export type ReportStatus = 'pending' | 'in_progress' | 'resolved';
export interface ThreadMessage {
  id: string;
  role: 'reporter' | 'agent';
  text: string;
  createdAt: string;
  selectionId?: string;
}
export interface ReportSummary {
  id: string;
  project: string;
  session: string;
  status: ReportStatus;
  revision: number;
  sequence: number;
  receivedAt: string;
  expiresAt: string;
  note: string;
}
export interface Report extends ReportSummary {
  payload: FeedbackPayload;
  messages: ThreadMessage[];
}
export interface ReportList {
  instance: string;
  cursor: number;
  reports: ReportSummary[];
}
export interface MessageInput {
  messageId: string;
  expectedRevision: number;
  text: string;
  selectionId?: string;
}
export interface UpdateInput extends MessageInput { status: ReportStatus }

export function scopePath(connection: Pick<BrowserConnection, 'project' | 'session'>): string {
  return `/v1/projects/${encodeURIComponent(connection.project)}/sessions/${encodeURIComponent(connection.session)}`;
}
