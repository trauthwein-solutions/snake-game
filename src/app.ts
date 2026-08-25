import type { GameAudioFactory, GameAudioSnapshot } from './audio/game-audio';
import { createWebGameAudio } from './audio/web-audio';
import { applyCommand, createInitialState } from './engine/game-engine';
import type { Direction, GameState } from './engine/model';
import {
  advanceSimulation,
  tickIntervalForSpeedTier,
} from './engine/simulation';
import { createInputController } from './input/input-controller';
import { createTouchControls } from './input/touch-controls';
import { renderGameFrame } from './rendering/canvas-renderer';
import {
  EMPTY_ARCADE_FEEDBACK,
  type ArcadeFeedback,
  type FoodFeedbackEvent,
  type TerminalFeedbackEvent,
} from './rendering/effects';
import { createPresentationLoop } from './rendering/presentation-loop';
import { createFixedStepScheduler } from './timing/fixed-step-scheduler';
import {
  loadBestScore,
  saveBestScore,
  type BestScoreStorage,
} from './storage/best-score';
import {
  loadPreferences,
  savePreferences,
  type Preferences,
  type PreferencesStorage,
} from './storage/preferences';
import { announce, createAnnouncer } from './ui/announcer';
import { createDialogs } from './ui/dialogs';
import { createHud, updateHudBestScore, updateHudScore } from './ui/hud';

const enteredTerminalStatus = (
  previousStatus: GameState['status'],
  nextStatus: GameState['status'],
): 'gameOver' | 'completed' | null => {
  if (
    nextStatus !== previousStatus &&
    (nextStatus === 'gameOver' || nextStatus === 'completed')
  ) {
    return nextStatus;
  }
  return null;
};

