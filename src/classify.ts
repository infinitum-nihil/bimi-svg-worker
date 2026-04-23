import type { Classification } from './types.ts';

export function classify(input: string): Classification {
  const trimmed = input.trim();
  if (!trimmed) return 'malformed';
  if (!/<svg\b/i.test(trimmed)) return 'malformed';
  if (!/<\/svg>\s*$/i.test(trimmed)) return 'malformed';

  // Raster-wrapped: <image> with data: URI — needs vectorization (Phase 2)
  if (/<image\b[^>]*\b(?:xlink:)?href\s*=\s*["']data:image\/(?:png|jpe?g|gif|webp)/i.test(trimmed)) {
    return 'raster-wrapped';
  }

  return 'fixable';
}
