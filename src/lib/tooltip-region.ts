import type { CaptureRegion } from './screen-reader';

type Band = { left: number; right: number; top: number; bottom: number; rows: number };

/** Locate compact dark info panels surrounded by the brighter map surface. */
export function locateTooltip(pixels: Uint8ClampedArray, width: number, height: number): CaptureRegion | null {
  const bands: Band[] = [];
  const minimumWidth = Math.max(24, Math.round(width * .07));
  const maximumWidth = Math.round(width * .38);
  const minY = Math.round(height * .12);
  const maxY = Math.round(height * .88);
  const brightness = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    return (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3;
  };
  const dark = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    const r = pixels[at], g = pixels[at + 1], b = pixels[at + 2];
    return (r + g + b) / 3 < 100 && Math.max(r, g, b) - Math.min(r, g, b) < 65;
  };
  for (let y = minY; y < maxY; y++) {
    let left = -1;
    let lastDark = -1;
    function closeRun() {
      if (left < 0) return;
      const span = lastDark - left + 1;
      if (span >= minimumWidth && span <= maximumWidth && left > width * .06 && lastDark < width * .94) {
        const match = bands.find((band) => band.bottom >= y - 2 && Math.abs(band.left - left) <= 3 && Math.abs(band.right - lastDark) <= 3);
        if (match) { match.bottom = y; match.rows++; }
        else bands.push({ left, right: lastDark, top: y, bottom: y, rows: 1 });
      }
      left = -1;
    }
    for (let x = 1; x < width - 1; x++) {
      if (dark(x, y)) { if (left < 0) left = x; lastDark = x; }
      else if (left >= 0 && x - lastDark > 5) closeRun();
    }
    closeRun();
  }

  let best: { score: number; region: CaptureRegion } | null = null;
  for (const band of bands) {
    const w = band.right - band.left + 1;
    const rawHeight = band.bottom - band.top + 1;
    if (rawHeight < Math.max(10, height * .035) || rawHeight > height * .3 || band.rows < rawHeight * .65) continue;
    // Text can split the horizontal bands. Recover the panel's top/bottom from
    // its dark margins so the glyphs in the title are never cropped in half.
    const marginRow = (y: number) => dark(band.right - 2, y)
      && (dark(band.left + 2, y) || dark(Math.floor((band.left + band.right) / 2), y));
    for (const direction of [-1, 1]) {
      const start = direction < 0 ? band.top : band.bottom;
      let misses = 0;
      for (let offset = 1; offset <= height * .12; offset++) {
        const y = start + direction * offset;
        if (y < minY || y >= maxY) break;
        if (marginRow(y)) {
          misses = 0;
          if (direction < 0) band.top = y; else band.bottom = y;
        } else if (++misses > 2) break;
      }
    }
    const h = band.bottom - band.top + 1;
    if (h > height * .3 || w / h < 1.7 || w / h > 7) continue;
    let inside = 0, outside = 0, darkCount = 0, lightCount = 0, count = 0;
    for (let y = band.top; y <= band.bottom; y++) {
      outside += brightness(Math.max(0, band.left - 4), y) + brightness(Math.min(width - 1, band.right + 4), y);
      for (let x = band.left; x <= band.right; x++) {
        const value = brightness(x, y);
        inside += value;
        if (dark(x, y)) darkCount++;
        // Small antialiased letters lose brightness in the reduced-size probe.
        if (value > 105) lightCount++;
        count++;
      }
    }
    const contrast = outside / (2 * h) - inside / count;
    const darkRatio = darkCount / count;
    if (contrast < 30 || darkRatio < .65 || lightCount < 4) continue;
    const score = contrast * darkRatio * Math.min(1, lightCount / 25);
    if (!best || score > best.score) {
      best = { score, region: { x: Math.max(0, (band.left - 2) / width), y: Math.max(0, (band.top - 2) / height), width: Math.min(width - band.left + 2, w + 4) / width, height: Math.min(height - band.top + 2, h + 4) / height } };
    }
  }
  return best?.region ?? null;
}

export function createTooltipFinder() {
  const probe = document.createElement('canvas');
  const context = probe.getContext('2d', { willReadFrequently: true });
  return (video: HTMLVideoElement): CaptureRegion | null => {
    if (!context || !video.videoWidth || video.readyState < 2) return null;
    const width = Math.round(video.videoWidth * Math.min(1, 640 / video.videoWidth, 480 / video.videoHeight));
    const height = Math.round(width * video.videoHeight / video.videoWidth);
    if (probe.width !== width) probe.width = width;
    if (probe.height !== height) probe.height = height;
    context.drawImage(video, 0, 0, width, height);
    return locateTooltip(context.getImageData(0, 0, width, height).data, width, height);
  };
}

export function tooltipHeading(region: CaptureRegion): CaptureRegion {
  return { x: region.x + region.width * .1, y: region.y, width: region.width * .9, height: region.height * .42 };
}
