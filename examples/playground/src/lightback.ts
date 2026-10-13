import { createLightback } from '@lightback/core';
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

export const screenshot = () =>
  import('modern-screenshot').then(({ domToBlob }) => domToBlob(document.documentElement, {
    type: 'image/png',
    scale: Math.min(window.devicePixelRatio, 2),
    // Match the dimensions the core reports in payload.page.size so docRects map 1:1.
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
