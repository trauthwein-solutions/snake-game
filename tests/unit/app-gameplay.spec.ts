import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Direction, GameState } from '../../src/engine/model';

type Listener = (event?: Event) => void;

class FakeElement {
  className = '';
  dataset: Record<string, string> = {};
  id = '';
  innerHTML = '';
  textContent = '';
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  focus = vi.fn();
  open = false;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {}

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  click(): void {
    for (const listener of [...(this.listeners.get('click') ?? [])]) {
      listener();
    }
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) {
      listener(event);
    }
    return !event.defaultPrevented;
  }

  close(): void {
    this.open = false;
  }

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  querySelector(selector: string): FakeElement | null {
    if (this.tagName === 'main') {
      return this.ownerDocument.shellElements.get(selector) ?? null;
    }

    if (this.tagName === 'dialog' && this.id === 'settings-dialog') {
      if (selector === '.icon-button') return this.ownerDocument.closeButton;
      if (selector === 'input') return this.ownerDocument.firstControl;
    }

    if (this.tagName === 'dialog' && this.id === 'game-over-dialog') {
      if (selector === '#game-over-title')
        return this.ownerDocument.resultTitle;
      if (selector === '[data-score="final"]')
        return this.ownerDocument.finalScore;
      if (selector === '[data-action="play-again"]') {
        return this.ownerDocument.dialogPlayAgainButton;
      }
      if (selector === '[data-action="return-to-title"]') {
        return this.ownerDocument.dialogReturnToTitleButton;
      }
    }

    if (this.tagName === 'section' && selector === '[data-score="current"]') {
      return this.ownerDocument.scoreValue;
    }

    return null;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  replaceWith(): void {}

  setAttribute(): void {}

  showModal(): void {
    this.open = true;
  }
}

class FakeMediaQueryList {
  matches = false;
  readonly listeners = new Set<Listener>();

  addEventListener(type: string, listener: Listener): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'change') this.listeners.delete(listener);
  }
}

