import { createLightback } from '@lightback/core';
import { domToBlob } from 'modern-screenshot';

/** Created at module load so console/network/error buffers start filling before React mounts. */
export const lightback = createLightback({
  endpoint: '/api/feedback',
  context: { app: 'playground', build: 'dev', release: '0.0.1' },
  capture: { networkBodies: true },
  beforeSend: (payload) => {
    console.info('[playground] beforeSend', payload.id, payload);
    return payload;
  },
});

export const screenshot = () =>
  domToBlob(document.documentElement, {
    type: 'image/png',
    scale: Math.min(window.devicePixelRatio, 2),
    // Match the dimensions the core reports in payload.page.size so docRects map 1:1.
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  });
