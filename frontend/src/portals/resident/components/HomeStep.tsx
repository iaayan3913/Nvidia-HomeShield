import { useRef, useState, type KeyboardEvent } from 'react';
import { LoaderCircle, MapPin, Search } from 'lucide-react';
import { Button } from '../../../shared/components/Button';
import { Input } from '../../../shared/components/FormControls';
import type { Property } from '../../../shared/mock';
import { findProperties } from '../contract';
import { UK_POSTCODE, normalisePostcode, type FieldErrors, type ReportDraft } from '../model';

export const HOME_FIELD_IDS = { home: 'rp-home-search', addressLine: 'rp-address-line', postcode: 'rp-postcode' } as const;

type SearchState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; query: string; results: Property[] } | { status: 'error' };

export function HomeStep({ draft, errors, update }: { draft: ReportDraft; errors: FieldErrors; update: (patch: Partial<ReportDraft>) => void }) {
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [queryError, setQueryError] = useState<string | undefined>();
  const tokenRef = useRef(0);
  const resultsRef = useRef<HTMLFieldSetElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const runSearch = async () => {
    const query = draft.searchQuery.trim();
    if (query.replace(/\s/g, '').length < 2) { setQueryError('Enter at least 2 characters of your postcode or address.'); return; }
    setQueryError(undefined);
    const token = ++tokenRef.current;
    setSearch({ status: 'loading' });
    try {
      const results = await findProperties(query);
      if (token !== tokenRef.current) return;
      setSearch({ status: 'done', query, results });
      if (results.length) window.setTimeout(() => resultsRef.current?.querySelector('input')?.focus(), 0);
    } catch {
      if (token === tokenRef.current) setSearch({ status: 'error' });
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void runSearch(); }
  };

  const choose = (property: Property) => {
    update({ home: { id: property.id, display_address: property.display_address, postcode: property.postcode, area: property.area } });
  };

  const switchMode = (mode: ReportDraft['addressMode']) => {
    update({ addressMode: mode, ...(mode === 'manual' ? { home: null } : {}) });
    window.setTimeout(() => document.getElementById(mode === 'manual' ? HOME_FIELD_IDS.addressLine : HOME_FIELD_IDS.home)?.focus(), 0);
  };

  if (draft.addressMode === 'manual') return <div className="rp-step-body">
    <p className="rp-lead">Enter your address and we will pass it to the housing team with your report.</p>
    <Input id={HOME_FIELD_IDS.addressLine} label="First line of your address" hint="Include your flat or house number." autoComplete="address-line1" error={errors.addressLine}
      value={draft.addressLine} maxLength={120} onChange={(event) => update({ addressLine: event.target.value })} />
    <Input id={HOME_FIELD_IDS.postcode} label="Postcode" autoComplete="postal-code" autoCapitalize="characters" spellCheck={false} className="rp-input-postcode" error={errors.postcode}
      value={draft.postcode} maxLength={10} onChange={(event) => update({ postcode: event.target.value })}
      onBlur={() => { const tidy = normalisePostcode(draft.postcode); if (UK_POSTCODE.test(draft.postcode.trim()) && tidy !== draft.postcode) update({ postcode: tidy }); }} />
    <Button type="button" variant="quiet" className="rp-mode-switch" icon={<Search size={18} aria-hidden="true" />} onClick={() => switchMode('search')}>Search for my address instead</Button>
  </div>;

  return <div className="rp-step-body">
    {draft.home && search.status !== 'done'
      ? <div className="rp-address">
          <MapPin size={20} aria-hidden="true" />
          <div>
            <span className="rp-address-label">Your home</span>
            <strong>{draft.home.display_address}</strong>
            <span>{draft.home.area ? `${draft.home.area}, ` : ''}{draft.home.postcode}</span>
          </div>
          <Button type="button" variant="secondary" className="rp-address-change" onClick={() => { update({ home: null }); setSearch({ status: 'idle' }); window.setTimeout(() => searchRef.current?.focus(), 0); }}>Change<span className="rp-visually-hidden"> address</span></Button>
        </div>
      : <>
          <div className="rp-search-row">
            <Input ref={searchRef} id={HOME_FIELD_IDS.home} label="Postcode or address" hint="For example S5 8QJ or 14 Rowan Court." autoComplete="off" spellCheck={false} enterKeyHint="search"
              error={errors.home ?? queryError} value={draft.searchQuery} maxLength={80} onKeyDown={onSearchKey}
              onChange={(event) => { update({ searchQuery: event.target.value }); setQueryError(undefined); }} />
            <Button type="button" variant="secondary" className="rp-search-button" disabled={search.status === 'loading'} aria-busy={search.status === 'loading'} onClick={() => void runSearch()}
              icon={search.status === 'loading' ? <LoaderCircle size={20} className="rp-spin" aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}>
              {search.status === 'loading' ? 'Searching…' : 'Find address'}
            </Button>
          </div>
          <p className="rp-visually-hidden" role="status">{search.status === 'loading' ? 'Searching for addresses' : search.status === 'done' ? `${search.results.length} ${search.results.length === 1 ? 'address' : 'addresses'} found` : search.status === 'error' ? 'Address search failed' : ''}</p>
          {search.status === 'error' ? <div className="rp-callout rp-callout--warning" role="alert"><div><strong>We could not search for addresses just now</strong><p>Check your connection and try again, or enter your address yourself.</p><Button type="button" variant="secondary" onClick={() => void runSearch()}>Try again</Button></div></div> : null}
          {search.status === 'done' && !search.results.length ? <p className="rp-empty">No homes match “{search.query}”. Check the postcode, or enter your address yourself.</p> : null}
          {search.status === 'done' && search.results.length ? <fieldset className="rp-fieldset" ref={resultsRef}>
            <legend className="rp-legend-small">Choose your address ({search.results.length} found)</legend>
            <div className="rp-results">
              {search.results.map((property) => <label key={property.id} className="rp-result">
                <input type="radio" name="rp-home" value={property.id} checked={draft.home?.id === property.id} onChange={() => choose(property)} />
                <span><strong>{property.display_address}</strong><span>{property.area}, {property.postcode}</span></span>
              </label>)}
            </div>
            {draft.home ? <p className="rp-chosen" aria-live="polite"><MapPin size={18} aria-hidden="true" />Selected: <strong>{draft.home.display_address}, {draft.home.postcode}</strong></p> : null}
          </fieldset> : null}
        </>}
    <Button type="button" variant="quiet" className="rp-mode-switch" onClick={() => switchMode('manual')}>My address isn’t listed</Button>
  </div>;
}
