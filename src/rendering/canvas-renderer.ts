import { GRID_HEIGHT, GRID_WIDTH } from '../engine/constants';
import type { Direction, GameState, GridPosition } from '../engine/model';
import {
  foodFeedbackFrame,
  foodPulseScale,
  terminalFeedbackFrame,
  type ArcadeFeedback,
  type FeedbackFrame,
  type FoodFeedbackEvent,
  type TerminalFeedbackEvent,
} from './effects';
import { paletteForMode, type RendererPalette } from './palette';

export interface RendererOptions {
  readonly colorMode?: 'normal' | 'high-contrast';
  readonly reducedMotion?: boolean;
  /** Presentation-only events painted against the frame timestamp. */
  readonly feedback?: ArcadeFeedback;
  /** Injected animation time keeps a rendered frame reproducible in tests. */
  readonly timestampMs?: number;
  /** Defaults to the canvas document's DPR; injectable for deterministic tests. */
  readonly devicePixelRatio?: number;
}

export type RenderResult =
  | {
      readonly status: 'drawn';
      readonly cssWidth: number;
      readonly cssHeight: number;
      readonly devicePixelRatio: number;
    }
  | { readonly status: 'skipped-zero-size' };

const safeDevicePixelRatio = (
  canvas: HTMLCanvasElement,
  requestedRatio: number | undefined,
): number => {
  const defaultView = canvas.ownerDocument?.defaultView;
  const ratio = requestedRatio ?? defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
};

const cssPixelLength = (value: string | undefined): number => {
  const length = Number.parseFloat(value ?? '');
  return Number.isFinite(length) ? length : 0;
};

const canvasContentBoxSize = (
  canvas: HTMLCanvasElement,
): { readonly width: number; readonly height: number } => {
  const bounds = canvas.getBoundingClientRect();
  const defaultView = canvas.ownerDocument?.defaultView;

  if (defaultView?.getComputedStyle !== undefined) {
    const styles = defaultView.getComputedStyle(canvas);
    const horizontalInsets =
      cssPixelLength(styles.borderLeftWidth) +
      cssPixelLength(styles.borderRightWidth) +
      cssPixelLength(styles.paddingLeft) +
      cssPixelLength(styles.paddingRight);
    const verticalInsets =
      cssPixelLength(styles.borderTopWidth) +
      cssPixelLength(styles.borderBottomWidth) +
      cssPixelLength(styles.paddingTop) +
      cssPixelLength(styles.paddingBottom);

    return {
      width: Math.max(0, bounds.width - horizontalInsets),
      height: Math.max(0, bounds.height - verticalInsets),
    };
  }

  const clientWidth = Number(canvas.clientWidth);
  const clientHeight = Number(canvas.clientHeight);
  return {
    width:
      Number.isFinite(clientWidth) && clientWidth > 0
        ? clientWidth
        : bounds.width,
    height:
      Number.isFinite(clientHeight) && clientHeight > 0
        ? clientHeight
        : bounds.height,
  };
};

