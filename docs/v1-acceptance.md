# SNAKISH v1 acceptance

This release accepts the existing game balance without subjective retuning.
The executable evidence is intentionally split by concern:

- `tests/unit/engine.spec.ts` fixes the 20×20 grid, three-segment snake at
  `(10,10)`, initial rightward direction, food at `(14,10)`, 10-point food,
  wall/body collision, board completion, restart state, and speed thresholds
  of 0/50/100/200.
- `tests/unit/simulation.spec.ts` fixes tier intervals at 180/155/130/110 ms,
  food placement, collision/completion behavior, and deterministic movement.
- `tests/unit/fixed-step-scheduler.spec.ts` fixes pause/resume debt, long-gap,
  catch-up, reset, and teardown behavior.
- `tests/unit/best-score.spec.ts`, `tests/unit/preferences.spec.ts`, and the
  matching browser specs fix score/preference persistence and failure fallback.
- `tests/e2e/final-acceptance.spec.ts` covers keyboard-only lifecycle including
  Restart, focus, accessible descriptions and announcements, and active
  gameplay across portrait/landscape resizing.
  The focused preferences, controls, pause-safety, renderer, audio, and desktop
  lifecycle specs cover contrast, reduced motion, touch/scroll, auto-pause,
  fallback, teardown/remount, and production smoke details.

Browser scope in this repository is Chromium desktop plus emulated touch/mobile.
Firefox and WebKit are not configured or claimed.
