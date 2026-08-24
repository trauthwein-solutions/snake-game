import { describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../../src/engine/game-engine';
import type { GameState } from '../../src/engine/model';
import {
  renderGameFrame,
  type RendererOptions,
} from '../../src/rendering/canvas-renderer';
import { foodPulseScale } from '../../src/rendering/effects';
import {
  HIGH_CONTRAST_PALETTE,
  NORMAL_PALETTE,
} from '../../src/rendering/palette';

interface DrawCall {
  readonly fillStyle: string;
  readonly args: readonly number[];
}

function createCanvasHarness(
  cssWidth = 400,
  cssHeight = cssWidth,
  hasContext = true,
) {
  const fillRectCalls: DrawCall[] = [];
  const fillCalls: string[] = [];
  const arcCalls: number[][] = [];
  const setTransform = vi.fn();
  const clearRect = vi.fn();
  const stroke = vi.fn();
  const fill = vi.fn(function (this: { fillStyle: string }) {
    fillCalls.push(this.fillStyle);
  });
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    shadowBlur: 0,
    shadowColor: '',
    globalAlpha: 1,
    setTransform,
    clearRect,
    fillRect: vi.fn(function (this: { fillStyle: string }, ...args: number[]) {
      fillRectCalls.push({ fillStyle: this.fillStyle, args });
    }),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn((...args: number[]) => {
      arcCalls.push(args);
    }),
    stroke,
    fill,
    save: vi.fn(),
    restore: vi.fn(),
  };
  const canvas = {
    width: 300,
    height: 150,
    getBoundingClientRect: () => ({ width: cssWidth, height: cssHeight }),
    getContext: vi.fn(() => (hasContext ? context : null)),
  } as unknown as HTMLCanvasElement;

  return {
    canvas,
    context,
    fillRectCalls,
    fillCalls,
    arcCalls,
    setTransform,
    clearRect,
    stroke,
    fill,
  };
}

function render(
  harness: ReturnType<typeof createCanvasHarness>,
  options: RendererOptions = {},
  state: GameState = createInitialState(),
) {
  return renderGameFrame(harness.canvas, state, {
    devicePixelRatio: 1,
    timestampMs: 0,
    ...options,
  });
}

