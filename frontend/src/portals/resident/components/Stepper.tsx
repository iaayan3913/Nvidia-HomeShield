import { Check } from 'lucide-react';
import { STEPS, type StepIndex } from '../model';

export function Stepper({ current, furthest, onSelect }: { current: StepIndex; furthest: StepIndex; onSelect: (step: StepIndex) => void }) {
  return <nav className="rp-stepper" aria-label="Report progress">
    <p className="rp-stepper-count">Step {current + 1} of {STEPS.length}</p>
    <ol>
      {STEPS.map((step, index) => {
        const i = index as StepIndex;
        const state = i === current ? 'current' : i < current || i <= furthest ? 'done' : 'todo';
        const reachable = i <= furthest && i !== current;
        const content = <><span className="rp-step-marker" aria-hidden="true">{state === 'done' && i < current ? <Check size={14} strokeWidth={3} /> : index + 1}</span><span className="rp-step-label">{step.label}</span></>;
        return <li key={step.id} data-state={state}>
          {reachable
            ? <button type="button" onClick={() => onSelect(i)} aria-label={`Go to step ${index + 1}: ${step.label}`}>{content}</button>
            : <span aria-current={i === current ? 'step' : undefined}>{content}</span>}
        </li>;
      })}
    </ol>
  </nav>;
}
