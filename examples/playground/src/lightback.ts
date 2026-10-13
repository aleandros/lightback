import { createLightback } from '@lightback/core';
import { domCapturer } from '@lightback/widget/lazy';
import { isDemo } from './mode';
import { saveSubmission } from './submissions';

/** Created at module load so console/network/error buffers start filling before React mounts. */
export const lightback = createLightback({
  ...(isDemo ? { send: saveSubmission } : { endpoint: '/api/feedback' }),
  context: { app: 'playground', build: isDemo ? 'demo' : 'dev', release: '0.0.1' },
  capture: { networkBodies: true },
  // Typed customer names are masked in screenshots, like the sidebar account marked with data-lightback-sensitive.
  privacy: { selectors: ['.chaos input'] },
  beforeSend: (payload) => {
    console.info('[playground] beforeSend', payload.id, payload);
    return payload;
  },
});

/** Captures what Lightback asks for (the viewport, see `screenshotArea` in main.tsx), so docRects map onto the image. */
export const screenshot = domCapturer((root, options) =>
  import('modern-screenshot').then(({ domToBlob }) => domToBlob(root, { ...options, type: 'image/png', scale: Math.min(window.devicePixelRatio, 2) })));