const drawGrid = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: RendererPalette,
): void => {
  const cellWidth = width / GRID_WIDTH;
  const cellHeight = height / GRID_HEIGHT;

  context.lineWidth = 1;
  for (let column = 0; column <= GRID_WIDTH; column += 1) {
    context.beginPath();
    context.strokeStyle = column % 5 === 0 ? palette.gridStrong : palette.grid;
    const x = column * cellWidth;
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let row = 0; row <= GRID_HEIGHT; row += 1) {
    context.beginPath();
    context.strokeStyle = row % 5 === 0 ? palette.gridStrong : palette.grid;
    const y = row * cellHeight;
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
};

const drawSegment = (
  context: CanvasRenderingContext2D,
  position: GridPosition,
  cellWidth: number,
  cellHeight: number,
  fillStyle: string,
  insetRatio: number,
): void => {
  const insetX = cellWidth * insetRatio;
  const insetY = cellHeight * insetRatio;
  context.fillStyle = fillStyle;
  context.fillRect(
    position.x * cellWidth + insetX,
    position.y * cellHeight + insetY,
    cellWidth - insetX * 2,
    cellHeight - insetY * 2,
  );
};

const eyeCenters = (
  direction: Direction,
  centerX: number,
  centerY: number,
  cellWidth: number,
  cellHeight: number,
): readonly (readonly [number, number])[] => {
  const horizontalOffset = cellWidth * 0.18;
  const verticalOffset = cellHeight * 0.18;
  const forwardX = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
  const forwardY = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;

  if (forwardX !== 0) {
    return [
      [centerX + forwardX * horizontalOffset, centerY - verticalOffset],
      [centerX + forwardX * horizontalOffset, centerY + verticalOffset],
    ];
  }

  return [
    [centerX - horizontalOffset, centerY + forwardY * verticalOffset],
    [centerX + horizontalOffset, centerY + forwardY * verticalOffset],
  ];
};

const drawHeadDetails = (
  context: CanvasRenderingContext2D,
  head: GridPosition,
  direction: Direction,
  cellWidth: number,
  cellHeight: number,
  palette: RendererPalette,
): void => {
  const centerX = (head.x + 0.5) * cellWidth;
  const centerY = (head.y + 0.5) * cellHeight;
  const eyeRadius = Math.max(1, Math.min(cellWidth, cellHeight) * 0.065);

  context.fillStyle = palette.snakeDetail;
  for (const [x, y] of eyeCenters(
    direction,
    centerX,
    centerY,
    cellWidth,
    cellHeight,
  )) {
    context.beginPath();
    context.arc(x, y, eyeRadius, 0, Math.PI * 2);
    context.fill();
  }
};

const drawFood = (
  context: CanvasRenderingContext2D,
  food: GridPosition,
  cellWidth: number,
  cellHeight: number,
  palette: RendererPalette,
  scale: number,
  allowGlow: boolean,
): void => {
  const centerX = (food.x + 0.5) * cellWidth;
  const centerY = (food.y + 0.5) * cellHeight;
  const radius = Math.min(cellWidth, cellHeight) * 0.32 * scale;

  context.save();
  context.shadowColor = palette.food;
  context.shadowBlur = allowGlow ? Math.min(cellWidth, cellHeight) * 0.25 : 0;
  context.fillStyle = palette.food;
  context.beginPath();
  context.moveTo(centerX, centerY - radius);
  context.lineTo(centerX + radius, centerY);
  context.lineTo(centerX, centerY + radius);
  context.lineTo(centerX - radius, centerY);
  context.closePath();
  context.fill();

  context.shadowBlur = 0;
  context.fillStyle = palette.foodDetail;
  context.fillRect(
    centerX - radius * 0.16,
    centerY - radius * 0.16,
    radius * 0.32,
    radius * 0.32,
  );
  context.restore();
};

const drawFoodFeedbackRing = (
  context: CanvasRenderingContext2D,
  event: FoodFeedbackEvent,
  frame: FeedbackFrame,
  cellWidth: number,
  cellHeight: number,
  palette: RendererPalette,
  allowGlow: boolean,
): void => {
  if (!frame.active) {
    return;
  }

  const centerX = (event.position.x + 0.5) * cellWidth;
  const centerY = (event.position.y + 0.5) * cellHeight;
  const unit = Math.min(cellWidth, cellHeight);
  const ringRadius = unit * 0.42 * frame.scale;

  context.save();
  context.globalAlpha = frame.alpha;
  context.strokeStyle = palette.foodFeedback;
  context.lineWidth = Math.max(1.5, unit * 0.09);
  context.shadowColor = palette.foodFeedback;
  context.shadowBlur = allowGlow ? unit * 0.2 : 0;
  context.beginPath();
  context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
};

interface SparkSegment {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

const edgeSafeSparkSegment = (
  centerX: number,
  centerY: number,
  directionX: number,
  directionY: number,
  innerDistance: number,
  outerDistance: number,
  lineWidth: number,
  width: number,
  height: number,
): SparkSegment => {
  const startX = centerX + directionX * innerDistance;
  const startY = centerY + directionY * innerDistance;
  const endX = centerX + directionX * outerDistance;
  const endY = centerY + directionY * outerDistance;
  const inset = lineWidth / 2;
  const isInBounds = (x: number, y: number): boolean =>
    x >= inset && x <= width - inset && y >= inset && y <= height - inset;

  if (isInBounds(startX, startY) && isInBounds(endX, endY)) {
    return { startX, startY, endX, endY };
  }

  const length = outerDistance - innerDistance;
  if (directionY !== 0) {
    const tangentOffset = centerX <= width / 2 ? outerDistance : -outerDistance;
    const tangentCenterX = Math.min(
      width - inset - length / 2,
      Math.max(inset + length / 2, centerX + tangentOffset),
    );
    const boundaryY = directionY < 0 ? inset : height - inset;
    return {
      startX: tangentCenterX - length / 2,
      startY: boundaryY,
      endX: tangentCenterX + length / 2,
      endY: boundaryY,
    };
  }

  const tangentOffset = centerY <= height / 2 ? outerDistance : -outerDistance;
  const tangentCenterY = Math.min(
    height - inset - length / 2,
    Math.max(inset + length / 2, centerY + tangentOffset),
  );
  const boundaryX = directionX < 0 ? inset : width - inset;
  return {
    startX: boundaryX,
    startY: tangentCenterY - length / 2,
    endX: boundaryX,
    endY: tangentCenterY + length / 2,
  };
};

const drawFoodFeedbackSparks = (
  context: CanvasRenderingContext2D,
  event: FoodFeedbackEvent,
  frame: FeedbackFrame,
  cellWidth: number,
  cellHeight: number,
  width: number,
  height: number,
  palette: RendererPalette,
): void => {
  if (!frame.active) {
    return;
  }

  const centerX = (event.position.x + 0.5) * cellWidth;
  const centerY = (event.position.y + 0.5) * cellHeight;
  const unit = Math.min(cellWidth, cellHeight);
  const sparkInner = unit * (0.5 + frame.progress * 0.18);
  const sparkOuter = sparkInner + unit * 0.2;
  const sparkDirections = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const;
  const lineWidth = Math.max(1, unit * 0.07);

  context.save();
  context.globalAlpha = frame.alpha;
  context.shadowBlur = 0;
  context.strokeStyle = palette.feedbackOutline;
  context.lineWidth = lineWidth;
  for (const [directionX, directionY] of sparkDirections) {
    const segment = edgeSafeSparkSegment(
      centerX,
      centerY,
      directionX,
      directionY,
      sparkInner,
      sparkOuter,
      lineWidth,
      width,
      height,
    );
    context.beginPath();
    context.moveTo(segment.startX, segment.startY);
    context.lineTo(segment.endX, segment.endY);
    context.stroke();
  }
  context.restore();
};

const drawGameOverFeedback = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  inset: number,
  cornerLength: number,
): void => {
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;

  context.beginPath();
  context.moveTo(left, top + cornerLength);
  context.lineTo(left, top);
  context.lineTo(left + cornerLength, top);
  context.moveTo(right - cornerLength, top);
  context.lineTo(right, top);
  context.lineTo(right, top + cornerLength);
  context.moveTo(right, bottom - cornerLength);
  context.lineTo(right, bottom);
  context.lineTo(right - cornerLength, bottom);
  context.moveTo(left + cornerLength, bottom);
  context.lineTo(left, bottom);
  context.lineTo(left, bottom - cornerLength);

  const impactSize = cornerLength * 0.7;
  context.moveTo(left, top);
  context.lineTo(left + impactSize, top + impactSize);
  context.moveTo(right, top);
  context.lineTo(right - impactSize, top + impactSize);
  context.moveTo(right, bottom);
  context.lineTo(right - impactSize, bottom - impactSize);
  context.moveTo(left, bottom);
  context.lineTo(left + impactSize, bottom - impactSize);
  context.stroke();
};

const drawTerminalFeedback = (
  context: CanvasRenderingContext2D,
  event: TerminalFeedbackEvent,
  frame: FeedbackFrame,
  width: number,
  height: number,
  palette: RendererPalette,
  allowGlow: boolean,
): void => {
  if (!frame.active) {
    return;
  }

  const shortestSide = Math.min(width, height);
  const inset = shortestSide * (0.055 + frame.progress * 0.025);
  const secondaryInset = inset + shortestSide * 0.035;

  context.save();
  context.globalAlpha = frame.alpha;
  context.strokeStyle =
    event.status === 'gameOver'
      ? palette.gameOverFeedback
      : palette.completedFeedback;
  context.lineWidth = Math.max(2, shortestSide * 0.012);
  context.shadowColor = context.strokeStyle;
  context.shadowBlur = allowGlow ? shortestSide * 0.018 : 0;

  if (event.status === 'gameOver') {
    drawGameOverFeedback(context, width, height, inset, shortestSide * 0.16);
  } else {
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    context.shadowBlur = 0;
    context.lineWidth = Math.max(1.5, shortestSide * 0.006);
    context.strokeStyle = palette.feedbackOutline;
    context.strokeRect(
      secondaryInset,
      secondaryInset,
      width - secondaryInset * 2,
      height - secondaryInset * 2,
    );
  }
  context.restore();
};

/**
 * Paints one complete frame without changing GameState. A zero-size canvas is
 * an explicit no-op; a visible canvas without a 2D context throws clearly.
 */
export const renderGameFrame = (
  canvas: HTMLCanvasElement,
  state: GameState,
  options: RendererOptions = {},
): RenderResult => {
  const { width: cssWidth, height: cssHeight } = canvasContentBoxSize(canvas);

  if (cssWidth <= 0 || cssHeight <= 0) {
    canvas.width = 0;
    canvas.height = 0;
    return { status: 'skipped-zero-size' };
  }

  const devicePixelRatio = safeDevicePixelRatio(
    canvas,
    options.devicePixelRatio,
  );
  const backingWidth = Math.max(1, Math.round(cssWidth * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(cssHeight * devicePixelRatio));
  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('SNAKISH renderer could not acquire a 2D canvas context.');
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, backingWidth, backingHeight);
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  const palette = paletteForMode(options.colorMode ?? 'normal');
  context.fillStyle = palette.background;
  context.fillRect(0, 0, cssWidth, cssHeight);
  drawGrid(context, cssWidth, cssHeight, palette);

  const cellWidth = cssWidth / GRID_WIDTH;
  const cellHeight = cssHeight / GRID_HEIGHT;
  const reducedMotion = options.reducedMotion ?? false;
  const allowGlow = !reducedMotion && options.colorMode !== 'high-contrast';

  const timestampMs = options.timestampMs ?? 0;
  const foodFrame = foodFeedbackFrame(
    options.feedback?.food,
    timestampMs,
    reducedMotion,
  );
  const terminalFrame = terminalFeedbackFrame(
    options.feedback?.terminal,
    timestampMs,
    reducedMotion,
  );
  if (
    options.feedback?.terminal !== null &&
    options.feedback?.terminal !== undefined
  ) {
    drawTerminalFeedback(
      context,
      options.feedback.terminal,
      terminalFrame,
      cssWidth,
      cssHeight,
      palette,
      allowGlow,
    );
  }
  if (options.feedback?.food !== null && options.feedback?.food !== undefined) {
    drawFoodFeedbackRing(
      context,
      options.feedback.food,
      foodFrame,
      cellWidth,
      cellHeight,
      palette,
      allowGlow,
    );
  }

  context.save();
  context.shadowColor = palette.glow;
  context.shadowBlur = allowGlow ? Math.min(cellWidth, cellHeight) * 0.28 : 0;
  for (let index = state.snake.length - 1; index >= 1; index -= 1) {
    const segment = state.snake[index];
    if (segment !== undefined) {
      drawSegment(
        context,
        segment,
        cellWidth,
        cellHeight,
        palette.snakeBody,
        0.13,
      );
    }
  }

  const head = state.snake[0];
  if (head !== undefined) {
    drawSegment(context, head, cellWidth, cellHeight, palette.snakeHead, 0.08);
    context.shadowBlur = 0;
    drawHeadDetails(
      context,
      head,
      state.lastAcceptedDirection,
      cellWidth,
      cellHeight,
      palette,
    );
  }
  context.restore();

  if (state.food !== null) {
    drawFood(
      context,
      state.food,
      cellWidth,
      cellHeight,
      palette,
      foodPulseScale(timestampMs, reducedMotion),
      allowGlow,
    );
  }

  if (options.feedback?.food !== null && options.feedback?.food !== undefined) {
    drawFoodFeedbackSparks(
      context,
      options.feedback.food,
      foodFrame,
      cellWidth,
      cellHeight,
      cssWidth,
      cssHeight,
      palette,
    );
  }

  context.shadowBlur = 0;
  context.globalAlpha = 1;
  return { status: 'drawn', cssWidth, cssHeight, devicePixelRatio };
};
