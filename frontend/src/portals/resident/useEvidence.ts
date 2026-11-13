import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Session-only evidence. The Blobs live in React state until they are sent with the report.
 * Object URLs are created and revoked by the components that display them (useObjectUrl).
 * Nothing here is ever written to storage.
 */
export interface PhotoItem { id: string; blob: Blob; originalSize: number; resized: boolean }
export interface VoiceNote { id: string; blob: Blob; seconds: number; mimeType: string }

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_LONG_EDGE = 2048;
export const MAX_RECORDING_SECONDS = 120;
const RESIZE_ABOVE_BYTES = 2.5 * 1024 * 1024;

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export class PhotoTooLargeError extends Error {}

async function encode(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode photo'))), 'image/jpeg', quality));
}

/** Downscales large phone photos to at most 2048 px on the long edge (JPEG) without blocking input. */
export async function preparePhoto(file: Blob): Promise<{ blob: Blob; resized: boolean }> {
  if (typeof createImageBitmap !== 'function') {
    if (file.size <= MAX_UPLOAD_BYTES) return { blob: file, resized: false };
    throw new PhotoTooLargeError();
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch {
    // Formats the browser cannot decode (for example some HEIC files) are sent unchanged if small enough.
    if (file.size <= MAX_UPLOAD_BYTES) return { blob: file, resized: false };
    throw new PhotoTooLargeError();
  }
  try {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= RESIZE_ABOVE_BYTES) return { blob: file, resized: false };
    const width = Math.round(bitmap.width * scale); const height = Math.round(bitmap.height * scale);
    for (const quality of [0.85, 0.7, 0.55]) {
      const blob = await encode(bitmap, width, height, quality);
      if (blob.size <= MAX_UPLOAD_BYTES) return { blob, resized: true };
    }
    throw new PhotoTooLargeError();
  } finally { bitmap.close(); }
}

export function usePhoto() {
  const [photo, setPhoto] = useState<PhotoItem | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const choose = useCallback(async (files: FileList | File[], hadPhoto: boolean) => {
    const list = Array.from(files);
    const file = list[0];
    if (!file) return;
    const token = ++tokenRef.current;
    setError(null);
    if (!file.type.startsWith('image/')) { setNotice(null); setError('That file is not a photo. Choose an image, or take a new photo.'); return; }
    const notes: string[] = [];
    if (list.length > 1) notes.push('We can send one photo with each report, so we have used the first one you chose.');
    else if (hadPhoto) notes.push('We can send one photo with each report, so this has replaced your previous photo.');
    setProcessing(true);
    try {
      const prepared = await preparePhoto(file);
      if (token !== tokenRef.current) return;
      if (prepared.resized) notes.push('We made the photo smaller so it sends quickly.');
      setPhoto({ id: newId(), blob: prepared.blob, originalSize: file.size, resized: prepared.resized });
      setNotice(notes.length ? notes.join(' ') : null);
    } catch {
      if (token !== tokenRef.current) return;
      setError('This photo is too large to send (the limit is 10 MB). Try taking a new photo or choosing a different one.');
      setNotice(null);
    } finally { if (token === tokenRef.current) setProcessing(false); }
  }, []);

  const remove = useCallback(() => { tokenRef.current++; setPhoto(null); setError(null); setNotice(null); setProcessing(false); }, []);
  return { photo, processing, error, notice, choose, remove, clear: remove };
}

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'denied' | 'unsupported' | 'insecure' | 'error';

export function initialRecorderStatus(): RecorderStatus {
  if (typeof window === 'undefined') return 'unsupported';
  if (window.isSecureContext === false) return 'insecure';
  return typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) ? 'idle' : 'unsupported';
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(initialRecorderStatus);
  const [note, setNote] = useState<VoiceNote | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);

  const releaseDevice = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    const initial = initialRecorderStatus();
    if (initial !== 'idle') { setStatus(initial); return; }
    if (recorderRef.current?.state === 'recording') return;
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      discardRef.current = false;
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
      recorder.addEventListener('stop', () => {
        const seconds = (Date.now() - startedAtRef.current) / 1000;
        releaseDevice();
        recorderRef.current = null;
        setElapsed(0);
        if (discardRef.current) return;
        const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
        if (chunks.length) setNote({ id: newId(), blob: new Blob(chunks, { type: mimeType }), seconds, mimeType });
        setStatus('idle');
      });
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start();
      setStatus('recording');
      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(seconds);
        if (seconds >= MAX_RECORDING_SECONDS) stop();
      }, 250);
    } catch (cause) {
      releaseDevice();
      recorderRef.current = null;
      const name = cause instanceof DOMException ? cause.name : '';
      setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'unsupported' : 'error');
    }
  }, [releaseDevice, stop]);

  const remove = useCallback(() => setNote(null), []);
  const clear = useCallback(() => {
    discardRef.current = true; stop(); releaseDevice(); setNote(null); setElapsed(0);
    setStatus(initialRecorderStatus());
  }, [releaseDevice, stop]);
  const retry = useCallback(() => setStatus(initialRecorderStatus()), []);

  // Release the microphone if the app unmounts mid-recording.
  useEffect(() => () => { discardRef.current = true; const recorder = recorderRef.current; if (recorder && recorder.state !== 'inactive') recorder.stop(); releaseDevice(); }, [releaseDevice]);

  return { status, note, elapsed, start, stop, remove, clear, retry };
}

/** Creates an object URL for the lifetime of the calling component and revokes it on change/unmount. */
export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);
  return url;
}
