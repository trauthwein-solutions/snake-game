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

export function mountApp(root: HTMLElement): () => void {
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
        Use arrow keys or swipe to guide the snake. WASD and the D-pad work too.
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

  const hud = createHud();
  hudMount.replaceWith(hud);
  const touchControls = createTouchControls(canvas.ownerDocument);
  touchControlsMount.replaceWith(touchControls.element);
  const dialogs = createDialogs(settingsButton);
  const announcer = createAnnouncer();
  shell.append(dialogs.settingsDialog, dialogs.gameOverDialog, announcer);

  root.replaceChildren(shell);
  root.dataset.ready = 'true';

  const view = canvas.ownerDocument.defaultView;
  let bestScoreStorage: BestScoreStorage | undefined;
  try {
    bestScoreStorage = view?.localStorage;
  } catch {
    bestScoreStorage = undefined;
  }

  let state: GameState = createInitialState();
  let bestScore = loadBestScore(bestScoreStorage);
  let runStartingBest: number | undefined;
  let feedback: ArcadeFeedback = EMPTY_ARCADE_FEEDBACK;
  let tornDown = false;

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
  let applyManualPauseIntent = (): void => {};
  const recordPauseIntent = (): void => {
    if (tornDown) {
      return;
    }
    root.dataset.pauseIntent = 'toggle';
    root.dataset.pauseIntentCount = String(
      Number(root.dataset.pauseIntentCount ?? 0) + 1,
    );
    applyManualPauseIntent();
  };
  const teardownInput = createInputController({
    keyboardTarget: canvas.ownerDocument,
    arena: canvas,
    touchControls,
    onDirection: recordDirection,
    onPauseToggle: recordPauseIntent,
  });

  const reducedMotionQuery = view?.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  const presentationLoop = createPresentationLoop({
    cancelAnimationFrame: view?.cancelAnimationFrame.bind(view),
    prefersReducedMotion: () => reducedMotionQuery?.matches === true,
    render: (timestampMs, reducedMotion) => {
      renderGameFrame(canvas, state, {
        timestampMs,
        reducedMotion,
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

  reducedMotionQuery?.addEventListener(
    'change',
    presentationLoop.syncMotionPreference,
  );

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
        saveBestScore(bestScoreStorage, bestScore);
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

      if (scoreIncreased) {
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

  const pauseRunningGame = (announcement: string): void => {
    if (tornDown || state.status !== 'running') {
      return;
    }

    state = applyCommand(state, { type: 'pause' });
    scheduler.pause();
    updateStateView();
    presentationLoop.redraw();
    announce(announcer, announcement);
  };

  const resumePausedGame = (): void => {
    if (tornDown || state.status !== 'paused') {
      return;
    }

    getGameplayView();
    state = applyCommand(state, { type: 'resume' });
    scheduler.start();
    updateStateView();
    presentationLoop.redraw();
    announce(announcer, 'Game resumed.');
  };

  applyManualPauseIntent = (): void => {
    if (state.status === 'running') {
      pauseRunningGame('Game paused.');
    } else if (state.status === 'paused') {
      resumePausedGame();
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

  const startReadyGame = (): void => {
    if (tornDown || state.status !== 'ready') {
      return;
    }

    getGameplayView();
    runStartingBest = bestScore;
    state = applyCommand(state, { type: 'start' });
    updateStateView();
    pauseButton.focus();
    presentationLoop.redraw();
    scheduler.start();
    announce(announcer, 'Game started.');
  };

  const restartAndStart = (): void => {
    if (tornDown) {
      return;
    }

    getGameplayView();
    runStartingBest = bestScore;
    clearFeedback();
    state = applyCommand(state, { type: 'restart' });
    state = applyCommand(state, { type: 'start' });
    dialogs.closeResult();
    updateStateView();
    presentationLoop.redraw();

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
    playButton.removeEventListener('click', startReadyGame);
    pauseButton.removeEventListener('click', recordPauseIntent);
    restartButton.removeEventListener('click', restartAndStart);
    dialogs.playAgainButton.removeEventListener('click', restartAndStart);
    dialogs.returnToTitleButton.removeEventListener('click', returnToTitle);
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
      presentationLoop.syncMotionPreference,
    );
  };
}
