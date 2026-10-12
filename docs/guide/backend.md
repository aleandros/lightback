# Building your own backend

Lightback does not come with a server. You give it a URL or a function and it delivers the report. This page is the contract, a minimal receiver, and what to do with a report once you have it.

## The wire contract

The default transport posts to `endpoint` with `POST`.

**No attachments** (screenshots disabled or none captured): `Content-Type: application/json`, body is the `FeedbackPayload`.

**With attachments**: `Content-Type: multipart/form-data`. Fields:

| Field | Content |
| --- | --- |
| `payload` | The `FeedbackPayload` as a JSON string. |
| `screenshot.png` | Full-page capture, when one was taken. |
| `selection-1.png`, `selection-2.png`, … | One outlined crop per selection that has one. The selection's `crop` field names its file. |

`payload.attachments` lists every file with `name`, `type` and `size` so you can verify nothing was dropped.

Extra headers go through `headers`:

```ts
createLightback({
  endpoint: 'https://api.example.com/feedback',
  headers: { 'x-api-key': PUBLIC_WRITE_KEY },
});
```

That key is public by nature: it ships in the browser. Treat the endpoint like any public form: rate limit it, cap body size (a report with a retina full-page PNG can reach a few MB), and validate `payload.version === 1`.

## A minimal receiver

Node with Hono, which runs on Node, Bun, Deno, Cloudflare Workers and Vercel:

```ts
import { Hono } from 'hono';
import type { FeedbackPayload } from '@lightback/core';

const app = new Hono();

app.post('/api/feedback', async (c) => {
  const type = c.req.header('content-type') ?? '';
  let payload: FeedbackPayload;
  const files: Record<string, File> = {};

  if (type.startsWith('multipart/form-data')) {
    const form = await c.req.formData();
    payload = JSON.parse(form.get('payload') as string);
    for (const [name, value] of form.entries()) if (value instanceof File) files[name] = value;
  } else {
    payload = await c.req.json();
  }

  if (payload.version !== 1) return c.json({ error: 'unsupported payload version' }, 400);

  await store(payload, files); // your database and object storage
  return c.json({ ok: true, id: payload.id });
});
```

The same shape works in Express with `multer`, in Next.js route handlers with `request.formData()`, and in any framework that can parse multipart. The playground's mock in `examples/playground/vite.config.ts` is a complete reference receiver in forty lines.

## Fully custom transport

Skip HTTP entirely with `send`. It receives the payload and the attachments as `Blob`s and can do anything: a WebSocket, a queue, a Supabase insert, a GitHub issue.

```ts
createLightback({
  send: async (payload, attachments) => {
    const { data } = await supabase.from('feedback').insert({ id: payload.id, payload }).select().single();
    for (const a of attachments) {
      await supabase.storage.from('feedback').upload(`${payload.id}/${a.name}`, a.blob, { contentType: a.type });
    }
  },
});
```

If `send` throws, the widget shows the error and keeps the draft.

## Shaping the report before it leaves

`beforeSend` runs after redaction and right before the transport. Return the payload (mutated or not) to continue, or `null` to cancel silently.

```ts
createLightback({
  endpoint: '/api/feedback',
  beforeSend: (payload) => {
    if (payload.page.url.includes('/admin')) return null;        // never report from here
    payload.context.tenant = currentTenant();                      // enrich
    payload.network = payload.network.filter((n) => !n.url.includes('/analytics'));
    return payload;
  },
});
```

Use it for dynamic context, extra scrubbing, sampling, or routing by adding a field the server reads.

## Triage with a model

The payload is built to be read by a model. `toPromptContext` renders it as bounded markdown with the note, each selection's component chain and source, the failing requests, errors, console and breadcrumbs.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { toPromptContext } from '@lightback/core';

async function triage(payload: FeedbackPayload, screenshot?: Buffer) {
  const client = new Anthropic();
  const content: Anthropic.MessageParam['content'] = [
    { type: 'text', text: toPromptContext(payload) },
  ];
  if (screenshot) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot.toString('base64') } });
  content.push({ type: 'text', text: 'Summarise the problem in one sentence, name the most likely component and file, and rate severity 1-5. Answer as JSON.' });

  const res = await client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 400, messages: [{ role: 'user', content }] });
  return JSON.parse(res.content[0].type === 'text' ? res.content[0].text : '{}');
}
```

Send the crops too when there are selections; a crop is small and shows exactly what the user meant. The playground's Prompt tab shows the rendered markdown for any report, which is the fastest way to see what the model will read.

A reference implementation of this handler, with a JSON Schema for the payload, is on the roadmap.

## Storage notes

- Key reports by `payload.id`; it is a UUID generated in the browser and also returned to the widget's `onSent`.
- Keep attachments in object storage and the JSON in a database or a document store. The JSON alone is typically 20 to 80 KB with full buffers.
- `payload.context` is whatever the app attached: user id, tenant, feature flags. Index the fields you will filter by.
- Nothing in the payload is secret by design (redaction runs in the browser), but `console` and `network` can still contain internal URLs. Treat reports as internal data.
