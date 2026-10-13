export type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  t: number;
  level: Level;
  message: string;
}

export interface ErrorEntry {
  t: number;
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
  source?: string;
}

export interface NetworkEntry {
  t: number;
  kind: 'fetch' | 'xhr';
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  duration?: number;
  error?: string;
  requestBody?: string;
  responseBody?: string;
}

export interface Breadcrumb {
  t: number;
  type: 'click' | 'input' | 'navigation' | 'visibility' | 'custom';
  message: string;
  data?: Record<string, unknown>;
}

export interface Env {
  userAgent: string;
  language: string;
  timezone: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  online: boolean;
  platform?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface ComponentInfo {
  name: string;
  /** Where this component was rendered from (JSX call site), when a dev build exposes it. */
  source?: SourceLocation;
}

/** Compact description of an element inside a region selection. */
export interface ElementSummary {
  selector: string;
  tag: string;
  text: string;
  role?: string;
  components: string[];
  rect: Rect;
  docRect: Rect;
  source?: SourceLocation;
  /** Inside a sensitive subtree: text and role are withheld. */
  sensitive?: boolean;
}

export interface ElementSelection {
  id: string;
  /** `element` for a single click, `region` for a dragged rectangle. */
  kind: 'element' | 'region';
  selector: string;
  tag: string;
  elementId?: string;
  classes: string[];
  text: string;
  attrs: Record<string, string>;
  /** Viewport-relative rect at selection time. */
  rect: Rect;
  /** Document-relative rect (rect + scroll offset), for overlaying on full-page screenshots. */
  docRect: Rect;
  framework: 'react' | 'vue' | null;
  /** Component chain from the element outward, e.g. ["InvoiceRow", "InvoiceTable", "Dashboard", "App"]. */
  components: string[];
  /** Same chain with per-component source locations when available. */
  chain: ComponentInfo[];
  /** JSX call site of this element in a dev build, or a `data-source` attribute stamped by a build plugin. */
  source?: SourceLocation;
  /** Sanitized props of the nearest component (functions, elements and children stripped, depth-limited). */
  props?: Record<string, unknown>;
  /** Attachment name of a cropped screenshot of this selection, when one was captured. */
  crop?: string;
  /** Region selections only: the dragged rectangle and the visible elements it contains. */
  region?: { rect: Rect; docRect: Rect; children: ElementSummary[] };
  /** Note the reporter attached to this specific element. */
  note?: string;
  /** Short HTML snippet (outerHTML trimmed) for extra context. */
  html?: string;
  /** Inside a sensitive subtree: text, classes, attributes, props and HTML are withheld. */
  sensitive?: boolean;
}

/** An opaque box painted over screenshot pixels before they are stored, previewed or sent. */
export interface ScreenshotMask {
  /** Document-relative rect, in the same space as `ElementSelection.docRect`. */
  docRect: Rect;
  /** `sensitive`: a host-marked element at capture time. `reporter`: an area the reporter chose to hide. */
  reason: 'sensitive' | 'reporter';
}

export interface AttachmentRef {
  name: string;
  type: string;
  size: number;
  /**
   * For images: the document area the image shows, in CSS pixels (the space of `ElementSelection.docRect`).
   * Map a docRect onto the image by subtracting `area.x`/`area.y` and scaling by `imageWidth / area.width`.
   * Absent for non-images and for older senders; a `screenshot.png` without it covers the whole page (`page.size`).
   */
  area?: Rect;
}

export interface Attachment extends AttachmentRef {
  blob: Blob;
}

export interface FeedbackPayload {
  version: 1;
  id: string;
  createdAt: string;
  page: {
    url: string;
    title: string;
    referrer: string;
    scroll: { x: number; y: number };
    /** Full document size, so docRects can be mapped onto a full-page screenshot. */
    size: { width: number; height: number };
  };
  note: { text: string; transcript?: string };
  selections: ElementSelection[];
  attachments: AttachmentRef[];
  env: Env;
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  network: NetworkEntry[];
  breadcrumbs: Breadcrumb[];
  context: Record<string, unknown>;
  /** Areas covered in the attached screenshots. Absent when nothing was masked. */
  masks?: ScreenshotMask[];
}

export interface Limits {
  console: number;
  errors: number;
  network: number;
  breadcrumbs: number;
  /** Max characters kept for any single string (message, body, text). */
  string: number;
}

export interface RedactOptions {
  /** Header names (case-insensitive) whose values get replaced. */
  headers: string[];
  /** URL query params whose values get replaced. */
  urlParams: string[];
  /** Regexes applied to every captured string. */
  patterns: RegExp[];
  replacement: string;
}

export interface PersistenceOptions {
  /** Storage namespace. Use a different key for each app/client on the same origin. */
  key?: string;
  /** Recovery expiry after the last checkpoint, in milliseconds. Default and maximum: 30 minutes. */
  maxAge?: number;
  /** Maximum stored snapshot size, including blobs. Default: 5 MiB. Oversized attachments are omitted. */
  maxBytes?: number;
  /** Persist screenshot blobs. Off by default. The widget stores only masked images (see privacy). */
  attachments?: boolean;
}

export interface PrivacyOptions {
  /**
   * CSS selectors for sensitive subtrees, in addition to the `data-lightback-sensitive` attribute. Matching elements
   * and their descendants keep their selector and component names; text, attributes, props, HTML and pixels are withheld.
   */
  selectors?: string[];
}

export interface LightbackOptions {
  /** Sensitive elements to withhold from reports and mask in screenshots. */
  privacy?: PrivacyOptions;
  /** Session recovery is on by default. Set false to avoid all recovery storage access. */
  persistence?: false | PersistenceOptions;
  /** URL that receives submissions. Ignored if `send` is provided. */
  endpoint?: string;
  /** Fully custom transport. */
  send?: (payload: FeedbackPayload, attachments: Attachment[]) => Promise<void>;
  /** Extra headers for the default fetch transport. */
  headers?: Record<string, string>;
  /** Mutate or veto the payload right before sending. Return null to cancel. */
  beforeSend?: (payload: FeedbackPayload) => FeedbackPayload | null | Promise<FeedbackPayload | null>;
  /** Static context merged into every payload. */
  context?: Record<string, unknown>;
  capture?: Partial<{
    console: boolean;
    errors: boolean;
    network: boolean;
    breadcrumbs: boolean;
    /** Capture request/response bodies for same-origin requests. Off by default. */
    networkBodies: boolean;
  }>;
  limits?: Partial<Limits>;
  redact?: Partial<RedactOptions>;
}
