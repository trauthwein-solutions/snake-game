import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio, GameAudioFactory } from '../../src/audio/game-audio';
import type { Direction, GameState } from '../../src/engine/model';
import type { ArcadeFeedback } from '../../src/rendering/effects';

type Listener = (event?: Event) => void;

class FakeElement {
  readonly attributes = new Map<string, string>();
  checked = false;
  className = '';
  dataset: Record<string, string> = {};
  disabled = false;
  id = '';
  innerHTML = '';
  textContent = '';
  value = '';
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  focus = vi.fn();
  hidden = false;
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
    if (this.tagName === 'button' && this.disabled) {
      return;
    }

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
      if (selector === '#setting-music') return this.ownerDocument.musicControl;
      if (selector === '#setting-music-style')
        return this.ownerDocument.musicStyleControl;
      if (selector === '#setting-walls')
        return this.ownerDocument.wallModeControl;
      if (selector === '#setting-sound-effects')
        return this.ownerDocument.soundEffectsControl;
      if (selector === '#setting-reduced-motion')
        return this.ownerDocument.reducedMotionControl;
      if (selector === '#setting-high-contrast')
        return this.ownerDocument.highContrastControl;
    }

    if (this.tagName === 'dialog' && this.id === 'game-over-dialog') {
      if (selector === '#game-over-title')
        return this.ownerDocument.resultTitle;
      if (selector === '[data-score="final"]')
        return this.ownerDocument.finalScore;
      if (selector === '[data-new-best]') return this.ownerDocument.newBest;
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
    if (this.tagName === 'section' && selector === '[data-score="best"]') {
      return this.ownerDocument.bestScoreValue;
    }

    return null;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  replaceWith(): void {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  showModal(): void {
    this.open = true;
  }
}

class FakeMediaQueryList {
  matches: boolean;
  readonly listeners = new Set<Listener>();

  constructor(
    readonly media: string,
    matches = false,
  ) {
    this.matches = matches;
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  dispatchChange(): void {
    for (const listener of [...this.listeners]) listener(new Event('change'));
  }
}

class FakeStorage {
  readonly values = new Map<string, string>();
  readonly getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  readonly setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value);
  });
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
  readonly mediaQueries: FakeMediaQueryList[] = [];
  readonly matchMedia = vi.fn((media: string) => {
    const query = new FakeMediaQueryList(media);
    this.mediaQueries.push(query);
    return query;
  });
  readonly localStorage = new FakeStorage();
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(new Event(type));
    }
  }
}

class FakeDocument {
  hidden = false;
  readonly defaultView = new FakeView();
  readonly shell = new FakeElement('main', this);
  readonly hudMount = new FakeElement('div', this);
  readonly settingsButton = new FakeElement('button', this);
  readonly playButton = new FakeElement('button', this);
  readonly pauseButton = new FakeElement('button', this);
  readonly restartButton = new FakeElement('button', this);
  readonly canvas = new FakeElement('canvas', this);
  readonly touchControlsMount = new FakeElement('div', this);
  readonly instructions = new FakeElement('p', this);
  readonly closeButton = new FakeElement('button', this);
  readonly musicControl = new FakeElement('input', this);
  readonly musicStyleControl = new FakeElement('select', this);
  readonly wallModeControl = new FakeElement('select', this);
  readonly soundEffectsControl = new FakeElement('input', this);
  readonly reducedMotionControl = new FakeElement('input', this);
  readonly highContrastControl = new FakeElement('input', this);
  readonly firstControl = this.musicControl;
  readonly resultTitle = new FakeElement('h2', this);
  readonly finalScore = new FakeElement('strong', this);
  readonly newBest = new FakeElement('p', this);
  readonly dialogPlayAgainButton = new FakeElement('button', this);
  readonly dialogReturnToTitleButton = new FakeElement('button', this);
  readonly scoreValue = new FakeElement('dd', this);
  readonly bestScoreValue = new FakeElement('dd', this);
  readonly listeners = new Map<string, Set<Listener>>();
  readonly shellElements = new Map<string, FakeElement>([
    ['[data-hud]', this.hudMount],
    ['[data-action="settings"]', this.settingsButton],
    ['[data-action="play"]', this.playButton],
    ['[data-action="pause"]', this.pauseButton],
    ['[data-action="restart"]', this.restartButton],
    ['[data-render-target="arena"]', this.canvas],
    ['[data-touch-controls]', this.touchControlsMount],
    ['#arena-instructions', this.instructions],
  ]);

  createElement(tagName: string): FakeElement {
    return tagName === 'main' ? this.shell : new FakeElement(tagName, this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(new Event(type));
    }
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
        onPauseToggle: (event: KeyboardEvent) => void;
      }
    | undefined,
  inputTeardown: vi.fn(),
  interval: vi.fn((tier: number) => [180, 155, 130, 110][tier] ?? 180),
  onStep: undefined as (() => void) | undefined,
  presentationOptions: undefined as
    | {
        prefersReducedMotion: () => boolean;
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
  schedulerOperations: [] as string[],
  schedulerRunning: false,
  schedulerStart: vi.fn(),
  showResult: vi.fn(),
  simulation: vi.fn(),
  updateHudBestScore: vi.fn(),
  updateHudScore: vi.fn(),
}));

vi.mock('../../src/rendering/canvas-renderer', () => ({
  renderGameFrame: harness.render,
}));

