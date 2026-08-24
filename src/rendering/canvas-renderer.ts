import { GRID_HEIGHT, GRID_WIDTH } from '../engine/constants';
import type { Direction, GameState, GridPosition } from '../engine/model';
import { foodPulseScale } from './effects';
import { paletteForMode, type RendererPalette } from './palette';

export interface RendererOptions {
  readonly colorMode?: 'normal' | 'high-contrast';
  readonly reducedMotion?: boolean;
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
      foodPulseScale(options.timestampMs ?? 0, reducedMotion),
      allowGlow,
    );
  }

  context.shadowBlur = 0;
  return { status: 'drawn', cssWidth, cssHeight, devicePixelRatio };
};
