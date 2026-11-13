import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from './useTheme';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/** Light / Dark / System as a native radio group: arrow keys move, and the checked state is announced. */
export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  const name = useId();
  return <fieldset className="theme-control">
    <legend className="visually-hidden">Colour theme</legend>
    {OPTIONS.map(({ value, label, Icon }) => <label key={value} className="theme-control__option" title={`${label} theme`}>
      <input type="radio" name={name} value={value} checked={preference === value} onChange={() => setPreference(value)} />
      <span className="theme-control__face"><Icon size={16} aria-hidden="true" /><span className="theme-control__label">{label}</span></span>
    </label>)}
  </fieldset>;
}
