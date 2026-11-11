import { useCallback, useEffect, useRef, useState } from 'react';
import type { PSM, Worker } from 'tesseract.js';
import { captureFrame, createFrameSignature, createOcrWorker, nextScanDelay } from './ocr';
import { extractGuildName, guildKey, type CaptureRegion } from './screen-reader';

type Phase = 'idle' | 'requesting' | 'loading' | 'active' | 'paused' | 'error';
type Settings = { region: CaptureRegion | null; nameOnly: boolean; selecting: boolean };

export function useScreenCapture(settings: Settings, onDetected: (name: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const generation = useRef(0);
  const paused = useRef(false);
  const config = useRef(settings);
  const detect = useRef(onDetected);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('Comparte la ventana de Albion para empezar.');
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState(16 / 9);
  const [reading, setReading] = useState<{ text: string; candidate: string | null; duration: number } | null>(null);
  const supported = !!navigator.mediaDevices?.getDisplayMedia && window.isSecureContext;

  useEffect(() => { config.current = settings; detect.current = onDetected; }, [settings, onDetected]);

  const dispose = useCallback(() => {
    generation.current++;
    clearTimeout(timer.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (workerRef.current) void workerRef.current.terminate().catch(() => {});
    workerRef.current = null;
    paused.current = false;
  }, []);

  useEffect(() => dispose, [dispose]);

  const stop = useCallback(() => {
    dispose();
    setPhase('idle');
    setStatus('Captura detenida. Tu lista sigue disponible para revisar y guardar.');
  }, [dispose]);

  const pause = useCallback(() => {
    paused.current = true;
    setPhase((previous) => previous === 'active' ? 'paused' : previous);
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    setPhase((previous) => previous === 'paused' ? 'active' : previous);
  }, []);

  async function start() {
    if (!supported || streamRef.current || phase === 'requesting') return;
    dispose();
    const session = generation.current;
    setError('');
    setReading(null);
    setPhase('requesting');
    setStatus('Selecciona la ventana del juego en el navegador.');
    try {
      // This must run directly in the click handler, before loading OCR assets.
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
      if (session !== generation.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('No video track');
      track.addEventListener('ended', () => { if (session === generation.current) stop(); }, { once: true });
      const video = videoRef.current;
      if (!video) throw new Error('No video element');
      video.srcObject = stream;
      await video.play();
      if (session !== generation.current) return;
      setAspect(video.videoWidth / video.videoHeight || 16 / 9);
      setPhase('loading');
      setStatus('Preparando el lector local… La primera vez puede tardar unos segundos.');
      const initializing = createOcrWorker((progress) => {
        if (session === generation.current) setStatus(`Cargando lector local… ${progress}%`);
      });
      void initializing.then((lateWorker) => {
        if (session !== generation.current) void lateWorker.terminate().catch(() => {});
      }).catch(() => {});
      let startupTimeout: ReturnType<typeof setTimeout> | undefined;
      const worker = await Promise.race([
        initializing,
        new Promise<never>((_, reject) => { startupTimeout = setTimeout(() => reject(new Error('OCR startup timeout')), 45_000); }),
      ]).finally(() => clearTimeout(startupTimeout));
      if (session !== generation.current) { await worker.terminate(); return; }
      workerRef.current = worker;
      setPhase('active');
      setStatus('Pasa el cursor por un HO y mantenlo unos segundos sobre su información.');
      const canvas = document.createElement('canvas');
      const signatureOf = createFrameSignature();
      let previous = '';
      let repeats = 0;
      let previousConfig = '';
      let previousMode = '';
      let failures = 0;
      let scanDuration = 0;
      let cached: { signature: number; mode: string; fingerprint: string; text: string; confidence: number } | null = null;

      async function scan() {
        if (session !== generation.current) return;
        const snapshot = config.current;
        const fingerprint = JSON.stringify(snapshot);
        if (fingerprint !== previousConfig || paused.current || snapshot.selecting) {
          previous = ''; repeats = 0; previousConfig = fingerprint;
        }
        try {
          if (!paused.current && !snapshot.selecting && captureFrame(video!, canvas, snapshot.region)) {
            const mode = snapshot.nameOnly && snapshot.region ? '7' : '11';
            if (mode !== previousMode) {
              await worker.setParameters({ tessedit_pageseg_mode: mode as PSM, preserve_interword_spaces: '1' });
              previousMode = mode;
            }
            const signature = signatureOf(canvas);
            let text: string;
            let confidence: number;
            const started = performance.now();
            if (signature !== null && cached?.signature === signature && cached.mode === mode && cached.fingerprint === fingerprint) {
              ({ text, confidence } = cached);
            } else {
              const result = await worker.recognize(canvas);
              text = result.data.text;
              confidence = result.data.confidence;
              cached = signature === null ? null : { signature, mode, fingerprint, text, confidence };
            }
            scanDuration = performance.now() - started;
            if (session !== generation.current) return;
            failures = 0;
            if (!paused.current && fingerprint === JSON.stringify(config.current)) {
              const name = confidence >= 40 ? extractGuildName(text, snapshot.nameOnly && !!snapshot.region) : null;
              const readableText = text.trim().slice(0, 1200);
              setReading((last) => last?.text === readableText && last.candidate === name ? last : { text: readableText, candidate: name, duration: Math.round(scanDuration) });
              if (name) {
                repeats = guildKey(name) === previous ? repeats + 1 : 1;
                previous = guildKey(name);
                if (repeats >= 2) { detect.current(name); setStatus(`Detectado: ${name}. Revisa el nombre en la lista.`); }
                else setStatus(`Comprobando: ${name}… Mantén el cursor sobre el HO.`);
              } else {
                previous = ''; repeats = 0;
                setStatus(snapshot.region && snapshot.nameOnly ? 'No se pudo leer un nombre claro en la zona. Ajústala para incluir solo el texto.' : 'No se identificó un gremio. Pulsa «Marcar nombre» y encierra solo su texto.');
              }
            }
          }
        } catch {
          if (session !== generation.current) return;
          failures++;
          if (failures >= 3) {
            dispose();
            setPhase('error');
            setError('La lectura se interrumpió. Vuelve a compartir la ventana para reintentar. Tu lista sigue guardada en esta pestaña.');
            return;
          }
        }
        if (session === generation.current) timer.current = setTimeout(() => void scan(), nextScanDelay(scanDuration, !!config.current.region));
      }
      void scan();
    } catch (cause) {
      if (session !== generation.current) return;
      dispose();
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        setPhase('idle');
        setStatus('No se inició la captura. Pulsa «Compartir ventana» cuando quieras intentarlo.');
      } else {
        setPhase('error');
        setError('No se pudo iniciar el lector. Comprueba que la ventana del juego se pueda compartir y vuelve a intentarlo.');
      }
    }
  }

  return { videoRef, phase, status, error, reading, aspect, supported, start, stop, pause, resume };
}
