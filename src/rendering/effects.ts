const FOOD_PULSE_PERIOD_MS = 1_600;
const FOOD_PULSE_AMOUNT = 0.04;

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
