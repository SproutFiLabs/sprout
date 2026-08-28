/** Cropped botanical pieces from the generated atlas. */
export type BotanicalAtlasPart = 'fern' | 'ginkgo' | 'seedling' | 'berries' | 'oak' | 'butterfly-new';
export type BotanicalAtlas = Record<BotanicalAtlasPart, CanvasImageSource>;

export const BOTANICAL_ATLAS_BOUNDS: Record<BotanicalAtlasPart, { x: number; y: number; width: number; height: number }> = {
  fern: { x: 110, y: 12, width: 290, height: 538 },
  ginkgo: { x: 515, y: 80, width: 484, height: 427 },
  seedling: { x: 1048, y: 151, width: 471, height: 363 },
  berries: { x: 30, y: 580, width: 464, height: 430 },
  oak: { x: 586, y: 516, width: 358, height: 496 },
  'butterfly-new': { x: 1028, y: 612, width: 479, height: 358 },
};

let cached: Promise<BotanicalAtlas> | undefined;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load ${src}`));
    image.src = src;
  });
}

/**
 * Load the atlas once, matte out its neutral checkerboard, and return tight
 * canvas crops. Saturated painted pixels remain untouched; only low-chroma
 * neutral pixels become transparent at runtime.
 */
export function loadBotanicalAtlas(): Promise<BotanicalAtlas> {
  if (cached) return cached;
  cached = loadImage('/art/dashboard/motion/botanical-atlas.png').then((image) => {
    const source = document.createElement('canvas');
    source.width = 1536; source.height = 1024;
    const context = source.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable for botanical atlas');
    context.drawImage(image, 0, 0, source.width, source.height);
    const pixels = context.getImageData(0, 0, source.width, source.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const red = pixels.data[i]!, green = pixels.data[i + 1]!, blue = pixels.data[i + 2]!;
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      // Checker cells are neutral. A soft threshold avoids leaving a gray halo
      // while retaining the low-saturation edges in the painted pieces.
      pixels.data[i + 3] = chroma < 14 ? 0 : Math.min(255, Math.round((chroma - 10) * 28));
    }
    context.putImageData(pixels, 0, 0);
    const atlas = {} as BotanicalAtlas;
    for (const [name, bounds] of Object.entries(BOTANICAL_ATLAS_BOUNDS) as Array<[BotanicalAtlasPart, typeof BOTANICAL_ATLAS_BOUNDS[BotanicalAtlasPart]]>) {
      const crop = document.createElement('canvas');
      crop.width = bounds.width; crop.height = bounds.height;
      crop.getContext('2d')!.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      atlas[name] = crop;
    }
    return atlas;
  });
  return cached;
}
