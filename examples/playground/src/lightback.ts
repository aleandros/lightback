import { createFeedbackBridge } from '@lightback/mcp/browser';
import { createLightback } from '@lightback/core';
import { domCapturer } from '@lightback/widget/lazy';
import { isDemo } from './mode';
import { saveSubmission } from './submissions';

// Explicit dev-only opt-in. This JSON must contain browser-config output, never agent credentials.
export const feedbackBridge = import.meta.env.DEV && import.meta.env.VITE_LIGHTBACK_BRIDGE
  ? createFeedbackBridge(JSON.parse(import.meta.env.VITE_LIGHTBACK_BRIDGE)) : undefined;

/** Created at module load so console/network/error buffers start filling before React mounts. */
export const lightback = createLightback({
  ...(feedbackBridge ? { send: feedbackBridge.send } : isDemo ? { send: saveSubmission } : { endpoint: '/api/feedback' }),
  context: { app: 'playground', build: isDemo ? 'demo' : 'dev', release: '0.0.1' },
  capture: { networkBodies: true },
  // Typed customer names are masked in screenshots, like the sidebar account marked with data-lightback-sensitive.
  privacy: { selectors: ['.chaos input'] },
  beforeSend: (payload) => {
    console.info('[playground] beforeSend', payload.id, payload);
    return payload;
  },
});

feedbackBridge?.connect(lightback);

/** Captures what Lightback asks for (the viewport, see `screenshotArea` in main.tsx), so docRects map onto the image. */
export const screenshot = domCapturer((root, options) =>
  import('modern-screenshot').then(({ domToBlob }) => domToBlob(root, { ...options, type: 'image/png', scale: Math.min(window.devicePixelRatio, 2) })));