export function mountApp(
  root: HTMLElement,
  audioFactory: GameAudioFactory = createWebGameAudio,
): () => void {
  const shell = document.createElement('main');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <header class="hero">
      <p class="eyebrow">Neon arcade</p>
      <h1>SNAKISH</h1>
      <p class="subtitle">Enter the grid.</p>
    </header>

    <section class="game-panel" aria-label="Game controls and arena">
      <div data-hud></div>

      <div class="arena-frame">
        <canvas
          class="arena-canvas"
          role="img"
          aria-label="SNAKISH game arena"
          aria-describedby="arena-instructions"
          data-render-target="arena"
        >
          SNAKISH game arena. Use the nearby instructions to play.
        </canvas>
      </div>

      <p class="instructions" id="arena-instructions">
        Guide the snake to food. Wall or body collisions end the run. Use arrow
        keys or WASD, swipe the arena, or use the D-pad. Press P to pause or
        resume.
      </p>

      <div data-touch-controls></div>

      <div class="game-actions" aria-label="Game actions">
        <button class="button button--primary" type="button" data-action="play">
          Play
        </button>
        <button class="button" type="button" data-action="pause">
          Pause
        </button>
        <button class="button" type="button" data-action="restart">
          Restart
        </button>
        <button class="button" type="button" data-action="settings">
          Settings
        </button>
      </div>
    </section>
  `;

  const hudMount = shell.querySelector<HTMLElement>('[data-hud]');
  const settingsButton = shell.querySelector<HTMLButtonElement>(
    '[data-action="settings"]',
  );
  const playButton = shell.querySelector<HTMLButtonElement>(
    '[data-action="play"]',
  );
  const pauseButton = shell.querySelector<HTMLButtonElement>(
    '[data-action="pause"]',
  );
  const restartButton = shell.querySelector<HTMLButtonElement>(
    '[data-action="restart"]',
  );
  const canvas = shell.querySelector<HTMLCanvasElement>(
    '[data-render-target="arena"]',
  );
  const touchControlsMount = shell.querySelector<HTMLElement>(
    '[data-touch-controls]',
  );

  if (
    hudMount === null ||
    settingsButton === null ||
    playButton === null ||
    pauseButton === null ||
    restartButton === null ||
    canvas === null ||
    touchControlsMount === null
  ) {
    throw new Error('SNAKISH interface controls could not be created.');
  }

  const view = canvas.ownerDocument.defaultView;
  let storage: (BestScoreStorage & PreferencesStorage) | undefined;
  try {
    storage = view?.localStorage;
  } catch {
    storage = undefined;
  }

  let preferences = loadPreferences(storage);
  const reducedMotionQuery = view?.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  const prefersReducedMotion = (): boolean =>
    preferences.reducedMotion || reducedMotionQuery?.matches === true;
  const publishVisualPreferences = (): void => {
    const highContrast = String(preferences.highContrast);
    const reducedMotion = String(prefersReducedMotion());
    root.dataset.highContrast = highContrast;
    root.dataset.reducedMotion = reducedMotion;
    shell.dataset.highContrast = highContrast;
    shell.dataset.reducedMotion = reducedMotion;
  };

  const hud = createHud();
  hudMount.replaceWith(hud);
  const touchControls = createTouchControls(canvas.ownerDocument);
  touchControlsMount.replaceWith(touchControls.element);
  const dialogs = createDialogs(settingsButton, preferences);
  const announcer = createAnnouncer();
  shell.append(dialogs.settingsDialog, dialogs.gameOverDialog, announcer);

  publishVisualPreferences();
  root.replaceChildren(shell);
  root.dataset.ready = 'true';

  let state: GameState = createInitialState();
  let bestScore = loadBestScore(storage);
  let runStartingBest: number | undefined;
  let feedback: ArcadeFeedback = EMPTY_ARCADE_FEEDBACK;
  let tornDown = false;
  let runId = 0;
  const gameAudio = audioFactory(view ?? undefined);
  const audioSnapshot = (): GameAudioSnapshot => ({
    status: state.status,
    runId,
    musicEnabled: preferences.music,
    soundEffectsEnabled: preferences.soundEffects,
  });
  const syncAudio = (activation?: Event): void => {
    if (activation === undefined) {
      gameAudio.sync(audioSnapshot());
    } else {
      gameAudio.sync(audioSnapshot(), activation);
    }
  };

  syncAudio();

  const clearFeedback = (): void => {
    feedback = EMPTY_ARCADE_FEEDBACK;
  };

  const recordFoodFeedback = (timestampMs: number): void => {
    const head = state.snake[0];
    if (head === undefined) {
      return;
    }

    const event: FoodFeedbackEvent = Object.freeze({
      type: 'food',
      timestampMs,
      position: Object.freeze({ x: head.x, y: head.y }),
    });
    feedback = Object.freeze({ ...feedback, food: event });
  };

  const recordTerminalFeedback = (
    timestampMs: number,
    status: 'gameOver' | 'completed',
  ): void => {
    const event: TerminalFeedbackEvent = Object.freeze({
      type: 'terminal',
      timestampMs,
      status,
    });
    feedback = Object.freeze({ ...feedback, terminal: event });
  };

  const updateStateView = (): void => {
    const head = state.snake[0];
    const playIsActionable = state.status === 'ready';
    const pauseIsActionable =
      state.status === 'running' || state.status === 'paused';
    root.dataset.gameStatus = state.status;
    root.dataset.gameScore = String(state.score);
    root.dataset.gameHead = head === undefined ? '' : `${head.x},${head.y}`;
    playButton.disabled = !playIsActionable;
    playButton.className = playIsActionable
      ? 'button button--primary'
      : 'button';
    pauseButton.disabled = !pauseIsActionable;
    pauseButton.className = pauseIsActionable
      ? 'button button--primary'
      : 'button';
    pauseButton.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
    updateHudScore(hud, state.score);
    updateHudBestScore(hud, bestScore);
  };

  updateStateView();

  const recordDirection = (direction: Direction): void => {
    if (tornDown) {
      return;
    }
    root.dataset.inputDirection = direction;
    root.dataset.inputDirectionCount = String(
      Number(root.dataset.inputDirectionCount ?? 0) + 1,
    );
    state = applyCommand(state, { type: 'turn', direction });
  };
  let applyManualPauseIntent: (activation?: Event) => void = () => {};
  const recordPauseIntent = (event?: Event): void => {
    if (tornDown) {
      return;
    }
    root.dataset.pauseIntent = 'toggle';
    root.dataset.pauseIntentCount = String(
      Number(root.dataset.pauseIntentCount ?? 0) + 1,
    );
    const activation =
      event !== undefined && 'key' in event && event.key === 'Escape'
        ? undefined
        : event;
    applyManualPauseIntent(activation);
  };
  const teardownInput = createInputController({
    keyboardTarget: canvas.ownerDocument,
    arena: canvas,
    touchControls,
    onDirection: recordDirection,
    onPauseToggle: recordPauseIntent,
  });

  const presentationLoop = createPresentationLoop({
    cancelAnimationFrame: view?.cancelAnimationFrame.bind(view),
    prefersReducedMotion,
    render: (timestampMs, reducedMotion) => {
      renderGameFrame(canvas, state, {
        timestampMs,
        reducedMotion,
        colorMode: preferences.highContrast ? 'high-contrast' : 'normal',
        feedback,
      });
    },
    requestAnimationFrame: view?.requestAnimationFrame.bind(view),
  });

  const ResizeObserverConstructor = view?.ResizeObserver;
  let resizeObserver: ResizeObserver | undefined;
  if (ResizeObserverConstructor !== undefined) {
    resizeObserver = new ResizeObserverConstructor(presentationLoop.redraw);
    resizeObserver.observe(canvas);
  }

  const handleReducedMotionChange = (): void => {
    if (tornDown) {
      return;
    }
    publishVisualPreferences();
    presentationLoop.syncMotionPreference();
  };
  reducedMotionQuery?.addEventListener('change', handleReducedMotionChange);

  const settingKeys = [
    'music',
    'soundEffects',
    'reducedMotion',
    'highContrast',
  ] as const;
  const settingListeners = settingKeys.map((key) => {
    const control = dialogs.settingsControls[key];
    const handleClick = (event: Event): void => {
      if (tornDown || (key !== 'music' && key !== 'soundEffects')) {
        return;
      }

      gameAudio.sync(
        Object.freeze({
          ...audioSnapshot(),
          musicEnabled: key === 'music' ? control.checked : preferences.music,
          soundEffectsEnabled:
            key === 'soundEffects' ? control.checked : preferences.soundEffects,
        }),
        event,
      );
    };
    const handleChange = (): void => {
      if (tornDown || control.checked === preferences[key]) {
        return;
      }

      preferences = Object.freeze({
        ...preferences,
        [key]: control.checked,
      }) as Preferences;
      savePreferences(storage, preferences);

      if (key === 'music' || key === 'soundEffects') {
        syncAudio();
      }

      if (key === 'reducedMotion') {
        publishVisualPreferences();
        presentationLoop.syncMotionPreference();
      } else if (key === 'highContrast') {
        publishVisualPreferences();
        presentationLoop.redraw();
      }
    };
    control.addEventListener('click', handleClick);
    control.addEventListener('change', handleChange);
    return { control, handleChange, handleClick };
  });

  let resolutionQuery: MediaQueryList | undefined;
  let resolutionDevicePixelRatio: number | undefined;
  const armResolutionQuery = (): void => {
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    if (view === null || view === undefined) {
      resolutionQuery = undefined;
      resolutionDevicePixelRatio = undefined;
      return;
    }

    resolutionDevicePixelRatio = view.devicePixelRatio;
    resolutionQuery = view.matchMedia(
      `(resolution: ${resolutionDevicePixelRatio}dppx)`,
    );
    resolutionQuery.addEventListener('change', handleResolutionChange);
  };
  const handleResolutionChange = (): void => {
    presentationLoop.redraw();
    armResolutionQuery();
  };
  const handleResize = (): void => {
    presentationLoop.redraw();
    if (view?.devicePixelRatio !== resolutionDevicePixelRatio) {
      armResolutionQuery();
    }
  };

  view?.addEventListener('resize', handleResize);
  armResolutionQuery();

  const getGameplayView = (): Window => {
    if (
      view === null ||
      view === undefined ||
      typeof view.performance?.now !== 'function' ||
      typeof view.setTimeout !== 'function' ||
      typeof view.clearTimeout !== 'function'
    ) {
      throw new Error(
        'SNAKISH cannot start because browser timing APIs are unavailable.',
      );
    }

    return view;
  };

  const scheduler = createFixedStepScheduler({
    now: () => {
      return getGameplayView().performance.now();
    },
    schedule: (callback, delayMs) => {
      return getGameplayView().setTimeout(callback, delayMs);
    },
    cancel: (timerId) => {
      getGameplayView().clearTimeout(timerId);
    },
    getIntervalMs: () => tickIntervalForSpeedTier(state.speedTier),
    onStep: () => {
      if (tornDown || state.status !== 'running') {
        return;
      }

      const previousScore = state.score;
      const previousStatus: GameState['status'] = state.status;
      state = advanceSimulation(state, Math.random);
      const scoreIncreased = state.score > previousScore;
      if (state.score > bestScore) {
        bestScore = state.score;
        saveBestScore(storage, bestScore);
      }
      const terminalStatus = enteredTerminalStatus(
        previousStatus,
        state.status,
      );
      if (scoreIncreased || terminalStatus !== null) {
        const feedbackTimestampMs = getGameplayView().performance.now();
        if (scoreIncreased) {
          recordFoodFeedback(feedbackTimestampMs);
        }
        if (terminalStatus !== null) {
          recordTerminalFeedback(feedbackTimestampMs, terminalStatus);
        }
      }
      updateStateView();
      presentationLoop.redraw();

      if (terminalStatus !== null) {
        syncAudio();
        gameAudio.play(terminalStatus);
      } else if (scoreIncreased) {
        gameAudio.play('food');
      }

      if (scoreIncreased && terminalStatus === null) {
        announce(announcer, `Score ${state.score}.`);
      }

      if (terminalStatus !== null) {
        if (scheduler.isRunning()) {
          scheduler.pause();
        }
        dialogs.closeSettings();
        dialogs.showResult(
          terminalStatus,
          state.score,
          runStartingBest !== undefined && state.score > runStartingBest,
        );
        announce(
          announcer,
          terminalStatus === 'completed'
            ? `Grid complete. Final score ${state.score}.`
            : `Game over. Final score ${state.score}.`,
        );
      }
    },
  });

  const pauseRunningGame = (
    announcement: string,
    activation?: Event,
    playCue = false,
  ): void => {
    if (tornDown || state.status !== 'running') {
      return;
    }

    state = applyCommand(state, { type: 'pause' });
    scheduler.pause();
    updateStateView();
    presentationLoop.redraw();
    syncAudio(activation);
    if (playCue) {
      gameAudio.play('pause');
    }
    announce(announcer, announcement);
  };

  const resumePausedGame = (activation?: Event): void => {
    if (tornDown || state.status !== 'paused') {
      return;
    }

    getGameplayView();
    state = applyCommand(state, { type: 'resume' });
    scheduler.start();
    updateStateView();
    presentationLoop.redraw();
    syncAudio(activation);
    gameAudio.play('resume');
    announce(announcer, 'Game resumed.');
  };

  applyManualPauseIntent = (activation?: Event): void => {
    if (state.status === 'running') {
      pauseRunningGame('Game paused.', activation, true);
    } else if (state.status === 'paused') {
      resumePausedGame(activation);
    } else if (activation !== undefined) {
      syncAudio(activation);
    }
  };

  const gameplayDocument = canvas.ownerDocument;
  const handleVisibilityChange = (): void => {
    if (gameplayDocument.hidden) {
      pauseRunningGame('Game paused because the tab was hidden.');
    }
  };
  const handleBlur = (): void => {
    pauseRunningGame('Game paused because the window lost focus.');
  };

  const startReadyGame = (activation: Event): void => {
    if (tornDown || state.status !== 'ready') {
      return;
    }

    getGameplayView();
    runStartingBest = bestScore;
    runId += 1;
    state = applyCommand(state, { type: 'start' });
    updateStateView();
    syncAudio(activation);
    pauseButton.focus();
    presentationLoop.redraw();
    scheduler.start();
    announce(announcer, 'Game started.');
  };

  const restartAndStart = (activation: Event): void => {
    if (tornDown) {
      return;
    }

    getGameplayView();
    runStartingBest = bestScore;
    runId += 1;
    clearFeedback();
    state = applyCommand(state, { type: 'restart' });
    state = applyCommand(state, { type: 'start' });
    dialogs.closeResult();
    updateStateView();
    pauseButton.focus();
    presentationLoop.redraw();
    syncAudio(activation);

    if (scheduler.isRunning()) {
      scheduler.reset();
    } else {
      scheduler.start();
    }
    announce(announcer, 'Game restarted.');
  };

  const returnToTitle = (): void => {
    if (tornDown) {
      return;
    }

    if (scheduler.isRunning()) {
      scheduler.pause();
    }
    clearFeedback();
    state = applyCommand(state, { type: 'restart' });
    runStartingBest = undefined;
    dialogs.closeResult();
    updateStateView();
    presentationLoop.redraw();
    syncAudio();
    announce(announcer, 'Returned to title.');
    playButton.focus();
  };

  playButton.addEventListener('click', startReadyGame);
  pauseButton.addEventListener('click', recordPauseIntent);
  restartButton.addEventListener('click', restartAndStart);
  dialogs.playAgainButton.addEventListener('click', restartAndStart);
  dialogs.returnToTitleButton.addEventListener('click', returnToTitle);
  gameplayDocument.addEventListener('visibilitychange', handleVisibilityChange);
  view?.addEventListener('blur', handleBlur);

  return () => {
    if (tornDown) {
      return;
    }
    tornDown = true;
    gameAudio.dispose();
    playButton.removeEventListener('click', startReadyGame);
    pauseButton.removeEventListener('click', recordPauseIntent);
    restartButton.removeEventListener('click', restartAndStart);
    dialogs.playAgainButton.removeEventListener('click', restartAndStart);
    dialogs.returnToTitleButton.removeEventListener('click', returnToTitle);
    for (const { control, handleChange, handleClick } of settingListeners) {
      control.removeEventListener('click', handleClick);
      control.removeEventListener('change', handleChange);
    }
    dialogs.teardown();
    scheduler.dispose();
    teardownInput();
    presentationLoop.stop();
    resizeObserver?.disconnect();
    view?.removeEventListener('resize', handleResize);
    view?.removeEventListener('blur', handleBlur);
    gameplayDocument.removeEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    reducedMotionQuery?.removeEventListener(
      'change',
      handleReducedMotionChange,
    );
  };
}
