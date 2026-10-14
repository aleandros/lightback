import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
// Core redaction can alter generated IDs; treat report IDs as opaque path segments.
export const reportIdSchema = z.string().min(1).max(200).refine(id => id !== '.' && id !== '..');
const text = z.string().max(100_000);
const num = z.number().finite();
const size = z.object({ width: num.nonnegative(), height: num.nonnegative() });
const point = z.object({ x: num, y: num });
const rect = point.extend(size.shape);
const source = z.object({ file: text, line: num.optional(), column: num.optional() });
const summary = z.object({
  selector: text, tag: text, text, role: text.optional(), components: z.array(text).max(100),
  rect, docRect: rect, source: source.optional(), sensitive: z.boolean().optional(),
});
const selection = summary.omit({ role: true }).extend({
  id: text, kind: z.enum(['element', 'region']), elementId: text.optional(), classes: z.array(text).max(500),
  attrs: z.record(z.string(), text), framework: z.enum(['react', 'vue']).nullable(),
  chain: z.array(z.object({ name: text, source: source.optional() })).max(100),
  props: z.record(z.string(), z.unknown()).optional(), crop: text.optional(), note: text.optional(), html: text.optional(),
  region: z.object({ rect, docRect: rect, children: z.array(summary).max(2000) }).optional(),
});
export const attachmentSchema = z.object({ name: z.string().min(1).max(200), type: z.literal('image/png'), size: z.number().int().nonnegative().max(5 * 1024 * 1024), area: rect.optional() });
// Boundary validation for the fields consumed by toPromptContext. Unknown v1 extension fields survive.
export const payloadSchema = z.object({
  version: z.literal(1), id: reportIdSchema, createdAt: z.iso.datetime({ offset: true }),
  page: z.object({ url: text, title: text, referrer: text, scroll: point, size }),
  note: z.object({ text, transcript: text.optional() }), selections: z.array(selection).max(50),
  attachments: z.array(attachmentSchema).max(51),
  env: z.object({ userAgent: text, language: text, timezone: text, viewport: size, screen: size, devicePixelRatio: num, online: z.boolean(), platform: text.optional() }),
  console: z.array(z.object({ t: num, level: z.enum(['log', 'info', 'warn', 'error', 'debug']), message: text })).max(1000),
  errors: z.array(z.object({ t: num, kind: z.enum(['error', 'unhandledrejection']), message: text, stack: text.optional(), source: text.optional() })).max(1000),
  network: z.array(z.object({ t: num, kind: z.enum(['fetch', 'xhr']), method: text, url: text, status: num.optional(), ok: z.boolean().optional(), duration: num.optional(), error: text.optional(), requestBody: text.optional(), responseBody: text.optional() })).max(1000),
  breadcrumbs: z.array(z.object({ t: num, type: z.enum(['click', 'input', 'navigation', 'visibility', 'custom']), message: text, data: z.record(z.string(), z.unknown()).optional() })).max(1000),
  context: z.record(z.string(), z.unknown()), masks: z.array(z.object({ docRect: rect, reason: z.enum(['sensitive', 'reporter']) })).max(1000).optional(),
}).passthrough();
export const statusSchema = z.enum(['pending', 'in_progress', 'resolved']);
export const messageSchema = z.object({
  messageId: idSchema, expectedRevision: z.number().int().positive(),
  text: z.string().trim().min(1).max(8000), selectionId: z.string().max(200).optional(),
});
export const updateSchema = messageSchema.extend({ status: statusSchema });
