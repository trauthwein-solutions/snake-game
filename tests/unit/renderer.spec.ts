import { describe, expect, it, vi } from 'vitest';

import { createInitialState } from '../../src/engine/game-engine';
import type { GameState } from '../../src/engine/model';
import {
  renderGameFrame,
  type RendererOptions,
} from '../../src/rendering/canvas-renderer';
import {
  FOOD_FEEDBACK_DURATION_MS,
  TERMINAL_FEEDBACK_DURATION_MS,
  foodFeedbackFrame,
  foodPulseScale,
  terminalFeedbackFrame,
  type ArcadeFeedback,
} from '../../src/rendering/effects';
import {
  HIGH_CONTRAST_PALETTE,
  NORMAL_PALETTE,
} from '../../src/rendering/palette';

interface DrawCall {
  readonly fillStyle: string;
  readonly args: readonly number[];
}

interface PathPoint {
  readonly operation: 'moveTo' | 'lineTo';
  readonly x: number;
  readonly y: number;
}

interface StrokeCall {
  readonly globalAlpha: number;
  readonly lineWidth: number;
  readonly path: readonly PathPoint[];
  readonly shadowBlur: number;
  readonly strokeStyle: string;
}

function createCanvasHarness(
  cssWidth = 400,
  cssHeight = cssWidth,
  hasContext = true,
) {
  const fillRectCalls: DrawCall[] = [];
  const fillCalls: string[] = [];
  const arcCalls: number[][] = [];
  const strokeCalls: StrokeCall[] = [];
  const paintOrder: string[] = [];
  let currentPath: PathPoint[] = [];
  const setTransform = vi.fn();
  const clearRect = vi.fn();
  const stroke = vi.fn(function (this: {
    globalAlpha: number;
    lineWidth: number;
    shadowBlur: number;
    strokeStyle: string;
  }) {
    strokeCalls.push({
      globalAlpha: this.globalAlpha,
      lineWidth: this.lineWidth,
      path: [...currentPath],
      shadowBlur: this.shadowBlur,
      strokeStyle: this.strokeStyle,
    });
    paintOrder.push(`stroke:${this.strokeStyle}`);
  });
  const fill = vi.fn(function (this: { fillStyle: string }) {
    fillCalls.push(this.fillStyle);
    paintOrder.push(`fill:${this.fillStyle}`);
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
      paintOrder.push(`fillRect:${this.fillStyle}`);
    }),
    strokeRect: vi.fn(),
    beginPath: vi.fn(() => {
      currentPath = [];
    }),
    moveTo: vi.fn((x: number, y: number) => {
      currentPath.push({ operation: 'moveTo', x, y });
    }),
    lineTo: vi.fn((x: number, y: number) => {
      currentPath.push({ operation: 'lineTo', x, y });
    }),
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
    strokeCalls,
    paintOrder,
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

const foodFeedback = (
  timestampMs = 1_000,
  position = { x: 3, y: 4 },
): ArcadeFeedback => ({
  food: {
    type: 'food',
    timestampMs,
    position,
  },
  terminal: null,
});

const terminalFeedback = (
  status: 'gameOver' | 'completed',
  timestampMs = 1_000,
): ArcadeFeedback => ({
  food: null,
  terminal: { type: 'terminal', timestampMs, status },
});

describe('arcade feedback calculations', () => {
  it.each([
    ['start', 1_000, true, 0],
    ['mid-window', 1_180, true, 0.5],
    ['exact expiry', 1_000 + FOOD_FEEDBACK_DURATION_MS, false, 0],
    ['after expiry', 2_000, false, 0],
    ['future event', 999, false, 0],
  ] as const)(
    'calculates food feedback at %s',
    (_label, now, active, progress) => {
      expect(foodFeedbackFrame(foodFeedback().food, now, false)).toMatchObject({
        active,
        progress,
      });
    },
  );

  it.each([
    ['start', 1_000, true, 0],
    ['mid-window', 1_250, true, 0.5],
    ['exact expiry', 1_000 + TERMINAL_FEEDBACK_DURATION_MS, false, 0],
    ['after expiry', 2_000, false, 0],
    ['future event', 999, false, 0],
  ] as const)(
    'calculates terminal feedback at %s',
    (_label, now, active, progress) => {
      expect(
        terminalFeedbackFrame(
          terminalFeedback('gameOver').terminal,
          now,
          false,
        ),
      ).toMatchObject({ active, progress });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'returns neutral finite feedback for invalid time %s',
    (invalidTime) => {
      const invalidFood = {
        ...foodFeedback().food!,
        timestampMs: invalidTime,
      };
      const invalidTerminal = {
        ...terminalFeedback('completed').terminal!,
        timestampMs: invalidTime,
      };
      const frames = [
        foodFeedbackFrame(invalidFood, 1_100, false),
        foodFeedbackFrame(foodFeedback().food, invalidTime, false),
        terminalFeedbackFrame(invalidTerminal, 1_100, false),
        terminalFeedbackFrame(
          terminalFeedback('completed').terminal,
          invalidTime,
          false,
        ),
      ];

      for (const frame of frames) {
        expect(frame).toEqual({
          active: false,
          progress: 0,
          alpha: 0,
          scale: 1,
        });
        expect(
          [frame.progress, frame.alpha, frame.scale].every((value) =>
            Number.isFinite(value),
          ),
        ).toBe(true);
      }
    },
  );

  it('suppresses both feedback types to neutral frames for reduced motion', () => {
    expect(foodFeedbackFrame(foodFeedback().food, 1_180, true)).toEqual({
      active: false,
      progress: 0,
      alpha: 0,
      scale: 1,
    });
    expect(
      terminalFeedbackFrame(
        terminalFeedback('completed').terminal,
        1_250,
        true,
      ),
    ).toEqual({ active: false, progress: 0, alpha: 0, scale: 1 });
  });

  it('keeps every active numeric output finite and bounded', () => {
    for (let timestamp = 1_000; timestamp < 1_500; timestamp += 17) {
      for (const frame of [
        foodFeedbackFrame(foodFeedback().food, timestamp, false),
        terminalFeedbackFrame(
          terminalFeedback('completed').terminal,
          timestamp,
          false,
        ),
      ]) {
        expect(frame.progress).toBeGreaterThanOrEqual(0);
        expect(frame.progress).toBeLessThanOrEqual(1);
        expect(frame.alpha).toBeGreaterThanOrEqual(0);
        expect(frame.alpha).toBeLessThanOrEqual(1);
        expect(frame.scale).toBeGreaterThanOrEqual(1);
        expect(frame.scale).toBeLessThanOrEqual(2);
        expect(
          [frame.progress, frame.alpha, frame.scale].every((value) =>
            Number.isFinite(value),
          ),
        ).toBe(true);
      }
    }
  });
});

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

  it('renders identically when feedback is omitted or explicitly empty', () => {
    const omittedHarness = createCanvasHarness();
    const emptyHarness = createCanvasHarness();

    render(omittedHarness, { timestampMs: 220 });
    render(emptyHarness, {
      timestampMs: 220,
      feedback: { food: null, terminal: null },
    });

    expect(emptyHarness.fillRectCalls).toEqual(omittedHarness.fillRectCalls);
    expect(emptyHarness.context.arc.mock.calls).toEqual(
      omittedHarness.context.arc.mock.calls,
    );
    expect(emptyHarness.context.moveTo.mock.calls).toEqual(
      omittedHarness.context.moveTo.mock.calls,
    );
    expect(emptyHarness.context.lineTo.mock.calls).toEqual(
      omittedHarness.context.lineTo.mock.calls,
    );
    expect(emptyHarness.context.strokeRect.mock.calls).toEqual(
      omittedHarness.context.strokeRect.mock.calls,
    );
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

  it.each([
    ['center', { x: 10, y: 10 }],
    ['top edge', { x: 10, y: 0 }],
    ['right edge', { x: 19, y: 10 }],
    ['bottom edge', { x: 10, y: 19 }],
    ['left edge', { x: 0, y: 10 }],
    ['top-left corner', { x: 0, y: 0 }],
    ['top-right corner', { x: 19, y: 0 }],
    ['bottom-right corner', { x: 19, y: 19 }],
    ['bottom-left corner', { x: 0, y: 19 }],
  ] as const)(
    'keeps four distinct visible spark segments in bounds at the %s',
    (_label, position) => {
      const harness = createCanvasHarness();
      const state = {
        ...createInitialState(),
        snake: [position],
        food: { x: 5, y: 5 },
      };

      render(
        harness,
        { feedback: foodFeedback(1_000, position), timestampMs: 1_180 },
        state,
      );

      expect(harness.arcCalls).toContainEqual([
        (position.x + 0.5) * 20,
        (position.y + 0.5) * 20,
        expect.any(Number),
        0,
        Math.PI * 2,
      ]);
      const sparks = harness.strokeCalls.filter(
        ({ strokeStyle }) => strokeStyle === NORMAL_PALETTE.feedbackOutline,
      );
      expect(sparks).toHaveLength(4);

      const headLeft = position.x * 20 + 20 * 0.08;
      const headTop = position.y * 20 + 20 * 0.08;
      const headRight = (position.x + 1) * 20 - 20 * 0.08;
      const headBottom = (position.y + 1) * 20 - 20 * 0.08;
      const segmentKeys = new Set<string>();
      for (const spark of sparks) {
        expect(spark.path).toHaveLength(2);
        const [start, end] = spark.path;
        expect(start?.operation).toBe('moveTo');
        expect(end?.operation).toBe('lineTo');
        expect(start).toBeDefined();
        expect(end).toBeDefined();
        if (start === undefined || end === undefined) continue;

        for (const point of [start, end]) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
          expect(point.x).toBeGreaterThanOrEqual(spark.lineWidth / 2);
          expect(point.x).toBeLessThanOrEqual(400 - spark.lineWidth / 2);
          expect(point.y).toBeGreaterThanOrEqual(spark.lineWidth / 2);
          expect(point.y).toBeLessThanOrEqual(400 - spark.lineWidth / 2);
        }
        expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(0);
        expect(
          start.x < headLeft ||
            start.x > headRight ||
            start.y < headTop ||
            start.y > headBottom,
        ).toBe(true);
        segmentKeys.add(`${start.x},${start.y}:${end.x},${end.y}`);
      }
      expect(segmentKeys.size).toBe(4);

      const ringPaint = harness.paintOrder.indexOf(
        `stroke:${NORMAL_PALETTE.foodFeedback}`,
      );
      const headPaint = harness.paintOrder.indexOf(
        `fillRect:${NORMAL_PALETTE.snakeHead}`,
      );
      const detailPaint = harness.paintOrder.lastIndexOf(
        `fill:${NORMAL_PALETTE.snakeDetail}`,
      );
      const firstSparkPaint = harness.paintOrder.indexOf(
        `stroke:${NORMAL_PALETTE.feedbackOutline}`,
      );
      expect(ringPaint).toBeLessThan(headPaint);
      expect(firstSparkPaint).toBeGreaterThan(detailPaint);
    },
  );

  it('uses visibly distinct cross and double-frame terminal geometry', () => {
    const gameOverHarness = createCanvasHarness();
    const completedHarness = createCanvasHarness();

    render(gameOverHarness, {
      feedback: terminalFeedback('gameOver'),
      timestampMs: 1_250,
    });
    render(completedHarness, {
      feedback: terminalFeedback('completed'),
      timestampMs: 1_250,
    });

    expect(gameOverHarness.context.lineTo.mock.calls.length).toBeGreaterThan(
      completedHarness.context.lineTo.mock.calls.length,
    );
    expect(gameOverHarness.context.strokeRect).not.toHaveBeenCalled();
    expect(completedHarness.context.strokeRect).toHaveBeenCalledTimes(2);
  });

  it('draws no feedback pixels for reduced motion and uses no glow in high contrast', () => {
    const reducedHarness = createCanvasHarness();
    const baselineHarness = createCanvasHarness();
    const highContrastHarness = createCanvasHarness();

    render(reducedHarness, {
      feedback: foodFeedback(),
      reducedMotion: true,
      timestampMs: 1_180,
    });
    render(baselineHarness, { reducedMotion: true, timestampMs: 1_180 });
    expect(reducedHarness.context.arc.mock.calls).toEqual(
      baselineHarness.context.arc.mock.calls,
    );
    expect(reducedHarness.context.moveTo.mock.calls).toEqual(
      baselineHarness.context.moveTo.mock.calls,
    );
    expect(reducedHarness.context.lineTo.mock.calls).toEqual(
      baselineHarness.context.lineTo.mock.calls,
    );

    render(highContrastHarness, {
      colorMode: 'high-contrast',
      feedback: {
        food: foodFeedback().food,
        terminal: terminalFeedback('completed').terminal,
      },
      timestampMs: 1_180,
    });
    expect(
      highContrastHarness.strokeCalls.every(
        ({ shadowBlur }) => shadowBlur === 0,
      ),
    ).toBe(true);
    expect(highContrastHarness.context.strokeRect).toHaveBeenCalledTimes(2);
    expect(highContrastHarness.context.arc).toHaveBeenCalledWith(
      70,
      90,
      expect.any(Number),
      0,
      Math.PI * 2,
    );

    const highContrastGameOverHarness = createCanvasHarness();
    render(highContrastGameOverHarness, {
      colorMode: 'high-contrast',
      feedback: terminalFeedback('gameOver'),
      timestampMs: 1_180,
    });
    expect(
      highContrastGameOverHarness.strokeCalls.every(
        ({ shadowBlur }) => shadowBlur === 0,
      ),
    ).toBe(true);
    expect(
      highContrastGameOverHarness.context.lineTo.mock.calls.length,
    ).toBeGreaterThan(baselineHarness.context.lineTo.mock.calls.length);
  });

  it('balances feedback context state and leaves neutral alpha and shadow', () => {
    const harness = createCanvasHarness();

    render(harness, {
      feedback: {
        food: foodFeedback().food,
        terminal: terminalFeedback('gameOver').terminal,
      },
      timestampMs: 1_180,
    });

    expect(harness.context.save).toHaveBeenCalledTimes(
      harness.context.restore.mock.calls.length,
    );
    expect(harness.context.globalAlpha).toBe(1);
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
