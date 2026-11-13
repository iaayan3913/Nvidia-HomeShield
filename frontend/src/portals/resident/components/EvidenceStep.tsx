import { useRef } from 'react';
import { ImagePlus, LoaderCircle, Mic, MicOff, Square, Trash2, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { formatBytes, formatDuration, type FieldErrors } from '../model';
import { MAX_PHOTOS, MAX_RECORDING_SECONDS, MAX_VOICE_NOTES, useObjectUrl, type PhotoItem, type usePhotos, type useVoiceRecorder, type VoiceNote } from '../useEvidence';

export const EVIDENCE_FIELD_IDS = { evidence: 'rp-add-photos' } as const;

type Photos = ReturnType<typeof usePhotos>;
type Recorder = ReturnType<typeof useVoiceRecorder>;

export function PhotoThumb({ photo, index, onRemove }: { photo: PhotoItem; index: number; onRemove?: () => void }) {
  const url = useObjectUrl(photo.file);
  return <li className="rp-thumb">
    {url ? <img src={url} alt={`Photo ${index + 1} you added`} /> : <span className="rp-thumb-placeholder" aria-hidden="true" />}
    <span className="rp-thumb-meta">Photo {index + 1} · {formatBytes(photo.file.size)}</span>
    {onRemove ? <button type="button" className="rp-thumb-remove" onClick={onRemove} aria-label={`Remove photo ${index + 1}`}><X size={18} aria-hidden="true" /></button> : null}
  </li>;
}

export function VoiceClip({ note, index, onRemove }: { note: VoiceNote; index: number; onRemove?: () => void }) {
  const url = useObjectUrl(note.blob);
  return <li className="rp-voice-clip">
    <span className="rp-voice-label">Voice note {index + 1} <span>({formatDuration(note.seconds)})</span></span>
    {url ? <audio controls src={url} preload="metadata" aria-label={`Play voice note ${index + 1}`} /> : null}
    {onRemove ? <Button type="button" variant="quiet" className="rp-voice-delete" icon={<Trash2 size={18} aria-hidden="true" />} onClick={onRemove} aria-label={`Delete voice note ${index + 1}`}>Delete</Button> : null}
  </li>;
}

export function EvidenceStep({ photos, recorder, errors, hasDescription }: { photos: Photos; recorder: Recorder; errors: FieldErrors; hasDescription: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = photos.photos.length >= MAX_PHOTOS;
  const voiceFull = recorder.notes.length >= MAX_VOICE_NOTES;

  return <div className="rp-step-body">
    <p className="rp-lead">{hasDescription ? 'Photos and voice notes are optional, but they help the repairs team understand the problem.' : 'You have not written a description, so please add at least one photo or voice note.'}</p>
    {errors.evidence ? <p className="field-error rp-inline-error" id="rp-evidence-error">{errors.evidence}</p> : null}

    <section className="rp-evidence-block" aria-labelledby="rp-photos-title">
      <div className="rp-block-head">
        <h3 id="rp-photos-title">Photos</h3>
        <span className="field-hint">{photos.photos.length} of {MAX_PHOTOS} added</span>
      </div>
      <input ref={inputRef} id={EVIDENCE_FIELD_IDS.evidence} className="rp-visually-hidden" type="file" accept="image/*" multiple disabled={full}
        aria-describedby={errors.evidence ? 'rp-evidence-error rp-photos-hint' : 'rp-photos-hint'}
        onChange={(event) => { if (event.target.files) photos.addFiles(event.target.files); event.target.value = ''; }} />
      <label htmlFor={EVIDENCE_FIELD_IDS.evidence} className={`button button--secondary rp-file-button${full ? ' is-disabled' : ''}`}>
        <ImagePlus size={20} aria-hidden="true" />{photos.photos.length ? 'Add more photos' : 'Add photos'}
      </label>
      <span id="rp-photos-hint" className="field-hint">Up to {MAX_PHOTOS} images, 15 MB each. Close-ups and a wider shot of the room both help.</span>
      {photos.error ? <p className="field-error" role="alert">{photos.error}</p> : null}
      {photos.photos.length
        ? <ul className="rp-thumbs" aria-label="Photos added">{photos.photos.map((photo, index) => <PhotoThumb key={photo.id} photo={photo} index={index} onRemove={() => { photos.remove(photo.id); inputRef.current?.focus(); }} />)}</ul>
        : <p className="rp-empty">No photos added yet.</p>}
    </section>

    <section className="rp-evidence-block" aria-labelledby="rp-voice-title">
      <div className="rp-block-head">
        <h3 id="rp-voice-title">Voice note</h3>
        <span className="field-hint">Up to {MAX_VOICE_NOTES} notes, {MAX_RECORDING_SECONDS / 60} minutes each</span>
      </div>
      <VoiceControls recorder={recorder} disabled={voiceFull} />
      {recorder.notes.length
        ? <ul className="rp-voice-list" aria-label="Voice notes recorded">{recorder.notes.map((note, index) => <VoiceClip key={note.id} note={note} index={index} onRemove={() => recorder.remove(note.id)} />)}</ul>
        : null}
    </section>

    <p className="rp-privacy-note">Photos and recordings stay in this browser tab while you complete the report. In this demonstration they are never uploaded or saved; only a short description of each item is recorded.</p>
  </div>;
}

function VoiceControls({ recorder, disabled }: { recorder: Recorder; disabled: boolean }) {
  const { status, elapsed } = recorder;
  if (status === 'unsupported') return <div className="rp-callout rp-callout--info" role="note"><MicOff size={20} aria-hidden="true" /><div><strong>Voice recording is not available here</strong><p>This browser or device cannot record audio. Please describe the problem in writing on the previous step, or add photos.</p></div></div>;
  if (status === 'denied') return <div className="rp-callout rp-callout--warning" role="alert"><MicOff size={20} aria-hidden="true" /><div><strong>Microphone access was blocked</strong><p>To record a voice note, allow microphone access in your browser settings and try again. You can also describe the problem in writing instead.</p><Button type="button" variant="secondary" onClick={recorder.retry}>Try again</Button></div></div>;
  if (status === 'error') return <div className="rp-callout rp-callout--warning" role="alert"><MicOff size={20} aria-hidden="true" /><div><strong>We could not start the microphone</strong><p>Check that no other app is using it, then try again, or describe the problem in writing.</p><Button type="button" variant="secondary" onClick={recorder.retry}>Try again</Button></div></div>;
  if (status === 'recording') return <div className="rp-recording" role="status">
    <span className="rp-recording-dot" aria-hidden="true" />
    <span>Recording <span className="rp-timer">{formatDuration(elapsed)}</span> <span className="rp-visually-hidden">Press Stop when you have finished.</span></span>
    <Button type="button" variant="secondary" icon={<Square size={18} aria-hidden="true" />} onClick={recorder.stop}>Stop recording</Button>
  </div>;
  return <div className="rp-voice-actions">
    <Button type="button" variant="secondary" disabled={disabled || status === 'requesting'} onClick={() => void recorder.start()}
      icon={status === 'requesting' ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}>
      {status === 'requesting' ? 'Waiting for microphone…' : recorder.notes.length ? 'Record another note' : 'Record a voice note'}
    </Button>
    {disabled ? <span className="field-hint">You have added the maximum number of voice notes.</span> : <span className="field-hint">Your browser will ask for permission to use the microphone.</span>}
  </div>;
}
