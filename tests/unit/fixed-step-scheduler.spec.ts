import { describe, expect, it, vi } from 'vitest';

import {
  createFixedStepScheduler,
  type FixedStepSchedulerOptions,
} from '../../src/timing/fixed-step-scheduler';

function createTimerHarness(
  overrides: Partial<FixedStepSchedulerOptions> = {},
) {
  let currentTime = 0;
  let intervalMs = 100;
  let nextTimerId = 1;
  const callbacks = new Map<number, () => void>();
  const allCallbacks = new Map<number, () => void>();
  const onStep = vi.fn();
  const now = vi.fn(() => currentTime);
  const getIntervalMs = vi.fn(() => intervalMs);
  const schedule = vi.fn((callback: () => void, delayMs: number) => {
    void delayMs;
    const timerId = nextTimerId;
    nextTimerId += 1;
    callbacks.set(timerId, callback);
    allCallbacks.set(timerId, callback);
    return timerId;
  });
  const cancel = vi.fn((timerId: number) => {
    callbacks.delete(timerId);
  });
  const scheduler = createFixedStepScheduler({
    cancel,
    getIntervalMs,
    now,
    onStep,
    schedule,
    ...overrides,
  });

  return {
    allCallbacks,
    callbacks,
    cancel,
    getIntervalMs,
    now,
    onStep,
    schedule,
    scheduler,
    fire(timerId: number, time: number) {
      currentTime = time;
      const callback = allCallbacks.get(timerId);
      if (callback === undefined) {
        throw new Error(`Unknown timer ${timerId}.`);
      }
      callbacks.delete(timerId);
      callback();
    },
    nextTimerId() {
      const timerId = callbacks.keys().next().value as number | undefined;
      if (timerId === undefined) {
        throw new Error('Expected one pending timer.');
      }
      return timerId;
    },
    setIntervalMs(value: number) {
      intervalMs = value;
    },
    setTime(value: number) {
      currentTime = value;
    },
  };
}

function createSynchronousFirstScheduleHarness() {
  let currentTime = 0;
  let nextTimerId = 1;
  let maxLiveTimers = 0;
  let synchronousCallback: (() => void) | undefined;
  const callbacks = new Map<number, () => void>();
  const cancel = vi.fn((timerId: number) => {
    callbacks.delete(timerId);
  });
  const onStep = vi.fn();
  const schedule = vi.fn((callback: () => void, delayMs: number) => {
    void delayMs;
    const timerId = nextTimerId;
    nextTimerId += 1;

    if (synchronousCallback === undefined) {
      synchronousCallback = callback;
      callback();
      return timerId;
    }

    callbacks.set(timerId, callback);
    maxLiveTimers = Math.max(maxLiveTimers, callbacks.size);
    return timerId;
  });
  const scheduler = createFixedStepScheduler({
    cancel,
    getIntervalMs: () => 100,
    now: () => currentTime,
    onStep,
    schedule,
  });

  return {
    callbacks,
    cancel,
    maxLiveTimers: () => maxLiveTimers,
    onStep,
    schedule,
    scheduler,
    setTime(value: number) {
      currentTime = value;
    },
    fireSynchronousCallbackAgain() {
      synchronousCallback?.();
    },
  };
}