vi.mock('../../src/rendering/presentation-loop', () => ({
  createPresentationLoop: vi.fn(
    (options: {
      prefersReducedMotion: () => boolean;
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
      onPauseToggle: (event: KeyboardEvent) => void;
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
  updateHudBestScore: harness.updateHudBestScore,
  updateHudScore: harness.updateHudScore,
}));

const dialogElements = vi.hoisted(() => ({
  gameOverDialog: undefined as FakeElement | undefined,
  playAgainButton: undefined as FakeElement | undefined,
  returnToTitleButton: undefined as FakeElement | undefined,
  settingsDialog: undefined as FakeElement | undefined,
  settingsControls: undefined as
    | {
        music: FakeElement;
        musicStyle: FakeElement;
        wallMode: FakeElement;
        soundEffects: FakeElement;
        reducedMotion: FakeElement;
        highContrast: FakeElement;
      }
    | undefined,
}));

vi.mock('../../src/ui/dialogs', () => ({
  createDialogs: vi.fn(
    (
      settingsButton: FakeElement,
      initialSettings: {
        music: boolean;
        musicStyle: string;
        wallMode: string;
        soundEffects: boolean;
        reducedMotion: boolean;
        highContrast: boolean;
      },
    ) => {
      const document = settingsButton.ownerDocument;
      dialogElements.settingsDialog = new FakeElement('dialog', document);
      dialogElements.gameOverDialog = new FakeElement('dialog', document);
      dialogElements.playAgainButton = new FakeElement('button', document);
      dialogElements.returnToTitleButton = new FakeElement('button', document);
      dialogElements.settingsControls = {
        music: new FakeElement('input', document),
        musicStyle: new FakeElement('select', document),
        wallMode: new FakeElement('select', document),
        soundEffects: new FakeElement('input', document),
        reducedMotion: new FakeElement('input', document),
        highContrast: new FakeElement('input', document),
      };
      for (const key of ['music'] as const) {
        dialogElements.settingsControls[key].checked = initialSettings[key];
      }
      dialogElements.settingsControls.musicStyle.value =
        initialSettings.musicStyle;
      dialogElements.settingsControls.wallMode.value = initialSettings.wallMode;
      for (const key of [
        'soundEffects',
        'reducedMotion',
        'highContrast',
      ] as const) {
        dialogElements.settingsControls[key].checked = initialSettings[key];
      }
      return {
        settingsDialog: dialogElements.settingsDialog,
        gameOverDialog: dialogElements.gameOverDialog,
        playAgainButton: dialogElements.playAgainButton,
        returnToTitleButton: dialogElements.returnToTitleButton,
        settingsControls: dialogElements.settingsControls,
        showResult: harness.showResult,
        closeResult: harness.closeResult,
        closeSettings: harness.closeSettings,
        teardown: harness.dialogTeardown,
      };
    },
  ),
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

function mountHarness(
  configure?: (document: FakeDocument) => void,
  audioFactory?: GameAudioFactory,
) {
  const document = new FakeDocument();
  configure?.(document);
  const root = new FakeElement('div', document);
  vi.stubGlobal('document', document);
  const teardown = mountApp(root as unknown as HTMLElement, audioFactory);
  return { document, root, teardown };
}

function fakeAudio() {
  const audio: GameAudio = {
    sync: vi.fn(),
    play: vi.fn(),
    dispose: vi.fn(),
  };
  const factory = vi.fn(() => audio);
  return { audio, factory };
}

function renderFeedback(timestampMs = 0): ArcadeFeedback | undefined {
  harness.presentationOptions?.render(timestampMs, false);
  return (
    harness.render.mock.calls.at(-1)?.[2] as
      { feedback?: ArcadeFeedback } | undefined
  )?.feedback;
}

function expectActionState(
  document: FakeDocument,
  expected: {
    pauseClass: string;
    pauseDisabled: boolean;
    pauseLabel: string;
    playClass: string;
    playDisabled: boolean;
  },
): void {
  expect(document.playButton.disabled).toBe(expected.playDisabled);
  expect(document.playButton.className).toBe(expected.playClass);
  expect(document.pauseButton.disabled).toBe(expected.pauseDisabled);
  expect(document.pauseButton.className).toBe(expected.pauseClass);
  expect(document.pauseButton.textContent).toBe(expected.pauseLabel);
  expect(document.restartButton.disabled).toBe(false);
  expect(document.settingsButton.disabled).toBe(false);
}

beforeEach(() => {
  harness.schedulerRunning = false;
  harness.schedulerStart.mockImplementation(() => {
    harness.schedulerOperations.push('start');
    harness.schedulerRunning = true;
  });
  harness.schedulerPause.mockImplementation(() => {
    harness.schedulerOperations.push('pause');
    harness.schedulerRunning = false;
  });
  harness.schedulerReset.mockImplementation(() => {
    harness.schedulerOperations.push('reset');
  });
  harness.schedulerDispose.mockImplementation(() => {
    harness.schedulerOperations.push('dispose');
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
  harness.schedulerOperations.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  harness.inputOptions = undefined;
  harness.onStep = undefined;
  harness.presentationOptions = undefined;
});

describe('mountApp gameplay lifecycle', () => {
  it('loads the persisted best once before publishing the initial HUD', () => {
    const { document } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.values.set(
        'snakish.best-score.v1',
        JSON.stringify({ version: 1, bestScore: 40 }),
      );
    });

    expect(document.defaultView.localStorage.getItem.mock.calls).toEqual([
      ['snakish.preferences.v1'],
      ['snakish.best-score.v1'],
    ]);
    expect(harness.updateHudScore).toHaveBeenCalledWith(expect.anything(), 0);
    expect(harness.updateHudBestScore).toHaveBeenCalledWith(
      expect.anything(),
      40,
    );
    expect(harness.updateHudBestScore).toHaveBeenCalledOnce();
  });

  it('loads all Settings controls once before publishing effective visuals', () => {
    const { document, root } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.values.set(
        'snakish.preferences.v1',
        '{"highContrast":true,"reducedMotion":true,"soundEffects":false,"music":false,"version":1}',
      );
    });

    expect(dialogElements.settingsControls).toMatchObject({
      music: { checked: false },
      musicStyle: { value: 'neonPulse' },
      wallMode: { value: 'solid' },
      soundEffects: { checked: false },
      reducedMotion: { checked: true },
      highContrast: { checked: true },
    });
    expect(root.dataset).toMatchObject({
      highContrast: 'true',
      reducedMotion: 'true',
    });
    expect(
      document.defaultView.localStorage.getItem.mock.calls.filter(
        ([key]) => key === 'snakish.preferences.v1',
      ),
    ).toHaveLength(1);
    harness.presentationOptions?.render(15, true);
    expect(harness.render).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        colorMode: 'high-contrast',
        reducedMotion: true,
      }),
    );
  });

  it('writes one canonical complete payload only for each actual checkbox change', () => {
    const { document } = mountHarness();
    document.defaultView.localStorage.setItem.mockClear();
    const controls = dialogElements.settingsControls;
    if (controls === undefined) throw new Error('Expected Settings controls.');

    controls.music.checked = true;
    controls.music.dispatchEvent(new Event('change'));
    expect(document.defaultView.localStorage.setItem).not.toHaveBeenCalled();

    controls.music.checked = false;
    controls.music.dispatchEvent(new Event('change'));
    controls.soundEffects.checked = false;
    controls.soundEffects.dispatchEvent(new Event('change'));

    expect(document.defaultView.localStorage.setItem.mock.calls).toEqual([
      [
        'snakish.preferences.v1',
        '{"version":3,"music":false,"musicStyle":"neonPulse","soundEffects":true,"reducedMotion":false,"highContrast":false,"wallMode":"solid"}',
      ],
      [
        'snakish.preferences.v1',
        '{"version":3,"music":false,"musicStyle":"neonPulse","soundEffects":false,"reducedMotion":false,"highContrast":false,"wallMode":"solid"}',
      ],
    ]);
    expect(harness.presentationRedraw).not.toHaveBeenCalled();
    expect(harness.presentationSync).not.toHaveBeenCalled();
    expect(harness.schedulerOperations).toEqual([]);
  });

  it('loads Walls from storage and saves one canonical v3 payload per actual selection', () => {
    const { document } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.values.set(
        'snakish.preferences.v1',
        '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"wrapAround"}',
      );
    });
    const control = dialogElements.settingsControls?.wallMode;
    if (control === undefined) throw new Error('Expected Walls control.');
    expect(control.value).toBe('wrapAround');
    document.defaultView.localStorage.setItem.mockClear();

    control.dispatchEvent(new Event('change'));
    expect(document.defaultView.localStorage.setItem).not.toHaveBeenCalled();

    control.value = 'solid';
    control.dispatchEvent(new Event('change'));

    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledOnce();
    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledWith(
      'snakish.preferences.v1',
      '{"version":3,"music":false,"musicStyle":"pixelDrift","soundEffects":true,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    );
  });

  it('uses the latest rapid Walls selection on the next active tick without reset', () => {
    const { audio, factory } = fakeAudio();
    const { document, root } = mountHarness(undefined, factory);
    const control = dialogElements.settingsControls?.wallMode;
    if (control === undefined) throw new Error('Expected Walls control.');
    document.playButton.click();
    harness.onStep?.();
    const beforeChange = { ...root.dataset };
    const feedbackBeforeChange = renderFeedback(10);
    const schedulerBefore = [...harness.schedulerOperations];
    vi.mocked(audio.sync).mockClear();

    control.value = 'wrapAround';
    control.dispatchEvent(new Event('change'));
    control.value = 'solid';
    control.dispatchEvent(new Event('change'));
    control.value = 'wrapAround';
    control.dispatchEvent(new Event('change'));

    expect(root.dataset).toEqual(beforeChange);
    expect(harness.schedulerOperations).toEqual(schedulerBefore);
    expect(harness.schedulerReset).not.toHaveBeenCalled();
    expect(audio.sync).not.toHaveBeenCalled();
    expect(harness.announce).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('restart'),
    );
    expect(document.instructions.textContent).toContain('Edges wrap');
    expect(renderFeedback(20)).toBe(feedbackBeforeChange);

    harness.onStep?.();

    expect(harness.simulation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'running',
        score: 0,
        speedTier: 0,
        snake: [
          { x: 11, y: 10 },
          { x: 10, y: 10 },
          { x: 9, y: 10 },
        ],
        lastAcceptedDirection: 'right',
        pendingDirection: null,
      }),
      Math.random,
      'wrapAround',
    );
  });

  it('keeps checkbox state in memory when preference saving throws', () => {
    mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.setItem.mockImplementation(() => {
        throw new Error('blocked');
      });
    });
    const controls = dialogElements.settingsControls;
    if (controls === undefined) throw new Error('Expected Settings controls.');

    for (const control of [
      controls.music,
      controls.soundEffects,
      controls.reducedMotion,
      controls.highContrast,
    ]) {
      control.checked = !control.checked;
      expect(() => control.dispatchEvent(new Event('change'))).not.toThrow();
    }
    controls.wallMode.value = 'wrapAround';
    expect(() =>
      controls.wallMode.dispatchEvent(new Event('change')),
    ).not.toThrow();

    expect(controls).toMatchObject({
      music: { checked: false },
      soundEffects: { checked: false },
      reducedMotion: { checked: true },
      highContrast: { checked: true },
      wallMode: { value: 'wrapAround' },
    });
  });

  it('redraws high contrast immediately and uses its color mode on every frame', () => {
    const { root } = mountHarness();
    const control = dialogElements.settingsControls?.highContrast;
    if (control === undefined) throw new Error('Expected High contrast.');

    control.checked = true;
    control.dispatchEvent(new Event('change'));

    expect(root.dataset.highContrast).toBe('true');
    expect(harness.presentationRedraw).toHaveBeenCalledOnce();
    harness.presentationOptions?.render(30, false);
    expect(harness.render.mock.calls.at(-1)?.[2]).toMatchObject({
      colorMode: 'high-contrast',
    });

    control.checked = false;
    control.dispatchEvent(new Event('change'));
    harness.presentationOptions?.render(40, false);
    expect(harness.render.mock.calls.at(-1)?.[2]).toMatchObject({
      colorMode: 'normal',
    });
  });

  it('applies stored/system reduced-motion truth table and never saves OS changes', () => {
    const { document, root } = mountHarness();
    const control = dialogElements.settingsControls?.reducedMotion;
    const query = document.defaultView.mediaQueries.find(
      ({ media }) => media === '(prefers-reduced-motion: reduce)',
    );
    if (control === undefined || query === undefined) {
      throw new Error('Expected reduced-motion controls.');
    }
    document.defaultView.localStorage.setItem.mockClear();

    control.checked = true;
    control.dispatchEvent(new Event('change'));
    expect(root.dataset.reducedMotion).toBe('true');
    expect(harness.presentationOptions?.prefersReducedMotion()).toBe(true);
    expect(harness.presentationSync).toHaveBeenCalledTimes(1);

    query.matches = true;
    query.dispatchChange();
    expect(root.dataset.reducedMotion).toBe('true');
    expect(harness.presentationSync).toHaveBeenCalledTimes(2);

    control.checked = false;
    control.dispatchEvent(new Event('change'));
    expect(root.dataset.reducedMotion).toBe('true');
    expect(harness.presentationOptions?.prefersReducedMotion()).toBe(true);
    expect(harness.presentationSync).toHaveBeenCalledTimes(3);

    query.matches = false;
    query.dispatchChange();
    expect(root.dataset.reducedMotion).toBe('false');
    expect(harness.presentationOptions?.prefersReducedMotion()).toBe(false);
    expect(harness.presentationSync).toHaveBeenCalledTimes(4);
    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('forwards eligible activations and increments run identity without replacing audio', () => {
    const { audio, factory } = fakeAudio();
    const { document } = mountHarness(undefined, factory);
    const playActivation = new Event('click');
    const restartActivation = new Event('click');
    const playAgainActivation = new Event('click');

    expect(factory).toHaveBeenCalledOnce();
    expect(audio.sync).toHaveBeenCalledWith({
      status: 'ready',
      runId: 0,
      musicEnabled: true,
      musicStyle: 'neonPulse',
      soundEffectsEnabled: true,
    });

    document.playButton.dispatchEvent(playActivation);
    document.restartButton.dispatchEvent(restartActivation);
    dialogElements.playAgainButton?.dispatchEvent(playAgainActivation);

    expect(factory).toHaveBeenCalledOnce();
    expect(audio.sync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'running', runId: 1 }),
      playActivation,
    );
    expect(audio.sync).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ status: 'running', runId: 2 }),
      restartActivation,
    );
    expect(audio.sync).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ status: 'running', runId: 3 }),
      playAgainActivation,
    );
  });

  it('syncs before manual cues and never offers Escape as audio activation', () => {
    const { audio, factory } = fakeAudio();
    const { document } = mountHarness(undefined, factory);
    document.playButton.dispatchEvent(new Event('click'));
    vi.mocked(audio.sync).mockClear();
    vi.mocked(audio.play).mockClear();
    const pauseActivation = new Event('click');
    const pActivation = { key: 'p' } as KeyboardEvent;
    const escape = { key: 'Escape' } as KeyboardEvent;

    document.pauseButton.dispatchEvent(pauseActivation);
    harness.inputOptions?.onPauseToggle(pActivation);
    harness.inputOptions?.onPauseToggle(escape);

    expect(vi.mocked(audio.sync).mock.calls).toEqual([
      [
        expect.objectContaining({ status: 'paused', runId: 1 }),
        pauseActivation,
      ],
      [expect.objectContaining({ status: 'running', runId: 1 }), pActivation],
      [expect.objectContaining({ status: 'paused', runId: 1 })],
    ]);
    expect(vi.mocked(audio.play).mock.calls).toEqual([
      ['pause'],
      ['resume'],
      ['pause'],
    ]);
    for (let index = 0; index < 3; index += 1) {
      expect(
        vi.mocked(audio.sync).mock.invocationCallOrder[index],
      ).toBeLessThan(
        vi.mocked(audio.play).mock.invocationCallOrder[index] ?? 0,
      );
    }
  });

  it('allows trusted P to unlock while ready but never allows Escape', () => {
    const { audio, factory } = fakeAudio();
    mountHarness(undefined, factory);
    vi.mocked(audio.sync).mockClear();
    const pActivation = { key: 'p' } as KeyboardEvent;

    harness.inputOptions?.onPauseToggle(pActivation);
    harness.inputOptions?.onPauseToggle({ key: 'Escape' } as KeyboardEvent);

    expect(vi.mocked(audio.sync).mock.calls).toEqual([
      [expect.objectContaining({ status: 'ready', runId: 0 }), pActivation],
    ]);
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('offers only the original settings click as activation and persists on change', () => {
    const { audio, factory } = fakeAudio();
    const { document } = mountHarness(undefined, factory);
    const controls = dialogElements.settingsControls;
    if (controls === undefined) throw new Error('Expected Settings controls.');
    vi.mocked(audio.sync).mockClear();
    document.defaultView.localStorage.setItem.mockClear();
    const click = new Event('click');
    const change = new Event('change');

    controls.music.checked = false;
    controls.music.dispatchEvent(click);
    controls.music.dispatchEvent(change);

    expect(vi.mocked(audio.sync).mock.calls).toEqual([
      [
        expect.objectContaining({
          musicEnabled: false,
          soundEffectsEnabled: true,
        }),
        click,
      ],
      [
        expect.objectContaining({
          musicEnabled: false,
          soundEffectsEnabled: true,
        }),
      ],
    ]);
    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledOnce();
  });

  it('persists a migrated style change canonically and syncs the latest snapshot once', () => {
    const { audio, factory } = fakeAudio();
    const { document } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.values.set(
        'snakish.preferences.v1',
        '{"version":1,"music":true,"soundEffects":false,"reducedMotion":true,"highContrast":false}',
      );
    }, factory);
    const control = dialogElements.settingsControls?.musicStyle;
    if (control === undefined) throw new Error('Expected Music style.');
    expect(control.value).toBe('neonPulse');
    vi.mocked(audio.sync).mockClear();
    document.defaultView.localStorage.setItem.mockClear();

    control.value = 'chillGrid';
    control.dispatchEvent(new Event('change'));

    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledWith(
      'snakish.preferences.v1',
      '{"version":3,"music":true,"musicStyle":"chillGrid","soundEffects":false,"reducedMotion":true,"highContrast":false,"wallMode":"solid"}',
    );
    expect(vi.mocked(audio.sync).mock.calls).toEqual([
      [
        expect.objectContaining({
          musicEnabled: true,
          musicStyle: 'chillGrid',
          soundEffectsEnabled: false,
        }),
      ],
    ]);
  });

  it('keeps automatic pause silent and audio toggles independent with no reduced-motion coupling', () => {
    const { audio, factory } = fakeAudio();
    const { document } = mountHarness(undefined, factory);
    document.playButton.dispatchEvent(new Event('click'));
    vi.mocked(audio.sync).mockClear();
    vi.mocked(audio.play).mockClear();

    document.hidden = true;
    document.dispatch('visibilitychange');
    expect(audio.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'paused' }),
    );
    expect(audio.play).not.toHaveBeenCalled();

    const controls = dialogElements.settingsControls;
    if (controls === undefined) throw new Error('Expected Settings controls.');
    const musicClick = new Event('click');
    controls.music.checked = false;
    controls.music.dispatchEvent(musicClick);
    controls.music.dispatchEvent(new Event('change'));
    expect(audio.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        musicEnabled: false,
        soundEffectsEnabled: true,
      }),
    );

    const callsBeforeMotion = vi.mocked(audio.sync).mock.calls.length;
    controls.reducedMotion.checked = true;
    controls.reducedMotion.dispatchEvent(new Event('change'));
    expect(audio.sync).toHaveBeenCalledTimes(callsBeforeMotion);

    const effectsClick = new Event('click');
    controls.soundEffects.checked = false;
    controls.soundEffects.dispatchEvent(effectsClick);
    controls.soundEffects.dispatchEvent(new Event('change'));
    expect(audio.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        musicEnabled: false,
        soundEffectsEnabled: false,
      }),
    );
  });

  it.each(['gameOver', 'completed'] as const)(
    'drops callback unlocks and lets a coincident %s cue suppress food',
    (terminalStatus) => {
      const { audio, factory } = fakeAudio();
      const { document } = mountHarness(undefined, factory);
      document.playButton.dispatchEvent(new Event('click'));
      vi.mocked(audio.sync).mockClear();
      vi.mocked(audio.play).mockClear();
      harness.simulation
        .mockImplementationOnce((state: GameState) => ({
          ...movingState(state),
          score: 10,
        }))
        .mockImplementationOnce((state: GameState) => ({
          ...state,
          status: terminalStatus,
          score: 20,
        }));

      harness.onStep?.();
      expect(audio.play).toHaveBeenLastCalledWith('food');
      vi.mocked(audio.play).mockClear();
      harness.onStep?.();

      expect(audio.sync).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: terminalStatus, runId: 1 }),
      );
      expect(vi.mocked(audio.sync).mock.calls.at(-1)).toHaveLength(1);
      expect(vi.mocked(audio.play).mock.calls).toEqual([[terminalStatus]]);
      expect(
        vi.mocked(audio.sync).mock.invocationCallOrder.at(-1),
      ).toBeLessThan(
        vi.mocked(audio.play).mock.invocationCallOrder.at(-1) ?? 0,
      );
    },
  );

  it('silences title return and disposes audio once during idempotent teardown', () => {
    const { audio, factory } = fakeAudio();
    const { document, teardown } = mountHarness(undefined, factory);
    document.playButton.dispatchEvent(new Event('click'));
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
    }));
    harness.onStep?.();
    vi.mocked(audio.sync).mockClear();
    vi.mocked(audio.play).mockClear();

    dialogElements.returnToTitleButton?.dispatchEvent(new Event('click'));

    expect(audio.sync).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', runId: 1 }),
    );
    expect(vi.mocked(audio.sync).mock.calls[0]).toHaveLength(1);
    expect(audio.play).not.toHaveBeenCalled();

    const musicStyle = dialogElements.settingsControls?.musicStyle;
    const wallMode = dialogElements.settingsControls?.wallMode;
    expect(musicStyle?.listeners.get('change')?.size).toBe(1);
    expect(wallMode?.listeners.get('change')?.size).toBe(1);

    teardown();
    teardown();
    expect(audio.dispose).toHaveBeenCalledOnce();
    expect(musicStyle?.listeners.get('change')?.size).toBe(0);
    expect(wallMode?.listeners.get('change')?.size).toBe(0);
  });

  it('does not write for scores below or tied with the persisted best', () => {
    const { document } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.values.set(
        'snakish.best-score.v1',
        JSON.stringify({ version: 1, bestScore: 20 }),
      );
    });
    document.playButton.click();
    harness.simulation
      .mockImplementationOnce((state: GameState) => ({
        ...movingState(state),
        score: 10,
      }))
      .mockImplementationOnce((state: GameState) => ({
        ...movingState(state),
        score: 20,
      }));

    harness.onStep?.();
    harness.onStep?.();

    expect(document.defaultView.localStorage.setItem).not.toHaveBeenCalled();
    expect(harness.updateHudBestScore).toHaveBeenLastCalledWith(
      expect.anything(),
      20,
    );
  });

  it('publishes and canonically writes once for every strictly reached best', () => {
    const { document } = mountHarness();
    document.playButton.click();
    harness.simulation
      .mockImplementationOnce((state: GameState) => ({
        ...movingState(state),
        score: 10,
      }))
      .mockImplementationOnce(movingState)
      .mockImplementationOnce((state: GameState) => ({
        ...movingState(state),
        score: 20,
      }));

    harness.onStep?.();
    harness.onStep?.();
    harness.onStep?.();

    expect(document.defaultView.localStorage.setItem.mock.calls).toEqual([
      ['snakish.best-score.v1', JSON.stringify({ version: 1, bestScore: 10 })],
      ['snakish.best-score.v1', JSON.stringify({ version: 1, bestScore: 20 })],
    ]);
    expect(harness.updateHudBestScore).toHaveBeenLastCalledWith(
      expect.anything(),
      20,
    );
  });

  it('retains the in-memory and HUD best when saving throws', () => {
    const { document } = mountHarness((fakeDocument) => {
      fakeDocument.defaultView.localStorage.setItem.mockImplementation(() => {
        throw new Error('blocked');
      });
    });
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      score: 10,
    }));

    expect(() => harness.onStep?.()).not.toThrow();
    document.pauseButton.click();

    expect(harness.updateHudBestScore).toHaveBeenLastCalledWith(
      expect.anything(),
      10,
    );
  });

  it('mounts and keeps an in-memory best when localStorage access throws', () => {
    let document!: FakeDocument;

    expect(() => {
      ({ document } = mountHarness((fakeDocument) => {
        Object.defineProperty(fakeDocument.defaultView, 'localStorage', {
          configurable: true,
          get: () => {
            throw new Error('blocked');
          },
        });
      }));
    }).not.toThrow();

    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      score: 10,
    }));
    expect(() => harness.onStep?.()).not.toThrow();
    expect(harness.updateHudBestScore).toHaveBeenLastCalledWith(
      expect.anything(),
      10,
    );
  });

  it.each([
    ['gameOver', 40, 10, false],
    ['gameOver', 40, 40, false],
    ['gameOver', 40, 50, true],
    ['completed', 40, 10, false],
    ['completed', 40, 40, false],
    ['completed', 40, 50, true],
  ] as const)(
    'presents %s from run-start %i with final %i and new-best=%s',
    (status, startingBest, finalScore, isNewBest) => {
      const { document } = mountHarness((fakeDocument) => {
        fakeDocument.defaultView.localStorage.values.set(
          'snakish.best-score.v1',
          JSON.stringify({ version: 1, bestScore: startingBest }),
        );
      });
      document.playButton.click();
      harness.simulation.mockImplementationOnce((state: GameState) => ({
        ...state,
        status,
        score: finalScore,
      }));

      harness.onStep?.();

      expect(harness.showResult).toHaveBeenCalledWith(
        status,
        finalScore,
        isNewBest,
      );
    },
  );

  it('snapshots current best for Restart, Play Again, and the next title Play', () => {
    const { document } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      score: 10,
    }));
    harness.onStep?.();

    document.restartButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
      score: 10,
    }));
    harness.onStep?.();
    expect(harness.showResult).toHaveBeenLastCalledWith('gameOver', 10, false);

    dialogElements.playAgainButton?.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'completed',
      score: 10,
    }));
    harness.onStep?.();
    expect(harness.showResult).toHaveBeenLastCalledWith('completed', 10, false);

    dialogElements.returnToTitleButton?.click();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
      score: 10,
    }));
    harness.onStep?.();
    expect(harness.showResult).toHaveBeenLastCalledWith('gameOver', 10, false);
  });

  it('focuses enabled Pause exactly once after a successful Play transition', () => {
    const { document } = mountHarness();

    document.playButton.click();

    expect(document.playButton.disabled).toBe(true);
    expect(document.playButton.focus).not.toHaveBeenCalled();
    expect(document.pauseButton.disabled).toBe(false);
    expect(document.pauseButton.focus).toHaveBeenCalledOnce();

    document.playButton.dispatchEvent(new Event('click'));
    harness.onStep?.();
    document.hidden = true;
    document.dispatch('visibilitychange');
    document.hidden = false;
    document.pauseButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
    }));
    harness.onStep?.();
    document.defaultView.dispatch('blur');

    expect(document.playButton.focus).not.toHaveBeenCalled();
    expect(document.pauseButton.focus).toHaveBeenCalledOnce();
  });

  it('synchronizes ready, running, and paused action semantics and visual priority', () => {
    const { document, root } = mountHarness();

    expectActionState(document, {
      playDisabled: false,
      playClass: 'button button--primary',
      pauseDisabled: true,
      pauseClass: 'button',
      pauseLabel: 'Pause',
    });
    document.pauseButton.click();
    expect(root.dataset.gameStatus).toBe('ready');
    expect(root.dataset.pauseIntentCount).toBeUndefined();
    expect(harness.schedulerOperations).toEqual([]);

    document.playButton.click();
    expectActionState(document, {
      playDisabled: true,
      playClass: 'button',
      pauseDisabled: false,
      pauseClass: 'button button--primary',
      pauseLabel: 'Pause',
    });
    document.pauseButton.click();
    expect(root.dataset.gameStatus).toBe('paused');
    expectActionState(document, {
      playDisabled: true,
      playClass: 'button',
      pauseDisabled: false,
      pauseClass: 'button button--primary',
      pauseLabel: 'Resume',
    });
    expect(harness.schedulerOperations).toEqual(['start', 'pause']);
    expect(harness.presentationRedraw).toHaveBeenCalled();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Game paused.',
    );

    harness.inputOptions?.onPauseToggle({ key: 'p' } as KeyboardEvent);
    expect(root.dataset.gameStatus).toBe('running');
    expectActionState(document, {
      playDisabled: true,
      playClass: 'button',
      pauseDisabled: false,
      pauseClass: 'button button--primary',
      pauseLabel: 'Pause',
    });
    expect(root.dataset.pauseIntentCount).toBe('2');
    expect(harness.schedulerOperations).toEqual(['start', 'pause', 'start']);
    expect(harness.schedulerReset).not.toHaveBeenCalled();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Game resumed.',
    );
  });

  it.each(['gameOver', 'completed'] as const)(
    'gives dialog actions control in the %s state',
    (status) => {
      const { document, root } = mountHarness();
      document.playButton.click();
      harness.simulation.mockImplementationOnce((state: GameState) => ({
        ...state,
        status,
      }));

      harness.onStep?.();

      expect(root.dataset.gameStatus).toBe(status);
      expectActionState(document, {
        playDisabled: true,
        playClass: 'button',
        pauseDisabled: true,
        pauseClass: 'button',
        pauseLabel: 'Pause',
      });
    },
  );

  it('preserves a queued turn across pause and rejects replacement input while paused', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    harness.inputOptions?.onDirection('up');

    document.pauseButton.click();
    harness.inputOptions?.onDirection('left');
    harness.onStep?.();
    expect(harness.simulation).not.toHaveBeenCalled();
    expect(root.dataset.inputDirection).toBe('left');
    expect(root.dataset.inputDirectionCount).toBe('2');

    document.pauseButton.click();
    harness.onStep?.();

    expect(harness.simulation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        pendingDirection: 'up',
      }),
      Math.random,
      'solid',
    );
  });

  it('auto-pauses for hidden and blur once, never resumes on restoration, and reports the cause', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    document.hidden = true;

    document.dispatch('visibilitychange');
    document.dispatch('visibilitychange');
    document.defaultView.dispatch('blur');

    expect(root.dataset.gameStatus).toBe('paused');
    expect(document.pauseButton.textContent).toBe('Resume');
    expect(harness.schedulerOperations).toEqual(['start', 'pause']);
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Game paused because the tab was hidden.',
    );

    document.hidden = false;
    document.dispatch('visibilitychange');
    document.defaultView.dispatch('focus');
    expect(root.dataset.gameStatus).toBe('paused');
    expect(harness.schedulerOperations).toEqual(['start', 'pause']);

    document.pauseButton.click();
    document.defaultView.dispatch('blur');
    document.defaultView.dispatch('blur');
    document.hidden = true;
    document.dispatch('visibilitychange');
    expect(root.dataset.gameStatus).toBe('paused');
    expect(harness.schedulerOperations).toEqual([
      'start',
      'pause',
      'start',
      'pause',
    ]);
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      'Game paused because the window lost focus.',
    );
  });

  it('keeps manual and automatic pause intent inert in terminal states while retaining diagnostics', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
    }));
    harness.onStep?.();

    document.pauseButton.click();
    harness.inputOptions?.onPauseToggle({ key: 'p' } as KeyboardEvent);
    document.hidden = true;
    document.dispatch('visibilitychange');
    document.defaultView.dispatch('blur');

    expect(root.dataset.gameStatus).toBe('gameOver');
    expect(root.dataset.pauseIntentCount).toBe('1');
    expect(harness.schedulerOperations).toEqual(['start', 'pause']);
  });

  it('restarts a manually paused run as a fresh running scheduler interval', () => {
    const { document, root } = mountHarness();
    document.playButton.click();
    document.pauseButton.click();

    document.restartButton.click();

    expect(root.dataset).toMatchObject({
      gameStatus: 'running',
      gameScore: '0',
      gameHead: '10,10',
    });
    expect(document.pauseButton.textContent).toBe('Pause');
    expect(harness.schedulerOperations).toEqual(['start', 'pause', 'start']);
    expect(harness.schedulerReset).not.toHaveBeenCalled();
    expect(harness.simulation).not.toHaveBeenCalled();
  });

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
      'solid',
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

  it('timestamps food feedback at the scored transition and stores the consumed head cell', () => {
    const { document } = mountHarness();
    document.defaultView.performance.now.mockReturnValue(1_234.5);
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      food: { x: 2, y: 3 },
      score: 10,
    }));

    harness.onStep?.();

    const feedback = renderFeedback(1_250);
    expect(feedback).toEqual({
      food: {
        type: 'food',
        timestampMs: 1_234.5,
        position: { x: 11, y: 10 },
      },
      terminal: null,
    });
    expect(Object.isFrozen(feedback)).toBe(true);
    expect(Object.isFrozen(feedback?.food)).toBe(true);
    expect(Object.isFrozen(feedback?.food?.position)).toBe(true);
  });

  it('records no food feedback for ordinary movement, pause, resume, or ready state', () => {
    const { document } = mountHarness();

    expect(renderFeedback()).toEqual({ food: null, terminal: null });
    document.playButton.click();
    document.pauseButton.click();
    document.pauseButton.click();
    harness.onStep?.();

    expect(renderFeedback(500)).toEqual({ food: null, terminal: null });
  });

  it.each(['gameOver', 'completed'] as const)(
    'timestamps %s feedback only on the transition into terminal state',
    (status) => {
      const { document } = mountHarness();
      document.defaultView.performance.now.mockReturnValue(2_500);
      document.playButton.click();
      harness.simulation.mockImplementationOnce((state: GameState) => ({
        ...state,
        status,
      }));

      harness.onStep?.();
      const transitionFeedback = renderFeedback(2_520);
      document.defaultView.performance.now.mockReturnValue(9_999);
      harness.onStep?.();

      expect(transitionFeedback).toEqual({
        food: null,
        terminal: { type: 'terminal', timestampMs: 2_500, status },
      });
      expect(Object.isFrozen(transitionFeedback)).toBe(true);
      expect(Object.isFrozen(transitionFeedback?.terminal)).toBe(true);
      expect(renderFeedback(2_540)).toBe(transitionFeedback);
      expect(harness.showResult).toHaveBeenCalledOnce();
    },
  );

  it('clears prior feedback on Restart, Play Again, and Return to Title', () => {
    const { document } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      score: 10,
    }));
    harness.onStep?.();
    expect(renderFeedback(10)?.food).not.toBeNull();

    document.restartButton.click();
    expect(renderFeedback(20)).toEqual({ food: null, terminal: null });

    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'gameOver',
    }));
    harness.onStep?.();
    expect(renderFeedback(30)?.terminal).not.toBeNull();
    dialogElements.playAgainButton?.click();
    expect(renderFeedback(40)).toEqual({ food: null, terminal: null });

    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status: 'completed',
    }));
    harness.onStep?.();
    expect(renderFeedback(50)?.terminal).not.toBeNull();
    dialogElements.returnToTitleButton?.click();
    expect(renderFeedback(60)).toEqual({ food: null, terminal: null });
  });

  it('does not mutate feedback through retained callbacks after teardown', () => {
    const { document, teardown } = mountHarness();
    document.playButton.click();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...movingState(state),
      score: 10,
    }));
    harness.onStep?.();
    const feedbackBeforeTeardown = renderFeedback(100);
    const retainedStep = harness.onStep;
    const readsBeforeTeardown =
      document.defaultView.localStorage.getItem.mock.calls.length;
    const writesBeforeTeardown =
      document.defaultView.localStorage.setItem.mock.calls.length;
    const hudUpdatesBeforeTeardown =
      harness.updateHudBestScore.mock.calls.length;

    teardown();
    retainedStep?.();

    expect(renderFeedback(200)).toBe(feedbackBeforeTeardown);
    expect(document.defaultView.localStorage.getItem).toHaveBeenCalledTimes(
      readsBeforeTeardown,
    );
    expect(document.defaultView.localStorage.setItem).toHaveBeenCalledTimes(
      writesBeforeTeardown,
    );
    expect(harness.updateHudBestScore).toHaveBeenCalledTimes(
      hudUpdatesBeforeTeardown,
    );
  });

  it.each([
    ['gameOver', 'Game over. Final score 30.'],
    ['completed', 'Grid complete. Final score 30.'],
  ] as const)('stops once and opens the %s result', (status, announcement) => {
    const { document } = mountHarness();
    document.playButton.click();
    harness.announce.mockClear();
    harness.simulation.mockImplementationOnce((state: GameState) => ({
      ...state,
      status,
      score: 30,
    }));

    harness.onStep?.();
    harness.onStep?.();

    expect(harness.schedulerPause).toHaveBeenCalledOnce();
    expect(harness.closeSettings).toHaveBeenCalledOnce();
    expect(harness.showResult).toHaveBeenCalledWith(status, 30, true);
    expect(harness.closeSettings.mock.invocationCallOrder[0]).toBeLessThan(
      harness.showResult.mock.invocationCallOrder[0] ?? 0,
    );
    expect(harness.announce).toHaveBeenCalledOnce();
    expect(harness.announce).toHaveBeenCalledWith(
      expect.anything(),
      announcement,
    );
  });

  it('restarts running games, supports Play Again, and returns to a focused ready start', () => {
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
    document.pauseButton.focus.mockClear();

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
    expect(document.pauseButton.focus).toHaveBeenCalledOnce();

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
      'Returned to start.',
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
    const pauseIntent = harness.inputOptions?.onPauseToggle;
    const blur = [...(document.defaultView.listeners.get('blur') ?? [])][0];
    const visibility = [
      ...(document.listeners.get('visibilitychange') ?? []),
    ][0];
    const statusBeforeTeardown = root.dataset.gameStatus;

    teardown();
    teardown();
    step?.();
    pauseIntent?.({ key: 'p' } as KeyboardEvent);
    blur?.();
    visibility?.();
    document.pauseButton.click();
    document.restartButton.click();
    dialogElements.playAgainButton?.click();

    expect(harness.schedulerDispose).toHaveBeenCalledOnce();
    expect(harness.dialogTeardown).toHaveBeenCalledOnce();
    expect(harness.inputTeardown).toHaveBeenCalledOnce();
    expect(harness.presentationStop).toHaveBeenCalledOnce();
    expect(harness.simulation).not.toHaveBeenCalled();
    expect(root.dataset.gameStatus).toBe(statusBeforeTeardown);
    expect(root.dataset.pauseIntentCount).toBeUndefined();
    expect(harness.schedulerStart).toHaveBeenCalledOnce();
    expect(document.defaultView.listeners.get('blur')?.size).toBe(0);
    expect(document.listeners.get('visibilitychange')?.size).toBe(0);
    expect(document.pauseButton.listeners.get('click')?.size).toBe(0);
  });
});

