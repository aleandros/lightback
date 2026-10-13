import type { Rect } from '@lightback/core';

/** Decode once into a drawImage source, including browsers without createImageBitmap. */
export async function decodeScreenshot(blob: Blob): Promise<ImageBitmap | HTMLCanvasElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Lightback: screenshot could not be decoded'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Lightback: screenshot requires a 2D canvas');
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type Drawable = ImageBitmap | HTMLCanvasElement;
export interface Page { width: number; height: number }
export interface Shot {
  blob: Blob;
  bitmap: Drawable;
  /** Document size when captured, so document-space rects map onto the bitmap. */
  page: Page;
}

/** CSS pixels added around every mask to cover antialiased edges and subpixel layout. */
const MASK_BLEED = 2;
export const MASK_FILL = '#111827';

/** Bitmap pixels covered by a document-space rect, clamped to the image. */
export function maskBounds(rect: Rect, page: Page, size: { width: number; height: number }): Rect | null {
  const sx = size.width / page.width;
  const sy = size.height / page.height;
  const x0 = Math.max(0, Math.floor((rect.x - MASK_BLEED) * sx));
  const y0 = Math.max(0, Math.floor((rect.y - MASK_BLEED) * sy));
  const x1 = Math.min(size.width, Math.ceil((rect.x + rect.width + MASK_BLEED) * sx));
  const y1 = Math.min(size.height, Math.ceil((rect.y + rect.height + MASK_BLEED) * sy));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * Paint opaque boxes over `rects` and re-encode. Returns the input when nothing intersects. Rejects instead of
 * returning unmasked pixels. The caller releases the source once it has switched to the result (see `release`).
 */
export async function maskShot(shot: Shot, rects: Rect[]): Promise<Shot> {
  const boxes = rects.map((r) => maskBounds(r, shot.page, shot.bitmap)).filter((b): b is Rect => b !== null);
  if (!boxes.length) return shot;
  const canvas = document.createElement('canvas');
  canvas.width = shot.bitmap.width;
  canvas.height = shot.bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Lightback: masking requires a 2D canvas');
  ctx.drawImage(shot.bitmap, 0, 0);
  ctx.fillStyle = MASK_FILL;
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.width, b.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Lightback: masked screenshot could not be encoded');
  return { blob, bitmap: canvas, page: shot.page };
}

export function release(bitmap: Drawable): void {
  if ('close' in bitmap) bitmap.close();
}