class FakeView {
  devicePixelRatio = 1;
  readonly ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  readonly performance = { now: vi.fn(() => 0) };
  readonly setTimeout = vi.fn(() => 1);
  readonly clearTimeout = vi.fn();
  readonly requestAnimationFrame = vi.fn(() => 1);
  readonly cancelAnimationFrame = vi.fn();
  readonly matchMedia = vi.fn(() => new FakeMediaQueryList());
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeDocument {
  readonly defaultView = new FakeView();
  readonly shell = new FakeElement('main', this);
  readonly hudMount = new FakeElement('div', this);
  readonly settingsButton = new FakeElement('button', this);
  readonly playButton = new FakeElement('button', this);
  readonly restartButton = new FakeElement('button', this);
  readonly canvas = new FakeElement('canvas', this);
  readonly touchControlsMount = new FakeElement('div', this);
  readonly closeButton = new FakeElement('button', this);
  readonly firstControl = new FakeElement('input', this);
  readonly resultTitle = new FakeElement('h2', this);
  readonly finalScore = new FakeElement('strong', this);
  readonly dialogPlayAgainButton = new FakeElement('button', this);
  readonly dialogReturnToTitleButton = new FakeElement('button', this);
  readonly scoreValue = new FakeElement('dd', this);
  readonly shellElements = new Map<string, FakeElement>([
    ['[data-hud]', this.hudMount],
    ['[data-action="settings"]', this.settingsButton],
    ['[data-action="play"]', this.playButton],
    ['[data-action="restart"]', this.restartButton],
    ['[data-render-target="arena"]', this.canvas],
    ['[data-touch-controls]', this.touchControlsMount],
  ]);

  createElement(tagName: string): FakeElement {
    return tagName === 'main' ? this.shell : new FakeElement(tagName, this);
  }
}

const harness = vi.hoisted(() => ({
  announce: vi.fn(),
  closeResult: vi.fn(),
  closeSettings: vi.fn(),
  createScheduler: vi.fn(),
  dialogTeardown: vi.fn(),
  inputOptions: undefined as
    | {
        onDirection: (direction: Direction) => void;
        onPauseToggle: () => void;
      }
    | undefined,
  inputTeardown: vi.fn(),
  interval: vi.fn((tier: number) => [180, 155, 130, 110][tier] ?? 180),
  onStep: undefined as (() => void) | undefined,
  presentationOptions: undefined as
    | {
        render: (timestampMs: number, reducedMotion: boolean) => void;
      }
    | undefined,
  presentationRedraw: vi.fn(),
  presentationStop: vi.fn(),
  presentationSync: vi.fn(),
  render: vi.fn(),
  schedulerDispose: vi.fn(),
  schedulerPause: vi.fn(),
  schedulerReset: vi.fn(),
  schedulerRunning: false,
  schedulerStart: vi.fn(),
  showResult: vi.fn(),
  simulation: vi.fn(),
  updateHudScore: vi.fn(),
}));

vi.mock('../../src/rendering/canvas-renderer', () => ({
  renderGameFrame: harness.render,
}));

vi.mock('../../src/rendering/presentation-loop', () => ({
  createPresentationLoop: vi.fn(
    (options: {
      render: (timestampMs: number, reducedMotion: boolean) => void;
    }) => {
      harness.presentationOptions = options;
      options.render(0, false);
      return {
        redraw: harness.presentationRedraw,
        stop: harness.presentationStop,
        syncMotionPreference: harness.presentationSync,
      };
    },
  ),
}));

vi.mock('../../src/input/input-controller', () => ({
  createInputController: vi.fn(
    (options: {
      onDirection: (direction: Direction) => void;
      onPauseToggle: () => void;
    }) => {
      harness.inputOptions = options;
      return harness.inputTeardown;
    },
  ),
}));

vi.mock('../../src/timing/fixed-step-scheduler', () => ({
  createFixedStepScheduler: harness.createScheduler,
}));

vi.mock('../../src/engine/simulation', () => ({
  advanceSimulation: harness.simulation,
  tickIntervalForSpeedTier: harness.interval,
}));

vi.mock('../../src/ui/hud', () => ({
  createHud: vi.fn(() => new FakeElement('section', new FakeDocument())),
  updateHudScore: harness.updateHudScore,
}));

const dialogElements = vi.hoisted(() => ({
  gameOverDialog: undefined as FakeElement | undefined,
  playAgainButton: undefined as FakeElement | undefined,
  returnToTitleButton: undefined as FakeElement | undefined,
  settingsDialog: undefined as FakeElement | undefined,
}));

vi.mock('../../src/ui/dialogs', () => ({
  createDialogs: vi.fn((settingsButton: FakeElement) => {
    const document = settingsButton.ownerDocument;
    dialogElements.settingsDialog = new FakeElement('dialog', document);
    dialogElements.gameOverDialog = new FakeElement('dialog', document);
    dialogElements.playAgainButton = new FakeElement('button', document);
    dialogElements.returnToTitleButton = new FakeElement('button', document);
    return {
      settingsDialog: dialogElements.settingsDialog,
      gameOverDialog: dialogElements.gameOverDialog,
      playAgainButton: dialogElements.playAgainButton,
      returnToTitleButton: dialogElements.returnToTitleButton,
      showResult: harness.showResult,
      closeResult: harness.closeResult,
      closeSettings: harness.closeSettings,
      teardown: harness.dialogTeardown,
    };
  }),
}));

vi.mock('../../src/ui/announcer', () => ({
  createAnnouncer: vi.fn(() => new FakeElement('p', new FakeDocument())),
  announce: harness.announce,
}));

import { mountApp } from '../../src/app';

function movingState(state: GameState): GameState {
  const head = state.snake[0];
  if (head === undefined) return state;
  return {
    ...state,
    snake: [{ x: head.x + 1, y: head.y }, ...state.snake.slice(0, -1)],
    pendingDirection: null,
  };
}

function mountHarness() {
  const document = new FakeDocument();
  const root = new FakeElement('div', document);
  vi.stubGlobal('document', document);
  const teardown = mountApp(root as unknown as HTMLElement);
  return { document, root, teardown };
}

beforeEach(() => {
  harness.schedulerRunning = false;
  harness.schedulerStart.mockImplementation(() => {
    harness.schedulerRunning = true;
  });
  harness.schedulerPause.mockImplementation(() => {
    harness.schedulerRunning = false;
  });
  harness.schedulerDispose.mockImplementation(() => {
    harness.schedulerRunning = false;
  });
  harness.createScheduler.mockImplementation(
    (options: { onStep: () => void }) => {
      harness.onStep = options.onStep;
      return {
        start: harness.schedulerStart,
        pause: harness.schedulerPause,
        reset: harness.schedulerReset,
        dispose: harness.schedulerDispose,
        isRunning: () => harness.schedulerRunning,
      };
    },
  );
  harness.simulation.mockImplementation(movingState);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  harness.inputOptions = undefined;
  harness.onStep = undefined;
  harness.presentationOptions = undefined;
});

describe('mountApp gameplay lifecycle', () => {
  it('renders and publishes current state, then applies turns before the next scheduled step', () => {
    const { document, root } = mountHarness();

    expect(root.dataset).toMatchObject({
      gameStatus: 'ready',
      gameScore: '0',
      gameHead: '10,10',
    });
    expect(harness.render.mock.calls[0]?.[1]).toMatchObject({
      status: 'ready',
    });

    document.playButton.click();
    expect(root.dataset.gameStatus).toBe('running');
    expect(root.dataset.gameHead).toBe('10,10');
    expect(harness.simulation).not.toHaveBeenCalled();
    expect(harness.schedulerStart).toHaveBeenCalledOnce();

    harness.inputOptions?.onDirection('up');
    expect(root.dataset.inputDirection).toBe('up');
    harness.onStep?.();
    harness.presentationOptions?.render(20, false);

    expect(harness.simulation).toHaveBeenCalledWith(
      expect.objectContaining({ pendingDirection: 'up' }),
      Math.random,
    );
    expect(root.dataset.gameHead).toBe('11,10');
    expect(harness.render.mock.calls.at(-1)?.[1]?.snake[0]).toEqual({
      x: 11,
      y: 10,
    });
  });

  it('starts once without a synchronous tick and reads the current speed tier', () => {
    const { document } = mountHarness();

    document.playButton.click();
    document.playButton.click();

    expect(harness.schedulerStart).toHaveBeenCalledOnce();
    expect(harness.simulation).not.toHaveBeenCalled();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Game started.',
    );
    expect(harness.createScheduler).toHaveBeenCalledOnce();

    const schedulerOptions = harness.createScheduler.mock.calls[0]?.[0] as {
      getIntervalMs: () => number;
    };
    expect(schedulerOptions.getIntervalMs()).toBe(180);
    expect(harness.interval).toHaveBeenLastCalledWith(0);
  });

  it('restarts from ready as a fresh running game without moving immediately', () => {
    const { document, root } = mountHarness();

    document.restartButton.click();

    expect(root.dataset).toMatchObject({
      gameStatus: 'running',
      gameScore: '0',
      gameHead: '10,10',
    });
    expect(harness.schedulerStart).toHaveBeenCalledOnce();
    expect(harness.schedulerReset).not.toHaveBeenCalled();
    expect(harness.simulation).not.toHaveBeenCalled();
  });

  it('mounts safely without timer APIs and fails clearly only when starting', () => {
    const { document, root } = mountHarness();
    Object.defineProperty(document.defaultView, 'setTimeout', {
      configurable: true,
      value: undefined,
    });

    expect(root.dataset.gameStatus).toBe('ready');
    expect(() => document.playButton.click()).toThrow(
      'SNAKISH cannot start because browser timing APIs are unavailable.',
    );
    expect(root.dataset.gameStatus).toBe('ready');
    expect(harness.schedulerStart).not.toHaveBeenCalled();
  });

  it('synchronizes score, diagnostics, redraw, and dynamic interval after eating', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      food: { x: 2, y: 3 },
      score: 50,
      speedTier: 1,
    }));

    harness.onStep?.();
    harness.presentationOptions?.render(30, false);

    expect(root.dataset.gameScore).toBe('50');
    expect(harness.updateHudScore).toHaveBeenLastCalledWith(
      expect.anything(),
      50,
    );
    expect(harness.presentationRedraw).toHaveBeenCalled();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Score 50.',
    );
    const schedulerOptions = harness.createScheduler.mock.calls[0]?.[0] as {
      getIntervalMs: () => number;
    };
    expect(schedulerOptions.getIntervalMs()).toBe(155);
    expect(harness.render.mock.calls.at(-1)?.[1]?.score).toBe(50);
    expect(harness.render.mock.calls.at(-1)?.[1]?.food).not.toEqual(
      harness.render.mock.calls.at(-1)?.[1]?.snake[0],
    );
  });

  it.each([
    ['gameOver', 'Game over. Final score 30.'],
    ['completed', 'Grid complete. Final score 30.'],
  ] as const)('stops once and opens the %s result', (status, announcement) => {
    const { document } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status,
      score: 30,
    }));

    harness.onStep?.();
    harness.onStep?.();

    expect(harness.schedulerPause).toHaveBeenCalledOnce();
    expect(harness.closeSettings).toHaveBeenCalledOnce();
    expect(harness.showResult).toHaveBeenCalledWith(status, 30);
    expect(harness.closeSettings.mock.invocationCallOrder[0]).toBeLessThan(
      harness.showResult.mock.invocationCallOrder[0] ?? 0,
    );
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      announcement,
    );
  });

  it('restarts running games, supports Play Again, and returns to a focused ready title', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    harness.onStep?.();
    expect(root.dataset.gameHead).toBe('11,10');

    document.restartButton.click();
    expect(root.dataset).toMatchObject({
      gameStatus: 'running',
      gameScore: '0',
      gameHead: '10,10',
    });
    expect(harness.schedulerReset).toHaveBeenCalledOnce();

    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
      score: 20,
    }));
    harness.onStep?.();
    dialogElements.playAgainButton?.click();
    expect(root.dataset.gameStatus).toBe('running');
    expect(root.dataset.gameScore).toBe('0');
    expect(harness.schedulerStart).toHaveBeenCalledTimes(2);

    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'completed',
    }));
    harness.onStep?.();
    dialogElements.returnToTitleButton?.click();
    expect(root.dataset).toMatchObject({
      gameStatus: 'ready',
      gameScore: '0',
      gameHead: '10,10',
    });
    expect(harness.closeResult).toHaveBeenCalled();
    expect(document.playButton.focus).toHaveBeenCalled();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Returned to title.',
    );
  });

  it.each(['paused', 'gameOver'] as const)(
    'restarts from %s with a fresh scheduler interval',
    (status) => {
      const { document, root } = mountHarness();
      document.playButton.click();
      harness.simulation.mockImplementationOnce((state: GameState) => ({
        ...state,
        status,
        score: 20,
      }));
      harness.onStep?.();

      document.restartButton.click();

      expect(root.dataset).toMatchObject({
        gameStatus: 'running',
        gameScore: '0',
        gameHead: '10,10',
      });
      expect(harness.closeResult).toHaveBeenCalled();
      if (status === 'gameOver') {
        expect(harness.schedulerStart).toHaveBeenCalledTimes(2);
      } else {
        expect(harness.schedulerReset).toHaveBeenCalledOnce();
      }
    },
  );

  it('tears down idempotently and ignores retained callbacks and controls', () => {
    const { document, root, teardown } = mountHarness();
    document.playButton.click();
    const step = harness.onStep;
    const statusBeforeTeardown = root.dataset.gameStatus;

    teardown();
    teardown();
    step?.();
    document.restartButton.click();
    dialogElements.playAgainButton?.click();

    expect(harness.schedulerDispose).toHaveBeenCalledOnce();
    expect(harness.dialogTeardown).toHaveBeenCalledOnce();
    expect(harness.inputTeardown).toHaveBeenCalledOnce();
    expect(harness.presentationStop).toHaveBeenCalledOnce();
    expect(harness.simulation).not.toHaveBeenCalled();
    expect(root.dataset.gameStatus).toBe(statusBeforeTeardown);
    expect(harness.schedulerStart).toHaveBeenCalledOnce();
  });
});

