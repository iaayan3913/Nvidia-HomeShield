import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Session-only evidence. Files and Blobs live in React state; object URLs are created and
 * revoked by the components that display them (see EvidencePreview). Nothing here is persisted.
 */
export interface PhotoItem { id: string; file: File }
export interface VoiceNote { id: string; blob: Blob; seconds: number; mimeType: string }

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
export const MAX_VOICE_NOTES = 3;
export const MAX_RECORDING_SECONDS = 120;

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function usePhotos() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const photosRef = useRef<PhotoItem[]>([]);
  const commit = (next: PhotoItem[]) => { photosRef.current = next; setPhotos(next); };

  const addFiles = useCallback((files: FileList | File[]) => {
    const problems: string[] = [];
    const next = [...photosRef.current];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) { problems.push(`“${file.name}” is not an image.`); continue; }
      if (file.size > MAX_PHOTO_BYTES) { problems.push(`“${file.name}” is larger than 15 MB.`); continue; }
      if (next.length >= MAX_PHOTOS) { problems.push(`You can add up to ${MAX_PHOTOS} photos.`); break; }
      next.push({ id: newId(), file });
    }
    commit(next);
    setError(problems.length ? problems.join(' ') : null);
  }, []);

  const remove = useCallback((id: string) => { commit(photosRef.current.filter((item) => item.id !== id)); setError(null); }, []);
  const clear = useCallback(() => { commit([]); setError(null); }, []);
  return { photos, error, addFiles, remove, clear };
}

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'denied' | 'unsupported' | 'error';

export function isRecordingSupported() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(() => (isRecordingSupported() ? 'idle' : 'unsupported'));
  const [notes, setNotes] = useState<VoiceNote[]>([]);
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
    if (!isRecordingSupported()) { setStatus('unsupported'); return; }
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
        if (chunks.length) setNotes((current) => [...current, { id: newId(), blob: new Blob(chunks, { type: mimeType }), seconds, mimeType }]);
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

  const remove = useCallback((id: string) => setNotes((current) => current.filter((item) => item.id !== id)), []);
  const clear = useCallback(() => {
    discardRef.current = true; stop(); releaseDevice(); setNotes([]); setElapsed(0);
    setStatus(isRecordingSupported() ? 'idle' : 'unsupported');
  }, [releaseDevice, stop]);
  const retry = useCallback(() => setStatus(isRecordingSupported() ? 'idle' : 'unsupported'), []);

  // Release the microphone if the portal unmounts mid-recording.
  useEffect(() => () => { discardRef.current = true; const recorder = recorderRef.current; if (recorder && recorder.state !== 'inactive') recorder.stop(); releaseDevice(); }, [releaseDevice]);

  return { status, notes, elapsed, start, stop, remove, clear, retry };
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
