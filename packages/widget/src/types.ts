import type { FeedbackPayload, LightbackClient, Rect } from '@lightback/core';
import type { WidgetStrings } from './strings';

export interface ScreenshotRequest {
  /**
   * Document area to capture, in CSS pixels (the space of `ElementSelection.docRect`): the whole page, or the
   * viewport with `screenshotArea: 'viewport'`. The image must show exactly this area, at any scale.
   */
  area: Rect;
}

export interface WidgetOptions {
  client: LightbackClient;
  /**
   * Return an image blob of `request.area` (the full page unless `screenshotArea` is 'viewport'). Called with the
   * widget hidden. Omit to disable screenshots.
   */
  screenshot?: (request: ScreenshotRequest) => Promise<Blob | null>;
  /**
   * What a capture covers. 'page' (default) asks for the whole document. 'viewport' asks for what is on screen:
   * images stay small on long pages, and `domCapturer` copies only what is on screen. A selection the first capture
   * does not show gets its crop from a capture of the screen it was selected on.
   */
  screenshotArea?: 'page' | 'viewport';
  /**
   * Capture a screenshot automatically when pick mode starts and attach a padded crop of every selection.
   * Defaults to true when `screenshot` is provided.
   */
  autoScreenshot?: boolean;
  /**
   * Skip automatic captures when the capturer would have to clone more elements than this: DOM-cloning capturers
   * block the page for time proportional to it. Counts what `domCapturer` clones, excluding hidden subtrees in
   * both modes. Viewport captures retain off-screen layout boxes and fixed-element paths. The Screenshot button
   * still captures on request and is highlighted after an automatic skip/failure. Default 8000; `Infinity` disables the check.
   */
  screenshotMaxElements?: number;
  /** Padding in CSS pixels around a selection in its crop. Default 16. */
  cropPadding?: number;
  /**
   * Milliseconds the "Sending…" card stays cancellable before the report actually goes out.
   * 0 sends immediately. Default 5000.
   */
  sendDelay?: number;
  position?: 'bottom-right' | 'bottom-left';
  /** Legacy alias for strings.pillOpen; strings.pillOpen takes precedence. */
  triggerLabel?: string;
  strings?: Partial<WidgetStrings>;
  theme?: 'light' | 'dark' | 'auto';
  hideTrigger?: boolean;
  /** CSS color for buttons and highlights. */
  accent?: string;
  onSent?: (payload: FeedbackPayload) => void;
  onError?: (error: unknown) => void;
}

export interface WidgetHandle {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  startPicking(): void;
  destroy(): void;
}
