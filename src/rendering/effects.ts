import type { GridPosition } from '../engine/model';

const FOOD_PULSE_PERIOD_MS = 1_600;
const FOOD_PULSE_AMOUNT = 0.04;

export const FOOD_FEEDBACK_DURATION_MS = 360;
export const TERMINAL_FEEDBACK_DURATION_MS = 500;

export interface FoodFeedbackEvent {
  readonly type: 'food';
  readonly timestampMs: number;
  readonly position: GridPosition;
}

export interface TerminalFeedbackEvent {
  readonly type: 'terminal';
  readonly timestampMs: number;
  readonly status: 'gameOver' | 'completed';
}

export interface ArcadeFeedback {
  readonly food: FoodFeedbackEvent | null;
  readonly terminal: TerminalFeedbackEvent | null;
}

export interface FeedbackFrame {
  readonly active: boolean;
  readonly progress: number;
  readonly alpha: number;
  readonly scale: number;
}

export const EMPTY_ARCADE_FEEDBACK: ArcadeFeedback = Object.freeze({
  food: null,
  terminal: null,
});

const INACTIVE_FEEDBACK_FRAME: FeedbackFrame = Object.freeze({
  active: false,
  progress: 0,
  alpha: 0,
  scale: 1,
});

const timedFeedbackFrame = (
  eventTimestampMs: number | undefined,
  timestampMs: number,
  durationMs: number,
  reducedMotion: boolean,
  maximumAlpha: number,
  maximumScale: number,
): FeedbackFrame => {
  if (
    reducedMotion ||
    eventTimestampMs === undefined ||
    !Number.isFinite(eventTimestampMs) ||
    !Number.isFinite(timestampMs)
  ) {
    return INACTIVE_FEEDBACK_FRAME;
  }

  const elapsedMs = timestampMs - eventTimestampMs;
  if (elapsedMs < 0 || elapsedMs >= durationMs) {
    return INACTIVE_FEEDBACK_FRAME;
  }

  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const alpha = Math.min(1, Math.max(0, maximumAlpha * (1 - progress)));
  const scale = Math.min(
    maximumScale,
    Math.max(1, 1 + (maximumScale - 1) * progress),
  );
  return { active: true, progress, alpha, scale };
};

export const foodFeedbackFrame = (
  event: FoodFeedbackEvent | null | undefined,
  timestampMs: number,
  reducedMotion: boolean,
): FeedbackFrame =>
  timedFeedbackFrame(
    event?.timestampMs,
    timestampMs,
    FOOD_FEEDBACK_DURATION_MS,
    reducedMotion,
    0.72,
    1.8,
  );

export const terminalFeedbackFrame = (
  event: TerminalFeedbackEvent | null | undefined,
  timestampMs: number,
  reducedMotion: boolean,
): FeedbackFrame =>
  timedFeedbackFrame(
    event?.timestampMs,
    timestampMs,
    TERMINAL_FEEDBACK_DURATION_MS,
    reducedMotion,
    0.64,
    1.35,
  );

/**
 * Returns a deterministic, gently bounded food scale. Reduced-motion frames
 * always use the neutral scale and therefore contain no animated pulse.
 */
export const foodPulseScale = (
  timestampMs: number,
  reducedMotion: boolean,
): number => {
  if (reducedMotion) {
    return 1;
  }

  const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : 0;
  const phase =
    ((safeTimestamp % FOOD_PULSE_PERIOD_MS) / FOOD_PULSE_PERIOD_MS) *
    Math.PI *
    2;

  return 1 + Math.sin(phase) * FOOD_PULSE_AMOUNT;
};
