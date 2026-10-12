import type { FeedbackPayload, LightbackClient } from '@lightback/core';
import type { WidgetStrings } from './strings';

export interface WidgetOptions {
  client: LightbackClient;
  /** Return an image blob of the full page. Called with the widget hidden. Omit to disable screenshots. */
  screenshot?: () => Promise<Blob | null>;
  /**
   * Capture a screenshot automatically when pick mode starts and attach a padded crop of every selection.
   * Defaults to true when `screenshot` is provided.
   */
  autoScreenshot?: boolean;
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
