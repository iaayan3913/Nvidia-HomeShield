# HomeShield design system

HomeShield has one identity and three deliberately different working environments. Resident is light, calm and editorial; Operations is dark, spatial and compact; Operative is light, high-contrast and touch-first. Shared navigation, typography, controls, status semantics and focus behaviour make them one product.

## Tokens

Tokens live in `src/styles/global.css`. Do not duplicate colour values inside a portal.

| Role | Token / value | Use |
|---|---|---|
| Brand | `--green-500: #76B900` | Primary action, selection, focus and map focus only |
| Graphite | `--graphite-950: #0D100D` | Operations canvas |
| Ink | `--ink-900` / `--ink-500` | Primary and supporting copy |
| Light surfaces | `--surface`, `--surface-subtle`, `--surface-muted` | Background hierarchy |
| Emergency | `--danger: #D9343B` | Threats and destructive actions only |
| Warning | `--warning: #AD6B00` | Deadlines and pending decisions |
| Information | `--info: #19759B` | Routes, location and neutral information |
| Success | `--success: #317C23` | Approved, complete and resolved |

Typography uses Manrope for headings and Source Sans 3 for interface text, with system fallbacks. The external font request is an enhancement: the product remains usable offline. Use the fluid heading styles already defined rather than oversized hero text. Body text is 16px minimum. Use the spacing scale from `--space-1` (4px) through `--space-8` (64px).

Radii are intentionally restrained: 4px status labels, 8px controls and 14px only for major bounded surfaces. Avoid glass effects, gradients, glowing borders and repeated floating cards. Use a thin separator or changes in surface tone before adding a shadow.

## Components

- `Button`: `primary` is NVIDIA green and reserved for the single principal action in a context. `secondary`, `quiet` and `danger` express alternatives.
- `Input`, `Select`, `Textarea`: labels are always visible. Pass `hint` or `error`; errors are associated with fields for assistive technology.
- `StatusBadge`: semantic state only, never decorative metadata.
- `PortalNav`: shared top-level navigation. Portals may add local navigation inside their owned directory.
- `NotificationProvider`: use `useNotifications().notify(...)` for immediate feedback. Shared workflow events belong in `mockService` activity and notifications.
- `ErrorBoundary`: root recovery state. Portal-level async failures need useful retry/empty states.

Use Lucide icons at 16–22px for controls, and include a text label or accessible name. Icons must clarify an action, not decorate every heading.

## Portal conventions

Resident: light surfaces, generous measure, one decision per step, reassuring plain English. Keep the emergency advice visible but not alarmist.

Operations: the map is the main surface. Use the dark tokens inherited from `[data-portal="operations"]`; one collapsible case rail and contextual inspector are preferred to permanent sidebars. Emergency red must remain distinct from green selections. Map labels and routes require sufficient contrast without permanent clutter.

Operative: mobile-first, 44px minimum targets, strong next-action hierarchy, no dense tables. Connectivity and demonstration status must remain understandable at a glance.

## Responsive and motion

Design mobile-first. Reference breakpoints are 430px (small phone), 760px (navigation/layout), 1024px (desktop workspace) and 1280px (wide map). Avoid device-specific assumptions. The global maximum reading width is 1280px; the Operations map may intentionally exceed it.

Motion is 140ms for feedback and 220ms for panel transitions. Camera movement may take 500–900ms when it communicates focus. Never continuously pulse except a controlled emergency marker. Honour `prefers-reduced-motion`; the global stylesheet disables nonessential transitions.

## Accessibility and content

Meet WCAG 2.2 AA contrast, preserve visible focus, use semantic landmarks, provide keyboard equivalents for map selection, and do not communicate state by colour alone. Never promise statutory deadlines or present a simulated classification as an official determination. Use British English. All mock workflows and synthetic locations must be labelled as demonstration data.
