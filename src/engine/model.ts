export type GameStatus =
  'ready' | 'running' | 'paused' | 'gameOver' | 'completed';

export type Direction = 'up' | 'right' | 'down' | 'left';

export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface GameState {
  readonly status: GameStatus;
  /** Head first, followed by each body segment in movement order. */
  readonly snake: readonly GridPosition[];
  /** Null only when the snake has completed the board. */
  readonly food: GridPosition | null;
  readonly score: number;
  readonly speedTier: number;
  /** Direction used by the most recent completed simulation tick. */
  readonly lastAcceptedDirection: Direction;
  /** The single legal turn waiting for the next simulation tick. */
  readonly pendingDirection: Direction | null;
}

export type GameCommand =
  | { readonly type: 'start' }
  | { readonly type: 'turn'; readonly direction: Direction }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | {
      readonly type: 'tick';
      /**
       * Deterministic replacement used only if this tick consumes food.
       * Null means that no free grid cell remains.
       */
      readonly nextFood: GridPosition | null;
    }
  | { readonly type: 'restart' };
