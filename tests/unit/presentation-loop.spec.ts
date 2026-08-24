import { describe, expect, it, vi } from 'vitest';

import { createPresentationLoop } from '../../src/rendering/presentation-loop';

function createAnimationHarness(reducedMotion = false) {
  let nextFrameId = 1;
  let prefersReducedMotion = reducedMotion;
  const callbacks = new Map<number, FrameRequestCallback>();
  const render = vi.fn();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  });
  const cancelAnimationFrame = vi.fn((frameId: number) => {
    callbacks.delete(frameId);
  });

  return {
    callbacks,
    cancelAnimationFrame,
    render,
    requestAnimationFrame,
    runNextFrame(timestamp: number) {
      const nextFrame = [...callbacks.entries()][0];
      if (nextFrame === undefined) {
        throw new Error('Expected a pending animation frame.');
      }
      callbacks.delete(nextFrame[0]);
      nextFrame[1](timestamp);
    },
    setReducedMotion(value: boolean) {
      prefersReducedMotion = value;
    },
    start() {
      return createPresentationLoop({
        cancelAnimationFrame,
        prefersReducedMotion: () => prefersReducedMotion,
        render,
        requestAnimationFrame,
      });
    },
  };
}

describe('createPresentationLoop', () => {
  it('redraws with changing RAF timestamps and keeps only one frame pending', () => {
    const harness = createAnimationHarness();
    const loop = harness.start();

    expect(harness.render).toHaveBeenCalledWith(0, false);
    expect(harness.callbacks.size).toBe(1);

    loop.redraw();
    loop.redraw();
    expect(harness.callbacks.size).toBe(1);

    harness.runNextFrame(125);
    expect(harness.render).toHaveBeenLastCalledWith(125, false);
    expect(harness.callbacks.size).toBe(1);

    harness.runNextFrame(250);
    expect(harness.render).toHaveBeenLastCalledWith(250, false);
    expect(harness.callbacks.size).toBe(1);

    loop.stop();
    expect(harness.callbacks.size).toBe(0);
  });

  it('renders one stable frame and schedules no RAF while motion is reduced', () => {
    const harness = createAnimationHarness(true);
    const loop = harness.start();

    expect(harness.render).toHaveBeenCalledTimes(1);
    expect(harness.render).toHaveBeenCalledWith(0, true);
    expect(harness.requestAnimationFrame).not.toHaveBeenCalled();

    loop.redraw();
    expect(harness.render).toHaveBeenCalledTimes(2);
    expect(harness.callbacks.size).toBe(0);

    harness.setReducedMotion(false);
    loop.syncMotionPreference();
    expect(harness.render).toHaveBeenLastCalledWith(0, false);
    expect(harness.callbacks.size).toBe(1);

    harness.setReducedMotion(true);
    loop.syncMotionPreference();
    expect(harness.render).toHaveBeenLastCalledWith(0, true);
    expect(harness.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(harness.callbacks.size).toBe(0);
  });
});
