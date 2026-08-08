# Accessibility

Status: active Cosmoaudition System v0.1 account
Date: 2026-07-28

## Implemented

- Audio starts only from the explicit, labelled `Listen` control.
- `Take observation`, `Listen`, `Stop`, `Panic`, master gain, locality, the five
  workspace buttons, patch checkboxes and ranges, material controls, output
  switches, MIDI authorization, and archive actions use native interactive
  elements and are keyboard reachable.
- A skip link moves focus to the current workbench.
- Desktop and mobile workspace navigation expose `aria-current`.
- Signal nodes expose selected state and an accessible value, unit, and evidence
  kind; the graphical orbital layout is not the only account of a signal.
- Runtime messages use `role="status"` and `aria-live="polite"`.
- Visible controls have focus-visible styles, and no critical action depends on
  hover.
- Motion effects are enabled only when `prefers-reduced-motion` permits them.
- The processor graphic is labelled as a control surface, not a measured
  spectrogram.

## Current browser coverage

The Playwright flow checks application identity, workspace navigation, fixture
observation, source-stratum controls, mapping-route state, imported-material
boundaries, explicit Listen/Panic transitions, failure without substitution,
archive save/load, and bounded runtime behavior.

Automated semantics do not establish screen-reader usability, perceptual
contrast, cognitive accessibility, or whether the auditory result is useful.

## Current limits

- A VoiceOver pass on macOS and iOS remains required before public release.
- Muted text and low-confidence colors still require measured contrast review.
- Sound has a textual source/mapping/control account but no caption-equivalent
  description of the heard result.
- Range inputs use browser-native slider semantics; their visual direction is
  not an additional semantic claim.
- Live Web MIDI accessibility depends on browser permission UI and the external
  device.

## Before public release

- Complete keyboard-only and VoiceOver passes at desktop and mobile widths.
- Measure contrast in every source-health and decision state.
- Test zoom, text enlargement, reduced motion, and high-contrast preferences.
- Keep Panic and current system status reachable in every workspace.
