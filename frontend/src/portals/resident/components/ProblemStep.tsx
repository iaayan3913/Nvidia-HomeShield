import { Select, Textarea } from '../../../shared/components/FormControls';
import { CATEGORIES, ROOMS, categoryById, type FieldErrors, type ReportDraft } from '../model';
import { CategorySafety } from './SafetyNotice';

export const PROBLEM_FIELD_IDS = { category: `rp-category-${CATEGORIES[0]!.id}`, description: 'rp-description' } as const;

export function ProblemStep({ draft, errors, update }: { draft: ReportDraft; errors: FieldErrors; update: (patch: Partial<ReportDraft>) => void }) {
  const selected = categoryById(draft.category);
  return <div className="rp-step-body">
    <fieldset className={`rp-fieldset${errors.category ? ' rp-fieldset--error' : ''}`} aria-describedby={errors.category ? 'rp-category-error' : undefined}>
      <legend>What kind of problem is it?</legend>
      {errors.category ? <span id="rp-category-error" className="field-error">{errors.category}</span> : null}
      <div className="rp-category-grid">
        {CATEGORIES.map(({ id, label, hint, icon: Icon }) => <label key={id} className="rp-choice" data-checked={draft.category === id}>
          <input type="radio" name="rp-category" id={`rp-category-${id}`} value={id} checked={draft.category === id} onChange={() => update({ category: id })} />
          <Icon size={22} aria-hidden="true" className="rp-choice-icon" />
          <span className="rp-choice-text"><strong>{label}</strong><span>{hint}</span></span>
        </label>)}
      </div>
    </fieldset>

    {selected ? <CategorySafety category={selected} /> : null}

    <Select label="Where in your home? (optional)" value={draft.room} onChange={(event) => update({ room: event.target.value })}>
      <option value="">Not sure, or prefer not to say</option>
      {ROOMS.map((room) => <option key={room} value={room}>{room}</option>)}
    </Select>

    <Textarea id={PROBLEM_FIELD_IDS.description} label="Describe the problem"
      hint="What is happening, when it started and who it affects. If it is easier, you can add photos or a voice note in the next step instead."
      error={errors.description} value={draft.description} maxLength={1500} rows={5}
      onChange={(event) => update({ description: event.target.value })} />
    <p className="rp-char-count" aria-live="off">{draft.description.length} / 1500 characters</p>
  </div>;
}
