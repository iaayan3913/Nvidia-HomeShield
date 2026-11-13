import { Camera, LoaderCircle, Lock, Mic, MicOff, Square, Trash2, X } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { formatBytes, formatDuration, type FieldErrors } from '../model';
import { MAX_RECORDING_SECONDS, useObjectUrl, type PhotoItem, type usePhoto, type useVoiceRecorder, type VoiceNote } from '../useEvidence';

export const EVIDENCE_FIELD_IDS = { evidence: 'rp-add-photo' } as const;

type Photo = ReturnType<typeof usePhoto>;
type Recorder = ReturnType<typeof useVoiceRecorder>;

export function PhotoThumb({ photo, onRemove, small = false }: { photo: PhotoItem; onRemove?: () => void; small?: boolean }) {
  const url = useObjectUrl(photo.blob);
  return <div className={`rp-thumb${small ? ' rp-thumb--small' : ''}`}>
    {url ? <img src={url} alt="The photo you added" /> : <span className="rp-thumb-placeholder" aria-hidden="true" />}
    {small ? null : <span className="rp-thumb-meta">{formatBytes(photo.blob.size)}{photo.resized ? ` (reduced from ${formatBytes(photo.originalSize)})` : ''}</span>}
    {onRemove ? <button type="button" className="rp-thumb-remove" onClick={onRemove} aria-label="Remove photo"><X size={18} aria-hidden="true" /></button> : null}
  </div>;
}

export function VoiceClip({ note, onRemove }: { note: VoiceNote; onRemove?: () => void }) {
  const url = useObjectUrl(note.blob);
  return <div className="rp-voice-clip">
    <span className="rp-voice-label">Voice note <span>({formatDuration(note.seconds)})</span></span>
    {url ? <audio controls src={url} preload="metadata" aria-label="Play your voice note" /> : null}
    {onRemove ? <Button type="button" variant="quiet" className="rp-voice-delete" icon={<Trash2 size={18} aria-hidden="true" />} onClick={onRemove} aria-label="Delete voice note">Delete</Button> : null}
  </div>;
}

export function EvidenceStep({ photo, recorder, errors, hasDescription }: { photo: Photo; recorder: Recorder; errors: FieldErrors; hasDescription: boolean }) {
  return <div className="rp-step-body">
    <p className="rp-lead">{hasDescription ? 'This is optional, but a photo or a short voice note helps the repairs team understand the problem and bring the right tools.' : 'You have not written a description, so please add a photo or a voice note.'}</p>
    {errors.evidence ? <p className="field-error rp-inline-error" id="rp-evidence-error">{errors.evidence}</p> : null}

    <section className="rp-evidence-block" aria-labelledby="rp-photo-title">
      <div className="rp-block-head"><h3 id="rp-photo-title">Photo</h3><span className="field-hint">One photo per report</span></div>
      <input id={EVIDENCE_FIELD_IDS.evidence} className="rp-visually-hidden" type="file" accept="image/*" capture="environment" disabled={photo.processing}
        aria-describedby={errors.evidence ? 'rp-evidence-error rp-photo-hint' : 'rp-photo-hint'}
        onChange={(event) => { const files = event.target.files; if (files?.length) void photo.choose(files, Boolean(photo.photo)); event.target.value = ''; }} />
      {photo.photo
        ? <PhotoThumb photo={photo.photo} onRemove={photo.remove} />
        : null}
      <label htmlFor={EVIDENCE_FIELD_IDS.evidence} className={`button button--secondary rp-file-button${photo.processing ? ' is-disabled' : ''}`}>
        {photo.processing ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Camera size={20} aria-hidden="true" />}
        {photo.processing ? 'Preparing photo…' : photo.photo ? 'Replace photo' : 'Take or choose a photo'}
      </label>
      <span id="rp-photo-hint" className="field-hint">A clear photo of the problem, taken from a little way back, works best. Large photos are made smaller before sending.</span>
      <p className="rp-visually-hidden" aria-live="polite">{photo.processing ? 'Preparing photo' : photo.photo ? 'Photo added' : ''}</p>
      {photo.notice ? <p className="rp-notice" role="status">{photo.notice}</p> : null}
      {photo.error ? <p className="field-error" role="alert">{photo.error}</p> : null}
    </section>

    <section className="rp-evidence-block" aria-labelledby="rp-voice-title">
      <div className="rp-block-head"><h3 id="rp-voice-title">Voice note</h3><span className="field-hint">Up to {MAX_RECORDING_SECONDS / 60} minutes</span></div>
      {recorder.note
        ? <><VoiceClip note={recorder.note} onRemove={recorder.remove} /><span className="field-hint">We can send one voice note with each report. Delete this one to record again.</span></>
        : <VoiceControls recorder={recorder} />}
    </section>

    <p className="rp-privacy-note">Your photo and voice note are sent with your report and are seen only by the housing repairs team.</p>
  </div>;
}

function Fallback({ tone, icon, title, children, onRetry }: { tone: 'info' | 'warning'; icon: React.ReactNode; title: string; children: React.ReactNode; onRetry?: () => void }) {
  return <div className={`rp-callout rp-callout--${tone}`} role={tone === 'warning' ? 'alert' : 'note'}>{icon}<div><strong>{title}</strong><p>{children}</p>{onRetry ? <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button> : null}</div></div>;
}

function VoiceControls({ recorder }: { recorder: Recorder }) {
  const { status, elapsed } = recorder;
  if (status === 'insecure') return <Fallback tone="info" icon={<Lock size={20} aria-hidden="true" />} title="Voice notes need a secure connection">Recording is only available when this page is opened over a secure (https) connection. You can still describe the problem in writing and add a photo.</Fallback>;
  if (status === 'unsupported') return <Fallback tone="info" icon={<MicOff size={20} aria-hidden="true" />} title="Voice notes are not available on this device">This browser cannot record audio. Please describe the problem in writing, or add a photo.</Fallback>;
  if (status === 'denied') return <Fallback tone="warning" icon={<MicOff size={20} aria-hidden="true" />} title="Microphone access was blocked" onRetry={recorder.retry}>To record a voice note, allow microphone access in your browser settings and try again. You can also describe the problem in writing instead.</Fallback>;
  if (status === 'error') return <Fallback tone="warning" icon={<MicOff size={20} aria-hidden="true" />} title="We could not start the microphone" onRetry={recorder.retry}>Check that no other app is using it, then try again, or describe the problem in writing.</Fallback>;
  if (status === 'recording') return <div className="rp-recording" role="status">
    <span className="rp-recording-dot" aria-hidden="true" />
    <span>Recording <span className="rp-timer">{formatDuration(elapsed)}</span> <span className="rp-visually-hidden">Press Stop when you have finished.</span></span>
    <Button type="button" variant="secondary" icon={<Square size={18} aria-hidden="true" />} onClick={recorder.stop}>Stop recording</Button>
  </div>;
  return <div className="rp-voice-actions">
    <Button type="button" variant="secondary" disabled={status === 'requesting'} onClick={() => void recorder.start()}
      icon={status === 'requesting' ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}>
      {status === 'requesting' ? 'Waiting for microphone…' : 'Record a voice note'}
    </Button>
    <span className="field-hint">Your browser will ask for permission to use the microphone.</span>
  </div>;
}