describe('gameplay UI helpers', () => {
  it('provides concise nonvisual arena, score, settings, and result descriptions', async () => {
    const { document } = mountHarness();
    const shellMarkup = document.shell.innerHTML.replaceAll(/\s+/g, ' ');
    expect(shellMarkup).toContain(
      'Guide the snake to food. Wall or body collisions end the run.',
    );
    expect(shellMarkup).toContain('Press P to pause or resume.');

    const { createDialogs } = await vi.importActual<
      typeof import('../../src/ui/dialogs')
    >('../../src/ui/dialogs');
    const dialogs = createDialogs(
      document.settingsButton as unknown as HTMLButtonElement,
      {
        version: 3,
        music: true,
        musicStyle: 'neonPulse',
        soundEffects: true,
        reducedMotion: false,
        highContrast: false,
        wallMode: 'solid',
      },
    );
    const settings = dialogs.settingsDialog as unknown as FakeElement;
    const result = dialogs.gameOverDialog as unknown as FakeElement;
    expect(settings.attributes.get('aria-describedby')).toBe(
      'settings-description',
    );
    expect(settings.innerHTML).toContain(
      'Choose audio, gameplay, and visual preferences.',
    );
    expect(settings.innerHTML).toContain('<span>Walls</span>');
    expect(settings.innerHTML).toContain('>Wrap-around</option>');
    expect(result.attributes.get('aria-describedby')).toBe('result-summary');
    expect(result.innerHTML).toContain('id="result-summary"');

    const { createHud } =
      await vi.importActual<typeof import('../../src/ui/hud')>(
        '../../src/ui/hud',
      );
    const hud = createHud() as unknown as FakeElement;
    expect(hud.innerHTML).toContain('<dt>Best score</dt>');
  });

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
      {
        version: 3,
        music: false,
        musicStyle: 'pixelDrift',
        soundEffects: true,
        reducedMotion: true,
        highContrast: false,
        wallMode: 'wrapAround',
      },
    );

    expect(dialogs.settingsControls.music.checked).toBe(false);
    expect(dialogs.settingsControls.musicStyle.value).toBe('pixelDrift');
    expect(dialogs.settingsControls.soundEffects.checked).toBe(true);
    expect(dialogs.settingsControls.reducedMotion.checked).toBe(true);
    expect(dialogs.settingsControls.highContrast.checked).toBe(false);
    expect(dialogs.settingsControls.wallMode.value).toBe('wrapAround');

    dialogs.showResult(status, 40, true);

    expect(document.resultTitle.textContent).toBe(title);
    expect(document.finalScore.textContent).toBe('40');
    expect(document.newBest.hidden).toBe(false);
    expect(document.dialogPlayAgainButton.focus).toHaveBeenCalledOnce();
    expect(dialogs.gameOverDialog.open).toBe(true);
    expect(
      (dialogs.gameOverDialog as unknown as FakeElement).attributes.get(
        'aria-describedby',
      ),
    ).toBe('result-summary result-best');

    dialogs.showResult(status, 40, false);
    expect(document.newBest.hidden).toBe(true);
    expect(
      (dialogs.gameOverDialog as unknown as FakeElement).attributes.get(
        'aria-describedby',
      ),
    ).toBe('result-summary');
  });

  it('closes settings narrowly and removes every dialog listener on teardown', async () => {
    const document = new FakeDocument();
    vi.stubGlobal('document', document);
    const { createDialogs } = await vi.importActual<
      typeof import('../../src/ui/dialogs')
    >('../../src/ui/dialogs');
    const dialogs = createDialogs(
      document.settingsButton as unknown as HTMLButtonElement,
      {
        version: 3,
        music: true,
        musicStyle: 'neonPulse',
        soundEffects: true,
        reducedMotion: false,
        highContrast: false,
        wallMode: 'solid',
      },
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

  it('updates current and Best HUD scores independently', async () => {
    const document = new FakeDocument();
    const hud = new FakeElement('section', document);
    const { updateHudBestScore, updateHudScore } =
      await vi.importActual<typeof import('../../src/ui/hud')>(
        '../../src/ui/hud',
      );

    updateHudScore(hud as unknown as HTMLElement, 10);

    expect(document.scoreValue.textContent).toBe('10');
    expect(document.bestScoreValue.textContent).toBe('');

    updateHudBestScore(hud as unknown as HTMLElement, 40);

    expect(document.scoreValue.textContent).toBe('10');
    expect(document.bestScoreValue.textContent).toBe('40');
  });
});
