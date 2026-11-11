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
  const scale = region ? Math.min(3, 1800 / width) : Math.min(1, 1920 / width);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(video, source.x * video.videoWidth, source.y * video.videoHeight, width, height, 0, 0, canvas.width, canvas.height);
  return true;
}
