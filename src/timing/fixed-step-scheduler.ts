export interface FixedStepScheduler {
  start(): void;
  pause(): void;
  reset(): void;
  dispose(): void;
  isRunning(): boolean;
}

export interface FixedStepSchedulerOptions {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timerId: number) => void;
  getIntervalMs: () => number;
  onStep: () => void;
  maxCatchUpSteps?: number;
  longGapMs?: number;
}

const DEFAULT_MAX_CATCH_UP_STEPS = 3;
const DEFAULT_LONG_GAP_MS = 1_000;

export function createFixedStepScheduler(
  options: FixedStepSchedulerOptions,
): FixedStepScheduler {
  const maxCatchUpSteps =
    options.maxCatchUpSteps === undefined
      ? DEFAULT_MAX_CATCH_UP_STEPS
      : options.maxCatchUpSteps;
  const longGapMs =
    options.longGapMs === undefined ? DEFAULT_LONG_GAP_MS : options.longGapMs;

  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
    throw new RangeError('maxCatchUpSteps must be a positive integer.');
  }
  if (!Number.isFinite(longGapMs) || longGapMs <= 0) {
    throw new RangeError('longGapMs must be finite and positive.');
  }

  let running = false;
  let disposed = false;
  let baselineMs: number | undefined;
  let elapsedDebtMs = 0;
  let currentIntervalMs: number | undefined;
  let timerId: number | undefined;
  let pendingTimerToken: object | undefined;

  const readIntervalMs = (): number => {
    const intervalMs = options.getIntervalMs();
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(
        'The fixed-step interval must be finite and positive.',
      );
    }
    return intervalMs;
  };

  const readRunningIntervalMs = (): number => {
    try {
      return readIntervalMs();
    } catch (error) {
      running = false;
      pendingTimerToken = undefined;
      timerId = undefined;
      baselineMs = undefined;
      elapsedDebtMs = 0;
      currentIntervalMs = undefined;
      throw error;
    }
  };

  const cancelPendingTimer = (): void => {
    const pendingTimerId = timerId;
    pendingTimerToken = undefined;
    timerId = undefined;
    if (pendingTimerId !== undefined) {
      options.cancel(pendingTimerId);
    }
  };

  const scheduleAfter = (delayMs: number): void => {
    if (disposed || !running || pendingTimerToken !== undefined) {
      return;
    }

    const timerToken = {};
    pendingTimerToken = timerToken;
    const scheduledTimerId = options.schedule(() => {
      if (disposed || !running || pendingTimerToken !== timerToken) {
        return;
      }

      pendingTimerToken = undefined;
      timerId = undefined;
      runTimeout();
    }, delayMs);

    if (pendingTimerToken === timerToken) {
      timerId = scheduledTimerId;
    }
  };

  const runTimeout = (): void => {
    if (disposed || !running) {
      return;
    }

    const currentTimeMs = options.now();
    const elapsedMs =
      baselineMs === undefined ? Number.NaN : currentTimeMs - baselineMs;
    const safeElapsedMs =
      Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;

    baselineMs = Number.isFinite(currentTimeMs) ? currentTimeMs : undefined;

    if (safeElapsedMs >= longGapMs) {
      elapsedDebtMs = 0;
      currentIntervalMs = readRunningIntervalMs();
      scheduleAfter(currentIntervalMs);
      return;
    }

    elapsedDebtMs += safeElapsedMs;
    let intervalMs = currentIntervalMs;
    if (intervalMs === undefined) {
      intervalMs = readRunningIntervalMs();
      currentIntervalMs = intervalMs;
    }
    let completedSteps = 0;

    while (elapsedDebtMs >= intervalMs && completedSteps < maxCatchUpSteps) {
      elapsedDebtMs -= intervalMs;
      options.onStep();
      completedSteps += 1;

      if (disposed || !running || pendingTimerToken !== undefined) {
        return;
      }
      intervalMs = readRunningIntervalMs();
      currentIntervalMs = intervalMs;
    }

    if (completedSteps === maxCatchUpSteps) {
      elapsedDebtMs = 0;
    }

    scheduleAfter(intervalMs - elapsedDebtMs);
  };

  const start = (): void => {
    if (disposed || running) {
      return;
    }

    const currentTimeMs = options.now();
    baselineMs = Number.isFinite(currentTimeMs) ? currentTimeMs : undefined;
    elapsedDebtMs = 0;
    currentIntervalMs = readIntervalMs();
    running = true;
    scheduleAfter(currentIntervalMs);
  };

  const pause = (): void => {
    if (disposed) {
      return;
    }

    running = false;
    cancelPendingTimer();
    baselineMs = undefined;
    elapsedDebtMs = 0;
    currentIntervalMs = undefined;
  };

  const reset = (): void => {
    if (disposed) {
      return;
    }

    cancelPendingTimer();
    baselineMs = undefined;
    elapsedDebtMs = 0;

    if (!running) {
      return;
    }

    const currentTimeMs = options.now();
    baselineMs = Number.isFinite(currentTimeMs) ? currentTimeMs : undefined;
    currentIntervalMs = readRunningIntervalMs();
    scheduleAfter(currentIntervalMs);
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }

    disposed = true;
    running = false;
    cancelPendingTimer();
    baselineMs = undefined;
    elapsedDebtMs = 0;
    currentIntervalMs = undefined;
  };

  return {
    dispose,
    isRunning: () => running,
    pause,
    reset,
    start,
  };
}