describe('createFixedStepScheduler', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid maxCatchUpSteps %s',
    (maxCatchUpSteps) => {
      expect(() =>
        createFixedStepScheduler({
          cancel: vi.fn(),
          getIntervalMs: () => 100,
          maxCatchUpSteps,
          now: () => 0,
          onStep: vi.fn(),
          schedule: vi.fn(() => 1),
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid longGapMs %s',
    (longGapMs) => {
      expect(() =>
        createFixedStepScheduler({
          cancel: vi.fn(),
          getIntervalMs: () => 100,
          longGapMs,
          now: () => 0,
          onStep: vi.fn(),
          schedule: vi.fn(() => 1),
        }),
      ).toThrow(RangeError);
    },
  );

  it('starts from a fresh baseline, schedules one full interval, and is idempotent', () => {
    const harness = createTimerHarness();

    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.now).not.toHaveBeenCalled();
    expect(harness.getIntervalMs).not.toHaveBeenCalled();

    harness.setTime(25);
    harness.scheduler.start();
    harness.scheduler.start();

    expect(harness.scheduler.isRunning()).toBe(true);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.now).toHaveBeenCalledTimes(1);
    expect(harness.getIntervalMs).toHaveBeenCalledTimes(1);
    expect(harness.schedule).toHaveBeenCalledTimes(1);
    expect(harness.schedule.mock.calls[0]?.[1]).toBe(100);
    expect(harness.callbacks.size).toBe(1);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid interval %s without scheduling a timer',
    (intervalMs) => {
      const harness = createTimerHarness({ getIntervalMs: () => intervalMs });

      expect(() => harness.scheduler.start()).toThrow(RangeError);
      expect(harness.schedule).not.toHaveBeenCalled();
      expect(harness.callbacks.size).toBe(0);
    },
  );

  it('preserves debt across early wakes and schedules only the exact remainder', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 40);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(60);
    expect(harness.callbacks.size).toBe(1);

    harness.fire(harness.nextTimerId(), 70);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(30);
    expect(harness.callbacks.size).toBe(1);

    harness.fire(harness.nextTimerId(), 100);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
    expect(harness.schedule.mock.calls[3]?.[1]).toBe(100);
    expect(harness.callbacks.size).toBe(1);
  });

  it('performs multiple fixed steps for jitter and keeps the fractional debt', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 250);

    expect(harness.onStep).toHaveBeenCalledTimes(2);
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(50);
    expect(harness.callbacks.size).toBe(1);
  });

  it('re-reads the interval after every step so speed changes apply within catch-up', () => {
    let intervalMs = 100;
    const onStep = vi.fn(() => {
      intervalMs = 50;
    });
    const getIntervalMs = vi.fn(() => intervalMs);
    const harness = createTimerHarness({
      getIntervalMs,
      maxCatchUpSteps: 5,
      onStep,
    });
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 250);

    expect(onStep).toHaveBeenCalledTimes(4);
    expect(getIntervalMs).toHaveBeenCalledTimes(5);
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(50);
  });

  it('stops coherently when the dynamic catch-up interval read throws and can restart cleanly', () => {
    const intervalError = new RangeError('dynamic interval read failed');
    let failIntervalRead = false;
    const harness = createTimerHarness({
      getIntervalMs: () => {
        if (failIntervalRead) {
          throw intervalError;
        }
        return 100;
      },
      maxCatchUpSteps: 5,
    });
    harness.scheduler.start();
    failIntervalRead = true;

    let thrown: unknown;
    try {
      harness.fire(harness.nextTimerId(), 150);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(intervalError);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.callbacks.size).toBe(0);
    expect(harness.cancel).not.toHaveBeenCalled();

    failIntervalRead = false;
    harness.setTime(500);
    harness.scheduler.start();

    expect(harness.scheduler.isRunning()).toBe(true);
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
    harness.fire(harness.nextTimerId(), 500);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
  });

  it('runs at most the default cap and discards all remaining debt', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 350);

    expect(harness.onStep).toHaveBeenCalledTimes(3);
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(100);

    harness.fire(harness.nextTimerId(), 450);
    expect(harness.onStep).toHaveBeenCalledTimes(4);
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(100);
  });

  it('honors a configured catch-up cap', () => {
    const harness = createTimerHarness({ maxCatchUpSteps: 1 });
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 250);

    expect(harness.onStep).toHaveBeenCalledTimes(1);
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(100);
  });

  it('drops debt at the default long-gap threshold and restarts with a fresh full interval', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();
    harness.fire(harness.nextTimerId(), 40);
    harness.setIntervalMs(60);

    harness.fire(harness.nextTimerId(), 1_040);

    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(60);

    harness.fire(harness.nextTimerId(), 1_100);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
  });

  it('stops coherently when the long-gap interval read throws and can restart cleanly', () => {
    const intervalError = new RangeError('long-gap interval read failed');
    let failIntervalRead = false;
    const harness = createTimerHarness({
      getIntervalMs: () => {
        if (failIntervalRead) {
          throw intervalError;
        }
        return 100;
      },
    });
    harness.scheduler.start();
    failIntervalRead = true;

    let thrown: unknown;
    try {
      harness.fire(harness.nextTimerId(), 1_000);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(intervalError);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.callbacks.size).toBe(0);
    expect(harness.cancel).not.toHaveBeenCalled();

    failIntervalRead = false;
    harness.setTime(2_000);
    harness.scheduler.start();

    expect(harness.scheduler.isRunning()).toBe(true);
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
    harness.fire(harness.nextTimerId(), 2_000);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
  });

  it('treats negative elapsed time as zero, preserves existing debt, and resets the baseline', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), 40);
    harness.fire(harness.nextTimerId(), 20);

    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(60);

    harness.fire(harness.nextTimerId(), 80);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
  });

  it('recovers safely from nonfinite elapsed time without creating bad delays', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();

    harness.fire(harness.nextTimerId(), Number.NaN);
    expect(harness.schedule.mock.calls[1]?.[1]).toBe(100);

    harness.fire(harness.nextTimerId(), 50);
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(100);
    expect(harness.onStep).not.toHaveBeenCalled();

    harness.fire(harness.nextTimerId(), 150);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
  });

  it('pauses idempotently, cancels pending work, and resumes without old debt', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();
    harness.fire(harness.nextTimerId(), 40);

    harness.scheduler.pause();
    harness.scheduler.pause();

    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.size).toBe(0);

    harness.setTime(500);
    harness.scheduler.start();
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(100);
    harness.fire(harness.nextTimerId(), 600);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
  });

  it('resets a running scheduler to a fresh baseline and one full interval', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();
    harness.fire(harness.nextTimerId(), 40);

    harness.setTime(75);
    harness.scheduler.reset();

    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.size).toBe(1);
    expect(harness.schedule.mock.calls[2]?.[1]).toBe(100);

    harness.fire(harness.nextTimerId(), 175);
    expect(harness.onStep).toHaveBeenCalledTimes(1);
  });

  it('stops coherently when a running reset interval read throws and can restart cleanly', () => {
    const intervalError = new RangeError('reset interval read failed');
    let failIntervalRead = false;
    const harness = createTimerHarness({
      getIntervalMs: () => {
        if (failIntervalRead) {
          throw intervalError;
        }
        return 100;
      },
    });
    harness.scheduler.start();
    harness.fire(harness.nextTimerId(), 40);
    const pendingTimerId = harness.nextTimerId();
    failIntervalRead = true;
    harness.setTime(75);

    let thrown: unknown;
    try {
      harness.scheduler.reset();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(intervalError);
    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.callbacks.size).toBe(0);
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.cancel).toHaveBeenCalledWith(pendingTimerId);

    failIntervalRead = false;
    harness.setTime(500);
    harness.scheduler.start();

    expect(harness.scheduler.isRunning()).toBe(true);
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
    harness.fire(harness.nextTimerId(), 500);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.schedule.mock.calls.at(-1)?.[1]).toBe(100);
  });

  it('resets while paused without consulting time or interval or scheduling', () => {
    const harness = createTimerHarness();

    harness.scheduler.reset();

    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.now).not.toHaveBeenCalled();
    expect(harness.getIntervalMs).not.toHaveBeenCalled();
    expect(harness.schedule).not.toHaveBeenCalled();
  });

  it('ignores stale canceled callbacks without disturbing the current timer', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();
    const staleTimerId = harness.nextTimerId();

    harness.setTime(25);
    harness.scheduler.reset();
    const currentTimerId = harness.nextTimerId();
    harness.fire(staleTimerId, 500);

    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.callbacks.size).toBe(1);
    expect(harness.nextTimerId()).toBe(currentTimerId);
    expect(harness.schedule).toHaveBeenCalledTimes(2);
  });

  it.each(['pause', 'dispose'] as const)(
    '%s cancels only the live timer after a synchronous first schedule',
    (operation) => {
      const harness = createSynchronousFirstScheduleHarness();

      harness.scheduler.start();

      expect(harness.onStep).not.toHaveBeenCalled();
      expect(harness.schedule).toHaveBeenCalledTimes(2);
      expect(harness.schedule.mock.calls.map((call) => call[1])).toEqual([
        100, 100,
      ]);
      expect([...harness.callbacks.keys()]).toEqual([2]);
      expect(harness.maxLiveTimers()).toBe(1);

      harness.setTime(100);
      harness.fireSynchronousCallbackAgain();

      expect(harness.onStep).not.toHaveBeenCalled();
      expect([...harness.callbacks.keys()]).toEqual([2]);
      expect(harness.schedule).toHaveBeenCalledTimes(2);

      harness.scheduler[operation]();

      expect(harness.scheduler.isRunning()).toBe(false);
      expect(harness.cancel).toHaveBeenCalledTimes(1);
      expect(harness.cancel).toHaveBeenCalledWith(2);
      expect(harness.callbacks.size).toBe(0);
      expect(harness.maxLiveTimers()).toBe(1);
    },
  );

  it('disposes terminally and makes later methods and stale callbacks inert', () => {
    const harness = createTimerHarness();
    harness.scheduler.start();
    const staleTimerId = harness.nextTimerId();
    const nowCalls = harness.now.mock.calls.length;
    const intervalCalls = harness.getIntervalMs.mock.calls.length;

    harness.scheduler.dispose();
    harness.scheduler.dispose();
    harness.scheduler.start();
    harness.scheduler.reset();
    harness.scheduler.pause();
    harness.fire(staleTimerId, 100);

    expect(harness.scheduler.isRunning()).toBe(false);
    expect(harness.cancel).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.size).toBe(0);
    expect(harness.onStep).not.toHaveBeenCalled();
    expect(harness.now).toHaveBeenCalledTimes(nowCalls);
    expect(harness.getIntervalMs).toHaveBeenCalledTimes(intervalCalls);
    expect(harness.schedule).toHaveBeenCalledTimes(1);
  });

  it('stops a callback immediately when onStep disposes the scheduler', () => {
    const schedulerHolder: {
      current?: ReturnType<typeof createFixedStepScheduler>;
    } = {};
    const onStep = vi.fn(() => schedulerHolder.current?.dispose());
    const harness = createTimerHarness({ onStep });
    const scheduler = harness.scheduler;
    schedulerHolder.current = scheduler;
    scheduler.start();
    const intervalCalls = harness.getIntervalMs.mock.calls.length;

    harness.fire(harness.nextTimerId(), 350);

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(scheduler.isRunning()).toBe(false);
    expect(harness.getIntervalMs).toHaveBeenCalledTimes(intervalCalls);
    expect(harness.callbacks.size).toBe(0);
  });

  it('throws if an interval becomes invalid during catch-up and never schedules it', () => {
    let intervalMs = 100;
    const onStep = vi.fn(() => {
      intervalMs = 0;
    });
    const harness = createTimerHarness({
      getIntervalMs: () => intervalMs,
      onStep,
    });
    harness.scheduler.start();
    const timerId = harness.nextTimerId();

    expect(() => harness.fire(timerId, 100)).toThrow(RangeError);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(harness.schedule).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.size).toBe(0);
  });
});