describe('renderGameFrame', () => {
  it('sizes and draws from the content box instead of the bordered and padded box', () => {
    const harness = createCanvasHarness(334, 338);
    Object.defineProperty(harness.canvas, 'ownerDocument', {
      value: {
        defaultView: {
          devicePixelRatio: 2,
          getComputedStyle: () => ({
            borderLeftWidth: '2px',
            borderRightWidth: '2px',
            borderTopWidth: '2px',
            borderBottomWidth: '2px',
            paddingLeft: '5px',
            paddingRight: '5px',
            paddingTop: '7px',
            paddingBottom: '7px',
          }),
        },
      },
    });

    expect(render(harness, { devicePixelRatio: 2 })).toEqual({
      status: 'drawn',
      cssWidth: 320,
      cssHeight: 320,
      devicePixelRatio: 2,
    });
    expect(harness.canvas.width).toBe(640);
    expect(harness.canvas.height).toBe(640);
    expect(harness.fillRectCalls[0]?.args).toEqual([0, 0, 320, 320]);
  });

  it('uses client dimensions as a deterministic content-box fallback', () => {
    const harness = createCanvasHarness(322, 322);
    Object.defineProperties(harness.canvas, {
      clientWidth: { value: 320 },
      clientHeight: { value: 320 },
    });

    expect(render(harness, { devicePixelRatio: 2 })).toMatchObject({
      status: 'drawn',
      cssWidth: 320,
      cssHeight: 320,
    });
    expect(harness.canvas.width).toBe(640);
    expect(harness.canvas.height).toBe(640);
  });

  it('sizes backing pixels for CSS size and DPR, then draws in CSS coordinates', () => {
    const harness = createCanvasHarness(320, 320);

    expect(render(harness, { devicePixelRatio: 2 })).toEqual({
      status: 'drawn',
      cssWidth: 320,
      cssHeight: 320,
      devicePixelRatio: 2,
    });
    expect(harness.canvas.width).toBe(640);
    expect(harness.canvas.height).toBe(640);
    expect(harness.setTransform).toHaveBeenNthCalledWith(1, 1, 0, 0, 1, 0, 0);
    expect(harness.clearRect).toHaveBeenCalledWith(0, 0, 640, 640);
    expect(harness.setTransform).toHaveBeenNthCalledWith(2, 2, 0, 0, 2, 0, 0);
    expect(harness.fillRectCalls[0]?.args).toEqual([0, 0, 320, 320]);
  });

  it('resets the transform on every frame and does not accumulate DPR scaling', () => {
    const harness = createCanvasHarness(200, 200);

    render(harness, { devicePixelRatio: 2 });
    render(harness, { devicePixelRatio: 3 });

    expect(harness.canvas.width).toBe(600);
    expect(harness.canvas.height).toBe(600);
    expect(harness.setTransform.mock.calls).toEqual([
      [1, 0, 0, 1, 0, 0],
      [2, 0, 0, 2, 0, 0],
      [1, 0, 0, 1, 0, 0],
      [3, 0, 0, 3, 0, 0],
    ]);
  });

  it('draws a 20 by 20 grid plus distinct body, head, and food treatments', () => {
    const harness = createCanvasHarness();

    render(harness);

    expect(harness.stroke).toHaveBeenCalledTimes(42);
    expect(
      harness.fillRectCalls.some(
        ({ fillStyle }) => fillStyle === NORMAL_PALETTE.snakeBody,
      ),
    ).toBe(true);
    expect(
      harness.fillRectCalls.some(
        ({ fillStyle }) => fillStyle === NORMAL_PALETTE.snakeHead,
      ),
    ).toBe(true);
    expect(NORMAL_PALETTE.snakeHead).not.toBe(NORMAL_PALETTE.snakeBody);
    expect(harness.arcCalls.length).toBeGreaterThanOrEqual(2);
    expect(harness.fillCalls).toContain(NORMAL_PALETTE.snakeDetail);
    expect(harness.fillCalls).toContain(NORMAL_PALETTE.food);
  });

  it('uses a high-contrast palette with independently distinct game elements', () => {
    const harness = createCanvasHarness();

    render(harness, { colorMode: 'high-contrast' });

    const usedColors = harness.fillRectCalls.map(({ fillStyle }) => fillStyle);
    expect(usedColors).toContain(HIGH_CONTRAST_PALETTE.background);
    expect(usedColors).toContain(HIGH_CONTRAST_PALETTE.snakeBody);
    expect(usedColors).toContain(HIGH_CONTRAST_PALETTE.snakeHead);
    expect(harness.fillCalls).toContain(HIGH_CONTRAST_PALETTE.food);
    expect(
      new Set([
        HIGH_CONTRAST_PALETTE.background,
        HIGH_CONTRAST_PALETTE.snakeBody,
        HIGH_CONTRAST_PALETTE.snakeHead,
        HIGH_CONTRAST_PALETTE.food,
      ]).size,
    ).toBe(4);
    expect(HIGH_CONTRAST_PALETTE.foodShape).toBe('diamond');
    expect(harness.context.shadowBlur).toBe(0);
  });

  it('never mutates game state or its positions', () => {
    const harness = createCanvasHarness();
    const state = createInitialState();
    const snapshot = structuredClone(state);

    render(harness, {}, state);

    expect(state).toEqual(snapshot);
    expect(state.snake[0]).toBeDefined();
    expect(state.food).toBeDefined();
  });

  it('uses a bounded timestamp-driven food pulse and disables it for reduced motion', () => {
    expect(foodPulseScale(0, false)).toBe(foodPulseScale(0, false));
    expect(foodPulseScale(400, false)).not.toBe(foodPulseScale(0, false));

    for (const timestamp of [0, 100, 400, 800, 1_600, 10_000]) {
      expect(foodPulseScale(timestamp, false)).toBeGreaterThanOrEqual(0.96);
      expect(foodPulseScale(timestamp, false)).toBeLessThanOrEqual(1.04);
      expect(foodPulseScale(timestamp, true)).toBe(1);
    }

    const harness = createCanvasHarness();
    render(harness, { reducedMotion: true, timestampMs: 400 });
    expect(harness.context.shadowBlur).toBe(0);
  });

  it('returns an explicit no-op for zero-size canvases', () => {
    const harness = createCanvasHarness(0, 0);

    expect(render(harness)).toEqual({ status: 'skipped-zero-size' });
    expect(harness.canvas.width).toBe(0);
    expect(harness.canvas.height).toBe(0);
    expect(harness.canvas.getContext).not.toHaveBeenCalled();
  });

  it('fails clearly when a visible canvas has no 2D context', () => {
    const harness = createCanvasHarness(400, 400, false);

    expect(() => render(harness)).toThrowError(
      'SNAKISH renderer could not acquire a 2D canvas context.',
    );
  });
});
