import type { Worker } from 'tesseract.js';
import type { CaptureRegion } from './screen-reader';

export async function createOcrWorker(onProgress: (progress: number) => void): Promise<Worker> {
  const { createWorker, OEM } = await import('tesseract.js');
  const base = `${window.location.origin}/ocr/tesseract-7.0.0`;
  return createWorker(['eng', 'spa'], OEM.LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${window.location.origin}/ocr/tessdata-fast-v4`,
    workerBlobURL: false,
    logger(message) {
      if (message.status === 'loading language traineddata') onProgress(Math.round(message.progress * 100));
    },
    // Rejection is handled by the capture lifecycle, including initialization.
    errorHandler() {},
  }, { load_system_dawg: '0', load_freq_dawg: '0' });
}

export function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, region: CaptureRegion | null) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return false;
  const source = region ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = source.width * video.videoWidth;
  const height = source.height * video.videoHeight;
  // Upscale a selected name for small game fonts; cap work for full-window capture.
  const scale = region ? Math.min(4, 1100 / width, Math.sqrt(400_000 / (width * height))) : Math.min(1, 1920 / width);
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.drawImage(video, source.x * video.videoWidth, source.y * video.videoHeight, width, height, 0, 0, canvas.width, canvas.height);
  return true;
}

export function nextScanDelay(duration: number, cropped: boolean) {
  // Adapt the pause to recognition time instead of running jobs back-to-back.
  return Math.min(6000, Math.max(cropped ? 700 : 1800, duration * 2));
}

export function createFrameSignature() {
  const probe = document.createElement('canvas');
  probe.width = 192;
  probe.height = 108;
  const context = probe.getContext('2d', { willReadFrequently: true });
  return (frame: HTMLCanvasElement) => {
    if (!context) return null;
    context.drawImage(frame, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let signature = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      signature = Math.imul(signature ^ pixels[index], 16777619);
      signature = Math.imul(signature ^ pixels[index + 1], 16777619);
      signature = Math.imul(signature ^ pixels[index + 2], 16777619);
    }
    return signature >>> 0;
  };
}