describe('gameplay UI helpers', () => {
  it.each([
    ['gameOver', 'Game over'],
    ['completed', 'Grid complete'],
  ] as const)('renders and focuses the %s result', async (status, title) => {
    const document = new FakeDocument();
    vi.stubGlobal('document', document);
    const { createDialogs } = await vi.importActual<
      typeof import('../../src/ui/dialogs')
    >('../../src/ui/dialogs');
    const dialogs = createDialogs(
      document.settingsButton as unknown as HTMLButtonElement,
    );

    dialogs.showResult(status, 40);

    expect(document.resultTitle.textContent).toBe(title);
    expect(document.finalScore.textContent).toBe('40');
    expect(document.dialogPlayAgainButton.focus).toHaveBeenCalledOnce();
    expect(dialogs.gameOverDialog.open).toBe(true);
  });

  it('closes settings narrowly and removes every dialog listener on teardown', async () => {
    const document = new FakeDocument();
    vi.stubGlobal('document', document);
    const { createDialogs } = await vi.importActual<
      typeof import('../../src/ui/dialogs')
    >('../../src/ui/dialogs');
    const dialogs = createDialogs(
      document.settingsButton as unknown as HTMLButtonElement,
    );
    const settingsDialog = dialogs.settingsDialog as unknown as FakeElement;
    const gameOverDialog = dialogs.gameOverDialog as unknown as FakeElement;

    document.settingsButton.click();
    expect(dialogs.settingsDialog.open).toBe(true);
    dialogs.closeSettings();
    expect(dialogs.settingsDialog.open).toBe(false);
    expect(() => dialogs.closeSettings()).not.toThrow();

    expect(document.settingsButton.listeners.get('click')?.size).toBe(1);
    expect(document.closeButton.listeners.get('click')?.size).toBe(1);
    expect(settingsDialog.listeners.get('close')?.size).toBe(1);
    expect(gameOverDialog.listeners.get('cancel')?.size).toBe(1);

    const handledCancel = new Event('cancel', { cancelable: true });
    expect(gameOverDialog.dispatchEvent(handledCancel)).toBe(false);
    expect(handledCancel.defaultPrevented).toBe(true);

    dialogs.teardown();

    expect(document.settingsButton.listeners.get('click')?.size).toBe(0);
    expect(document.closeButton.listeners.get('click')?.size).toBe(0);
    expect(settingsDialog.listeners.get('close')?.size).toBe(0);
    expect(gameOverDialog.listeners.get('cancel')?.size).toBe(0);
    const unhandledCancel = new Event('cancel', { cancelable: true });
    expect(gameOverDialog.dispatchEvent(unhandledCancel)).toBe(true);
    expect(unhandledCancel.defaultPrevented).toBe(false);
  });

  it('updates only the current HUD score', async () => {
    const document = new FakeDocument();
    const hud = new FakeElement('section', document);
    const { updateHudScore } =
      await vi.importActual<typeof import('../../src/ui/hud')>(
        '../../src/ui/hud',
      );

    updateHudScore(hud as unknown as HTMLElement, 10);

    expect(document.scoreValue.textContent).toBe('10');
  });
});
