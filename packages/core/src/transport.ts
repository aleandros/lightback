import type { Attachment, FeedbackPayload } from './types';

/**
 * Default transport. Sends JSON when there are no attachments, multipart otherwise.
 * Multipart layout: field `payload` holds the JSON string; each attachment is a file field named by `attachment.name`.
 */
export async function fetchTransport(
  endpoint: string,
  payload: FeedbackPayload,
  attachments: Attachment[],
  headers: Record<string, string> = {},
): Promise<void> {
  let res: Response;
  if (attachments.length === 0) {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  } else {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    for (const a of attachments) form.append(a.name, a.blob, a.name);
    res = await fetch(endpoint, { method: 'POST', headers, body: form });
  }
  if (!res.ok) throw new Error(`Lightback: endpoint responded ${res.status}`);
}
